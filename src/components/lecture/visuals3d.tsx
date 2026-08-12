'use client';

import { ThreeCanvas } from '@remotion/three';
import { useMemo } from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { VisualProps } from './visuals';
import { ImageCredit, KenBurnsImage } from './visuals';

/**
 * WebGL "3D-style" scene templates.
 *
 * These are motion graphics with real perspective and depth — not rendered 3D
 * film. Everything draws live in the visitor's browser via react-three-fiber,
 * so there is no render farm, no Lambda and no per-video cost.
 *
 * Geometry is deliberately low-poly and untextured: these have to stay smooth
 * on mid-range laptops and phones, not just gaming hardware.
 */

const VIOLET = '#8083ff';
const CYAN = '#4cd7f6';
const display = 'var(--font-outfit), system-ui, sans-serif';

/** Frame-driven, never wall-clock — so scrubbing and export stay deterministic. */
function useProgress() {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return {
    frame,
    progress: interpolate(frame, [0, Math.max(1, durationInFrames)], [0, 1], {
      extrapolateRight: 'clamp',
    }),
  };
}

function Backdrop({ image }: { image?: VisualProps['image'] }) {
  if (image) return <KenBurnsImage image={image} />;
  return (
    <AbsoluteFill
      style={{
        backgroundImage:
          'radial-gradient(at 20% 20%, rgba(128,131,255,0.22) 0px, transparent 55%), radial-gradient(at 80% 75%, rgba(76,215,246,0.18) 0px, transparent 55%)',
      }}
    />
  );
}

function Lights() {
  return (
    <>
      <ambientLight intensity={1.1} />
      <directionalLight position={[4, 6, 6]} intensity={2.4} color={CYAN} />
      <directionalLight position={[-5, -3, 3]} intensity={1.6} color={VIOLET} />
    </>
  );
}

/**
 * A slowly rotating solid with the key term floating in front of it.
 * The shape is chosen from the wording so a "field"/"planet" reads as a sphere
 * while a "structure"/"stack" reads as a box.
 */
export function RotatingConcept3D({ visual, image }: VisualProps) {
  const { frame, progress } = useProgress();
  const { fps, width, height } = useVideoConfig();

  const term = visual.highlight_term || visual.content[0] || '';
  const shape = useMemo(() => pickShape(`${term} ${visual.content.join(' ')}`), [term, visual.content]);

  const rotation = (frame / fps) * 0.55;
  const entrance = interpolate(progress, [0, 0.18], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ backgroundColor: '#0f131d' }}>
      <Backdrop image={image} />

      <AbsoluteFill>
        <ThreeCanvas width={width} height={height} style={{ background: 'transparent' }} camera={{ position: [0, 0, 5], fov: 50 }}>
          <Lights />
          <mesh rotation={[rotation * 0.4, rotation, 0]} scale={entrance * 1.35}>
            {shape === 'sphere' ? (
              <icosahedronGeometry args={[1, 1]} />
            ) : shape === 'torus' ? (
              <torusGeometry args={[0.85, 0.3, 16, 40]} />
            ) : (
              <boxGeometry args={[1.4, 1.4, 1.4]} />
            )}
            <meshStandardMaterial color={VIOLET} wireframe metalness={0.3} roughness={0.4} />
          </mesh>
        </ThreeCanvas>
      </AbsoluteFill>

      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: 64 }}>
        <div
          style={{
            opacity: interpolate(progress, [0.1, 0.3], [0, 1], { extrapolateRight: 'clamp' }),
            fontFamily: display,
            fontSize: 62,
            fontWeight: 700,
            textAlign: 'center',
            color: '#dfe2f1',
            textShadow: '0 6px 40px rgba(15,19,29,0.95)',
            maxWidth: 960,
            lineHeight: 1.1,
          }}
        >
          {term}
        </div>
      </AbsoluteFill>

      {image && <ImageCredit image={image} />}
    </AbsoluteFill>
  );
}

function pickShape(text: string): 'sphere' | 'box' | 'torus' {
  const value = text.toLowerCase();
  if (/\b(field|planet|orbit|gravity|atom|cell|earth|star|sphere|mass|particle)\b/.test(value)) return 'sphere';
  if (/\b(cycle|loop|ring|rotation|recursion|feedback|orbit)\b/.test(value)) return 'torus';
  return 'box';
}

