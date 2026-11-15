import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from 'remotion';

/**
 * Shared type and motion for the BoardMaster film.
 *
 * The palette is BoardMaster's own shipped light theme, taken from
 * src/app/globals.css so the film and the product cannot drift apart.
 */
export const C = {
  base: '#f2f5f9',
  void: '#e7ecf2',
  panel: '#ffffff',
  ink: '#10181f',
  ink2: '#3a4654',
  ink3: '#5a6877',
  line: '#d2dae4',
  teal: '#0b7a6d',
  blue: '#0d6fd1',
  amber: '#96580a',
  red: '#ca2b2b',
};

export const SANS =
  '"Segoe UI", -apple-system, BlinkMacSystemFont, system-ui, Roboto, Helvetica, Arial, sans-serif';
export const MONO = '"Cascadia Mono", "Consolas", "SF Mono", Menlo, monospace';

/** `*word*` marks an accented word. */
export function parseWords(text: string): Array<{ w: string; accent: boolean }> {
  return text.split(/(\*[^*]+\*)/g)
    .filter((s) => s.length > 0)
    .flatMap((chunk) => {
      const accent = chunk.startsWith('*') && chunk.endsWith('*');
      const body = accent ? chunk.slice(1, -1) : chunk;
      return body.split(/(\s+)/).filter((w) => w.trim().length > 0).map((w) => ({ w, accent }));
    });
}

/** A breathing beat between feature blocks: large type, words easing in. */
export const TitleCard: React.FC<{ text: string; sub?: string }> = ({ text, sub }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = parseWords(text);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: C.base,
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 220px',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            fontFamily: SANS,
            fontSize: 82,
            fontWeight: 650,
            lineHeight: 1.18,
            letterSpacing: '-0.025em',
            color: C.ink,
          }}
        >
          {words.map((item, i) => {
            const s = spring({ frame: frame - i * 2.5, fps, config: { damping: 200 } });
            return (
              <span
                key={i}
                style={{
                  display: 'inline-block',
                  marginRight: 18,
                  opacity: s,
                  transform: `translateY(${(1 - s) * 26}px)`,
                  color: item.accent ? C.teal : C.ink,
                }}
              >
                {item.w}
              </span>
            );
          })}
        </div>
        {sub ? (
          <div
            style={{
              marginTop: 26,
              fontFamily: MONO,
              fontSize: 25,
              letterSpacing: '0.04em',
              color: C.ink3,
              opacity: interpolate(frame, [14, 28], [0, 1], { extrapolateRight: 'clamp' }),
            }}
          >
            {sub}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

/** Bottom caption band, pinned over a product shot. */
export const Caption: React.FC<{ text: string; durationInFrames: number }> = ({
  text,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const inOp = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: 'clamp' });
  const outOp = interpolate(frame, [durationInFrames - 10, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
  });
  const op = Math.min(inOp, outOp);

  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 68 }}>
      <div
        style={{
          opacity: op,
          transform: `translateY(${(1 - op) * 10}px)`,
          backgroundColor: 'rgba(255,255,255,0.93)',
          border: `1px solid ${C.line}`,
          borderRadius: 10,
          boxShadow: '0 6px 26px -14px rgba(16,24,31,0.4)',
          padding: '14px 26px',
          fontFamily: MONO,
          fontSize: 25,
          letterSpacing: '0.015em',
          color: C.ink2,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

/**
 * A warm-white flash straddling a hard cut. Covers 5 frames each side only —
 * it marks the seam, it is not a decorative light effect.
 */
export const Flash: React.FC = () => {
  const frame = useCurrentFrame();
  const op = interpolate(frame, [0, 4, 10], [0, 0.82, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.quad),
  });
  return <AbsoluteFill style={{ backgroundColor: '#ffffff', opacity: op }} />;
};

/** Odometer-style rolling number, for the closing stat. */
export const Counter: React.FC<{ to: number; suffix?: string }> = ({ to, suffix = '' }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 200, mass: 0.8 } });
  return (
    <span style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>
      {Math.round(s * to)}
      {suffix}
    </span>
  );
};
