'use client';

import { useEffect } from 'react';
import type { Citation } from './ChatPanel';

/**
 * Shows the exact passage an answer was drawn from, opened by clicking a
 * citation badge.
 *
 * The excerpt comes from the retrieved chunk itself rather than a rendered page
 * image — the app stores extracted text, not page bitmaps, so this shows the
 * student precisely what the model was allowed to read.
 */
export default function SourceViewer({
  citation,
  onClose,
}: {
  citation: Citation | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!citation) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [citation, onClose]);

  if (!citation) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Source for ${citation.label}`}
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      <div
        onClick={(event) => event.stopPropagation()}
        className="relative glass-panel rounded-t-2xl sm:rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col fade-in"
      >
        <div className="flex items-center gap-2 px-5 py-4 border-b border-white/5">
          <span className="material-symbols-outlined text-[#4cd7f6]" style={{ fontSize: '20px' }}>format_quote</span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[#dfe2f1]" style={{ fontFamily: 'var(--font-outfit)' }}>
              {citation.label}
            </h3>
            <p className="text-[10px] text-[#908fa0]">Passage the answer was grounded in</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close source"
            className="ml-auto w-9 h-9 rounded-lg flex items-center justify-center hover:bg-white/5 transition-colors"
          >
            <span className="material-symbols-outlined text-[#c7c4d7]" style={{ fontSize: '20px' }}>close</span>
          </button>
        </div>

        <div className="overflow-y-auto p-5">
          <p className="text-sm text-[#c7c4d7] leading-relaxed whitespace-pre-wrap">{citation.text_preview}</p>
        </div>
      </div>
    </div>
  );
}
