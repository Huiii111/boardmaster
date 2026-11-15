import { padPosition, traceSegments } from './geometry';
import { DEFAULT_RULES, type PcbBoard, type PcbDesignRules } from './types';

/**
 * Board artwork generator.
 *
 * Real PCB renders are texture-based, not geometry-based: the copper layer,
 * ground pour, solder mask and silkscreen are *drawn*, then mapped onto a flat
 * board. Modelling every trace as a 3D box instead gives the flat, sparse look
 * of a bare slab with a few ridges on it.
 *
 * This renders the student's actual layout into a canvas at high resolution:
 *
 *   FR4 substrate  ->  copper (ground pour + their traces, with real clearance
 *                      gaps carved out)  ->  solder mask  ->  silkscreen
 *                      ->  bare pad openings
 *
 * Everything is derived from the `PcbBoard` they routed, so re-routing a net
 * changes the artwork.
 */

export interface ArtworkOptions {
  showMask: boolean;
  showSilkscreen: boolean;
  /** Solder-mask colour family. */
  mask: { base: string; pour: string; trace: string; silk: string };
  /** Trace ids flagged by the DRC, drawn in red. */
  flagged: Set<string>;
  rules?: PcbDesignRules;
  /** Pixels per millimetre. 12 gives a crisp board at typical zoom. */
  pixelsPerMm?: number;
}

const FR4 = '#b9a06a';
const FR4_DARK = '#9c8554';
const COPPER = '#c98f3f';
const COPPER_LIGHT = '#dba85c';
const PAD_GOLD = '#e8c56a';
const FLAG_RED = '#e8453c';

/** Rounded rectangle path, used for the board outline and the pour. */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * Draw the copper layer: a ground pour across the whole board with clearance
 * carved around every trace and pad, then the traces themselves on top.
 */
function drawCopperLayer(
  ctx: CanvasRenderingContext2D,
  board: PcbBoard,
  s: number,
  rules: PcbDesignRules,
  pourColour: string,
  traceColour: string,
  flagged: Set<string>,
): void {
  const clearance = rules.clearance;

  // 1. The pour, inset from the board edge the way a real fill is.
  ctx.fillStyle = pourColour;
  roundRect(ctx, 1.2 * s, 1.2 * s, (board.width - 2.4) * s, (board.height - 2.4) * s, 2 * s);
  ctx.fill();

  // 2. Carve clearance around every trace and pad so the pour is isolated.
  ctx.globalCompositeOperation = 'destination-out';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const trace of board.traces) {
    ctx.strokeStyle = '#000';
    ctx.lineWidth = (trace.width + clearance * 2) * s;
    ctx.beginPath();
    trace.points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x * s, p.y * s);
      else ctx.lineTo(p.x * s, p.y * s);
    });
    ctx.stroke();
  }

  for (const fp of board.footprints) {
    for (const pad of fp.pads) {
      const p = padPosition(fp, pad);
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(p.x * s, p.y * s, (pad.size / 2 + clearance) * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 3. Redraw the traces as copper inside the gaps just carved.
  ctx.globalCompositeOperation = 'source-over';
  for (const trace of board.traces) {
    // Traces are drawn a shade brighter than the pour. On a real board both are
    // copper under the same mask and look identical; separating them here is a
    // deliberate teaching choice so a student can see their own routing.
    ctx.strokeStyle = flagged.has(trace.id) ? FLAG_RED : traceColour;
    ctx.lineWidth = trace.width * s;
    ctx.beginPath();
    trace.points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x * s, p.y * s);
      else ctx.lineTo(p.x * s, p.y * s);
    });
    ctx.stroke();
  }
}

/** Silkscreen: courtyards, reference designators, polarity marks, board title. */
function drawSilkscreen(
  ctx: CanvasRenderingContext2D,
  board: PcbBoard,
  s: number,
  colour: string,
): void {
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = 0.18 * s;
  ctx.lineCap = 'butt';

  for (const fp of board.footprints) {
    const swap = fp.rotation === 90 || fp.rotation === 270;
    const w = (swap ? fp.courtyard.h : fp.courtyard.w) * s;
    const h = (swap ? fp.courtyard.w : fp.courtyard.h) * s;
    const cx = fp.x * s;
    const cy = fp.y * s;

    ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);

    // Reference designator above the part.
    ctx.font = `600 ${1.25 * s}px "JetBrains Mono", ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(fp.ref, cx, cy - h / 2 - 0.4 * s);

    // Polarity marks: a pin-1 dot, plus + / K for the polarised parts.
    const first = fp.pads[0];
    if (first) {
      const p = padPosition(fp, first);
      ctx.beginPath();
      ctx.arc(p.x * s, (p.y - first.size / 2 - 0.7) * s, 0.28 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    if (fp.kind === 'led' || fp.kind === 'capacitor' || fp.kind === 'dc_source') {
      const anode = fp.pads.find((q) => q.pinId === 'a' || q.pinId === 'p' || q.pinId === 'pos');
      const cathode = fp.pads.find((q) => q.pinId === 'k' || q.pinId === 'n' || q.pinId === 'neg');
      ctx.font = `700 ${1.25 * s}px "JetBrains Mono", ui-monospace, monospace`;
      ctx.textBaseline = 'middle';
      if (anode) {
        const p = padPosition(fp, anode);
        ctx.fillText('+', (p.x - anode.size / 2 - 1.0) * s, p.y * s);
      }
      if (cathode) {
        const p = padPosition(fp, cathode);
        ctx.fillText(fp.kind === 'led' ? 'K' : '−', (p.x + cathode.size / 2 + 1.0) * s, p.y * s);
      }
    }
  }

  // Board legend, bottom-left, like a real fab drawing.
  ctx.font = `600 ${1.15 * s}px "JetBrains Mono", ui-monospace, monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('CIRCUITMENTOR 3D', 6.5 * s, (board.height - 3.6) * s);
  ctx.font = `400 ${0.95 * s}px "JetBrains Mono", ui-monospace, monospace`;
  ctx.fillText('LED-01   REV A', 6.5 * s, (board.height - 2.0) * s);
}

