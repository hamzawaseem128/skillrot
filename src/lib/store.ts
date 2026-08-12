import { randomUUID } from 'crypto';
import type { LectureScene } from './lecture-types';
import type { NoteStatus, VideoNotesRecord } from './notes-types';
import type { SourceUnit } from './pdf-extract';
import { supabaseServer, isSupabaseConfigured } from './supabase';

/**
 * Persistence layer with two interchangeable backends:
 *
 *  - Supabase/Postgres + pgvector when the env vars are present (PRD §7.2)
 *  - An in-process store otherwise
 *
 * The fallback exists because PRD §9 puts demo reliability above everything:
 * a missing or misconfigured database should degrade the app to "works for
 * this session" rather than breaking the upload → cards → chat → roadmap flow
 * in front of judges. Every call site is backend-agnostic.
 */

export type ContentType = 'document' | 'video';

export interface StoredMaterial {
  id: string;
  user_id: string;
  title: string;
  raw_text: string;
  /** Drives citation wording: 'slide' for decks, 'page' for PDFs and text. */
  source_unit: SourceUnit;
  /** 'document' → becomes a video lecture. 'video' → becomes structured notes. */
  content_type: ContentType;
  /** YouTube watch URL or Storage path; null for documents. */
  video_url: string | null;
  video_duration_seconds: number | null;
  created_at: string;
}

export interface CreateMaterialOptions {
  sourceUnit?: SourceUnit;
  contentType?: ContentType;
  videoUrl?: string | null;
  videoDurationSeconds?: number | null;
}

export interface StoredChunk {
  chunk_index: number;
  chunk_text: string;
  page_start: number | null;
  page_end: number | null;
  embedding: number[] | null;
}

export interface StoredCard {
  title: string;
  content: string;
  emoji: string;
  order_index: number;
}

export interface StoredSkill {
  skill_name: string;
  source_material_id: string | null;
  created_at: string;
}

interface MemoryRecord {
  material: StoredMaterial;
  chunks: StoredChunk[];
  cards: StoredCard[];
  /** card_index -> generated scenes */
  scenes: Map<number, LectureScene[]>;
}

/**
 * Held on globalThis so the store survives Next.js hot-reloads in development —
 * a module-local Map is wiped on every edit, which would drop the material
 * mid-demo.
 */
const memory = ((globalThis as typeof globalThis & { __skillrotStore?: {
  materials: Map<string, MemoryRecord>;
  skills: Map<string, StoredSkill[]>;
} }).__skillrotStore ??= {
  materials: new Map<string, MemoryRecord>(),
  skills: new Map<string, StoredSkill[]>(),
});

export { isSupabaseConfigured };

/**
 * Creates the `users` row for an anonymous student if it doesn't exist yet.
 * `materials.user_id` and `skills.user_id` are foreign keys onto this table
 * (PRD §7.2), so the row has to exist before the first insert.
 */
export async function ensureUser(userId: string): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const { error } = await supabaseServer()
    .from('users')
    .upsert({ id: userId }, { onConflict: 'id', ignoreDuplicates: true });

  if (error) console.error('[store] ensureUser failed:', error.message);
}

export async function createMaterial(
  userId: string,
  title: string,
  rawText: string,
  options: CreateMaterialOptions = {},
): Promise<StoredMaterial> {
  const {
    sourceUnit = 'page',
    contentType = 'document',
    videoUrl = null,
    videoDurationSeconds = null,
  } = options;

  if (isSupabaseConfigured()) {
    await ensureUser(userId);

    const { data, error } = await supabaseServer()
      .from('materials')
      .insert({
        user_id: userId,
        title,
        raw_text: rawText,
        source_unit: sourceUnit,
        content_type: contentType,
        video_url: videoUrl,
        video_duration_seconds: videoDurationSeconds,
      })
      .select()
      .single();

    if (!error && data) return normalizeMaterial(data);
    console.error('[store] createMaterial fell back to memory:', error?.message);
  }

  const material: StoredMaterial = {
    id: randomUUID(),
    user_id: userId,
    title,
    raw_text: rawText,
    source_unit: sourceUnit,
    content_type: contentType,
    video_url: videoUrl,
    video_duration_seconds: videoDurationSeconds,
    created_at: new Date().toISOString(),
  };
  memory.materials.set(material.id, { material, chunks: [], cards: [], scenes: new Map() });
  return material;
}

