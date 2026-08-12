import { NextResponse } from 'next/server';
import { embedDocuments } from '@/lib/gemini';
import { getChunks, saveChunks } from '@/lib/store';
import { handleRouteError, jsonError, requireOwnedMaterial } from '@/lib/api-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/generate-embeddings — embeds the material's chunks for vector
 * retrieval (PRD §7.4 steps 1-2).
 *
 * A failure here is non-fatal: /api/ask falls back to keyword retrieval, so the
 * chat still answers with real citations. We report the degraded state instead
 * of failing the request.
 */
export async function POST(request: Request) {
  try {
    const { material_id, user_id } = await request.json();

    const owned = await requireOwnedMaterial(material_id, user_id);
    if (!owned.ok) return owned.response;

    const chunks = await getChunks(material_id);
    if (chunks.length === 0) return jsonError('No chunks stored for this material.', 422);

    if (chunks.every((chunk) => chunk.embedding?.length)) {
      return NextResponse.json({ chunks_count: chunks.length, embedded: true, cached: true });
    }

    try {
      const embeddings = await embedDocuments(chunks.map((chunk) => chunk.chunk_text));
      await saveChunks(
        material_id,
        chunks.map((chunk, index) => ({ ...chunk, embedding: embeddings[index] ?? null })),
      );

      return NextResponse.json({ chunks_count: chunks.length, embedded: true, cached: false });
    } catch (error) {
      console.error('[Embeddings] falling back to keyword retrieval:', error);
      return NextResponse.json({
        chunks_count: chunks.length,
        embedded: false,
        fallback: 'keyword',
        message: 'Embeddings unavailable — chat will use keyword retrieval.',
      });
    }
  } catch (error) {
    return handleRouteError('Embedding generation', error);
  }
}