/**
 * Layered depth: background, mid-ground cards and foreground text each move at
 * a different rate as the camera pans, which reads as real depth without any
 * 3D modelling.
 */
export function DepthParallax3D({ visual, image }: VisualProps) {
  const { progress } = useProgress();
  const pan = interpolate(progress, [0, 1], [-1, 1]);

  return (
    <AbsoluteFill style={{ backgroundColor: '#0f131d' }}>
      <AbsoluteFill style={{ transform: `translateX(${pan * -28}px) scale(1.06)` }}>
        <Backdrop image={image} />
      </AbsoluteFill>

      {/* Mid-ground: moves faster than the backdrop. */}
      <AbsoluteFill
        style={{
          transform: `translateX(${pan * -70}px)`,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 22,
          flexDirection: 'row',
          padding: 64,
        }}
      >
        {visual.content.slice(0, 3).map((item, index) => (
          <div
            key={item}
            style={{
              opacity: interpolate(progress, [0.05 + index * 0.08, 0.28 + index * 0.08], [0, 1], {
                extrapolateRight: 'clamp',
              }),
              background: 'rgba(30, 41, 59, 0.72)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 18,
              padding: '26px 30px',
              fontSize: 27,
              color: '#dfe2f1',
              textAlign: 'center',
              maxWidth: 320,
              lineHeight: 1.3,
              backdropFilter: 'blur(4px)',
            }}
          >
            {item}
          </div>
        ))}
      </AbsoluteFill>

      {/* Foreground: fastest, so it appears nearest the camera. */}
      {visual.highlight_term && (
        <AbsoluteFill
          style={{
            transform: `translateX(${pan * -130}px)`,
            alignItems: 'center',
            justifyContent: 'flex-start',
            padding: 56,
          }}
        >
          <div
            style={{
              fontFamily: display,
              fontSize: 44,
              fontWeight: 700,
              background: `linear-gradient(90deg, ${VIOLET}, ${CYAN})`,
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            {visual.highlight_term}
          </div>
        </AbsoluteFill>
      )}

      {image && <ImageCredit image={image} />}
    </AbsoluteFill>
  );
}

/**
 * A formula on a tilted plane that straightens as the scene plays, as if the
 * camera settles square onto it while the narration explains it.
 */
export function FormulaFloat3D({ visual, image }: VisualProps) {
  const { progress } = useProgress();
  const [expression, ...rest] = visual.content;

  const rotateX = interpolate(progress, [0, 0.6], [26, 0], { extrapolateRight: 'clamp' });
  const rotateY = interpolate(progress, [0, 0.6], [-22, 0], { extrapolateRight: 'clamp' });
  const lift = interpolate(progress, [0, 0.6], [70, 0], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ backgroundColor: '#0f131d' }}>
      <Backdrop image={image} />

      <AbsoluteFill
        style={{ alignItems: 'center', justifyContent: 'center', padding: 64, perspective: 1200 }}
      >
        <div
          style={{
            transform: `rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(${lift}px)`,
            transformStyle: 'preserve-3d',
            background: 'rgba(30, 41, 59, 0.82)',
            border: `1px solid rgba(128,131,255,0.45)`,
            borderRadius: 26,
            padding: '52px 64px',
            textAlign: 'center',
            maxWidth: '88%',
            boxShadow: '0 40px 80px rgba(0,0,0,0.55)',
          }}
        >
          {visual.highlight_term && (
            <div style={{ fontSize: 20, letterSpacing: 3, textTransform: 'uppercase', color: '#908fa0', marginBottom: 18 }}>
              {visual.highlight_term}
            </div>
          )}
          <div style={{ fontFamily: display, fontSize: 56, fontWeight: 700, color: '#dfe2f1' }}>{expression}</div>
          {rest.length > 0 && (
            <div style={{ marginTop: 20, fontSize: 25, color: '#c7c4d7', lineHeight: 1.4 }}>{rest.join(' · ')}</div>
          )}
        </div>
      </AbsoluteFill>

      {image && <ImageCredit image={image} />}
    </AbsoluteFill>
  );
}

export const VISUAL_COMPONENTS_3D = {
  rotating_concept_3d: RotatingConcept3D,
  depth_parallax_3d: DepthParallax3D,
  formula_float_3d: FormulaFloat3D,
} as const;
