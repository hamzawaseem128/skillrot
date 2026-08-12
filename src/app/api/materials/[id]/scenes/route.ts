import { NextResponse } from 'next/server';
import { QuotaExhaustedError, generateLectureScript, type RawScene } from '@/lib/gemini';
import {
  LECTURE_FPS,
  VISUAL_TYPES,
  resolveSceneDuration,
  totalDurationSeconds,
  type LectureScene,
  type SceneVisual,
  type VisualType,
} from '@/lib/lecture-types';
import { findSceneImage, isImageSearchConfigured } from '@/lib/scene-images';
import { clearScenes, getCards, getScenes, saveScenes } from '@/lib/store';
import { handleRouteError, jsonError, requireOwnedMaterial } from '@/lib/api-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/materials/[id]/scenes — narrated scene script for one card.
 *
 * Generated lazily on first view and cached, so a 8-card deck only ever costs
 * as many Gemini calls as the student actually watches.
 */
/**
 * Server-side single-flight.
 *
 * Two viewers (or one viewer double-firing on a fast re-render) asking for the
 * same card must not each spend a Gemini call. Concurrent callers await the
 * same promise; the winner writes the cache and everyone gets the result.
 */
const inFlight = ((globalThis as typeof globalThis & { __skillrotSceneJobs?: Map<string, Promise<LectureScene[]>> })
  .__skillrotSceneJobs ??= new Map<string, Promise<LectureScene[]>>());

export async function POST(request: Request, context: RouteContext<'/api/materials/[id]/scenes'>) {
  try {
    const { id } = await context.params;
    const { card_index, user_id, regenerate } = await request.json();

    const cardIndex = Number(card_index);
    if (!Number.isInteger(cardIndex) || cardIndex < 0) {
      return jsonError('card_index must be a non-negative integer.');
    }

    const owned = await requireOwnedMaterial(id, user_id);
    if (!owned.ok) return owned.response;

    const cards = await getCards(id);
    const card = cards[cardIndex];
    if (!card) return jsonError('That card does not exist for this material.', 404);

    // Regeneration is the only path that may spend a call on an already-cached
    // card, and it is always user-initiated.
    if (regenerate === true) await clearScenes(id, cardIndex);

    const cached = await getScenes(id, cardIndex);
    if (cached.length > 0) {
      return NextResponse.json({
        card_index: cardIndex,
        topic: card.title,
        scenes: cached,
        fps: LECTURE_FPS,
        total_seconds: totalDurationSeconds(cached),
        cached: true,
      });
    }

    const jobKey = `${id}:${cardIndex}`;
    let job = inFlight.get(jobKey);

    if (!job) {
      job = (async () => {
        const script = await generateLectureScript(card.title, card.content, owned.material.raw_text);
        const scenes = normalizeScenes(script.scenes);
        if (scenes.length === 0) throw new Error('EMPTY_SCRIPT');

        await attachImages(scenes);
        await saveScenes(id, cardIndex, scenes);
        return scenes;
      })().finally(() => inFlight.delete(jobKey));

      inFlight.set(jobKey, job);
    }

    const scenes = await job;

    return NextResponse.json({
      card_index: cardIndex,
      topic: card.title,
      scenes,
      fps: LECTURE_FPS,
      total_seconds: totalDurationSeconds(scenes),
      cached: false,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'EMPTY_SCRIPT') {
      return jsonError('Could not build a lecture for this card.', 422);
    }
    if (error instanceof QuotaExhaustedError) {
      // 503 rather than 429: retrying today will not help, so the client must
      // not treat this as "back off and try again shortly".
      return jsonError(error.message, 503, { quota_exhausted: true });
    }
    return handleRouteError('Lecture generation', error);
  }
}

/**
 * Looks up one stock photo per scene, sequentially.
 *
 * Sequential rather than parallel on purpose: the shared cache and the
 * `seen` set only de-duplicate correctly if each lookup can observe the
 * previous one's result, and Pexels' free tier is rate-limited anyway.
 * Failures are swallowed — a scene without a photo still renders.
 */
async function attachImages(scenes: LectureScene[]): Promise<void> {
  if (!isImageSearchConfigured()) return;

  const seen = new Set<string>();

  for (const scene of scenes) {
    const query = scene.visual.image_query?.trim();
    if (!query) continue;

    const image = await findSceneImage(query, seen);
    if (image) {
      scene.image = image;
      seen.add(image.url);
    }
  }
}

/**
 * Coerces model output into renderable scenes. The player indexes templates by
 * `visual.type` and reads `content[0]`/`content[1]` positionally, so an
 * unexpected type or an empty array would render a blank frame — every field is
 * defaulted rather than trusted.
 */
function normalizeScenes(raw: RawScene[]): LectureScene[] {
  return raw
    .filter((scene) => typeof scene?.narration === 'string' && scene.narration.trim().length > 0)
    .slice(0, 6)
    .map((scene, scene_index) => {
      const narration_text = scene.narration!.trim();
      return {
        scene_index,
        narration_text,
        visual: normalizeVisual(scene.visual, narration_text),
        duration_seconds: resolveSceneDuration(narration_text, scene.duration_hint_seconds),
        audio_url: null,
      };
    });
}

function normalizeVisual(visual: RawScene['visual'], narration: string): SceneVisual {
  const type: VisualType = VISUAL_TYPES.includes(visual?.type as VisualType)
    ? (visual!.type as VisualType)
    : 'bullet_reveal';

  const content = (visual?.content ?? [])
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim().slice(0, 90))
    .slice(0, 4);

  // A visual with nothing to show falls back to a short phrase from the
  // narration so the frame is never empty.
  if (content.length === 0) content.push(firstClause(narration));

  // Comparison renders two sides; give it a second one rather than a half-frame.
  if (type === 'comparison' && content.length === 1) content.push('—');

  return {
    type,
    content,
    highlight_term: visual?.highlight_term?.trim() || undefined,
    image_query: visual?.image_query?.trim() || undefined,
  };
}

function firstClause(text: string): string {
  const clause = text.split(/[.,;:]/)[0]?.trim() ?? text;
  return clause.length > 70 ? `${clause.slice(0, 67).trimEnd()}…` : clause;
}
