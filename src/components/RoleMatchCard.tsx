'use client';

import { useState } from 'react';
import ProgressRing from './ProgressRing';
import SkillPill from './SkillPill';

export interface RoleMatch {
  id: string;
  title: string;
  track: string;
  description: string;
  match_percentage: number;
  matched_skills: string[];
  missing_skills: string[];
}

const TRACK_STYLES: Record<string, string> = {
  engineering: 'bg-[#8083ff]/15 text-[#c0c1ff] border-[#8083ff]/25',
  data: 'bg-[#4cd7f6]/15 text-[#4cd7f6] border-[#4cd7f6]/25',
  product: 'bg-amber-400/15 text-amber-300 border-amber-400/25',
  business: 'bg-emerald-400/15 text-emerald-300 border-emerald-400/25',
  design: 'bg-pink-400/15 text-pink-300 border-pink-400/25',
};

export default function RoleMatchCard({ match, defaultOpen = false }: { match: RoleMatch; defaultOpen?: boolean }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const trackStyle = TRACK_STYLES[match.track] ?? TRACK_STYLES.engineering;

  return (
    <div className="glass-panel rounded-2xl overflow-hidden transition-all duration-300 hover:border-[#8083ff]/30">
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        className="w-full flex items-center gap-3 sm:gap-4 p-4 sm:p-5 text-left hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex-shrink-0">
          <ProgressRing percentage={match.match_percentage} size={64} strokeWidth={5} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-bold text-[#dfe2f1] truncate" style={{ fontFamily: 'var(--font-outfit)' }}>
              {match.title}
            </h3>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border capitalize ${trackStyle}`}>
              {match.track}
            </span>
          </div>
          <p className="text-xs text-[#908fa0] mt-1 line-clamp-2">{match.description}</p>
          <p className="text-xs text-[#c7c4d7] mt-2">
            <span className="text-emerald-400 font-semibold">{match.matched_skills.length} matched</span>
            <span className="text-[#464554]"> · </span>
            <span className="text-[#ffb2b7] font-semibold">{match.missing_skills.length} to learn</span>
          </p>
        </div>

        <span
          className={`material-symbols-outlined text-[#908fa0] transition-transform duration-300 flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`}
        >
          expand_more
        </span>
      </button>

      {isOpen && (
        <div className="px-5 pb-5 pt-1 space-y-4 fade-in border-t border-white/5">
          <div>
            <p className="text-xs font-semibold text-emerald-400 mb-2 flex items-center gap-1.5 mt-4">
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>verified</span>
              Skills you already have
            </p>
            <div className="flex flex-wrap gap-2">
              {match.matched_skills.length > 0 ? (
                match.matched_skills.map((skill) => <SkillPill key={skill} skill={skill} variant="have" />)
              ) : (
                <p className="text-xs text-[#908fa0]">Nothing matched yet — upload more material.</p>
              )}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-[#ffb2b7] mb-2 flex items-center gap-1.5">
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>flag</span>
              Skills you still need
            </p>
            <div className="flex flex-wrap gap-2">
              {match.missing_skills.length > 0 ? (
                match.missing_skills.map((skill) => <SkillPill key={skill} skill={skill} variant="missing" />)
              ) : (
                <p className="text-xs text-emerald-400">You cover every skill listed for this role.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
