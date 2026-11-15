import type { PcbFootprint, PcbPad, PcbTrace } from './types';

export interface Point {
  x: number;
  y: number;
}

/** Absolute position of a pad, accounting for footprint position and rotation. */
export function padPosition(fp: PcbFootprint, pad: PcbPad): Point {
  const rad = (fp.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: fp.x + pad.dx * cos - pad.dy * sin,
    y: fp.y + pad.dx * sin + pad.dy * cos,
  };
}

/** Rotated courtyard bounding box of a footprint. */
export function courtyardBox(fp: PcbFootprint): { x: number; y: number; w: number; h: number } {
  const swap = fp.rotation === 90 || fp.rotation === 270;
  const w = swap ? fp.courtyard.h : fp.courtyard.w;
  const h = swap ? fp.courtyard.w : fp.courtyard.h;
  return { x: fp.x - w / 2, y: fp.y - h / 2, w, h };
}

export function boxesOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
  gap = 0,
): boolean {
  return (
    a.x < b.x + b.w + gap &&
    a.x + a.w + gap > b.x &&
    a.y < b.y + b.h + gap &&
    a.y + a.h + gap > b.y
  );
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Shortest distance from point `p` to segment `a`-`b`. */
export function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return distance(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Shortest distance between two segments in 2D. */
export function segmentSegmentDistance(a1: Point, a2: Point, b1: Point, b2: Point): number {
  if (segmentsIntersect(a1, a2, b1, b2)) return 0;
  return Math.min(
    pointSegmentDistance(a1, b1, b2),
    pointSegmentDistance(a2, b1, b2),
    pointSegmentDistance(b1, a1, a2),
    pointSegmentDistance(b2, a1, a2),
  );
}

function orientation(p: Point, q: Point, r: Point): number {
  const v = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
  if (Math.abs(v) < 1e-12) return 0;
  return v > 0 ? 1 : 2;
}

function onSegment(p: Point, q: Point, r: Point): boolean {
  return (
    q.x <= Math.max(p.x, r.x) + 1e-12 &&
    q.x >= Math.min(p.x, r.x) - 1e-12 &&
    q.y <= Math.max(p.y, r.y) + 1e-12 &&
    q.y >= Math.min(p.y, r.y) - 1e-12
  );
}

export function segmentsIntersect(p1: Point, q1: Point, p2: Point, q2: Point): boolean {
  const o1 = orientation(p1, q1, p2);
  const o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1);
  const o4 = orientation(p2, q2, q1);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;
  return false;
}

/** The individual segments making up a trace. */
export function traceSegments(trace: PcbTrace): Array<[Point, Point]> {
  const out: Array<[Point, Point]> = [];
  for (let i = 0; i + 1 < trace.points.length; i++) {
    const a = trace.points[i];
    const b = trace.points[i + 1];
    if (a && b) out.push([a, b]);
  }
  return out;
}

export function traceLength(trace: PcbTrace): number {
  return traceSegments(trace).reduce((sum, [a, b]) => sum + distance(a, b), 0);
}

/** Find the pad nearest to a point, within `maxDist`. */
export function findPadAt(
  footprints: PcbFootprint[],
  point: Point,
  maxDist: number,
): { footprint: PcbFootprint; pad: PcbPad; position: Point } | null {
  let best: { footprint: PcbFootprint; pad: PcbPad; position: Point; d: number } | null = null;
  for (const fp of footprints) {
    for (const pad of fp.pads) {
      const pos = padPosition(fp, pad);
      const d = distance(pos, point);
      if (d <= Math.max(maxDist, pad.size / 2) && (!best || d < best.d)) {
        best = { footprint: fp, pad, position: pos, d };
      }
    }
  }
  if (!best) return null;
  return { footprint: best.footprint, pad: best.pad, position: best.position };
}

export function snapToGrid(value: number, grid: number): number {
  return Math.round(value / grid) * grid;
}
