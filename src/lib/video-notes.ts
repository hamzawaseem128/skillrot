import { callGeminiWithRetry } from './gemini';
import type { NoteSection, StructuredNotes } from './notes-types';

/**
 * Video → structured notes, via Gemini's native video understanding.
 *
 * Raw REST rather than the SDK: `@google/generative-ai`'s `Part` union has no
 * field for `videoMetadata`, which is what allows a long lecture to be analysed
 * in clipped segments instead of one oversized request. The call still routes
 * through `callGeminiWithRetry`, so key rotation, backoff and daily-quota
 * detection behave exactly as they do everywhere else.
 */

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL = process.env.GEMINI_VIDEO_MODEL || process.env.GEMINI_MODEL || 'gemini-flash-latest';

/**
 * Video costs roughly 300 tokens/second at default resolution against a
 * 1,048,576-token window, so ~55 minutes is the hard ceiling for one request.
 * Segments are kept well under it to leave room for the prompt and to keep any
 * single call inside a serverless timeout.
 */
export const SEGMENT_SECONDS = 900; // 15 minutes

/**
 * 'low' costs ~1/3 the tokens but degrades on-screen text. Lecture slides are
 * mostly text, so default resolution is the right trade unless quota is tight.
 */
const MEDIA_RESOLUTION = process.env.GEMINI_MEDIA_RESOLUTION || 'MEDIA_RESOLUTION_MEDIUM';

const NOTES_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING', description: 'Concise title for the whole lecture.' },
    sections: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          heading: { type: 'STRING', description: 'Section heading, at most 8 words.' },
          timestamp_start: {
            type: 'STRING',
            description: 'When this section begins, as HH:MM:SS or MM:SS from the start of the video.',
          },
          bullets: {
            type: 'ARRAY',
            items: { type: 'STRING' },
            description: '3-6 substantive bullet points capturing what was actually taught.',
          },
          key_terms: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                term: { type: 'STRING' },
                definition: { type: 'STRING', description: 'One sentence, in plain language.' },
              },
              required: ['term', 'definition'],
            },
          },
        },
        required: ['heading', 'timestamp_start', 'bullets', 'key_terms'],
      },
    },
  },
  required: ['title', 'sections'],
};

export interface VideoSource {
  /** YouTube watch URL, or a Gemini Files API URI (files/abc123). */
  fileUri: string;
  mimeType: string;
}

export interface SegmentRange {
  startSeconds: number;
  endSeconds: number | null;
}

/**
 * Analyses one segment of a video and returns its sections.
 *
 * Timestamps come back relative to the clip, so the caller offsets them into
 * whole-video time — otherwise every segment would start again at 00:00.
 */
