'use client';

/**
 * Anonymous client-side identity.
 *
 * The MVP has no auth (PRD §4 non-goals), but the roadmap still has to
 * accumulate skills across multiple uploads for one student. A stable id in
 * localStorage gives us that continuity without a login screen.
 */

const USER_ID_KEY = 'skillrot:user-id';

export function getUserId(): string {
  if (typeof window === 'undefined') return 'demo-student';

  let userId = window.localStorage.getItem(USER_ID_KEY);
  if (!userId) {
    userId = `student-${crypto.randomUUID()}`;
    window.localStorage.setItem(USER_ID_KEY, userId);
  }
  return userId;
}