export async function getMaterial(materialId: string): Promise<StoredMaterial | null> {
  const local = memory.materials.get(materialId);
  if (local) return local.material;

  if (isSupabaseConfigured()) {
    const { data, error } = await supabaseServer()
      .from('materials')
      .select('*')
      .eq('id', materialId)
      .maybeSingle();

    if (!error && data) return normalizeMaterial(data);
  }

  return null;
}

/**
 * Fills in columns added by later migrations, so an app pointed at an older
 * schema still renders rather than crashing on undefined.
 */
function normalizeMaterial(row: Record<string, unknown>): StoredMaterial {
  const unit = row.source_unit;

  return {
    ...(row as unknown as StoredMaterial),
    source_unit: unit === 'slide' || unit === 'timestamp' ? unit : 'page',
    content_type: row.content_type === 'video' ? 'video' : 'document',
    video_url: (row.video_url as string | null) ?? null,
    video_duration_seconds: (row.video_duration_seconds as number | null) ?? null,
  };
}

/**
 * Replaces all chunks for a material. Idempotent by design: `/api/upload` writes
 * chunks without embeddings and `/api/generate-embeddings` rewrites the same set
 * with vectors attached, so re-running a step must not duplicate rows.
 */
export async function saveChunks(materialId: string, chunks: StoredChunk[]): Promise<void> {
  const local = memory.materials.get(materialId);
  if (local) {
    local.chunks = chunks;
    return;
  }

  if (isSupabaseConfigured()) {
    await supabaseServer().from('material_chunks').delete().eq('material_id', materialId);

    const { error } = await supabaseServer()
      .from('material_chunks')
      .insert(chunks.map((chunk) => ({ material_id: materialId, ...chunk })));

    // The delete above already ran, so a failed insert leaves the material with
    // no chunks at all. Swallowing that produced a silent dead end: retrieval
    // found nothing and the chat answered "I couldn't find that in your
    // uploaded material" forever, while the caller reported success. Surface it.
    if (error) {
      console.error('[store] saveChunks failed:', error.message);
      throw new Error(`Could not store document chunks: ${error.message}`);
    }
  }
}

export async function getChunks(materialId: string): Promise<StoredChunk[]> {
  const local = memory.materials.get(materialId);
  if (local) return local.chunks;

  if (isSupabaseConfigured()) {
    const { data, error } = await supabaseServer()
      .from('material_chunks')
      .select('chunk_index, chunk_text, page_start, page_end, embedding')
      .eq('material_id', materialId)
      .order('chunk_index');

    if (!error && data) {
      return data.map((row) => ({
        chunk_index: row.chunk_index as number,
        chunk_text: row.chunk_text as string,
        page_start: (row.page_start as number | null) ?? null,
        page_end: (row.page_end as number | null) ?? null,
        // pgvector round-trips as a JSON-ish string through PostgREST.
        embedding: parseEmbedding(row.embedding),
      }));
    }
  }

  return [];
}

/**
 * Top-k nearest chunks via pgvector's cosine distance operator (PRD §7.4).
 *
 * Returns null when the query can't be served here — no Supabase, the material
 * lives in the in-process store, or the `match_material_chunks` function hasn't
 * been created — so the caller can fall back to in-process similarity.
 */
export async function matchChunksByEmbedding(
  materialId: string,
  queryEmbedding: number[],
  matchCount: number,
): Promise<StoredChunk[] | null> {
  if (!isSupabaseConfigured() || memory.materials.has(materialId)) return null;

  const { data, error } = await supabaseServer().rpc('match_material_chunks', {
    p_material_id: materialId,
    query_embedding: JSON.stringify(queryEmbedding),
    match_count: matchCount,
  });

  if (error || !Array.isArray(data)) {
    if (error) console.error('[store] match_material_chunks unavailable:', error.message);
    return null;
  }

  return data.map((row) => ({
    chunk_index: row.chunk_index as number,
    chunk_text: row.chunk_text as string,
    page_start: (row.page_start as number | null) ?? null,
    page_end: (row.page_end as number | null) ?? null,
    embedding: null,
  }));
}

export async function saveCards(materialId: string, cards: StoredCard[]): Promise<void> {
  const local = memory.materials.get(materialId);
  if (local) {
    local.cards = cards;
    return;
  }

  if (isSupabaseConfigured()) {
    await supabaseServer().from('learning_cards').delete().eq('material_id', materialId);

    const { error } = await supabaseServer()
      .from('learning_cards')
      .insert(cards.map((card) => ({ material_id: materialId, ...card })));

    if (error) console.error('[store] saveCards failed:', error.message);
  }
}

