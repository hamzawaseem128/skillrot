'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LearningCard, LectureScene } from '@/lib/lecture-types';
import { DroppedFromQueueError, enqueueSceneRequest } from './sceneQueue';

/**
 * Remotion pulls in a sizeable client bundle and touches browser-only APIs, so
 * the player is loaded on demand rather than shipped with the first paint.
 */
const LecturePlayer = dynamic(() => import('./LecturePlayer'), {
  ssr: false,
  loading: () => <PlayerSkeleton label="Loading player…" />,
});

type Mode = 'watch' | 'read';

interface ScriptState {
  topic: string;
  scenes: LectureScene[];
}

interface LectureCardPanelProps {
  materialId: string;
  materialTitle: string;
  userId: string;
  cards: LearningCard[];
}

export default function LectureCardPanel({
  materialId,
  materialTitle,
  userId,
  cards,
}: LectureCardPanelProps) {
  const [mode, setMode] = useState<Mode>('watch');
  const [index, setIndex] = useState(0);
  const [scripts, setScripts] = useState<Record<number, ScriptState>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [quotaBlocked, setQuotaBlocked] = useState(false);
  const touchStartX = useRef(0);

  const card = cards[index];
  const script = scripts[index];
  const error = errors[index];
  // Derived rather than stored: a `loading` state variable would have to be set
  // synchronously inside the fetch effect, which cascades renders.
  const isLoading = mode === 'watch' && !script && !error;

  const goTo = useCallback(
    (next: number) => {
      if (next < 0 || next >= cards.length) return;
      setIndex(next);
    },
    [cards.length],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Don't hijack arrow keys while the student is typing in the chat panel.
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;

      if (event.key === 'ArrowRight') goTo(index + 1);
      if (event.key === 'ArrowLeft') goTo(index - 1);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [goTo, index]);

  // Scenes are generated on first view of a card and then cached, so a long
  // deck never costs more Gemini calls than the student actually watches.
  const indexRef = useRef(index);
  indexRef.current = index;

  useEffect(() => {
    if (mode !== 'watch' || !card || script || error) return;

    let cancelled = false;
    const cardIndex = index;

    // Queued rather than fired immediately: swiping through several cards must
    // not launch several concurrent Gemini calls.
    const { promise, cancel } = enqueueSceneRequest(
      `${materialId}:${cardIndex}`,
      async (signal) => {
        const response = await fetch(`/api/materials/${materialId}/scenes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ card_index: cardIndex, user_id: userId }),
          signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const failure = new Error(payload.error || 'Could not build this lecture.');
          (failure as Error & { quotaExhausted?: boolean }).quotaExhausted = Boolean(payload.quota_exhausted);
          throw failure;
        }
        return payload as { topic: string; scenes: LectureScene[] };
      },
      // By the time this job reaches the front of the queue the viewer may have
      // moved on; only the card actually on screen is still worth generating.
      () => indexRef.current === cardIndex,
    );

    promise
      .then((payload) => {
        if (cancelled) return;
        setScripts((current) => ({
          ...current,
          [cardIndex]: { topic: payload.topic, scenes: payload.scenes },
        }));
      })
      .catch((caught) => {
        // A dropped/aborted job is not a failure the viewer should ever see.
        if (cancelled || caught instanceof DroppedFromQueueError || caught?.name === 'AbortError') return;
        setErrors((current) => ({
          ...current,
          [cardIndex]: caught instanceof Error ? caught.message : 'Could not build this lecture.',
        }));
        setQuotaBlocked(Boolean(caught?.quotaExhausted));
      });

    return () => {
      cancelled = true;
      cancel();
    };
  }, [mode, index, card, script, error, materialId, userId]);

  /** Clearing the stored error re-triggers the fetch effect for this card. */
  const retry = useCallback(() => {
    setErrors((current) => {
      const next = { ...current };
      delete next[index];
      return next;
    });
  }, [index]);

  /**
   * One silent background retry. A per-minute limit clears on its own, so the
   * video can appear without the viewer having to click anything. Skipped when
   * the daily quota is gone, since waiting 30s cannot help with that.
   */
  useEffect(() => {
    if (!error || quotaBlocked || mode !== 'watch') return;

    const timer = window.setTimeout(() => {
      setErrors((current) => {
        const next = { ...current };
        delete next[index];
        return next;
      });
    }, 30000);

    return () => window.clearTimeout(timer);
  }, [error, quotaBlocked, mode, index]);

  /** Explicit user action — the only path that spends a call on a cached card. */
  const regenerate = useCallback(async () => {
    setScripts((current) => {
      const next = { ...current };
      delete next[index];
      return next;
    });
    setErrors((current) => {
      const next = { ...current };
      delete next[index];
      return next;
    });

    try {
      const response = await fetch(`/api/materials/${materialId}/scenes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_index: index, user_id: userId, regenerate: true }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not rebuild this lecture.');
      setScripts((current) => ({ ...current, [index]: { topic: payload.topic, scenes: payload.scenes } }));
    } catch (caught) {
      setErrors((current) => ({
        ...current,
        [index]: caught instanceof Error ? caught.message : 'Could not rebuild this lecture.',
      }));
    }
  }, [index, materialId, userId]);

  if (!card) return null;

  return (
    <div className="w-full max-w-lg mx-auto">
      <div className="flex items-center gap-1 mb-3" role="group" aria-label="Card view mode">
        {(['watch', 'read'] as const).map((option) => (
          <button
            key={option}
            onClick={() => setMode(option)}
            aria-pressed={mode === option}
            className={`inline-flex items-center gap-1.5 px-3 py-2 min-h-10 rounded-lg text-xs font-medium transition-all ${
              mode === option
                ? 'bg-[#8083ff]/20 text-[#c0c1ff] border border-[#8083ff]/30'
                : 'text-[#908fa0] border border-transparent hover:text-[#dfe2f1]'
            }`}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
              {option === 'watch' ? 'smart_display' : 'article'}
            </span>
            {option === 'watch' ? 'Watch' : 'Read'}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-[#908fa0]">
          {index + 1} of {cards.length}
        </span>
      </div>

      <div
        onTouchStart={(event) => {
          touchStartX.current = event.touches[0].clientX;
        }}
        onTouchEnd={(event) => {
          const delta = touchStartX.current - event.changedTouches[0].clientX;
          if (Math.abs(delta) > 50) goTo(delta > 0 ? index + 1 : index - 1);
        }}
      >
        {mode === 'read' ? (
          <ReadCard card={card} />
        ) : error ? (
          <PlayerError
            message={error}
            quotaBlocked={quotaBlocked}
            onRetry={retry}
            onSwitchToRead={() => setMode('read')}
          />
        ) : isLoading || !script ? (
          <PlayerSkeleton label="Preparing your lecture…" />
        ) : (
          <>
            <LecturePlayer
              key={index}
              scenes={script.scenes}
              topic={script.topic}
              materialTitle={materialTitle}
            />
            <button
              onClick={regenerate}
              className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] text-[#908fa0] hover:text-[#dfe2f1] hover:bg-white/5 transition-colors"
              title="Spends another Gemini call for this card"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>refresh</span>
              Regenerate this lecture
            </button>
          </>
        )}
      </div>

      <div className="flex items-center justify-between mt-4 gap-3">
        <button
          onClick={() => goTo(index - 1)}
          disabled={index === 0}
          aria-label="Previous card"
          className="w-11 h-11 rounded-full bg-[#1c1f2a] border border-[#464554] flex items-center justify-center disabled:opacity-30 hover:bg-[#262a35] transition-colors disabled:cursor-not-allowed"
        >
          <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>chevron_left</span>
        </button>

        <div className="flex gap-1 flex-1 justify-center">
          {cards.map((entry, dotIndex) => (
            <button
              key={entry.title}
              onClick={() => goTo(dotIndex)}
              aria-label={`Go to card ${dotIndex + 1}`}
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
          disabled={index === cards.length - 1}
          aria-label="Next card"
          className="w-11 h-11 rounded-full bg-[#1c1f2a] border border-[#464554] flex items-center justify-center disabled:opacity-30 hover:bg-[#262a35] transition-colors disabled:cursor-not-allowed"
        >
          <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>chevron_right</span>
        </button>
      </div>
    </div>
  );
}

function ReadCard({ card }: { card: LearningCard }) {
  return (
    <div className="glass-panel rounded-2xl p-8 min-h-[320px] flex flex-col items-center justify-center text-center relative overflow-hidden fade-in">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#8083ff] via-[#4cd7f6] to-[#8083ff]" />
      <div className="text-5xl mb-4">{card.emoji}</div>
      <h3 className="text-xl font-bold text-[#dfe2f1] mb-3" style={{ fontFamily: 'var(--font-outfit)' }}>
        {card.title}
      </h3>
      <p className="text-[#c7c4d7] leading-relaxed text-base">{card.content}</p>
    </div>
  );
}

function PlayerSkeleton({ label }: { label: string }) {
  return (
    <div className="glass-panel rounded-2xl min-h-[320px] flex flex-col items-center justify-center gap-4 text-center p-8">
      <div className="w-12 h-12 rounded-full border-2 border-[#8083ff] border-t-transparent spin-slow" />
      <div>
        <p className="text-sm text-[#c7c4d7]">{label}</p>
        <p className="text-xs text-[#908fa0] mt-1">Writing the script and staging the visuals</p>
      </div>
    </div>
  );
}

function PlayerError({
  message,
  quotaBlocked,
  onRetry,
  onSwitchToRead,
}: {
  message: string;
  quotaBlocked: boolean;
  onRetry: () => void;
  onSwitchToRead: () => void;
}) {
  return (
    <div className="glass-panel rounded-2xl min-h-[320px] flex flex-col items-center justify-center gap-3 text-center p-8">
      <span className="material-symbols-outlined text-[#ff516a]" style={{ fontSize: '36px' }}>
        {quotaBlocked ? 'hourglass_disabled' : 'error'}
      </span>
      <p className="text-sm text-[#ffb2b7] max-w-sm leading-relaxed">{message}</p>

      <div className="flex gap-2 flex-wrap justify-center">
        <button
          onClick={onSwitchToRead}
          className="px-4 py-2 rounded-lg bg-gradient-to-r from-[#8083ff] to-[#4cd7f6] text-[#0f131d] text-xs font-semibold hover:opacity-90 transition-opacity"
        >
          Keep studying in Read
        </button>
        {!quotaBlocked && (
          <button
            onClick={onRetry}
            className="px-4 py-2 rounded-lg glass-panel text-xs text-[#dfe2f1] glow-hover transition-all"
          >
            Try again now
          </button>
        )}
      </div>

      <p className="text-[10px] text-[#908fa0] max-w-xs">
        {quotaBlocked
          ? 'Reading works normally — only lecture generation needs the quota.'
          : 'Retrying automatically in the background; the video will appear on its own if it succeeds.'}
      </p>
    </div>
  );
}
