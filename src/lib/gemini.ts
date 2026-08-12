import { GoogleGenerativeAI, SchemaType, TaskType } from '@google/generative-ai';
import { VISUAL_TYPES, type LearningCard } from './lecture-types';

export type { LearningCard };

const GENERATION_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';

/** Gemini's free tier caps batch embedding requests; stay well under it. */
const EMBED_BATCH_SIZE = 50;

/**
 * Must match the `vector(768)` column in supabase/schema.sql.
 *
 * gemini-embedding-001 returns 3072 dimensions by default. Those cannot be
 * indexed by pgvector (both ivfflat and hnsw cap at 2000), so we ask the API to
 * truncate. The model is trained with Matryoshka representation learning, so a
 * 768-dimension output is a first-class embedding rather than a lossy slice.
 */
const EMBEDDING_DIMENSIONS = 768;

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export function isGeminiConfigured(): boolean {
  return geminiKeys().length > 0;
}

/**
 * Configured keys in preference order.
 *
 * Free-tier quota is enforced per Google Cloud *project*, so a second key only
 * adds headroom if it comes from a different project. Two keys from the same
 * project still give redundancy (one being revoked or rotated), just not extra
 * requests.
 */
function geminiKeys(): string[] {
  return [process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2].filter(
    (key): key is string => Boolean(key && key.trim()),
  );
}

/**
 * Keys known to have burned their daily allowance, and when to trust them again.
 *
 * Held on globalThis so the knowledge survives hot reloads — otherwise every
 * edit would send the next request back to a key we already know is spent.
 */
const exhaustedUntil = ((globalThis as typeof globalThis & { __skillrotKeyCooldown?: Map<string, number> })
  .__skillrotKeyCooldown ??= new Map<string, number>());

/** Google resets free-tier daily quota at midnight Pacific. */
function nextPacificMidnight(): number {
  const now = new Date();
  const pacific = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const reset = new Date(pacific);
  reset.setHours(24, 0, 0, 0);
  return now.getTime() + (reset.getTime() - pacific.getTime());
}

function isUsable(key: string): boolean {
  const until = exhaustedUntil.get(key);
  if (until === undefined) return true;
  if (Date.now() >= until) {
    exhaustedUntil.delete(key);
    return true;
  }
  return false;
}

function markExhausted(key: string): void {
  exhaustedUntil.set(key, nextPacificMidnight());
}

/** Short, non-secret identifier for logs. */
function keyLabel(key: string): string {
  return `…${key.slice(-6)}`;
}

function clientFor(apiKey: string): GoogleGenerativeAI {
  return new GoogleGenerativeAI(apiKey);
}

/** Thrown when the daily free-tier allowance is gone. Retrying cannot fix it. */
export class QuotaExhaustedError extends Error {
  readonly scope: 'day' | 'project';

  constructor(scope: 'day' | 'project', keyCount = 1) {
    const keysPhrase = keyCount > 1 ? `All ${keyCount} Gemini keys are` : "Gemini's free daily quota is";
    super(
      scope === 'day'
        ? `${keysPhrase} out of daily quota for this model. It resets at midnight Pacific time.`
        : "No configured Gemini key has quota for this model. Check GEMINI_MODEL and each key's billing status.",
    );
    this.name = 'QuotaExhaustedError';
    this.scope = scope;
  }
}

const MAX_ATTEMPTS = 4;
/** 2s → 4s → 8s → 16s, per the agreed backoff schedule. */
const BASE_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 20000;

interface RateLimitInfo {
  retryable: boolean;
  delayMs: number | null;
  exhausted: 'day' | 'project' | null;
}

/**
 * Classifies a Gemini failure.
 *
 * The distinction that matters is per-minute vs per-day. A `PerMinute` quota
 * clears on its own, so backing off is exactly right. A `PerDay` quota does not
 * — it returns `retryDelay: "0s"` and stays failed until midnight Pacific, so
 * retrying it only adds tens of seconds of latency before the same error.
 */
