import { NextResponse } from 'next/server';
import { chunkText } from '@/lib/chunker';
import { embedDocuments } from '@/lib/gemini';
import { QuotaExhaustedError } from '@/lib/gemini';
import {
  NOTE_STATUS_LABELS,
  isYouTubeSource,
  notesToPlainText,
  timestampToSeconds,
  type StructuredNotes,
} from '@/lib/notes-types';
import { transferToGemini } from '@/lib/video-storage';
import {
  getVideoNotes,
  saveChunks,
  saveVideoNotes,
  updateMaterialText,
  updateVideoNotesStatus,
} from '@/lib/store';
import { analyseVideoSegment, mergeNotes, planSegments } from '@/lib/video-notes';
import { handleRouteError, jsonError, requireOwnedMaterial } from '@/lib/api-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** One segment per request; Vercel Hobby caps a function at 60s. */
export const maxDuration = 60;

/**
 * Video → Notes pipeline.
 *
 * GET  — current job state, for polling.
 * POST — advances the job by exactly ONE step, then returns.
 *
 * The client drives the loop. Vercel has no durable background worker on the
 * hobby tier and a function cannot outlive a whole video, so "one step per
 * request" is what makes a multi-minute job possible at all. Every step is
 * idempotent-ish: state lives in `video_notes`, so a dropped request just means
 * the next POST retries that step.
 */
export async function GET(request: Request, context: RouteContext<'/api/materials/[id]/notes'>) {
  try {
    const { id } = await context.params;
    const userId = new URL(request.url).searchParams.get('user_id');

    const owned = await requireOwnedMaterial(id, userId);
    if (!owned.ok) return owned.response;

    return NextResponse.json(await describe(id, owned.material.title));
  } catch (error) {
    return handleRouteError('Notes status', error);
  }
}

export async function POST(request: Request, context: RouteContext<'/api/materials/[id]/notes'>) {
  try {
    const { id } = await context.params;
    const { user_id } = await request.json().catch(() => ({}));

    const owned = await requireOwnedMaterial(id, user_id);
    if (!owned.ok) return owned.response;

    const material = owned.material;
    if (material.content_type !== 'video') {
      return jsonError('This material is not a video.', 400);
    }
    if (!material.video_url) {
      return jsonError('This video has no source URL.', 422);
    }

    const job = await getVideoNotes(id);
    if (!job) return jsonError('No notes job exists for this material.', 404);
    if (job.status === 'done') return NextResponse.json(await describe(id, material.title));

    const segments = planSegments(material.video_duration_seconds);

    try {
      const isYouTube = isYouTubeSource(material.video_url);

      // ---- step: begin -----------------------------------------------------
      if (job.status === 'pending' || job.status === 'failed') {
        // A YouTube URL goes straight to Gemini; an uploaded file has to be
        // transferred to the Files API first.
        const next = isYouTube || job.gemini_file_uri ? 'analysing' : 'uploading';

        await saveVideoNotes({
          material_id: id,
          notes_json: job.notes_json,
          status: next,
          progress_message:
            next === 'uploading' ? NOTE_STATUS_LABELS.uploading : describeSegment(job.segment_index, segments.length),
          error: null,
          segment_index: job.segment_index,
          segment_total: segments.length,
          gemini_file_uri: job.gemini_file_uri,
        });
        return NextResponse.json(await describe(id, material.title));
      }

      // ---- step: hand an uploaded file to Gemini ---------------------------
      if (job.status === 'uploading') {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error('GEMINI_API_KEY is not set.');

        const { fileUri } = await transferToGemini(material.video_url, apiKey, material.title);

        await saveVideoNotes({
          material_id: id,
          notes_json: job.notes_json,
          status: 'analysing',
          progress_message: describeSegment(job.segment_index, segments.length),
          error: null,
          segment_index: job.segment_index,
          segment_total: segments.length,
          gemini_file_uri: fileUri,
        });
        return NextResponse.json(await describe(id, material.title));
      }

      // ---- step: analyse one segment ---------------------------------------
      if (job.status === 'analysing') {
        const index = Math.min(job.segment_index, segments.length - 1);
        const fileUri = isYouTube ? material.video_url : job.gemini_file_uri;
        if (!fileUri) throw new Error('The video has not been prepared for analysis yet.');

        const part = await analyseVideoSegment(
          { fileUri, mimeType: 'video/mp4' },
          segments[index],
          index,
        );

        const merged = mergeNotes(
          [...(job.notes_json ? [job.notes_json] : []), part],
          material.title,
        );

        const nextIndex = index + 1;
        const finishedAnalysis = nextIndex >= segments.length;

        await saveVideoNotes({
          material_id: id,
          notes_json: merged,
          status: finishedAnalysis ? 'structuring' : 'analysing',
          progress_message: finishedAnalysis
            ? NOTE_STATUS_LABELS.structuring
            : describeSegment(nextIndex, segments.length),
          error: null,
          segment_index: nextIndex,
          segment_total: segments.length,
          gemini_file_uri: job.gemini_file_uri,
        });

        return NextResponse.json(await describe(id, material.title));
      }

      // ---- step: structure + index for the chatbot -------------------------
      if (job.status === 'structuring') {
        const notes = job.notes_json;
        if (!notes || notes.sections.length === 0) {
          throw new Error('No sections were produced for this video.');
        }

        await indexNotesForChat(id, notes);

        await saveVideoNotes({
          material_id: id,
          notes_json: notes,
          status: 'done',
          progress_message: NOTE_STATUS_LABELS.done,
          error: null,
          segment_index: job.segment_index,
          segment_total: job.segment_total,
          gemini_file_uri: job.gemini_file_uri,
        });

        return NextResponse.json(await describe(id, material.title));
      }

      return NextResponse.json(await describe(id, material.title));
    } catch (stepError) {
      const message =
        stepError instanceof QuotaExhaustedError
          ? stepError.message
          : stepError instanceof Error
            ? stepError.message
            : 'Something went wrong while building your notes.';

      // Partial work is kept: the failed step retries from where it stopped
      // rather than re-analysing segments already paid for.
      await updateVideoNotesStatus(id, 'failed', null, message);
      return NextResponse.json({ ...(await describe(id, material.title)), error: message }, { status: 200 });
    }
  } catch (error) {
    return handleRouteError('Notes generation', error);
  }
}