export async function getCards(materialId: string): Promise<StoredCard[]> {
  const local = memory.materials.get(materialId);
  if (local) return local.cards;

  if (isSupabaseConfigured()) {
    const { data, error } = await supabaseServer()
      .from('learning_cards')
      .select('title, content, emoji, order_index')
      .eq('material_id', materialId)
      .order('order_index');

    if (!error && data) return data as StoredCard[];
  }

  return [];
}

/**
 * Process-level scene cache, independent of which backend holds the material.
 *
 * This exists because scenes are the most expensive thing the app generates and
 * the Supabase write can fail on its own (most commonly: the `lecture_scenes`
 * table has not been migrated yet). Without this layer that failure silently
 * meant *no caching at all*, so every view of a card spent another Gemini call
 * and burned through the daily free-tier quota.
 */
const sceneCache = ((globalThis as typeof globalThis & { __skillrotScenes?: Map<string, LectureScene[]> })
  .__skillrotScenes ??= new Map<string, LectureScene[]>());

const sceneKey = (materialId: string, cardIndex: number) => `${materialId}:${cardIndex}`;

/** Cached narrated scenes for one learning card, or [] if not generated yet. */
export async function getScenes(materialId: string, cardIndex: number): Promise<LectureScene[]> {
  const cached = sceneCache.get(sceneKey(materialId, cardIndex));
  if (cached?.length) return cached;

  const local = memory.materials.get(materialId);
  if (local) return local.scenes.get(cardIndex) ?? [];

  if (isSupabaseConfigured()) {
    const { data, error } = await supabaseServer()
      .from('lecture_scenes')
      .select('scene_index, narration_text, visual_json, audio_url, duration_seconds, image_json')
      .eq('material_id', materialId)
      .eq('card_index', cardIndex)
      .order('scene_index');

    if (!error && data) {
      return data.map((row) => ({
        scene_index: row.scene_index as number,
        narration_text: row.narration_text as string,
        visual: row.visual_json as LectureScene['visual'],
        duration_seconds: Number(row.duration_seconds),
        audio_url: (row.audio_url as string | null) ?? null,
        image: (row.image_json as LectureScene['image']) ?? null,
      }));
    }
  }

  return [];
}

export async function saveScenes(materialId: string, cardIndex: number, scenes: LectureScene[]): Promise<void> {
  // Always populate the process cache first, so a Supabase failure below can
  // never cost a second Gemini call for the same card in this process.
  sceneCache.set(sceneKey(materialId, cardIndex), scenes);

  const local = memory.materials.get(materialId);
  if (local) {
    local.scenes.set(cardIndex, scenes);
    return;
  }

  if (isSupabaseConfigured()) {
    await supabaseServer()
      .from('lecture_scenes')
      .delete()
      .eq('material_id', materialId)
      .eq('card_index', cardIndex);

    const { error } = await supabaseServer().from('lecture_scenes').insert(
      scenes.map((scene) => ({
        material_id: materialId,
        card_index: cardIndex,
        scene_index: scene.scene_index,
        narration_text: scene.narration_text,
        visual_json: scene.visual,
        audio_url: scene.audio_url ?? null,
        duration_seconds: scene.duration_seconds,
        image_json: scene.image ?? null,
      })),
    );

    // Non-fatal: the process cache above still serves this card for the life of
    // the server. Only cross-restart persistence is lost.
    if (error) {
      console.error(
        `[store] saveScenes failed (scenes cached in memory only): ${error.message}` +
          ' — run supabase/migrations/002_lecture_scenes.sql to persist them.',
      );
    }
  }
}

/**
 * Video-notes job state, mirrored in memory so the pipeline keeps working when
 * migration 003 hasn't run — the same degradation the scene cache uses.
 */
const notesCache = ((globalThis as typeof globalThis & { __skillrotNotes?: Map<string, VideoNotesRecord> })
  .__skillrotNotes ??= new Map<string, VideoNotesRecord>());

export async function getVideoNotes(materialId: string): Promise<VideoNotesRecord | null> {
  if (isSupabaseConfigured()) {
    const { data, error } = await supabaseServer()
      .from('video_notes')
      .select('material_id, notes_json, status, progress_message, error, segment_index, segment_total, gemini_file_uri')
      .eq('material_id', materialId)
      .maybeSingle();

    if (!error && data) return data as VideoNotesRecord;
    if (error) console.error('[store] getVideoNotes fell back to memory:', error.message);
  }

  return notesCache.get(materialId) ?? null;
}

