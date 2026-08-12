import { NextResponse } from 'next/server';
import { extractSkills } from '@/lib/gemini';
import { saveSkills } from '@/lib/store';
import { handleRouteError, jsonError, requireOwnedMaterial } from '@/lib/api-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/extract-skills — pulls standardized skill names out of the material
 * and accumulates them onto the student's profile (PRD §5.4).
 */
export async function POST(request: Request) {
  try {
    const { material_id, user_id } = await request.json();

    const owned = await requireOwnedMaterial(material_id, user_id);
    if (!owned.ok) return owned.response;
    const material = owned.material;

    const skills = await extractSkills(material.raw_text);
    if (skills.length === 0) {
      return jsonError('No recognisable skills found in this material.', 422);
    }

    // Attribute to the material's owner, which requireOwnedMaterial just
    // confirmed matches the requester.
    await saveSkills(material.user_id, material_id, skills);

    return NextResponse.json({ skills });
  } catch (error) {
    return handleRouteError('Skill extraction', error);
  }
}
