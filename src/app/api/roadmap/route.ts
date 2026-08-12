import { NextResponse } from 'next/server';
import { fetchAdzunaRoles } from '@/lib/adzuna';
import { JOB_ROLES } from '@/lib/job-roles';
import { matchRolesToSkills, topSkillGaps } from '@/lib/skill-matching';
import { getSkills } from '@/lib/store';
import { DEMO_USER_ID, handleRouteError } from '@/lib/api-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/roadmap?user_id= — matches the student's accumulated skills against
 * the curated role dataset and returns matches plus gaps (PRD §5.5).
 *
 * Pure computation over stored skills, so it re-reflects every new upload
 * without another model call.
 *
 * The MVP has no auth (PRD §4), so the anonymous `user_id` doubles as the
 * bearer token for that student's profile: callers only ever see the skills
 * belonging to the id they present. Real authentication is required before
 * this could be trusted with anything beyond demo data.
 */
export async function GET(request: Request) {
  try {
    const userId = new URL(request.url).searchParams.get('user_id') || DEMO_USER_ID;
    const stored = await getSkills(userId);
    const skillNames = stored.map((skill) => skill.skill_name);

    if (skillNames.length === 0) {
      return NextResponse.json({
        skills: [],
        matches: [],
        gaps: [],
        empty: true,
      });
    }

    // Live Adzuna listings augment the curated dataset when credentials are
    // present (PRD §8 stretch). They never replace it, so the roadmap stays
    // populated and demo-safe if the API is slow, rate-limited or down.
    const liveRoles = await fetchAdzunaRoles();
    const roles = liveRoles ? [...JOB_ROLES, ...liveRoles] : JOB_ROLES;

    const matches = matchRolesToSkills(skillNames, 6, roles);

    return NextResponse.json({
      skills: skillNames,
      empty: false,
      role_source: liveRoles ? 'curated+live' : 'curated',
      role_count: roles.length,
      matches: matches.map((match) => ({
        id: match.role.id,
        title: match.role.title,
        track: match.role.track,
        description: match.role.description,
        match_percentage: match.match_percentage,
        matched_skills: match.matched_skills,
        missing_skills: match.missing_skills,
      })),
      gaps: topSkillGaps(skillNames, 6, roles),
    });
  } catch (error) {
    return handleRouteError('Roadmap', error);
  }
}