/**
 * Upserts job state. Always writes the memory copy first so a missing table
 * cannot strand a job with no readable status.
 */
export async function saveVideoNotes(record: VideoNotesRecord): Promise<void> {
  notesCache.set(record.material_id, record);

  if (isSupabaseConfigured()) {
    const { error } = await supabaseServer()
      .from('video_notes')
      .upsert(
        {
          material_id: record.material_id,
          notes_json: record.notes_json,
          status: record.status,
          progress_message: record.progress_message,
          error: record.error,
          segment_index: record.segment_index,
          segment_total: record.segment_total,
          gemini_file_uri: record.gemini_file_uri,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'material_id' },
      );

    if (error) {
      console.error(
        `[store] saveVideoNotes failed (kept in memory only): ${error.message}` +
          ' — run supabase/migrations/003_video_notes.sql to persist it.',
      );
    }
  }
}

/** Convenience for advancing a job without rewriting the whole record. */
export async function updateVideoNotesStatus(
  materialId: string,
  status: NoteStatus,
  progressMessage: string | null = null,
  error: string | null = null,
): Promise<void> {
  const existing = await getVideoNotes(materialId);
  await saveVideoNotes({
    material_id: materialId,
    notes_json: existing?.notes_json ?? null,
    status,
    progress_message: progressMessage,
    error,
    segment_index: existing?.segment_index ?? 0,
    segment_total: existing?.segment_total ?? 1,
    gemini_file_uri: existing?.gemini_file_uri ?? null,
  });
}

/** Also updates the material's derived text so the RAG pipeline can index it. */
export async function updateMaterialText(materialId: string, rawText: string): Promise<void> {
  const local = memory.materials.get(materialId);
  if (local) {
    local.material.raw_text = rawText;
    return;
  }

  if (isSupabaseConfigured()) {
    const { error } = await supabaseServer()
      .from('materials')
      .update({ raw_text: rawText })
      .eq('id', materialId);

    if (error) console.error('[store] updateMaterialText failed:', error.message);
  }
}

/** Drops cached scenes for one card so the next request regenerates them. */
export async function clearScenes(materialId: string, cardIndex: number): Promise<void> {
  sceneCache.delete(sceneKey(materialId, cardIndex));
  memory.materials.get(materialId)?.scenes.delete(cardIndex);

  if (isSupabaseConfigured()) {
    await supabaseServer()
      .from('lecture_scenes')
      .delete()
      .eq('material_id', materialId)
      .eq('card_index', cardIndex);
  }
}

export async function saveSkills(userId: string, materialId: string | null, skills: string[]): Promise<void> {
  if (skills.length === 0) return;

  if (isSupabaseConfigured() && !memory.materials.has(materialId ?? '')) {
    await ensureUser(userId);

    const { error } = await supabaseServer()
      .from('skills')
      .insert(skills.map((skill_name) => ({
        user_id: userId,
        skill_name,
        source_material_id: materialId,
      })));

    if (!error) return;
    console.error('[store] saveSkills fell back to memory:', error.message);
  }

  const existing = memory.skills.get(userId) ?? [];
  const timestamp = new Date().toISOString();
  memory.skills.set(userId, [
    ...existing,
    ...skills.map((skill_name) => ({
      skill_name,
      source_material_id: materialId,
      created_at: timestamp,
    })),
  ]);
}

/** All skills accumulated by a user across every upload (PRD §5.4). */
export async function getSkills(userId: string): Promise<StoredSkill[]> {
  const local = memory.skills.get(userId) ?? [];

  if (isSupabaseConfigured()) {
    const { data, error } = await supabaseServer()
      .from('skills')
      .select('skill_name, source_material_id, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (!error && data) {
      // Merge both backends: a session can straddle a Supabase outage.
      return dedupeByName([...(data as StoredSkill[]), ...local]);
    }
  }

  return dedupeByName(local);
}

function dedupeByName(skills: StoredSkill[]): StoredSkill[] {
  const seen = new Map<string, StoredSkill>();
  for (const skill of skills) {
    const key = skill.skill_name.toLowerCase().trim();
    if (!seen.has(key)) seen.set(key, skill);
  }
  return [...seen.values()];
}

function parseEmbedding(value: unknown): number[] | null {
  if (Array.isArray(value)) return value as number[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}