export async function analyseVideoSegment(
  source: VideoSource,
  range: SegmentRange,
  segmentIndex: number,
): Promise<StructuredNotes> {
  const videoPart: Record<string, unknown> = {
    file_data: { file_uri: source.fileUri, mime_type: source.mimeType },
  };

  // Clipping only applies to multi-segment jobs; sending offsets for a short
  // video would needlessly constrain it.
  if (range.startSeconds > 0 || range.endSeconds !== null) {
    videoPart.video_metadata = {
      start_offset: `${range.startSeconds}s`,
      ...(range.endSeconds !== null ? { end_offset: `${range.endSeconds}s` } : {}),
    };
  }

  const prompt = `You are turning a recorded university lecture into clean, structured study notes.

Watch the video and produce notes covering what is actually taught.

Rules:
- Break the lecture into 3 to 8 sections following its real structure — where the topic genuinely changes, not on a fixed clock.
- "timestamp_start" must be when that section begins, in MM:SS or HH:MM:SS, measured from the START OF THIS CLIP.
- Bullets must be substantive: state the actual definition, rule, example or result, not "the lecturer discusses X".
- Capture what is said AND what is written on slides or the board.
- "key_terms" are terms a student would need to memorise. Define each in one plain sentence. Return an empty array when a section introduces none.
- Do not invent content that is not in the video. If a stretch is admin, silence or Q&A with no teaching, skip it.
- Plain text only. No Markdown, no LaTeX — write "O(n)", never "$O(n)$".`;

  const payload = {
    contents: [{ role: 'user', parts: [videoPart, { text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: NOTES_SCHEMA,
      temperature: 0.2,
      mediaResolution: MEDIA_RESOLUTION,
    },
  };

  const raw = await callGeminiWithRetry(async (apiKey) => {
    const response = await fetch(`${GEMINI_API_BASE}/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      // Status and body are folded into the message because the shared retry
      // wrapper reads quota details out of it.
      throw new Error(`Video analysis failed (${response.status}): ${detail.slice(0, 400)}`);
    }

    const body = await response.json();
    const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string') {
      const reason = body?.candidates?.[0]?.finishReason ?? body?.promptFeedback?.blockReason ?? 'unknown';
      throw new Error(`Gemini returned no notes for this segment (${reason}).`);
    }
    return text;
  });

  const parsed = safeParse(raw);
  if (!parsed) throw new Error('Gemini returned malformed notes for this segment.');

  return {
    title: parsed.title?.trim() || `Part ${segmentIndex + 1}`,
    sections: normalizeSections(parsed.sections, range.startSeconds),
  };
}

function normalizeSections(sections: unknown, offsetSeconds: number): NoteSection[] {
  if (!Array.isArray(sections)) return [];

  return sections
    .filter((section) => section && typeof section.heading === 'string')
    .map((section) => ({
      heading: String(section.heading).trim().slice(0, 120),
      timestamp_start: offsetTimestamp(section.timestamp_start, offsetSeconds),
      bullets: toStringArray(section.bullets).slice(0, 8),
      key_terms: Array.isArray(section.key_terms)
        ? section.key_terms
            .filter((term: unknown) => {
              const candidate = term as { term?: unknown; definition?: unknown };
              return typeof candidate?.term === 'string' && typeof candidate?.definition === 'string';
            })
            .map((term: { term: string; definition: string }) => ({
              term: term.term.trim().slice(0, 80),
              definition: term.definition.trim().slice(0, 300),
            }))
            .slice(0, 8)
        : [],
    }))
    .filter((section) => section.bullets.length > 0);
}

/**
 * Shifts a clip-relative timestamp into whole-video time. Without this, every
 * segment after the first would claim to start at 00:00.
 */
function offsetTimestamp(value: unknown, offsetSeconds: number): string {
  const parts = typeof value === 'string' ? value.trim().split(':').map(Number) : [];
  let seconds = 0;

  if (parts.length === 3 && parts.every(Number.isFinite)) {
    seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2 && parts.every(Number.isFinite)) {
    seconds = parts[0] * 60 + parts[1];
  }

  const total = Math.max(0, seconds + offsetSeconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    : `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
}

function safeParse(raw: string): { title?: string; sections?: unknown } | null {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

/** Splits a known duration into analysis segments. Unknown duration → one pass. */
export function planSegments(durationSeconds: number | null): SegmentRange[] {
  if (!durationSeconds || durationSeconds <= SEGMENT_SECONDS) {
    return [{ startSeconds: 0, endSeconds: null }];
  }

  const ranges: SegmentRange[] = [];
  for (let start = 0; start < durationSeconds; start += SEGMENT_SECONDS) {
    ranges.push({
      startSeconds: start,
      endSeconds: Math.min(start + SEGMENT_SECONDS, durationSeconds),
    });
  }
  return ranges;
}

/** Merges per-segment results into one document, keeping chronological order. */
export function mergeNotes(parts: StructuredNotes[], fallbackTitle: string): StructuredNotes {
  const sections = parts.flatMap((part) => part.sections);
  return {
    title: parts[0]?.title?.trim() || fallbackTitle,
    sections,
  };
}
