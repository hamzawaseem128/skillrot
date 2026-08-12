'use client';

import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { SceneImageRef, SceneVisual } from '@/lib/lecture-types';

/**
 * Remotion visual templates for the narrated lecture player.
 *
 * All of these render entirely in the visitor's browser via `@remotion/player`
 * — there is no server render or Lambda pipeline, so they cost nothing to run
 * on a Vercel hobby tier.
 *
 * Every template must survive whatever the model produced: `content` may hold
 * a single string or four, and `highlight_term` is often absent.
 */

const INK = '#dfe2f1';
const MUTED = '#c7c4d7';
const FAINT = '#908fa0';
const VIOLET = '#8083ff';
const CYAN = '#4cd7f6';
const PANEL = 'rgba(30, 41, 59, 0.6)';
const BORDER = 'rgba(255, 255, 255, 0.10)';

const display = 'var(--font-outfit), system-ui, sans-serif';
const body = 'var(--font-inter), system-ui, sans-serif';

export interface VisualProps {
  visual: SceneVisual;
  image?: SceneImageRef | null;
}

/** Staggered entrance used by most templates. */
function useEnter(index: number, stagger = 8) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const delay = index * stagger;

  const progress = spring({
    frame: frame - delay,
    fps,
    config: { damping: 200, stiffness: 90 },
  });

  return {
    opacity: interpolate(progress, [0, 1], [0, 1]),
    translateY: interpolate(progress, [0, 1], [18, 0]),
  };
}

/**
 * Slow zoom-and-pan over the scene photo so it reads as footage rather than a
 * pasted stock image. Sits behind a heavy scrim so foreground text keeps its
 * contrast whatever the photo happens to be.
 */
export function KenBurnsImage({ image }: { image: SceneImageRef }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const span = Math.max(1, durationInFrames);

  const scale = interpolate(frame, [0, span], [1.08, 1.22], { extrapolateRight: 'clamp' });
  const translateX = interpolate(frame, [0, span], [-1.5, 1.5], { extrapolateRight: 'clamp' });
  const fadeIn = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ overflow: 'hidden', opacity: fadeIn }}>
      <Img
        src={image.url}
        alt=""
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `scale(${scale}) translateX(${translateX}%)`,
        }}
      />
      {/* Scrim: without it, light photos make the body copy unreadable. */}
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(180deg, rgba(15,19,29,0.86) 0%, rgba(15,19,29,0.72) 45%, rgba(15,19,29,0.92) 100%)',
        }}
      />
    </AbsoluteFill>
  );
}

/** Attribution is a licence condition for both Pexels and Unsplash. */
export function ImageCredit({ image }: { image: SceneImageRef }) {
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'flex-end', padding: 18, pointerEvents: 'none' }}>
      <span style={{ fontSize: 15, color: 'rgba(223,226,241,0.55)' }}>Photo: {image.credit} / Pexels</span>
    </AbsoluteFill>
  );
}

function SceneFrame({ children, image }: { children: React.ReactNode; image?: SceneImageRef | null }) {
  const frame = useCurrentFrame();
  // A very slow drift keeps the frame from feeling like a static screenshot.
  const drift = interpolate(frame, [0, 300], [0, -10], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ backgroundColor: '#0f131d' }}>
      {image ? (
        <KenBurnsImage image={image} />
      ) : (
        <AbsoluteFill
          style={{
            backgroundImage:
              'radial-gradient(at 15% 15%, rgba(128,131,255,0.20) 0px, transparent 55%), radial-gradient(at 85% 80%, rgba(76,215,246,0.16) 0px, transparent 55%)',
          }}
        />
      )}

      <AbsoluteFill style={{ padding: 64, fontFamily: body, transform: `translateY(${drift}px)` }}>
        {children}
      </AbsoluteFill>

      {image && <ImageCredit image={image} />}
    </AbsoluteFill>
  );
}

function Heading({ text }: { text?: string }) {
  const { opacity, translateY } = useEnter(0);
  if (!text) return null;

  return (
    <div
      style={{
        opacity,
        transform: `translateY(${translateY}px)`,
        fontFamily: display,
        fontSize: 34,
        fontWeight: 700,
        marginBottom: 34,
        background: `linear-gradient(90deg, ${VIOLET}, ${CYAN})`,
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        color: 'transparent',
        lineHeight: 1.2,
      }}
    >
      {text}
    </div>
  );
}

export function BulletReveal({ visual, image }: VisualProps) {
  return (
    <SceneFrame image={image}>
      <Heading text={visual.highlight_term} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        {visual.content.map((item, index) => (
          <Bullet key={item} item={item} index={index + 1} />
        ))}
      </div>
    </SceneFrame>
  );
}

function Bullet({ item, index }: { item: string; index: number }) {
  const { opacity, translateY } = useEnter(index, 14);

  return (
    <div
      style={{
        opacity,
        transform: `translateY(${translateY}px)`,
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        background: PANEL,
        border: `1px solid ${BORDER}`,
        borderRadius: 18,
        padding: '20px 26px',
      }}
    >
      <div
        style={{
          width: 12,
          height: 12,
          borderRadius: 999,
          flexShrink: 0,
          background: `linear-gradient(135deg, ${VIOLET}, ${CYAN})`,
        }}
      />
      <span style={{ fontSize: 30, color: INK, lineHeight: 1.35 }}>{item}</span>
    </div>
  );
}

