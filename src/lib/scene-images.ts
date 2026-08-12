/**
 * Stock imagery for lecture scenes (Pexels, free tier).
 *
 * Entirely optional: without PEXELS_API_KEY every scene falls back to the
 * icon/diagram templates, which is why nothing here is allowed to throw or
 * block scene generation.
 */

const PEXELS_ENDPOINT = 'https://api.pexels.com/v1/search';
const REQUEST_TIMEOUT_MS = 4000;
const CACHE_TTL_MS = 60 * 60 * 1000;

export interface SceneImage {
  url: string;
  /** Both Pexels and Unsplash require visible attribution. */
  credit: string;
  credit_url: string;
}

interface CacheEntry {
  image: SceneImage | null;
  expiresAt: number;
}

const cache = ((globalThis as typeof globalThis & { __skillrotImages?: Map<string, CacheEntry> })
  .__skillrotImages ??= new Map<string, CacheEntry>());

export function isImageSearchConfigured(): boolean {
  return Boolean(process.env.PEXELS_API_KEY);
}

/**
 * Looks up one image per query, de-duplicated across a whole document.
 *
 * `seen` carries the URLs already used by earlier scenes in the same lecture so
 * consecutive scenes don't show the same photo — the API happily returns the
 * same top hit for "gravity field" and "gravitational field lines".
 */
export async function findSceneImage(query: string, seen: Set<string>): Promise<SceneImage | null> {
  if (!isImageSearchConfigured()) return null;

  const key = normalizeQuery(query);
  if (!key) return null;

  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    // A cached hit still has to respect de-duplication within this lecture.
    if (!cached.image || !seen.has(cached.image.url)) return cached.image;
  }

  try {
    const url = new URL(PEXELS_ENDPOINT);
    url.searchParams.set('query', query);
    url.searchParams.set('per_page', '5');
    url.searchParams.set('orientation', 'landscape');

    const response = await fetch(url, {
      headers: { Authorization: process.env.PEXELS_API_KEY! },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.error('[images] Pexels responded', response.status);
      return remember(key, null);
    }

    const payload = await response.json();
    const photos: PexelsPhoto[] = Array.isArray(payload?.photos) ? payload.photos : [];

    const picked = photos.find((photo) => photo?.src?.large && !seen.has(photo.src.large)) ?? photos[0];
    if (!picked?.src?.large) return remember(key, null);

    const image: SceneImage = {
      url: picked.src.large,
      credit: picked.photographer || 'Pexels',
      credit_url: picked.url || 'https://www.pexels.com',
    };

    return remember(key, image);
  } catch (error) {
    console.error('[images] lookup failed, scene will use its icon template:', error);
    return remember(key, null);
  }
}

interface PexelsPhoto {
  url?: string;
  photographer?: string;
  src?: { large?: string };
}

function remember(key: string, image: SceneImage | null): SceneImage | null {
  cache.set(key, { image, expiresAt: Date.now() + CACHE_TTL_MS });
  return image;
}

/**
 * Collapses near-identical queries onto one cache key, so "gravitational field
 * lines diagram" and "diagram of gravitational field lines" share a lookup.
 */
function normalizeQuery(query: string): string {
  const stop = new Set(['a', 'an', 'the', 'of', 'for', 'and', 'in', 'on', 'with', 'illustration', 'diagram', 'photo', 'image']);
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stop.has(word))
    .sort()
    .join(' ')
    .trim();
}
