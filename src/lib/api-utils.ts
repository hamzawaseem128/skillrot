import { NextResponse } from 'next/server';
import { getMaterial, type StoredMaterial } from './store';

/** Anonymous demo identity used when no user id is supplied by the client. */
export const DEMO_USER_ID = 'demo-student';

export function jsonError(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

type OwnedMaterial =
  | { ok: true; material: StoredMaterial }
  | { ok: false; response: NextResponse };

/**
 * Loads a material and verifies it belongs to the requesting student
 * (PRD §9 — no cross-user data leakage).
 *
 * A material owned by someone else returns 404, not 403: a 403 would confirm
 * that the id exists, which is itself a leak. Material ids are unguessable
 * UUIDs and the anonymous user id acts as the bearer token for them — the MVP
 * has no auth (PRD §4), so this is ownership checking, not authentication.
 */
export async function requireOwnedMaterial(materialId: unknown, userId: unknown): Promise<OwnedMaterial> {
  if (typeof materialId !== 'string' || !materialId) {
    return { ok: false, response: jsonError('material_id is required.') };
  }

  const material = await getMaterial(materialId);
  const requester = typeof userId === 'string' && userId ? userId : DEMO_USER_ID;

  if (!material || material.user_id !== requester) {
    return { ok: false, response: jsonError('Material not found. Upload it again.', 404) };
  }

  return { ok: true, material };
}

/**
 * Turns a thrown error into a response the UI can actually show the student.
 * Gemini quota/auth failures are the common case during a live demo, and a bare
 * "Internal Server Error" gives them nothing to act on.
 */
export function handleRouteError(scope: string, error: unknown) {
  console.error(`[${scope}]`, error);

  const message = error instanceof Error ? error.message : String(error);

  if (message.includes('GEMINI_API_KEY')) {
    return jsonError('Gemini API key is missing. Add GEMINI_API_KEY to .env.local and restart the dev server.', 503);
  }
  if (/quota|rate limit|429|RESOURCE_EXHAUSTED/i.test(message)) {
    return jsonError('Gemini API rate limit reached. Wait a few seconds and try again.', 429);
  }
  if (/API key not valid|API_KEY_INVALID|PERMISSION_DENIED/i.test(message)) {
    return jsonError('Gemini rejected the API key. Check GEMINI_API_KEY in .env.local.', 401);
  }

  return jsonError(`${scope} failed: ${message}`, 500);
}
