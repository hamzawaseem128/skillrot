'use client';

import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import { sceneFrameRanges, type LectureScene } from '@/lib/lecture-types';
import { VISUAL_COMPONENTS } from './visuals';
import { VISUAL_COMPONENTS_3D } from './visuals3d';

const ALL_VISUALS = { ...VISUAL_COMPONENTS, ...VISUAL_COMPONENTS_3D };

export interface LectureCompositionProps {
  scenes: LectureScene[];
  topic: string;
  /** Subtitles double as an accessibility path for the spoken narration. */
  showCaptions: boolean;
}

/**
 * The full lecture timeline: one `<Sequence>` per scene, laid out back to back.
 *
 * Durations come from the narration word count rather than measured audio,
 * because browser speech synthesis reports no duration in advance. That makes
 * the timeline deterministic, which is what allows scrubbing to work at all.
 */
export function LectureComposition({ scenes, topic, showCaptions }: LectureCompositionProps) {
  const ranges = sceneFrameRanges(scenes);

  return (
    <AbsoluteFill style={{ backgroundColor: '#0f131d' }}>
      {scenes.map((scene, index) => {
        const Visual = ALL_VISUALS[scene.visual.type] ?? ALL_VISUALS.bullet_reveal;
        const range = ranges[index];

        return (
          <Sequence key={scene.scene_index} from={range.from} durationInFrames={range.durationInFrames}>
            <Visual visual={scene.visual} image={scene.image} />
            {showCaptions && <Caption text={scene.narration_text} />}
          </Sequence>
        );
      })}

      <TopicBadge topic={topic} />
      <ProgressBar />
    </AbsoluteFill>
  );
}

function Caption({ text }: { text: string }) {
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', padding: 46 }}>
      <div
        style={{
          maxWidth: '86%',
          background: 'rgba(8, 11, 18, 0.82)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 14,
          padding: '16px 24px',
          fontSize: 24,
          lineHeight: 1.4,
          color: '#dfe2f1',
          textAlign: 'center',
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
}

function TopicBadge({ topic }: { topic: string }) {
  return (
    <AbsoluteFill style={{ padding: 28, pointerEvents: 'none' }}>
      <div
        style={{
          alignSelf: 'flex-start',
          fontSize: 20,
          letterSpacing: 1.5,
          textTransform: 'uppercase',
          color: '#908fa0',
        }}
      >
        {topic}
      </div>
    </AbsoluteFill>
  );
}

function ProgressBar() {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const percent = durationInFrames > 0 ? (frame / durationInFrames) * 100 : 0;

  return (
    <AbsoluteFill style={{ justifyContent: 'flex-start', pointerEvents: 'none' }}>
      <div style={{ height: 5, width: '100%', background: 'rgba(255,255,255,0.06)' }}>
        <div
          style={{
            height: '100%',
            width: `${percent}%`,
            background: 'linear-gradient(90deg, #8083ff, #4cd7f6)',
          }}
        />
      </div>
    </AbsoluteFill>
  );
}
