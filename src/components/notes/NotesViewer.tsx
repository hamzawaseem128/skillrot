'use client';

import { useState } from 'react';
import type { NoteSection, StructuredNotes } from '@/lib/notes-types';
import { timestampToSeconds } from '@/lib/notes-types';

/**
 * Study-document rendering of video notes: collapsible sections, bullets, and
 * key terms called out separately.
 *
 * Timestamps are buttons rather than labels — clicking one seeks the embedded
 * player, which is the whole point of keeping them through the pipeline.
 */
export default function NotesViewer({
  notes,
  onSeek,
}: {
  notes: StructuredNotes;
  onSeek?: (seconds: number) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});

  return (
    <div className="space-y-3">
      {notes.sections.map((section, index) => (
        <SectionBlock
          key={`${section.heading}-${index}`}
          section={section}
          isCollapsed={Boolean(collapsed[index])}
          onToggle={() => setCollapsed((current) => ({ ...current, [index]: !current[index] }))}
          onSeek={onSeek}
        />
      ))}
    </div>
  );
}

function SectionBlock({
  section,
  isCollapsed,
  onToggle,
  onSeek,
}: {
  section: NoteSection;
  isCollapsed: boolean;
  onToggle: () => void;
  onSeek?: (seconds: number) => void;
}) {
  const seconds = timestampToSeconds(section.timestamp_start);

  return (
    <div className="glass-panel rounded-2xl overflow-hidden">
      <div className="flex items-center gap-3 p-4 sm:p-5">
        {seconds !== null && onSeek && (
          <button
            onClick={() => onSeek(seconds)}
            title="Jump to this moment in the video"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium tabular-nums bg-[#03b5d3]/15 text-[#4cd7f6] border border-[#4cd7f6]/20 hover:bg-[#03b5d3]/30 transition-colors flex-shrink-0"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>play_arrow</span>
            {section.timestamp_start}
          </button>
        )}

        <button
          onClick={onToggle}
          aria-expanded={!isCollapsed}
          className="flex-1 text-left min-w-0"
        >
          <h3
            className="text-base font-bold text-[#dfe2f1] truncate"
            style={{ fontFamily: 'var(--font-outfit)' }}
          >
            {section.heading}
          </h3>
        </button>

        <button onClick={onToggle} aria-label={isCollapsed ? 'Expand section' : 'Collapse section'}>
          <span
            className={`material-symbols-outlined text-[#908fa0] transition-transform duration-300 ${isCollapsed ? '' : 'rotate-180'}`}
          >
            expand_more
          </span>
        </button>
      </div>

      {!isCollapsed && (
        <div className="px-4 sm:px-5 pb-5 space-y-4 fade-in">
          <ul className="space-y-2.5">
            {section.bullets.map((bullet) => (
              <li key={bullet} className="flex gap-3">
                <span className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0 bg-gradient-to-br from-[#8083ff] to-[#4cd7f6]" />
                <span className="text-sm text-[#c7c4d7] leading-relaxed">{bullet}</span>
              </li>
            ))}
          </ul>

          {section.key_terms.length > 0 && (
            <div className="rounded-xl bg-[#8083ff]/8 border border-[#8083ff]/20 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#c0c1ff] mb-2.5 flex items-center gap-1.5">
                <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>key</span>
                Key terms
              </p>
              <dl className="space-y-2">
                {section.key_terms.map((term) => (
                  <div key={term.term}>
                    <dt className="text-xs font-semibold text-[#dfe2f1] inline">{term.term}</dt>
                    <dd className="text-xs text-[#908fa0] inline"> — {term.definition}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
