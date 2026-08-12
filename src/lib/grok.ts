import type { RetrievedContext } from './gemini';

/**
 * Grok (xAI) as the chatbot's answer generator.
 *
 * The point of this split is quota isolation. Chat is the highest-frequency
 * model call in the app; scene generation and embeddings are occasional. Left
 * on one Gemini key they compete for the same daily free-tier pool, and a busy
 * chat session starves the video lectures. Chat answers therefore run on Grok
 * while retrieval (embeddings + pgvector) stays on Gemini.
 *
 * xAI's API is OpenAI-compatible, so plain fetch is enough — no extra SDK.
 */

const GROK_ENDPOINT = 'https://api.x.ai/v1/chat/completions';
const GROK_MODEL = process.env.GROK_MODEL || 'grok-4';

const MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 20000;

export function isGrokConfigured(): boolean {
  return Boolean(process.env.GROK_API_KEY);
}

const SYSTEM_PROMPT = `You are a study assistant answering questions about ONE student's uploaded course material.

Strict rules:
1. Answer using ONLY the context provided. Do not use outside knowledge, even if you know the answer.
2. If the context does not contain the answer, reply exactly: "I couldn't find that in your uploaded material." Then suggest what the student could ask instead.
3. Cite your source inline using the exact bracket labels shown in the context, for example [Page 4] or [Slide 2]. Use the labels verbatim — do not invent your own numbering.
4. Keep the answer under 120 words and use plain language.
5. Write plain text only. No Markdown headings and no LaTeX — write "O(n)", never "$O(n)$".`;

/**
 * Streams an answer from Grok as text deltas.
 *
 * Retries only cover establishing the stream. Once tokens are flowing a failure
 * cannot be retried transparently — the client has already rendered part of the
 * answer — so it surfaces instead.
 */
export async function* askWithContextStreamGrok(
  question: string,
  contexts: RetrievedContext[],
): AsyncGenerator<string> {
  const contextBlock = contexts
    .map((context) => `[${context.label}]\n${context.chunk_text}`)
    .join('\n\n---\n\n');

  const response = await connectWithRetry({
    model: GROK_MODEL,
    stream: true,
    temperature: 0.2,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Context:\n${contextBlock}\n\nQuestion: ${question}` },
    ],
  });

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    // The final element may be a partial line; keep it for the next chunk.
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;

      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') return;

      try {
        const parsed = JSON.parse(payload);
        const delta = parsed?.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) yield delta;
      } catch {
        // A malformed keep-alive line should not kill the stream.
      }
    }
  }
}

async function connectWithRetry(body: unknown): Promise<Response> {
  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey) {
    throw new Error('GROK_API_KEY is not set. Add it to .env.local and restart the dev server.');
  }

  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(GROK_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (response.ok && response.body) return response;

      const detail = await response.text().catch(() => '');
      const error = new Error(`Grok request failed (${response.status}): ${detail.slice(0, 300)}`);

      // 4xx other than 429 are permanent — a bad key or an unknown model name
      // will fail identically on every retry.
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === MAX_ATTEMPTS - 1) throw error;

      lastError = error;
      await new Promise((resolve) =>
        setTimeout(resolve, retryDelayMs(response.headers.get('retry-after'), attempt)),
      );
    } catch (error) {
      // A network-level failure is worth one more try; a thrown API error above
      // has already decided it is terminal.
      if (error instanceof Error && error.message.startsWith('Grok request failed')) throw error;
      lastError = error;
      if (attempt === MAX_ATTEMPTS - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(null, attempt)));
    }
  }

  throw lastError;
}

/** Honours the server's own Retry-After when present, else exponential backoff. */
function retryDelayMs(retryAfterHeader: string | null, attempt: number): number {
  const seconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, MAX_BACKOFF_MS);
  return Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
}
