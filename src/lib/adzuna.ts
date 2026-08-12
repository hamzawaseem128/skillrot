import type { JobRole } from './job-roles';
import { normalizeSkill } from './skill-matching';

/**
 * Optional live job-market upgrade (PRD §8, stretch goal).
 *
 * Adzuna is used only when both credentials are present. Everything about this
 * module is designed so it can never break a live demo:
 *
 *  - absent credentials  → returns null, caller uses the curated dataset
 *  - network error / non-200 / malformed payload → returns null
 *  - slow response → aborted after ADZUNA_TIMEOUT_MS
 *  - results cached in-process so repeated roadmap loads don't re-hit the API
 *
 * Adzuna returns free-text job descriptions rather than structured skill lists,
 * so required skills are inferred by matching descriptions against a known
 * vocabulary. That is lossy, which is exactly why this augments the curated
 * dataset rather than replacing it.
 */

// Measured round-trip against the live API is ~2.9-3.0s, so the previous 3.5s
// budget aborted valid responses intermittently.
const ADZUNA_TIMEOUT_MS = 6000;
const CACHE_TTL_MS = 15 * 60 * 1000;

/**
 * Adzuna's free tier truncates every description to 500 characters, which cuts
 * off the requirements section where skills are actually listed. Mining the
 * remaining blurb produces false positives ("Junior Development Chemist" ->
 * Data Analysis), so the bar is set high deliberately: a listing must both name
 * several recognisable skills AND read like an entry-level role. Most listings
 * fail this, which is the intended outcome — a junk role showing a student a
 * "100% match" is far worse for the roadmap than no live data at all.
 */
const MIN_DETECTED_SKILLS = 5;
const ENTRY_LEVEL_TITLE = /\b(junior|graduate|entry[- ]level|trainee|associate|intern|apprentice)\b/i;

/** Skill vocabulary searched for inside Adzuna descriptions. */
const DETECTABLE_SKILLS = [
  'Python', 'JavaScript', 'TypeScript', 'Java', 'C Programming', 'SQL', 'React',
  'Node.js', 'HTML', 'CSS', 'Git', 'Docker', 'Linux', 'Cloud Computing', 'CI/CD',
  'REST APIs', 'Databases', 'Data Structures', 'Algorithms', 'Machine Learning',
  'Deep Learning', 'Statistics', 'Data Visualization', 'Data Analysis', 'Excel',
  'Testing', 'Debugging', 'Agile', 'Communication', 'Problem Solving',
  'Project Management', 'Financial Analysis', 'Accounting', 'Market Research',
  'Business Analysis', 'User Research', 'UI Design', 'Accessibility', 'Security',
  'Networking', 'Distributed Systems', 'ETL', 'Data Modeling', 'Technical Writing',
];

interface CacheEntry {
  /** null means "this lookup yielded nothing usable" — cached so we stop retrying. */
  roles: JobRole[] | null;
  expiresAt: number;
}

/**
 * Failures and empty results are cached too, on a shorter TTL. Without this, a
 * configured-but-unproductive Adzuna account would add its full round-trip
 * (~3s) to *every* roadmap load while returning nothing, since only successes
 * were ever cached.
 */
const NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1000;

const cache = ((globalThis as typeof globalThis & { __skillrotAdzuna?: Map<string, CacheEntry> })
  .__skillrotAdzuna ??= new Map<string, CacheEntry>());

function remember(country: string, roles: JobRole[] | null): JobRole[] | null {
  cache.set(country, {
    roles,
    expiresAt: Date.now() + (roles ? CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS),
  });
  return roles;
}

export function isAdzunaConfigured(): boolean {
  return Boolean(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY);
}

/**
 * Fetches entry-level roles from Adzuna. Returns null whenever live data can't
 * be used, which the caller treats as "fall back to the curated dataset".
 */
export async function fetchAdzunaRoles(country = process.env.ADZUNA_COUNTRY || 'gb'): Promise<JobRole[] | null> {
  if (!isAdzunaConfigured()) return null;

  const cached = cache.get(country);
  if (cached && cached.expiresAt > Date.now()) return cached.roles;

  const url = new URL(`https://api.adzuna.com/v1/api/jobs/${country}/search/1`);
  url.searchParams.set('app_id', process.env.ADZUNA_APP_ID!);
  url.searchParams.set('app_key', process.env.ADZUNA_APP_KEY!);
  url.searchParams.set('results_per_page', '50');
  url.searchParams.set('what', 'graduate junior entry level');
  url.searchParams.set('content-type', 'application/json');

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(ADZUNA_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });

    if (!response.ok) {
      console.error('[adzuna] request failed with status', response.status);
      return remember(country, null);
    }

    const payload = await response.json();
    if (!Array.isArray(payload?.results)) return remember(country, null);

    const roles = dedupeByTitle(
      payload.results
        .map(toJobRole)
        .filter((role: JobRole | null): role is JobRole => role !== null),
    );

    if (roles.length === 0) {
      console.warn('[adzuna] no listing met the skill-detection bar; using curated dataset');
      return remember(country, null);
    }

    return remember(country, roles);
  } catch (error) {
    console.error('[adzuna] unavailable, using curated dataset:', error);
    return remember(country, null);
  }
}

function toJobRole(result: Record<string, unknown>): JobRole | null {
  const title = typeof result.title === 'string' ? stripHtml(result.title) : '';
  const description = typeof result.description === 'string' ? stripHtml(result.description) : '';
  if (!title || !description) return null;

  if (!ENTRY_LEVEL_TITLE.test(title)) return null;

  const required_skills = detectSkills(`${title} ${description}`);
  if (required_skills.length < MIN_DETECTED_SKILLS) return null;

  return {
    id: `adzuna-${String(result.id ?? title).replace(/\W+/g, '-').toLowerCase()}`,
    title,
    track: inferTrack(`${title} ${description}`),
    required_skills,
    description: description.length > 180 ? `${description.slice(0, 177).trimEnd()}…` : description,
  };
}

function detectSkills(text: string): string[] {
  const haystack = ` ${normalizeSkill(text)} `;
  return DETECTABLE_SKILLS.filter((skill) => {
    const needle = normalizeSkill(skill);
    return new RegExp(`(^|\\s)${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(haystack);
  }).slice(0, 8);
}

function inferTrack(text: string): JobRole['track'] {
  const value = text.toLowerCase();
  if (/\b(data|analytics|machine learning|scientist)\b/.test(value)) return 'data';
  if (/\b(design|ux|ui|product design)\b/.test(value)) return 'design';
  if (/\b(product manager|programme|program manager)\b/.test(value)) return 'product';
  if (/\b(finance|marketing|sales|consultant|account)\b/.test(value)) return 'business';
  return 'engineering';
}

function dedupeByTitle(roles: JobRole[]): JobRole[] {
  const seen = new Map<string, JobRole>();
  for (const role of roles) {
    const key = role.title.toLowerCase().trim();
    if (!seen.has(key)) seen.set(key, role);
  }
  return [...seen.values()];
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
