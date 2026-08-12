'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlayerRef } from '@remotion/player';

/**
 * Records the playing lecture to a .webm file, entirely in the browser.
 *
 * Why screen capture rather than `canvas.captureStream()`:
 *
 * 1. Remotion's Player renders React DOM, not a canvas — there is no drawing
 *    surface to capture. (Its server renderer screenshots headless Chrome,
 *    which is exactly the Lambda/Docker path this project cannot use.)
 * 2. `speechSynthesis` exposes no AudioNode or MediaStream, so its output
 *    cannot be routed into an AudioContext and mixed in. Tab capture is the
 *    only way to record the narration at all.
 *
 * `getDisplayMedia` solves both at once: it captures the rendered DOM and the
 * tab's audio output, including speech synthesis. The cost is a one-time
 * permission prompt where the viewer picks the tab and ticks "share tab audio".
 *
 * Timer ownership, which is subtle enough to be worth stating: exactly one
 * interval may exist at a time, `stopTimers` is the only thing that clears it,
 * and every exit path routes through `stopTimers`. An orphaned interval keeps
 * calling `setElapsed` forever with no way to reach it, which surfaces as
 * "Maximum update depth exceeded" pointing at the interval callback.
 */

export type RecorderState = 'idle' | 'requesting' | 'recording' | 'saving';

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

export function useLectureRecorder({
  playerRef,
  totalSeconds,
  filename,
}: {
  playerRef: React.RefObject<PlayerRef | null>;
  totalSeconds: number;
  filename: string;
}) {
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const stopGuardRef = useRef<number | null>(null);
  /** Held so the listener can actually be removed; anonymous ones leak. */
  const endedListenerRef = useRef<(() => void) | null>(null);
  /** True between start() and full teardown — blocks re-entry. */
  const activeRef = useRef(false);
  const mountedRef = useRef(true);

  const supported =
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getDisplayMedia === 'function' &&
    typeof window !== 'undefined' &&
    'MediaRecorder' in window;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // `start` is async and outlives its own click; without these guards it can
  // setState on an unmounted component (switch cards during the permission
  // prompt) and React warns or loops.
  const safeSetState = useCallback((next: RecorderState) => {
    if (mountedRef.current) setState(next);
  }, []);

  const safeSetError = useCallback((next: string | null) => {
    if (mountedRef.current) setError(next);
  }, []);

  /** The single owner of both timers. Idempotent. */
  const stopTimers = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (stopGuardRef.current !== null) {
      window.clearTimeout(stopGuardRef.current);
      stopGuardRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    stopTimers();

    const player = playerRef.current;
    if (player && endedListenerRef.current) {
      player.removeEventListener('ended', endedListenerRef.current);
    }
    endedListenerRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    activeRef.current = false;
  }, [playerRef, stopTimers]);

  useEffect(() => cleanup, [cleanup]);

  /**
   * Timers are killed here rather than waiting for `MediaRecorder.onstop`.
   * That event only fires when the recorder was genuinely recording — if it
   * failed to start, or the stream died first, `onstop` never arrives and the
   * interval would otherwise run forever.
   */
  const stop = useCallback(() => {
    stopTimers();

    const recorder = recorderRef.current;
    if (recorder && recorder.state === 'recording') {
      recorder.stop(); // onstop finishes the download, then calls cleanup()
    } else {
      cleanup();
      safeSetState('idle');
    }
  }, [stopTimers, cleanup, safeSetState]);

  const start = useCallback(async () => {
    // Re-entry guard. Without it a second invocation overwrites timerRef and
    // orphans the previous interval, which then runs unreachable forever.
    if (activeRef.current) return;

    const player = playerRef.current;
    if (!player || !supported) return;

    activeRef.current = true;
    safeSetError(null);
    if (mountedRef.current) setElapsed(0);
    safeSetState('requesting');

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: true,
        // Chromium-only hint that pre-selects this tab in the picker.
        preferCurrentTab: true,
      } as DisplayMediaStreamOptions);
    } catch {
      activeRef.current = false;
      safeSetState('idle');
      safeSetError('Screen capture was blocked or cancelled, so nothing was recorded.');
      return;
    }

    // The viewer may have navigated away while the permission prompt was open.
    if (!mountedRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      activeRef.current = false;
      return;
    }

    streamRef.current = stream;

    if (stream.getAudioTracks().length === 0) {
      // Not fatal — a silent lecture with captions is still useful — but the
      // viewer should know before they wait out a full real-time recording.
      safeSetError('No tab audio was shared, so the file will be silent. Captions are still burned in.');
    }

    const mimeType = MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorderRef.current = recorder;

    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    recorder.onstop = () => {
      safeSetState('saving');

      const blob = new Blob(chunks, { type: mimeType ?? 'video/webm' });
      const url = URL.createObjectURL(blob);

      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${filename}.webm`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Revoking immediately can abort the download in some browsers.
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);

      try {
        player.pause();
        if (player.isFullscreen()) player.exitFullscreen();
      } catch {
        /* The player may already be gone; the file is saved either way. */
      }

      cleanup();
      safeSetState('idle');
    };

    // If the viewer ends sharing from the browser's own bar, wrap up cleanly.
    stream.getVideoTracks()[0]?.addEventListener('ended', stop, { once: true });

    // Fullscreen so the captured frame is the lecture rather than the whole page.
    try {
      player.requestFullscreen();
    } catch {
      /* Fullscreen is a nicety; recording still works windowed. */
    }

    player.seekTo(0);
    recorder.start();
    safeSetState('recording');
    player.play();

    const startedAt = Date.now();
    // Belt and braces: never stack a second interval on top of a live one.
    stopTimers();
    timerRef.current = window.setInterval(() => {
      if (!mountedRef.current) return;
      setElapsed((Date.now() - startedAt) / 1000);
    }, 250);

    // Capture is real-time, so the recording ends when playback does. The guard
    // covers the case where the 'ended' event never fires.
    const onEnded = () => stop();
    endedListenerRef.current = onEnded;
    player.addEventListener('ended', onEnded);
    stopGuardRef.current = window.setTimeout(stop, (totalSeconds + 4) * 1000);
  }, [playerRef, supported, filename, totalSeconds, cleanup, stop, stopTimers, safeSetState, safeSetError]);

  const cancel = useCallback(() => {
    stop();
    cleanup();
    safeSetState('idle');
  }, [stop, cleanup, safeSetState]);

  return {
    supported,
    state,
    error,
    elapsed,
    progress: totalSeconds > 0 ? Math.min(1, elapsed / totalSeconds) : 0,
    start,
    cancel,
  };
}