function classifyGeminiError(error: unknown): RateLimitInfo {
  const message = error instanceof Error ? error.message : String(error);

  if (/limit:\s*0\b/.test(message)) {
    return { retryable: false, delayMs: null, exhausted: 'project' };
  }

  if (/\b429\b/.test(message) || /RESOURCE_EXHAUSTED/i.test(message)) {
    if (/PerDay/i.test(message)) {
      return { retryable: false, delayMs: null, exhausted: 'day' };
    }

    // Gemini reports how long to wait; honour it rather than guessing.
    const hinted = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(message);
    const delayMs = hinted ? Math.ceil(Number(hinted[1]) * 1000) : null;

    return { retryable: true, delayMs: delayMs && delayMs > 0 ? delayMs : null, exhausted: null };
  }

  if (/\b(500|502|503|504)\b/.test(message)) {
    return { retryable: true, delayMs: null, exhausted: null };
  }

  return { retryable: false, delayMs: null, exhausted: null };
}

/**
 * Shared wrapper for every Gemini call — scene scripts, cards, skills,
 * embeddings and answers all funnel through here so one policy governs the
 * whole key's quota.
 */
export async function callGeminiWithRetry<T>(operation: (apiKey: string) => Promise<T>): Promise<T> {
  const keys = geminiKeys();
  if (keys.length === 0) {
    throw new Error('GEMINI_API_KEY is not set. Add it to .env.local and restart the dev server.');
  }

  // Skip keys already known to be spent for the day, but keep them as a last
  // resort in case the cooldown estimate is wrong.
  const ordered = [...keys.filter(isUsable), ...keys.filter((key) => !isUsable(key))];
  let lastError: unknown;

  for (const apiKey of ordered) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        return await operation(apiKey);
      } catch (error) {
        lastError = error;
        const info = classifyGeminiError(error);

        if (info.exhausted === 'day') {
          markExhausted(apiKey);
          console.warn(`[gemini] key ${keyLabel(apiKey)} is out of daily quota; trying the next key`);
          break; // move to the next key rather than retrying this one
        }
        if (info.exhausted === 'project') {
          // A misconfigured project fails identically forever; another key may
          // still be fine, so fall through to it instead of aborting.
          console.warn(`[gemini] key ${keyLabel(apiKey)} has no quota for this model; trying the next key`);
          break;
        }
        if (!info.retryable || attempt === MAX_ATTEMPTS - 1) throw error;

        const backoff = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
        const waitMs = Math.min(info.delayMs ?? backoff, MAX_BACKOFF_MS);
        console.warn(`[gemini] attempt ${attempt + 1} failed, retrying in ${waitMs}ms`);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
  }

  // Every configured key is spent.
  if (lastError && classifyGeminiError(lastError).exhausted) {
    throw new QuotaExhaustedError(classifyGeminiError(lastError).exhausted!, keys.length);
  }
  throw lastError;
}

/**
 * Generates the swipeable learning cards (PRD §5.2).
 *
 * Uses Gemini's structured-output mode rather than parsing prose, because
 * regex-scraping a JSON array out of a chat response is the single most common
 * failure mode in this pipeline and it fails silently (empty carousel).
 */
export async function generateLearningCards(text: string): Promise<LearningCard[]> {
  // A factory, not an instance: the pool decides which key to use per attempt,
  // so the client cannot be bound before the call.
  const modelFor = (apiKey: string) => clientFor(apiKey).getGenerativeModel({
    model: GENERATION_MODEL,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            title: {
              type: SchemaType.STRING,
              description: 'Punchy card title, at most 6 words.',
            },
            content: {
              type: SchemaType.STRING,
              description: 'Two to three sentences explaining the concept in plain language.',
            },
            emoji: {
              type: SchemaType.STRING,
              description: 'A single emoji representing the concept.',
            },
          },
          required: ['title', 'content', 'emoji'],
        },
      },
    },
  });

  const prompt = `You are turning a university lecture into an Instagram-carousel-style study aid.

Read the lecture material below and produce between 5 and 8 learning cards covering its MOST important concepts.

Rules:
- Every card must come from the actual material below. Never invent concepts that are not present.
- Explain like you are talking to a smart friend who has not taken this course. Short sentences, no jargon unless you immediately define it.
- Do NOT copy sentences verbatim from the material. Rewrite them simply.
- Order cards the way a student should learn them (foundational concepts first).
- Each "content" must be 2-3 sentences, and must be concrete — include the actual definition, rule, or example, not a description of what the slide covers.

Lecture material:
"""
${truncate(text, 60000)}
"""`;

  const result = await callGeminiWithRetry((key) => modelFor(key).generateContent(prompt));
  const parsed = safeParseJson<Omit<LearningCard, 'order_index'>[]>(result.response.text());

  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter((card) => card && typeof card.title === 'string' && typeof card.content === 'string')
    .slice(0, 8)
    .map((card, order_index) => ({
      title: card.title,
      content: card.content,
      emoji: card.emoji || '💡',
      order_index,
    }));
}