export interface ArtworkResult {
  /** Colour map for the board's top face. */
  canvas: HTMLCanvasElement;
  /** Roughness map: copper and pads are glossier than the mask. */
  roughness: HTMLCanvasElement;
  width: number;
  height: number;
}

/** Render the complete board artwork for the top copper layer. */
export function renderBoardArtwork(board: PcbBoard, options: ArtworkOptions): ArtworkResult {
  const rules = options.rules ?? DEFAULT_RULES;
  const s = options.pixelsPerMm ?? 12;
  const W = Math.max(2, Math.round(board.width * s));
  const H = Math.max(2, Math.round(board.height * s));

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const roughness = document.createElement('canvas');
  roughness.width = W;
  roughness.height = H;
  const rctx = roughness.getContext('2d');

  if (!ctx || !rctx) return { canvas, roughness, width: W, height: H };

  /* ------------------------------ colour map ------------------------------ */
  // Substrate.
  ctx.fillStyle = options.showMask ? options.mask.base : FR4;
  ctx.fillRect(0, 0, W, H);

  // Subtle woven-laminate mottling, so the board is not a dead flat colour.
  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = options.showMask ? '#000000' : FR4_DARK;
  for (let y = 0; y < H; y += Math.max(2, Math.round(0.35 * s))) {
    ctx.fillRect(0, y, W, 1);
  }
  ctx.restore();

  // Copper: pour + traces, with clearance carved out.
  drawCopperLayer(
    ctx,
    board,
    s,
    rules,
    options.showMask ? options.mask.pour : COPPER,
    options.showMask ? options.mask.trace : COPPER_LIGHT,
    options.flagged,
  );

  // Silkscreen sits on top of the mask.
  if (options.showSilkscreen) drawSilkscreen(ctx, board, s, options.mask.silk);

  // Pad openings: bare metal, no mask over them.
  for (const fp of board.footprints) {
    for (const pad of fp.pads) {
      const p = padPosition(fp, pad);
      ctx.fillStyle = PAD_GOLD;
      ctx.beginPath();
      if (pad.shape === 'square') {
        const r = pad.size / 2;
        ctx.rect((p.x - r) * s, (p.y - r) * s, pad.size * s, pad.size * s);
      } else {
        ctx.arc(p.x * s, p.y * s, (pad.size / 2) * s, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  }

  /* ---------------------------- roughness map ---------------------------- */
  // White = rough (mask), black = glossy (metal).
  rctx.fillStyle = options.showMask ? '#9a9a9a' : '#c0c0c0';
  rctx.fillRect(0, 0, W, H);
  rctx.strokeStyle = '#3a3a3a';
  rctx.lineCap = 'round';
  rctx.lineJoin = 'round';
  for (const trace of board.traces) {
    rctx.lineWidth = trace.width * s;
    rctx.beginPath();
    trace.points.forEach((p, i) => {
      if (i === 0) rctx.moveTo(p.x * s, p.y * s);
      else rctx.lineTo(p.x * s, p.y * s);
    });
    rctx.stroke();
  }
  rctx.fillStyle = '#1e1e1e';
  for (const fp of board.footprints) {
    for (const pad of fp.pads) {
      const p = padPosition(fp, pad);
      rctx.beginPath();
      rctx.arc(p.x * s, p.y * s, (pad.size / 2) * s, 0, Math.PI * 2);
      rctx.fill();
    }
  }

  return { canvas, roughness, width: W, height: H };
}

/** Total routed copper length in mm, shown in the preview's caption. */
export function copperLengthMm(board: PcbBoard): number {
  let total = 0;
  for (const trace of board.traces) {
    for (const [a, b] of traceSegments(trace)) {
      total += Math.hypot(b.x - a.x, b.y - a.y);
    }
  }
  return total;
}
