import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, Easing } from 'remotion';

/**
 * A 2.5D camera over a full-page screenshot.
 *
 * Adapted from the template's PageCam, with the theme plumbing removed: the
 * theme system remaps asset paths to its own recoloured demo fixture, which
 * would quietly swap BoardMaster's real screenshots for a stock research app.
 *
 * (cx, cy) is the page-space CSS point placed at the centre of the 1920x1080
 * frame; zoom is scale, 1 meaning one CSS pixel per output pixel. Textures are
 * captured at 2x and drawn at CSS size, so text stays sharp when pushed in.
 */
export type CamKey = {
  frame: number;
  cx: number;
  cy: number;
  zoom: number;
  rotX?: number;
  rotY?: number;
  rotZ?: number;
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const Cam: React.FC<{
  src: string;
  pageW?: number;
  pageH?: number;
  keys: CamKey[];
  children?: React.ReactNode;
  blur?: number;
  ease?: (t: number) => number;
}> = ({
  src,
  pageW = 1920,
  pageH = 1080,
  keys,
  children,
  blur = 0,
  ease = Easing.bezier(0.33, 0, 0.15, 1),
}) => {
  const frame = useCurrentFrame();

  let a = keys[0];
  let b = keys[keys.length - 1];
  for (let i = 0; i < keys.length - 1; i++) {
    if (frame >= keys[i].frame && frame <= keys[i + 1].frame) {
      a = keys[i];
      b = keys[i + 1];
      break;
    }
  }
  const t =
    a.frame === b.frame
      ? 1
      : interpolate(frame, [a.frame, b.frame], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: ease,
        });

  const cx = lerp(a.cx, b.cx, t);
  const cy = lerp(a.cy, b.cy, t);
  const zoom = lerp(a.zoom, b.zoom, t);
  const rotX = lerp(a.rotX ?? 0, b.rotX ?? 0, t);
  const rotY = lerp(a.rotY ?? 0, b.rotY ?? 0, t);
  const rotZ = lerp(a.rotZ ?? 0, b.rotZ ?? 0, t);
  const is3d = keys.some((k) => k.rotX || k.rotY || k.rotZ);

  /*
   * Layout-level zoom, not transform scale: scaling a raster down and back up
   * resamples twice and smears the type. `zoom` re-lays-out at the final size.
   *
   * The offset has to be divided by zoom. `zoom` scales this element's own
   * coordinate space, so a translate of Tx renders as Tx*zoom device px, and a
   * page point cx lands at cx*zoom. Solving cx*zoom + Tx*zoom = 960 gives
   * Tx = 960/zoom - cx. Writing the offset un-divided multiplies it by zoom a
   * second time and flings the page off screen -- which is exactly what
   * happened: the whole measurements block rendered as empty background.
   */
  const plane = (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: pageW,
        height: pageH,
        zoom,
        transform: `translate(${960 / zoom - cx}px, ${540 / zoom - cy}px)`,
        filter: blur > 0 ? `blur(${blur}px)` : undefined,
      }}
    >
      <Img src={staticFile(src)} style={{ width: pageW, height: pageH, display: 'block' }} />
      {children}
    </div>
  );

  return (
    <AbsoluteFill style={{ backgroundColor: '#e7ecf2', overflow: 'hidden' }}>
      {is3d ? (
        <div style={{ perspective: 1600, width: 1920, height: 1080 }}>
          <div
            style={{
              width: 1920,
              height: 1080,
              transformStyle: 'preserve-3d',
              transform: `rotateX(${rotX}deg) rotateY(${rotY}deg) rotateZ(${rotZ}deg)`,
            }}
          >
            {plane}
          </div>
        </div>
      ) : (
        plane
      )}
    </AbsoluteFill>
  );
};
