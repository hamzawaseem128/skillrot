'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  NOTE_STATUS_LABELS,
  type NoteStatus,
  type StructuredNotes,
} from '@/lib/notes-types';
import NotesSlideView from './NotesSlideView';
import NotesViewer from './NotesViewer';

interface JobState {
  status: NoteStatus;
  progress_message: string | null;
  error: string | null;
  segment_index: number;
  segment_total: number;
  notes: StructuredNotes | null;
}

const TERMINAL: NoteStatus[] = ['done', 'failed'];

/**
 * Drives the Video → Notes pipeline from the browser.
 *
 * Each POST advances the job by one step and returns immediately, so a
 * multi-minute analysis never needs a request that outlives a serverless
 * function. This loop is the "worker" — Vercel's hobby tier has no other.
 */
export default function VideoNotesPanel({
  materialId,
  userId,
  videoUrl,
  title,
}: {
  materialId: string;
  userId: string;
  videoUrl: string;
  title: string;
}) {
  const [job, setJob] = useState<JobState | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [mode, setMode] = useState<'notes' | 'slides'>('notes');
  const runningRef = useRef(false);
  const playerRef = useRef<HTMLIFrameElement>(null);
  const youTubeId = extractYouTubeId(videoUrl);

  const advance = useCallback(async (): Promise<JobState | null> => {
    const response = await fetch(`/api/materials/${materialId}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Could not build notes for this video.');
    return payload as JobState;
  }, [materialId, userId]);

  useEffect(() => {
    if (runningRef.current) return;
    runningRef.current = true;

    let cancelled = false;

    (async () => {
      try {
        // Pick up wherever a previous visit left off rather than restarting.
        const initial = await fetch(
          `/api/materials/${materialId}/notes?user_id=${encodeURIComponent(userId)}`,
        ).then((response) => response.json());

        if (cancelled) return;
        setJob(initial);

        let current: JobState = initial;
        // A generous ceiling: each pass is one segment or one indexing step.
        for (let guard = 0; guard < 40 && !TERMINAL.includes(current.status); guard++) {
          const next = await advance();
          if (cancelled || !next) return;
          setJob(next);
          current = next;

          // A small gap keeps successive Gemini calls from reading as a burst.
          if (!TERMINAL.includes(current.status)) {
            await new Promise((resolve) => setTimeout(resolve, 600));
          }
        }
      } catch (error) {
        if (!cancelled) setFatal(error instanceof Error ? error.message : 'Something went wrong.');
      } finally {
        runningRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [materialId, userId, advance]);

  const seekTo = useCallback((seconds: number) => {
    // The IFrame Player API is not loaded, so re-pointing src with ?start= is
    // the dependency-free way to jump — it reloads the player at that moment.
    const frame = playerRef.current;
    if (!frame || !youTubeId) return;
    frame.src = `https://www.youtube.com/embed/${youTubeId}?start=${Math.floor(seconds)}&autoplay=1`;
    frame.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [youTubeId]);

  const retry = useCallback(() => {
    setFatal(null);
    setJob((current) => (current ? { ...current, status: 'pending', error: null } : current));
    runningRef.current = false;
    // Re-running the effect is what restarts the loop.
    setJob((current) => (current ? { ...current } : current));
  }, []);

  const errorMessage = fatal ?? job?.error ?? null;
  const isWorking = job !== null && !TERMINAL.includes(job.status) && !errorMessage;

  return (
    <div className="space-y-6">
      {youTubeId && (
        <div className="glass-panel rounded-2xl overflow-hidden">
          <div className="relative w-full" style={{ aspectRatio: '16 / 9' }}>
            <iframe
              ref={playerRef}
              src={`https://www.youtube.com/embed/${youTubeId}`}
              title={title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
              allowFullScreen
              className="absolute inset-0 w-full h-full"
            />
          </div>
        </div>
      )}

      {(isWorking || job === null) && !errorMessage && (
        <div className="glass-panel rounded-2xl p-8 text-center space-y-4">
          <div className="w-12 h-12 mx-auto rounded-full border-2 border-[#8083ff] border-t-transparent spin-slow" />
          <div>
            <p className="text-sm text-[#c7c4d7]">
              {job?.progress_message ?? NOTE_STATUS_LABELS.pending}
            </p>
            <p className="text-xs text-[#908fa0] mt-1">
              Watching a lecture takes a while — this stays running if you keep the tab open.
            </p>
          </div>
          {job && job.segment_total > 1 && (
            <div className="max-w-xs mx-auto">
              <div className="h-1.5 rounded-full bg-[#262a35] overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#8083ff] to-[#4cd7f6] transition-all duration-500"
                  style={{ width: `${(job.segment_index / job.segment_total) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {errorMessage && (
        <div className="glass-panel rounded-2xl p-8 text-center space-y-3">
          <span className="material-symbols-outlined text-[#ff516a]" style={{ fontSize: '36px' }}>error</span>
          <p className="text-sm text-[#ffb2b7] max-w-md mx-auto leading-relaxed">{errorMessage}</p>
          <button
            onClick={retry}
            className="px-4 py-2 rounded-lg glass-panel text-xs text-[#dfe2f1] glow-hover transition-all"
          >
            Try again
          </button>
          <p className="text-[10px] text-[#908fa0]">
            Any parts already analysed are kept — retrying resumes rather than starting over.
          </p>
        </div>
      )}

      {job?.status === 'done' && job.notes && (
        <div className="fade-in">
          <div className="flex items-center gap-1 mb-4" role="group" aria-label="Notes view mode">
            {(['notes', 'slides'] as const).map((option) => (
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
                  {option === 'notes' ? 'article' : 'view_carousel'}
                </span>
                {option === 'notes' ? 'Notes' : 'Slide view'}
              </button>
            ))}
            <span className="ml-auto text-[10px] text-[#908fa0]">
              {job.notes.sections.length} sections
            </span>
          </div>

          {mode === 'notes' ? (
            <NotesViewer notes={job.notes} onSeek={youTubeId ? seekTo : undefined} />
          ) : (
            <NotesSlideView notes={job.notes} onSeek={youTubeId ? seekTo : undefined} />
          )}
        </div>
      )}
    </div>
  );
}

function extractYouTubeId(url: string): string | null {
  try {
    return new URL(url).searchParams.get('v');
  } catch {
    return null;
  }
}