/**
 * Makes the notes searchable by the existing "Ask your material" chatbot.
 *
 * Each section becomes one chunk whose `page_start` holds its start time in
 * SECONDS. Combined with the material's `source_unit: 'timestamp'`, that makes
 * retrieval cite "12:04" through exactly the same path that cites "Page 4" —
 * no branching anywhere in the RAG pipeline.
 */
async function indexNotesForChat(materialId: string, notes: StructuredNotes): Promise<void> {
  const plainText = notesToPlainText(notes);
  await updateMaterialText(materialId, plainText);

  const chunks = notes.sections.flatMap((section, sectionIndex) => {
    const seconds = timestampToSeconds(section.timestamp_start) ?? 0;
    const body = [
      section.heading,
      ...section.bullets.map((bullet) => `- ${bullet}`),
      ...section.key_terms.map((term) => `${term.term}: ${term.definition}`),
    ].join('\n');

    // A very long section is split further so no chunk dwarfs the others, but
    // every piece keeps the section's timestamp for citation.
    return chunkText(body).map((piece, pieceIndex) => ({
      chunk_text: piece,
      page_start: seconds,
      page_end: seconds,
      sortKey: sectionIndex * 100 + pieceIndex,
    }));
  });

  const ordered = chunks
    .sort((a, b) => a.sortKey - b.sortKey)
    .map((chunk, chunk_index) => ({
      chunk_index,
      chunk_text: chunk.chunk_text,
      page_start: chunk.page_start,
      page_end: chunk.page_end,
      embedding: null as number[] | null,
    }));

  // Embeddings are best-effort: without them retrieval falls back to keyword
  // scoring, which still answers with correct timestamps.
  try {
    const embeddings = await embedDocuments(ordered.map((chunk) => chunk.chunk_text));
    ordered.forEach((chunk, index) => {
      chunk.embedding = embeddings[index] ?? null;
    });
  } catch (error) {
    console.error('[notes] embedding failed; chat will use keyword retrieval:', error);
  }

  await saveChunks(materialId, ordered);
}

function describeSegment(index: number, total: number): string {
  return total > 1
    ? `${NOTE_STATUS_LABELS.analysing} — part ${Math.min(index + 1, total)} of ${total}`
    : NOTE_STATUS_LABELS.analysing;
}

async function describe(materialId: string, title: string) {
  const job = await getVideoNotes(materialId);

  return {
    material_id: materialId,
    title,
    status: job?.status ?? 'pending',
    progress_message: job?.progress_message ?? NOTE_STATUS_LABELS[job?.status ?? 'pending'],
    error: job?.error ?? null,
    segment_index: job?.segment_index ?? 0,
    segment_total: job?.segment_total ?? 1,
    notes: job?.status === 'done' ? job.notes_json : null,
  };
}
