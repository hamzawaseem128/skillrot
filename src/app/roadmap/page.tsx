'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import Footer from '@/components/Footer';
import RoleMatchCard, { type RoleMatch } from '@/components/RoleMatchCard';
import SkillPill from '@/components/SkillPill';
import { getUserId } from '@/lib/session';

interface RoadmapResponse {
  skills: string[];
  matches: RoleMatch[];
  gaps: { skill: string; unlocks: number }[];
  empty: boolean;
  role_source?: 'curated' | 'curated+live';
  role_count?: number;
}

function isRoadmapResponse(value: unknown): value is RoadmapResponse {
  const candidate = value as RoadmapResponse | null;
  return Boolean(
    candidate &&
      Array.isArray(candidate.skills) &&
      Array.isArray(candidate.matches) &&
      Array.isArray(candidate.gaps),
  );
}

export default function RoadmapPage() {
  const [data, setData] = useState<RoadmapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Bumping this re-runs the fetch effect. Retrying is a new load, not a
  // state mutation, which keeps every setState below an await.
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadRoadmap() {
      try {
        const response = await fetch(`/api/roadmap?user_id=${encodeURIComponent(getUserId())}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Could not load your roadmap.');
        // A 200 with an unreadable body would otherwise reach the render branch
        // below and crash on `data.skills.length`.
        if (!isRoadmapResponse(payload)) throw new Error('The roadmap response was malformed.');
        if (cancelled) return;
        setData(payload);
        setError(null);
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : 'Could not load your roadmap.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    loadRoadmap();

    // Guards against a resolved fetch writing state after unmount, and against
    // an in-flight retry overwriting a newer one.
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const retry = () => {
    setIsLoading(true);
    setError(null);
    setReloadToken((token) => token + 1);
  };

  const bestMatch = data?.matches[0];

  return (
    <div className="min-h-screen">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-10">
          <h1 className="text-3xl sm:text-4xl font-bold text-[#dfe2f1] mb-2" style={{ fontFamily: 'var(--font-outfit)' }}>
            Your career roadmap
          </h1>
          <p className="text-[#c7c4d7]">
            Built from everything you have uploaded. Each new lecture sharpens the match.
          </p>
        </div>

        {isLoading && (
          <div className="flex flex-col items-center justify-center py-24">
            <div className="w-12 h-12 rounded-full border-2 border-[#8083ff] border-t-transparent spin-slow mb-4" />
            <p className="text-sm text-[#908fa0]">Matching your skills to roles…</p>
          </div>
        )}

        {!isLoading && error && (
          <div className="glass-panel rounded-2xl p-8 text-center">
            <span className="material-symbols-outlined text-[#ff516a] mb-3 block" style={{ fontSize: '40px' }}>error</span>
            <p className="text-[#ffb2b7] mb-4">{error}</p>
            <button
              onClick={retry}
              className="px-5 py-2.5 rounded-xl glass-panel text-sm text-[#dfe2f1] glow-hover transition-all"
            >
              Try again
            </button>
          </div>
        )}

        {!isLoading && !error && data?.empty && (
          <div className="glass-panel rounded-2xl p-10 text-center slide-up">
            <span className="material-symbols-outlined text-[#464554] mb-4 block" style={{ fontSize: '56px' }}>
              travel_explore
            </span>
            <h2 className="text-xl font-bold text-[#dfe2f1] mb-2" style={{ fontFamily: 'var(--font-outfit)' }}>
              No skills tracked yet
            </h2>
            <p className="text-sm text-[#908fa0] mb-6 max-w-sm mx-auto">
              Upload a lecture and SkillRot will extract the skills it teaches, then match them against real
              entry-level roles.
            </p>
            <Link
              href="/upload"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-[#8083ff] to-[#4cd7f6] text-[#0f131d] font-semibold hover:opacity-90 transition-opacity"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>upload_file</span>
              Upload your first lecture
            </Link>
          </div>
        )}

        {!isLoading && !error && data && !data.empty && (
          <div className="space-y-8 fade-in">
            <div className="grid gap-4 sm:grid-cols-3">
              <StatTile label="Skills tracked" value={data.skills.length} icon="psychology" />
              <StatTile label="Roles matched" value={data.matches.length} icon="work" />
              <StatTile
                label="Best match"
                value={bestMatch ? `${bestMatch.match_percentage}%` : '—'}
                icon="trending_up"
                caption={bestMatch?.title}
              />
            </div>

            <section>
              <h2 className="text-sm font-semibold text-[#c7c4d7] mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="material-symbols-outlined text-emerald-400" style={{ fontSize: '18px' }}>verified</span>
                Skills you have
                <span className="text-[10px] text-[#908fa0] font-normal">from your uploads</span>
              </h2>
              <div className="glass-panel rounded-2xl p-5">
                <div className="flex flex-wrap gap-2">
                  {data.skills.map((skill) => (
                    <SkillPill key={skill} skill={skill} variant="have" />
                  ))}
                </div>
              </div>
            </section>

            {data.gaps.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-[#c7c4d7] mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="material-symbols-outlined text-[#ffb2b7]" style={{ fontSize: '18px' }}>target</span>
                  Highest-leverage gaps
                  <span className="text-[10px] text-[#908fa0] font-normal">learn these to unlock the most roles</span>
                </h2>
                <div className="glass-panel rounded-2xl p-5 space-y-2.5">
                  {data.gaps.map((gap) => (
                    <div
                      key={gap.skill}
                      className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3"
                    >
                      <div className="min-w-0 sm:w-44 sm:flex-shrink-0">
                        <SkillPill skill={gap.skill} variant="missing" />
                      </div>
                      <div className="flex items-center gap-3 flex-1">
                        <div className="flex-1 h-1.5 rounded-full bg-[#262a35] overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-[#8083ff] to-[#4cd7f6] transition-all duration-700"
                            style={{ width: `${(gap.unlocks / data.gaps[0].unlocks) * 100}%` }}
                          />
                        </div>
                        <span className="text-xs text-[#908fa0] w-16 text-right flex-shrink-0">
                          {gap.unlocks} {gap.unlocks === 1 ? 'role' : 'roles'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section>
              <h2 className="text-sm font-semibold text-[#c7c4d7] mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="material-symbols-outlined text-[#8083ff]" style={{ fontSize: '18px' }}>work</span>
                Roles you are growing into
                <span className="text-[10px] text-[#908fa0] font-normal">tap a role to see the detail</span>
                {data.role_source === 'curated+live' && (
                  <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-400/15 text-emerald-300 border border-emerald-400/25">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    live job data
                  </span>
                )}
              </h2>
              <div className="space-y-3">
                {data.matches.map((match, index) => (
                  <RoleMatchCard key={match.id} match={match} defaultOpen={index === 0} />
                ))}
              </div>
            </section>

            <div className="glass-panel rounded-2xl p-6 text-center">
              <p className="text-sm text-[#c7c4d7] mb-4">
                Upload another lecture to sharpen these matches.
              </p>
              <Link
                href="/upload"
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-[#8083ff] to-[#4cd7f6] text-[#0f131d] text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>add</span>
                Add more material
              </Link>
            </div>
          </div>
        )}
      </div>

      <Footer />
    </div>
  );
}

function StatTile({ label, value, icon, caption }: { label: string; value: string | number; icon: string; caption?: string }) {
  return (
    <div className="glass-panel rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-2">
        <span className="material-symbols-outlined text-[#8083ff]" style={{ fontSize: '18px' }}>{icon}</span>
        <p className="text-xs text-[#908fa0] uppercase tracking-wider">{label}</p>
      </div>
      <p className="text-2xl font-bold text-[#dfe2f1]" style={{ fontFamily: 'var(--font-outfit)' }}>
        {value}
      </p>
      {caption && <p className="text-xs text-[#908fa0] mt-1 truncate">{caption}</p>}
    </div>
  );
}