/**
 * Extracts standardized, roadmap-compatible skill names (PRD §5.4).
 * The prompt pushes hard toward canonical industry terms, because narrow
 * verbatim phrases ("Chapter 3 traversal examples") never match the job dataset.
 */
export async function extractSkills(text: string): Promise<string[]> {
  // A factory, not an instance: the pool decides which key to use per attempt,
  // so the client cannot be bound before the call.
  const modelFor = (apiKey: string) => clientFor(apiKey).getGenerativeModel({
    model: GENERATION_MODEL,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: SchemaType.ARRAY,
        items: { type: SchemaType.STRING },
      },
    },
  });

  const prompt = `Extract the transferable skills and topics taught by the lecture material below.

Rules:
- Return 5 to 12 skills.
- Use STANDARD, industry-recognisable names that would appear in a job description — for example "Data Structures", "Big-O Notation", "SQL", "Statistics", "Machine Learning", "Financial Analysis".
- Do NOT return phrases lifted verbatim from the slides, lecture numbers, chapter titles, or the professor's phrasing.
- Do NOT return overly narrow items ("the three cases of the Master Theorem"); generalise to the skill they belong to ("Algorithm Complexity Analysis").
- Only return skills genuinely covered by the material.
- Title Case each skill.

Lecture material:
"""
${truncate(text, 60000)}
"""`;

  const result = await callGeminiWithRetry((key) => modelFor(key).generateContent(prompt));
  const parsed = safeParseJson<string[]>(result.response.text());

  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter((skill): skill is string => typeof skill === 'string' && skill.trim().length > 1)
    .map((skill) => skill.trim())
    .slice(0, 12);
}

/**
 * Writes the narrated scene script for one learning card (video lecture).
 *
 * Scenes are kept short on purpose: the visual timeline is derived from word
 * count, so a long scene drifts further from its narration. 5-10 seconds keeps
 * the slide and the voice tightly aligned.
 */
