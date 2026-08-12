'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { LectureScene } from '@/lib/lecture-types';

/** Speech-synthesis availability never changes, so there is nothing to subscribe to. */
const noopSubscribe = () => () => {};
const hasSpeechSynthesis = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

/**
 * Speaks the active scene's narration using the Web Speech API.
 *
 * Why the timeline drives the voice and not the other way round:
 * `speechSynthesis` cannot be seeked, reports no duration before it starts, and
 * fires `onboundary` inconsistently across browsers. So the Remotion timeline
 * stays authoritative and narration is (re)started at each scene boundary.
 * Sync is therefore scene-level, not word-level — which is what makes the
 * scrub bar and speed control work reliably.
 */
export function useNarration({
  scenes,
  activeIndex,
  isPlaying,
  rate,
  muted,
}: {
  scenes: LectureScene[];
  activeIndex: number;
  isPlaying: boolean;
  rate: number;
  muted: boolean;
}) {
  // Read through useSyncExternalStore rather than an effect: probing `window`
  // during render is unsafe on the server, and setting it from an effect
  // cascades an extra render on every mount.
  const supported = useSyncExternalStore(noopSubscribe, hasSpeechSynthesis, () => false);
  const spokenKey = useRef<string>('');

  useEffect(() => {
    if (!supported) return;
    const synth = window.speechSynthesis;

    if (!isPlaying || muted) {
      synth.cancel();
      spokenKey.current = '';
      return;
    }

    const scene = scenes[activeIndex];
    if (!scene) return;

    // Re-speaking the same scene on an unrelated re-render would stutter the
    // audio, so each (scene, rate) pair is spoken once.
    const key = `${activeIndex}:${rate}`;
    if (spokenKey.current === key) return;
    spokenKey.current = key;

    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(scene.narration_text);
    utterance.rate = Math.min(2, Math.max(0.5, rate));
    utterance.pitch = 1;
    utterance.lang = 'en-US';

    const preferred = pickVoice(synth.getVoices());
    if (preferred) utterance.voice = preferred;

    synth.speak(utterance);

    return () => {
      synth.cancel();
    };
  }, [supported, scenes, activeIndex, isPlaying, rate, muted]);

  // Chrome silently suspends synthesis after roughly 15 seconds of speech.
  // A periodic resume() keeps longer scenes audible.
  useEffect(() => {
    if (!supported || !isPlaying || muted) return;

    const timer = window.setInterval(() => {
      const synth = window.speechSynthesis;
      if (synth.speaking && !synth.paused) synth.resume();
    }, 5000);

    return () => window.clearInterval(timer);
  }, [supported, isPlaying, muted]);

  // Nothing should keep talking after the player unmounts.
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  return { narrationSupported: supported };
}

function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  if (voices.length === 0) return undefined;
  const english = voices.filter((voice) => voice.lang.toLowerCase().startsWith('en'));
  const pool = english.length > 0 ? english : voices;

  // Prefer a natural-sounding voice where the platform offers one.
  return (
    pool.find((voice) => /natural|neural|google|samantha|aria/i.test(voice.name)) ??
    pool.find((voice) => voice.default) ??
    pool[0]
  );
}
