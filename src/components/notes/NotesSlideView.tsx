'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { StructuredNotes } from '@/lib/notes-types';
import { timestampToSeconds } from '@/lib/notes-types';

/**
 * The same notes as swipeable slide cards.
 *
 * Navigation deliberately mirrors LectureCardPanel (dots, arrows, keyboard,
 * touch) so both halves of the app feel like one product rather than two.
 */
export default function NotesSlideView({
  notes,
  onSeek,
}: {
  notes: StructuredNotes;
  onSeek?: (seconds: number) => void;
}) {
  const [index, setIndex] = useState(0);
  const touchStartX = useRef(0);
  const sections = notes.sections;

  const goTo = useCallback(
    (next: number) => {
      if (next < 0 || next >= sections.length) return;
      setIndex(next);
    },
    [sections.length],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      if (event.key === 'ArrowRight') goTo(index + 1);
      if (event.key === 'ArrowLeft') goTo(index - 1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [goTo, index]);

  const section = sections[index];
  if (!section) return null;

  const seconds = timestampToSeconds(section.timestamp_start);

  return (
    <div className="w-full">
      <div
        onTouchStart={(event) => {
          touchStartX.current = event.touches[0].clientX;
        }}
        onTouchEnd={(event) => {
          const delta = touchStartX.current - event.changedTouches[0].clientX;
          if (Math.abs(delta) > 50) goTo(delta > 0 ? index + 1 : index - 1);
        }}
        className="glass-panel rounded-2xl p-6 sm:p-8 min-h-[340px] flex flex-col relative overflow-hidden fade-in"
      >
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#8083ff] via-[#4cd7f6] to-[#8083ff]" />

        <div className="flex items-start justify-between gap-3 mb-5">
          <h3
            className="text-xl font-bold text-[#dfe2f1] leading-tight"
            style={{ fontFamily: 'var(--font-outfit)' }}
          >
            {section.heading}
          </h3>
          {seconds !== null && onSeek && (
            <button
              onClick={() => onSeek(seconds)}
              title="Jump to this moment"
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium tabular-nums bg-[#03b5d3]/15 text-[#4cd7f6] border border-[#4cd7f6]/20 hover:bg-[#03b5d3]/30 transition-colors flex-shrink-0"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>play_arrow</span>
              {section.timestamp_start}
            </button>
          )}
        </div>

        <ul className="space-y-3 flex-1">
          {section.bullets.slice(0, 6).map((bullet) => (
            <li key={bullet} className="flex gap-3">
              <span className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0 bg-gradient-to-br from-[#8083ff] to-[#4cd7f6]" />
              <span className="text-[#c7c4d7] leading-relaxed">{bullet}</span>
            </li>
          ))}
        </ul>

        {section.key_terms.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-5 pt-4 border-t border-white/5">
            {section.key_terms.map((term) => (
              <span
                key={term.term}
                title={term.definition}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-[#8083ff]/15 text-[#c0c1ff] border border-[#8083ff]/25 cursor-help"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>key</span>
                {term.term}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mt-4 gap-3">
        <button
          onClick={() => goTo(index - 1)}
          disabled={index === 0}
          aria-label="Previous slide"
          className="w-11 h-11 rounded-full bg-[#1c1f2a] border border-[#464554] flex items-center justify-center disabled:opacity-30 hover:bg-[#262a35] transition-colors disabled:cursor-not-allowed"
        >
          <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>chevron_left</span>
        </button>

        <div className="flex gap-1 flex-1 justify-center flex-wrap">
          {sections.map((entry, dotIndex) => (
            <button
              key={`${entry.heading}-${dotIndex}`}
              onClick={() => goTo(dotIndex)}
              aria-label={`Go to slide ${dotIndex + 1}`}
              className={`h-1.5 rounded-full transition-all ${
                dotIndex === index
                  ? 'w-8 bg-gradient-to-r from-[#8083ff] to-[#4cd7f6]'
                  : 'w-4 bg-[#464554] hover:bg-[#908fa0]'
              }`}
            />
          ))}
        </div>

        <button
          onClick={() => goTo(index + 1)}
          disabled={index === sections.length - 1}
          aria-label="Next slide"
          className="w-11 h-11 rounded-full bg-[#1c1f2a] border border-[#464554] flex items-center justify-center disabled:opacity-30 hover:bg-[#262a35] transition-colors disabled:cursor-not-allowed"
        >
          <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>chevron_right</span>
        </button>
      </div>
    </div>
  );
}
