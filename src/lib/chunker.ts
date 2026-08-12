import { secondsToTimestamp } from './notes-types';
import type { ExtractedPage, SourceUnit } from './pdf-extract';

export interface TextChunk {
  chunk_index: number;
  chunk_text: string;
  page_start: number;
  page_end: number;
}

/** Roughly 400 words ≈ 500 tokens, matching the PRD's 300-500 token guidance. */
const DEFAULT_WORDS_PER_CHUNK = 400;
const DEFAULT_OVERLAP_WORDS = 60;

/**
 * Splits document text into overlapping chunks on word boundaries.
 *
 * Word boundaries matter: slicing on raw character offsets cuts tokens in half,
 * which degrades embedding quality and makes citation previews read as garbage.
 */
export function chunkText(
  text: string,
  wordsPerChunk = DEFAULT_WORDS_PER_CHUNK,
  overlapWords = DEFAULT_OVERLAP_WORDS,
): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
  if (!normalized) return [];

  const words = normalized.split(/\s+/);
  if (words.length <= wordsPerChunk) return [normalized];

  const stride = Math.max(1, wordsPerChunk - overlapWords);
  const chunks: string[] = [];

  for (let start = 0; start < words.length; start += stride) {
    chunks.push(words.slice(start, start + wordsPerChunk).join(' '));
    // The final window already consumed the tail; continuing would emit a run
    // of near-duplicate trailing chunks.
    if (start + wordsPerChunk >= words.length) break;
  }

  return chunks;
}

/**
 * Page-aware chunking: accumulates whole pages until a chunk reaches the target
 * size, so every chunk carries the page range it came from and citations can
 * say "Page 4" rather than "Section 7".
 *
 * Pages longer than the target (dense notes rather than slides) are split
 * internally, with each piece still attributed to that page.
 */
export function chunkPages(
  pages: ExtractedPage[],
  wordsPerChunk = DEFAULT_WORDS_PER_CHUNK,
  overlapWords = DEFAULT_OVERLAP_WORDS,
): TextChunk[] {
  const chunks: Omit<TextChunk, 'chunk_index'>[] = [];

  let buffer: string[] = [];
  let bufferWords = 0;
  let bufferStartPage = pages[0]?.page_number ?? 1;
  let bufferEndPage = bufferStartPage;

  const flush = () => {
    if (buffer.length === 0) return;
    chunks.push({
      chunk_text: buffer.join('\n\n'),
      page_start: bufferStartPage,
      page_end: bufferEndPage,
    });
    buffer = [];
    bufferWords = 0;
  };

  for (const page of pages) {
    const pageWords = countWords(page.text);

    // A single page that exceeds the target gets split on its own.
    if (pageWords > wordsPerChunk) {
      flush();
      for (const piece of chunkText(page.text, wordsPerChunk, overlapWords)) {
        chunks.push({ chunk_text: piece, page_start: page.page_number, page_end: page.page_number });
      }
      bufferStartPage = page.page_number;
      bufferEndPage = page.page_number;
      continue;
    }

    if (bufferWords + pageWords > wordsPerChunk && buffer.length > 0) {
      flush();
      bufferStartPage = page.page_number;
    }

    if (buffer.length === 0) bufferStartPage = page.page_number;
    buffer.push(page.text);
    bufferWords += pageWords;
    bufferEndPage = page.page_number;
  }

  flush();

  return chunks.map((chunk, chunk_index) => ({ ...chunk, chunk_index }));
}

/**
 * Human-readable citation label — "Page 4", "Pages 4-6", "Slide 2", or a video
 * timestamp like "12:04". Falls back to a section number when positional
 * attribution is unavailable.
 *
 * For video material, `page_start` holds seconds into the recording rather than
 * a page number, which is what lets the chatbot cite a moment without any
 * changes to the retrieval pipeline.
 */
export function labelForChunk(
  chunk: { chunk_index: number; page_start?: number | null; page_end?: number | null },
  unit: SourceUnit = 'page',
): string {
  const { page_start, page_end } = chunk;

  if (unit === 'timestamp') {
    return typeof page_start === 'number' && page_start >= 0
      ? secondsToTimestamp(page_start)
      : `Section ${chunk.chunk_index + 1}`;
  }

  if (typeof page_start !== 'number' || page_start < 1) return `Section ${chunk.chunk_index + 1}`;

  const singular = unit === 'slide' ? 'Slide' : 'Page';
  if (typeof page_end === 'number' && page_end > page_start) {
    return `${singular}s ${page_start}-${page_end}`;
  }
  return `${singular} ${page_start}`;
}

function countWords(value: string): number {
  const trimmed = value.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}
