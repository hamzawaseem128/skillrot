import { NextResponse } from 'next/server';
import { buildExtractiveCards } from '@/lib/extractive-cards';
import { generateLearningCards } from '@/lib/gemini';
import { getCards, saveCards } from '@/lib/store';
import { handleRouteError, jsonError, requireOwnedMaterial } from '@/lib/api-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/generate-cards — turns stored material into 5-8 swipeable learning
 * cards (PRD §5.2). Cached per material so navigating back to a result doesn't
 * re-spend a Gemini call.
 */
export async function POST(request: Request) {
  try {
    const { material_id, user_id } = await request.json();

    const owned = await requireOwnedMaterial(material_id, user_id);
    if (!owned.ok) return owned.response;
    const material = owned.material;

    const existing = await getCards(material_id);
    if (existing.length > 0) {
      return NextResponse.json({ cards: existing, cached: true });
    }

    try {
      const cards = await generateLearningCards(material.raw_text);
      if (cards.length === 0) throw new Error('Model returned no cards.');

      await saveCards(material_id, cards);
      return NextResponse.json({ cards, cached: false, degraded: false });
    } catch (modelError) {
      // PRD §9 puts a working demo above feature fidelity: rather than failing
      // the whole screen, fall back to cards extracted from the document
      // itself. They are still grounded in the real material (§5.2), just not
      // rewritten into simpler language — so the client is told it's degraded.
      console.error('[Card generation] falling back to extractive cards:', modelError);

      const cards = buildExtractiveCards(material.raw_text);
      if (cards.length === 0) {
        return jsonError('Could not generate cards from this material. Try a document with more written content.', 422);
      }

      await saveCards(material_id, cards);
      return NextResponse.json({
        cards,
        cached: false,
        degraded: true,
        notice: 'AI rewriting was unavailable, so these cards quote your document directly.',
      });
    }
  } catch (error) {
    return handleRouteError('Card generation', error);
  }
}