export async function generateLectureScript(
  cardTitle: string,
  cardContent: string,
  sourceText: string,
): Promise<{ topic: string; scenes: RawScene[] }> {
  // A factory, not an instance: the pool decides which key to use per attempt,
  // so the client cannot be bound before the call.
  const modelFor = (apiKey: string) => clientFor(apiKey).getGenerativeModel({
    model: GENERATION_MODEL,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: SchemaType.OBJECT,
        properties: {
          topic: { type: SchemaType.STRING, description: 'The topic title for this lecture segment.' },
          scenes: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                narration: {
                  type: SchemaType.STRING,
                  description: 'Spoken narration, 1-3 sentences, 5-10 seconds when read aloud.',
                },
                visual: {
                  type: SchemaType.OBJECT,
                  properties: {
                    type: {
                      type: SchemaType.STRING,
                      format: 'enum',
                      enum: [...VISUAL_TYPES],
                      description: 'Which on-screen template to render.',
                    },
                    content: {
                      type: SchemaType.ARRAY,
                      items: { type: SchemaType.STRING },
                      description:
                        'Short on-screen strings. bullet_reveal/diagram/icon_focus: 2-4 phrases. comparison: exactly 2. formula: the expression then its meaning.',
                    },
                    highlight_term: {
                      type: SchemaType.STRING,
                      description: 'Single key term to emphasise on screen.',
                    },
                    image_query: {
                      type: SchemaType.STRING,
                      description:
                        'Stock-photo search phrase for this scene, 2-5 concrete words describing a PHOTOGRAPHABLE subject.',
                    },
                  },
                  required: ['type', 'content'],
                },
                duration_hint_seconds: { type: SchemaType.NUMBER },
              },
              required: ['narration', 'visual', 'duration_hint_seconds'],
            },
          },
        },
        required: ['topic', 'scenes'],
      },
    },
  });

  const prompt = `Turn one concept from a university lecture into a short narrated video segment.

Concept title: ${cardTitle}
Concept summary: ${cardContent}

Produce 3 to 5 scenes that teach this concept, in the order a student should hear them.

Rules:
- Narration is SPOKEN aloud. Write for the ear: short sentences, no bullet characters, no markdown, no LaTeX. Write "O of n" rather than "O(n)" only when it would otherwise be unreadable aloud; otherwise plain words.
- Each narration must be 1-3 sentences and take roughly 5-10 seconds to say.
- On-screen "content" strings are NOT the narration. They are short labels — a few words each, never full sentences.
- Choose the visual type that genuinely fits the content. Mix 2D and 3D across the segment; do NOT make every scene 3D.
    * bullet_reveal — a short list of definitions or facts (2D)
    * diagram — a process or chain of relationships (2D)
    * formula — a real formula being stated (2D)
    * comparison — exactly two things contrasted (2D)
    * icon_focus — one headline idea (2D)
    * rotating_concept_3d — a physical object, body, structure or spatial concept worth seeing turn in space
    * depth_parallax_3d — a scene-setting or contextual idea that benefits from layered depth
    * formula_float_3d — a formula that is being derived or unpacked, rather than merely stated
  Use at most two 3D scenes per segment, and only where the content genuinely earns it — a list of definitions does not.
- "image_query": 2-5 concrete words naming something a PHOTOGRAPHER could actually shoot ("night sky stars", "circuit board", "students studying"). If the concept is purely abstract and has no photographable subject, return an empty string rather than inventing one.
- Ground everything in the source material below. Do not introduce facts that are not there.

Source material:
"""
${truncate(sourceText, 20000)}
"""`;

  const result = await callGeminiWithRetry((key) => modelFor(key).generateContent(prompt));
  const parsed = safeParseJson<{ topic?: string; scenes?: RawScene[] }>(result.response.text());

  if (!parsed || !Array.isArray(parsed.scenes)) {
    throw new Error('Gemini did not return a usable lecture script.');
  }

  return { topic: parsed.topic || cardTitle, scenes: parsed.scenes };
}

export interface RawScene {
  narration?: string;
  visual?: { type?: string; content?: string[]; highlight_term?: string; image_query?: string };
  duration_hint_seconds?: number;
}

/**
 * Streaming variant of {@link askWithContext} for the chat panel.
 * Returns an async iterable of text deltas so the route can pipe them straight
 * into a ReadableStream.
 */
export async function* askWithContextStream(
  question: string,
  contexts: RetrievedContext[],
): AsyncGenerator<string> {
  // A factory, not an instance: the pool decides which key to use per attempt,
  // so the client cannot be bound before the call.
  const modelFor = (apiKey: string) => clientFor(apiKey).getGenerativeModel({
    model: GENERATION_MODEL,
    generationConfig: { temperature: 0.2 },
  });

  const result = await callGeminiWithRetry((key) => modelFor(key).generateContentStream(buildGroundedPrompt(question, contexts)));

  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) yield text;
  }
}

export interface RetrievedContext {
  chunk_index: number;
  chunk_text: string;
  label: string;
}

