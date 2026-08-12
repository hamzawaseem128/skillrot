'use client';

import { Player, type PlayerRef } from '@remotion/player';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LECTURE_FPS,
  sceneFrameRanges,
  totalDurationSeconds,
  type LectureScene,
} from '@/lib/lecture-types';
import { LectureComposition } from './LectureComposition';
import { useLectureRecorder } from './useLectureRecorder';
import { useNarration } from './useNarration';

const SPEEDS = [1, 1.25, 1.5] as const;

interface LecturePlayerProps {
  scenes: LectureScene[];
  topic: string;
  /** Used to name the downloaded file. */
  materialTitle?: string;
}

/**
 * Client-side narrated lecture player.
 *
 * Uses `@remotion/player` only — no server render and no Lambda — so the whole
 * feature runs in the visitor's browser and stays free to host.
 */
export default function LecturePlayer({ scenes, topic, materialTitle = 'lecture' }: LecturePlayerProps) {
  const playerRef = useRef<PlayerRef>(null);
  const [frame, setFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [rate, setRate] = useState<number>(1);
  const [muted, setMuted] = useState(false);
  const [captions, setCaptions] = useState(true);

  const ranges = useMemo(() => sceneFrameRanges(scenes), [scenes]);
  const durationInFrames = useMemo(
    () => Math.max(1, ranges.reduce((sum, r) => sum + r.durationInFrames, 0)),
    [ranges],
  );
  const totalSeconds = useMemo(() => totalDurationSeconds(scenes), [scenes]);

  const activeIndex = useMemo(() => {
    const found = ranges.findIndex((r) => frame >= r.from && frame < r.from + r.durationInFrames);
    return found === -1 ? Math.max(0, ranges.length - 1) : found;
  }, [ranges, frame]);

  const { narrationSupported } = useNarration({ scenes, activeIndex, isPlaying, rate, muted });

  const recorder = useLectureRecorder({
    playerRef,
    totalSeconds,
    filename: slugify(`${materialTitle}-${topic}`),
  });
  const isRecording = recorder.state === 'recording' || recorder.state === 'requesting';

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;

    // All local state is driven by player events rather than set alongside the
    // imperative calls, so seeking from any source stays in sync.
    const onFrame = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    const onSeeked = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);

    player.addEventListener('frameupdate', onFrame);
    player.addEventListener('seeked', onSeeked);
    player.addEventListener('play', onPlay);
    player.addEventListener('pause', onPause);
    player.addEventListener('ended', onEnded);

    return () => {
      player.removeEventListener('frameupdate', onFrame);
      player.removeEventListener('seeked', onSeeked);
      player.removeEventListener('play', onPlay);
      player.removeEventListener('pause', onPause);
      player.removeEventListener('ended', onEnded);
    };
  }, []);

  // Note: no rewind-on-scene-change effect is needed. LectureCardPanel keys
  // this component by card index, so advancing a card mounts a fresh player
  // already positioned at frame 0.

  const seekToScene = useCallback(
    (index: number) => {
      const target = ranges[index];
      if (!target) return;
      playerRef.current?.seekTo(target.from);
    },
    [ranges],
  );

  const inputProps = useMemo(
    () => ({ scenes, topic, showCaptions: captions }),
    [scenes, topic, captions],
  );

  return (
    <div className="space-y-3">
      <div className="glass-panel rounded-2xl overflow-hidden">
        <Player
          ref={playerRef}
          component={LectureComposition}
          inputProps={inputProps}
          durationInFrames={durationInFrames}
          fps={LECTURE_FPS}
          compositionWidth={1280}
          compositionHeight={720}
          playbackRate={rate}
          style={{ width: '100%' }}
          acknowledgeRemotionLicense
        />
      </div>

      <div className="glass-panel rounded-xl p-3 space-y-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => playerRef.current?.toggle()}
            aria-label={isPlaying ? 'Pause lecture' : 'Play lecture'}
            className="w-11 h-11 flex-shrink-0 rounded-full bg-gradient-to-r from-[#8083ff] to-[#4cd7f6] flex items-center justify-center hover:scale-105 transition-transform"
          >
            <span className="material-symbols-outlined text-[#0f131d]" style={{ fontSize: '24px' }}>
              {isPlaying ? 'pause' : 'play_arrow'}
            </span>
          </button>

          <input
            type="range"
            min={0}
            max={durationInFrames - 1}
            value={Math.min(frame, durationInFrames - 1)}
            onChange={(event) => playerRef.current?.seekTo(Number(event.target.value))}
            aria-label="Seek through the lecture"
            className="flex-1 h-1.5 accent-[#8083ff] cursor-pointer"
          />

          <span className="text-xs text-[#908fa0] tabular-nums w-20 text-right flex-shrink-0">
            {formatTime(frame / LECTURE_FPS)} / {formatTime(totalSeconds)}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1" role="group" aria-label="Playback speed">
            {SPEEDS.map((speed) => (
              <button
                key={speed}
                onClick={() => setRate(speed)}
                aria-pressed={rate === speed}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  rate === speed
                    ? 'bg-[#8083ff]/20 text-[#c0c1ff] border border-[#8083ff]/30'
                    : 'text-[#908fa0] border border-transparent hover:text-[#dfe2f1]'
                }`}
              >
                {speed}×
              </button>
            ))}
          </div>

          <button
            onClick={() => setMuted((value) => !value)}
            aria-pressed={muted}
            disabled={!narrationSupported}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-[#c7c4d7] hover:bg-white/5 transition-colors disabled:opacity-40"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
              {muted || !narrationSupported ? 'volume_off' : 'volume_up'}
            </span>
            Narration
          </button>

          <button
            onClick={() => setCaptions((value) => !value)}
            aria-pressed={captions}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-[#c7c4d7] hover:bg-white/5 transition-colors"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
              {captions ? 'closed_caption' : 'closed_caption_disabled'}
            </span>
            Captions
          </button>

          <button
            onClick={recorder.state === 'idle' ? recorder.start : recorder.cancel}
            disabled={!recorder.supported || recorder.state === 'saving'}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-[#c7c4d7] hover:bg-white/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={
              recorder.supported
                ? 'Records in real time by capturing this tab'
                : 'This browser cannot capture tab video'
            }
          >
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
              {isRecording ? 'stop_circle' : 'download'}
            </span>
            {isRecording ? 'Stop' : 'Download'}
          </button>

          <span className="ml-auto text-[10px] text-[#908fa0]">
            Scene {activeIndex + 1} of {scenes.length}
          </span>
        </div>

        {recorder.state !== 'idle' && (
          <div className="rounded-lg bg-[#8083ff]/10 border border-[#8083ff]/25 p-3 space-y-2 fade-in">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#ff516a] animate-pulse flex-shrink-0" />
              <p className="text-xs text-[#c0c1ff]">
                {recorder.state === 'requesting'
                  ? 'Choose this tab and tick "Also share tab audio"…'
                  : recorder.state === 'saving'
                    ? 'Saving your file…'
                    : `Recording your lecture — ${formatTime(recorder.elapsed)} of ${formatTime(totalSeconds)}`}
              </p>
            </div>
            {recorder.state === 'recording' && (
              <>
                <div className="h-1.5 rounded-full bg-[#262a35] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#8083ff] to-[#4cd7f6] transition-all duration-200"
                    style={{ width: `${recorder.progress * 100}%` }}
                  />
                </div>
                <p className="text-[10px] text-[#908fa0]">
                  Capture happens in real time, so this takes as long as the lecture itself. Leave this tab visible.
                </p>
              </>
            )}
          </div>
        )}

        {recorder.error && (
          <p className="text-[10px] text-[#ffb2b7] leading-relaxed">{recorder.error}</p>
        )}

        {recorder.supported && recorder.state === 'idle' && (
          <p className="text-[10px] text-[#908fa0]">
            Downloads as WebM — plays in all major browsers and can be converted to MP4 if needed.
          </p>
        )}

        <div className="flex gap-1.5">
          {scenes.map((scene, index) => (
            <button
              key={scene.scene_index}
              onClick={() => seekToScene(index)}
              aria-label={`Jump to scene ${index + 1}`}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                index === activeIndex ? 'bg-gradient-to-r from-[#8083ff] to-[#4cd7f6]' : 'bg-[#464554] hover:bg-[#908fa0]'
              }`}
            />
          ))}
        </div>

        {!narrationSupported && (
          <p className="text-[10px] text-[#908fa0]">
            This browser has no speech synthesis, so the lecture plays silently. Captions are on by default.
          </p>
        )}
      </div>
    </div>
  );
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'skillrot-lecture'
  );
}

function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