export function DiagramPan({ visual, image }: VisualProps) {
  return (
    <SceneFrame image={image}>
      <Heading text={visual.highlight_term} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        {visual.content.map((node, index) => (
          <DiagramNode key={node} node={node} index={index} isLast={index === visual.content.length - 1} />
        ))}
      </div>
    </SceneFrame>
  );
}

function DiagramNode({ node, index, isLast }: { node: string; index: number; isLast: boolean }) {
  const { opacity, translateY } = useEnter(index + 1, 16);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18, opacity, transform: `translateY(${translateY}px)` }}>
      <div
        style={{
          background: PANEL,
          border: `1px solid ${BORDER}`,
          borderRadius: 16,
          padding: '22px 28px',
          maxWidth: 320,
          fontSize: 26,
          color: INK,
          textAlign: 'center',
          lineHeight: 1.3,
        }}
      >
        {node}
      </div>
      {!isLast && <span style={{ fontSize: 34, color: CYAN }}>→</span>}
    </div>
  );
}

export function FormulaHighlight({ visual, image }: VisualProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const [expression, ...rest] = visual.content;

  // Gentle pulse so the eye lands on the expression.
  const pulse = 1 + 0.02 * Math.sin((frame / fps) * 2.4);
  const { opacity } = useEnter(1, 10);

  return (
    <SceneFrame image={image}>
      <Heading text={visual.highlight_term} />
      <div
        style={{
          opacity,
          alignSelf: 'center',
          transform: `scale(${pulse})`,
          background: PANEL,
          border: `1px solid rgba(128,131,255,0.35)`,
          borderRadius: 24,
          padding: '44px 56px',
          textAlign: 'center',
          maxWidth: '90%',
        }}
      >
        <div style={{ fontFamily: display, fontSize: 54, fontWeight: 700, color: INK, letterSpacing: 0.5 }}>
          {expression}
        </div>
        {rest.length > 0 && (
          <div style={{ marginTop: 20, fontSize: 26, color: MUTED, lineHeight: 1.4 }}>{rest.join(' · ')}</div>
        )}
      </div>
    </SceneFrame>
  );
}

export function ComparisonSplit({ visual, image }: VisualProps) {
  const [left, right] = visual.content;

  return (
    <SceneFrame image={image}>
      <Heading text={visual.highlight_term} />
      <div style={{ display: 'flex', gap: 26, flex: 1, alignItems: 'stretch' }}>
        <ComparisonSide text={left} index={1} accent={VIOLET} from={-40} />
        <div style={{ display: 'flex', alignItems: 'center', fontSize: 28, color: FAINT, fontFamily: display }}>vs</div>
        <ComparisonSide text={right} index={2} accent={CYAN} from={40} />
      </div>
    </SceneFrame>
  );
}

function ComparisonSide({ text, index, accent, from }: { text: string; index: number; accent: string; from: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = spring({ frame: frame - index * 8, fps, config: { damping: 200, stiffness: 90 } });

  return (
    <div
      style={{
        flex: 1,
        opacity: interpolate(progress, [0, 1], [0, 1]),
        transform: `translateX(${interpolate(progress, [0, 1], [from, 0])}px)`,
        background: PANEL,
        border: `1px solid ${BORDER}`,
        borderTop: `3px solid ${accent}`,
        borderRadius: 20,
        padding: 34,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 30,
        color: INK,
        textAlign: 'center',
        lineHeight: 1.35,
      }}
    >
      {text}
    </div>
  );
}

export function IconFocus({ visual, image }: VisualProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = spring({ frame, fps, config: { damping: 120, stiffness: 80 } });
  const [headline, ...rest] = visual.content;

  return (
    <SceneFrame image={image}>
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          transform: `scale(${interpolate(progress, [0, 1], [0.88, 1])})`,
          opacity: interpolate(progress, [0, 1], [0, 1]),
        }}
      >
        {visual.highlight_term && (
          <div style={{ fontSize: 22, letterSpacing: 3, textTransform: 'uppercase', color: FAINT, marginBottom: 22 }}>
            {visual.highlight_term}
          </div>
        )}
        <div
          style={{
            fontFamily: display,
            fontSize: 58,
            fontWeight: 700,
            lineHeight: 1.15,
            maxWidth: 900,
            background: `linear-gradient(90deg, ${VIOLET}, ${CYAN})`,
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
          }}
        >
          {headline}
        </div>
        {rest.length > 0 && (
          <div style={{ marginTop: 26, fontSize: 27, color: MUTED, maxWidth: 820, lineHeight: 1.4 }}>
            {rest.join(' · ')}
          </div>
        )}
      </div>
    </SceneFrame>
  );
}

export const VISUAL_COMPONENTS = {
  bullet_reveal: BulletReveal,
  diagram: DiagramPan,
  formula: FormulaHighlight,
  comparison: ComparisonSplit,
  icon_focus: IconFocus,
} as const;