/** Shared by the streaming and non-streaming answer paths so they can't drift. */
function buildGroundedPrompt(question: string, contexts: RetrievedContext[]): string {
  const contextBlock = contexts
    .map((context) => `[${context.label}]\n${context.chunk_text}`)
    .join('\n\n---\n\n');

  return `You are a study assistant answering questions about ONE student's uploaded course material.

Strict rules:
1. Answer using ONLY the context below. Do not use outside knowledge, even if you know the answer.
2. If the context does not contain the answer, reply exactly: "I couldn't find that in your uploaded material." Then suggest what the student could ask instead.
3. Cite your source inline using the exact bracket labels shown in the context, e.g. [${contexts[0]?.label ?? 'Section 1'}].
4. Keep the answer under 120 words and use plain language.
5. Write plain text only. No Markdown headings and no LaTeX — write "O(n)", never "$O(n)$".

Context:
${contextBlock}

Question: ${question}`;
}

/**
 * Answers a question strictly from retrieved context (PRD §5.3).
 * The system prompt forbids outside knowledge and mandates a citation, so an
 * ungrounded question produces an honest refusal instead of a hallucination.
 */
export async function askWithContext(question: string, contexts: RetrievedContext[]): Promise<string> {
  // A factory, not an instance: the pool decides which key to use per attempt,
  // so the client cannot be bound before the call.
  const modelFor = (apiKey: string) => clientFor(apiKey).getGenerativeModel({
    model: GENERATION_MODEL,
    generationConfig: { temperature: 0.2 },
  });

  const result = await callGeminiWithRetry((key) => modelFor(key).generateContent(buildGroundedPrompt(question, contexts)));
  return result.response.text().trim();
}

/**
 * Embedding calls go straight to the REST API rather than through the SDK.
 *
 * `EmbedContentRequest` in @google/generative-ai has no `outputDimensionality`
 * field, and without it gemini-embedding-001 returns 3072 dimensions — too wide
 * for a pgvector index and a mismatch for the vector(768) schema column.
 */
async function callEmbeddingApi(
  texts: string[],
  taskType: TaskType.RETRIEVAL_DOCUMENT | TaskType.RETRIEVAL_QUERY,
): Promise<number[][]> {
  const model = `models/${EMBEDDING_MODEL}`;

  // Embeddings share the generation key's quota pool, so they go through the
  // same retry/rotation policy as every other Gemini call.
  return callGeminiWithRetry(async (apiKey) => {
    // Key travels in a header, not the query string, so it cannot leak into
    // proxy/CDN access logs. This is what the SDK does for its own calls.
    const response = await fetch(`${GEMINI_API_BASE}/${model}:batchEmbedContents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model,
          content: { parts: [{ text }] },
          taskType,
          outputDimensionality: EMBEDDING_DIMENSIONS,
        })),
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const retryAfter = response.headers.get('retry-after');
      // Both the status and the body are folded into the message because
      // classifyGeminiError reads quota details out of it.
      throw new Error(
        `Embedding request failed (${response.status})${retryAfter ? ` retry-after ${retryAfter}s` : ''}: ${detail.slice(0, 400)}`,
      );
    }

    const payload = await response.json();
    if (!Array.isArray(payload?.embeddings)) {
      throw new Error('Embedding response did not contain any embeddings.');
    }

    return payload.embeddings.map((embedding: { values: number[] }) => embedding.values) as number[][];
  });
}

/** Embeds document chunks for storage. Batched to limit round-trips. */
export async function embedDocuments(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const embeddings: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    embeddings.push(...(await callEmbeddingApi(texts.slice(i, i + EMBED_BATCH_SIZE), TaskType.RETRIEVAL_DOCUMENT)));
  }
  return embeddings;
}

/**
 * Embeds a search query. Uses RETRIEVAL_QUERY rather than RETRIEVAL_DOCUMENT —
 * the asymmetric task types are what make query/document similarity meaningful.
 */
export async function embedQuery(text: string): Promise<number[]> {
  const [embedding] = await callEmbeddingApi([text], TaskType.RETRIEVAL_QUERY);
  if (!embedding) throw new Error('Embedding response was empty.');
  return embedding;
}

/**
 * Structured-output mode should always return clean JSON, but a truncated or
 * fence-wrapped response is still possible on quota/timeout edges.
 */
function safeParseJson<T>(raw: string): T | null {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const match = trimmed.match(/[[{][\s\S]*[\]}]/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as T;
    } catch {
      return null;
    }
  }
}

function truncate(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n\n[material truncated]`;
}
