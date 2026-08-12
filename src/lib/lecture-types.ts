/**
 * Shared shapes for the narrated "video lecture" player.
 *
 * Kept in their own module (not in gemini.ts) because both server routes and
 * client components import them, and gemini.ts pulls in the Node-only SDK.
 */

/**
 * A single learning card. Declared here rather than in gemini.ts so client
 * components can import it without pulling the server-only SDK into scope.
 */
export interface LearningCard {
  title: string;
  content: string;
  emoji: string;
  order_index: number;
}

/**
 * Flat 2D templates plus three WebGL "3D-style" ones.
 *
 * These are motion graphics with real perspective and depth, not rendered 3D
 * film — the whole composition draws live in the browser, so it stays free to
 * host and needs no GPU render farm.
 */
export const VISUAL_TYPES = [
  'bullet_reveal',
  'diagram',
  'formula',
  'comparison',
  'icon_focus',
  'rotating_concept_3d',
  'depth_parallax_3d',
  'formula_float_3d',
] as const;

export type VisualType = (typeof VISUAL_TYPES)[number];

/** Templates that mount a WebGL canvas; used to gate lazy-loading of three.js. */
export const THREE_D_TYPES: readonly VisualType[] = [
  'rotating_concept_3d',
  'depth_parallax_3d',
  'formula_float_3d',
];

export function isThreeDType(type: VisualType): boolean {
  return THREE_D_TYPES.includes(type);
}

export interface SceneImageRef {
  url: string;
  credit: string;
  credit_url: string;
}

export interface SceneVisual {
  type: VisualType;
  /** Bullet points, diagram node labels, or the two sides of a comparison. */
  content: string[];
  /** Term to emphasise on screen; may be absent. */
  highlight_term?: string;
  /** Stock-photo search phrase written by the model. */
  image_query?: string;
}

export interface LectureScene {
  scene_index: number;
  narration_text: string;
  visual: SceneVisual;
  duration_seconds: number;
  audio_url?: string | null;
  /** Stock photo for this scene; absent when lookup is unconfigured or missed. */
  image?: SceneImageRef | null;
}

export interface LectureScript {
  card_index: number;
  topic: string;
  scenes: LectureScene[];
}

/** Frame rate for the Remotion composition. 30 is plenty for slide motion. */
export const LECTURE_FPS = 30;

/**
 * Average speaking rate used to size a scene when the model's own hint is
 * unrealistic. Browser speech synthesis gives no duration up front, so the
 * visual timeline is derived from word count instead — this keeps the
 * composition deterministic, which is what makes scrubbing possible at all.
 */
const WORDS_PER_MINUTE = 150;
const MIN_SCENE_SECONDS = 3;
const MAX_SCENE_SECONDS = 20;

export function estimateNarrationSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const seconds = (words / WORDS_PER_MINUTE) * 60;
  return clamp(seconds + 0.75, MIN_SCENE_SECONDS, MAX_SCENE_SECONDS);
}

/**
 * Reconciles the model's `duration_hint_seconds` with what the narration will
 * actually take. The hint is treated as a floor, never a ceiling: cutting a
 * sentence off mid-word looks far worse than holding a slide a beat too long.
 */
export function resolveSceneDuration(narration: string, hint: unknown): number {
  const estimated = estimateNarrationSeconds(narration);
  const hinted = typeof hint === 'number' && Number.isFinite(hint) ? hint : 0;
  return Number(clamp(Math.max(estimated, hinted), MIN_SCENE_SECONDS, MAX_SCENE_SECONDS).toFixed(2));
}

export function totalDurationSeconds(scenes: LectureScene[]): number {
  return scenes.reduce((sum, scene) => sum + scene.duration_seconds, 0);
}

/** Frame offset at which each scene starts, for Remotion `<Sequence>` layout. */
export function sceneFrameRanges(scenes: LectureScene[]): { from: number; durationInFrames: number }[] {
  let cursor = 0;
  return scenes.map((scene) => {
    const durationInFrames = Math.max(1, Math.round(scene.duration_seconds * LECTURE_FPS));
    const range = { from: cursor, durationInFrames };
    cursor += durationInFrames;
    return range;
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
