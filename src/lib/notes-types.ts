/**
 * Shapes for the Video → Notes flow.
 *
 * Client-safe: the notes viewer and the server routes both import these, so
 * nothing here may pull in the Gemini SDK or any Node-only module.
 */

export interface KeyTerm {
  term: string;
  definition: string;
}

export interface NoteSection {
  heading: string;
  /** "HH:MM:SS" or "MM:SS" into the source video; absent if unknown. */
  timestamp_start?: string | null;
  bullets: string[];
  key_terms: KeyTerm[];
}

export interface StructuredNotes {
  title: string;
  sections: NoteSection[];
}

/**
 * Where a video job has got to.
 *
 * A Vercel function cannot stay alive long enough to analyse a whole video, so
 * the client drives the pipeline one step per request and reads progress from
 * here between steps.
 */
export const NOTE_STATUSES = [
  'pending',
  'uploading',
  'analysing',
  'structuring',
  'done',
  'failed',
] as const;

export type NoteStatus = (typeof NOTE_STATUSES)[number];

/** User-facing progress copy, matching the statuses above. */
export const NOTE_STATUS_LABELS: Record<NoteStatus, string> = {
  pending: 'Queued',
  uploading: 'Preparing your video',
  analysing: 'Watching the lecture',
  structuring: 'Structuring your notes',
  done: 'Notes ready',
  failed: 'Could not build notes',
};

export interface VideoNotesRecord {
  material_id: string;
  notes_json: StructuredNotes | null;
  status: NoteStatus;
  progress_message: string | null;
  error: string | null;
  /** How many analysis segments are complete, and how many there are in total. */
  segment_index: number;
  segment_total: number;
  /** Gemini Files API URI for uploaded video; null for YouTube sources. */
  gemini_file_uri: string | null;
}

/** A YouTube watch URL is passed to Gemini as-is; anything else is a Storage path. */
export function isYouTubeSource(videoUrl: string): boolean {
  return /^https?:\/\/(www\.)?youtube\.com\/watch\?v=/.test(videoUrl);
}

/** Video sources accepted by the pipeline. */
export const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm', '.m4v'] as const;

export function isVideoFilename(name: string): boolean {
  const lower = name.toLowerCase();
  return VIDEO_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

export function isVideoMimeType(mimeType: string): boolean {
  return mimeType.startsWith('video/');
}

/** Recognises the YouTube URL forms Gemini accepts directly. */
export function parseYouTubeUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;

  try {
    const url = new URL(trimmed);
    const host = url.hostname.replace(/^www\./, '');

    if (host === 'youtu.be' && url.pathname.length > 1) {
      return `https://www.youtube.com/watch?v=${url.pathname.slice(1)}`;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const id = url.searchParams.get('v');
      if (id) return `https://www.youtube.com/watch?v=${id}`;
      // /shorts/<id> and /embed/<id>
      const match = /^\/(?:shorts|embed)\/([\w-]+)/.exec(url.pathname);
      if (match) return `https://www.youtube.com/watch?v=${match[1]}`;
    }
  } catch {
    return null;
  }

  return null;
}

/** "01:02:03" / "12:04" → seconds. Returns null for unparseable input. */
export function timestampToSeconds(timestamp: string | null | undefined): number | null {
  if (!timestamp) return null;

  const parts = timestamp.trim().split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) return null;

  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
}

export function secondsToTimestamp(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  const mm = minutes.toString().padStart(hours > 0 ? 2 : 1, '0');
  const ss = seconds.toString().padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Flattens notes into plain text for the existing embedding pipeline, so video
 * material feeds the RAG chatbot through exactly the same path as a document.
 * Timestamps are kept inline because they become the citation labels.
 */
export function notesToPlainText(notes: StructuredNotes): string {
  const blocks = [notes.title];

  for (const section of notes.sections) {
    const heading = section.timestamp_start
      ? `${section.heading} [${section.timestamp_start}]`
      : section.heading;

    const lines = [heading, ...section.bullets.map((bullet) => `- ${bullet}`)];

    for (const term of section.key_terms) {
      lines.push(`${term.term}: ${term.definition}`);
    }

    blocks.push(lines.join('\n'));
  }

  return blocks.join('\n\n');
}
