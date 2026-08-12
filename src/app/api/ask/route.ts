import { NextResponse } from 'next/server';
import { askWithContext } from '@/lib/gemini';
import { retrieveRelevantChunks } from '@/lib/retrieval';
import { handleRouteError, jsonError, requireOwnedMaterial } from '@/lib/api-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/ask — RAG question answering over one material (PRD §5.3).
 *
 * Retrieval runs first, the model sees only the retrieved chunks, and every
 * response carries citations pointing back at the source pages.
 */
export async function POST(request: Request) {
  try {
    const { material_id, question, user_id } = await request.json();

    if (typeof question !== 'string' || !question.trim()) return jsonError('question is required.');

    const owned = await requireOwnedMaterial(material_id, user_id);
    if (!owned.ok) return owned.response;

    const { contexts, strategy } = await retrieveRelevantChunks(
      material_id,
      question.trim(),
      owned.material.source_unit,
    );

    if (contexts.length === 0) {
      return NextResponse.json({
        answer: "I couldn't find that in your uploaded material.",
        citations: [],
        strategy,
      });
    }

    const answer = await askWithContext(question.trim(), contexts);

    return NextResponse.json({
      answer,
      strategy,
      citations: contexts.map((context) => ({
        chunk_index: context.chunk_index,
        label: context.label,
        text_preview: `${context.chunk_text.slice(0, 220).trim()}…`,
      })),
    });
  } catch (error) {
    return handleRouteError('Question answering', error);
  }
}
