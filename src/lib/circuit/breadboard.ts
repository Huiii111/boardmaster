import type { HoleId, RowId } from './types';

/**
 * Half-size (30 column) solderless breadboard geometry + internal connectivity.
 *
 * World units: 1 unit = 1 inch, so the standard 0.1" pitch is PITCH = 0.1.
 * The board is centred on the origin; +x is to the right, +z is towards the viewer.
 */

export const PITCH = 0.1;
export const COLS = 30;
/** Power rails are shorter than the main banks, as on a real board. */
export const RAIL_COL_MIN = 2;
export const RAIL_COL_MAX = 29;

export interface RowSpec {
  id: RowId;
  /** z coordinate of the hole centres in this row. */
  z: number;
  kind: 'main' | 'rail';
  /** Which half of the board, used for the internal 5-hole strips. */
  bank: 'top' | 'bottom';
  /** Rail polarity, only for `kind: 'rail'`. */
  polarity?: '+' | '-';
  /**
   * z of the painted polarity line for a rail. On a real board the red and blue
   * lines bracket the rail pair on its outer edges, so these are given
   * explicitly rather than derived from an offset.
   */
  stripeZ?: number;
}

export const ROWS: readonly RowSpec[] = [
  { id: 'TP', z: -0.95, kind: 'rail', bank: 'top', polarity: '+', stripeZ: -1.02 },
  { id: 'TN', z: -0.85, kind: 'rail', bank: 'top', polarity: '-', stripeZ: -0.78 },
  { id: 'A', z: -0.55, kind: 'main', bank: 'top' },
  { id: 'B', z: -0.45, kind: 'main', bank: 'top' },
  { id: 'C', z: -0.35, kind: 'main', bank: 'top' },
  { id: 'D', z: -0.25, kind: 'main', bank: 'top' },
  { id: 'E', z: -0.15, kind: 'main', bank: 'top' },
  { id: 'F', z: 0.15, kind: 'main', bank: 'bottom' },
  { id: 'G', z: 0.25, kind: 'main', bank: 'bottom' },
  { id: 'H', z: 0.35, kind: 'main', bank: 'bottom' },
  { id: 'I', z: 0.45, kind: 'main', bank: 'bottom' },
  { id: 'J', z: 0.55, kind: 'main', bank: 'bottom' },
  { id: 'BN', z: 0.85, kind: 'rail', bank: 'bottom', polarity: '-', stripeZ: 0.78 },
  { id: 'BP', z: 0.95, kind: 'rail', bank: 'bottom', polarity: '+', stripeZ: 1.02 },
] as const;

export const MAIN_ROWS: readonly RowId[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
export const ROW_ORDER: readonly RowId[] = ROWS.map((r) => r.id);

const ROW_BY_ID = new Map<RowId, RowSpec>(ROWS.map((r) => [r.id, r]));

export const BOARD_WIDTH = (COLS + 2) * PITCH; // 3.2
export const BOARD_DEPTH = 2.2;
export const BOARD_HEIGHT = 0.1;
/** y coordinate of the board's top surface. */
export const BOARD_TOP = BOARD_HEIGHT;

export function rowSpec(row: RowId): RowSpec | undefined {
  return ROW_BY_ID.get(row);
}

/** Two-digit column so hole ids sort lexicographically: `E07`, `E14`. */
export function holeId(row: RowId, col: number): HoleId {
  return `${row}${String(col).padStart(2, '0')}`;
}

export function parseHole(id: HoleId): { row: RowId; col: number } | null {
  const m = /^([A-Z]{1,2})(\d{1,2})$/.exec(id);
  if (!m) return null;
  const row = m[1] as RowId;
  const col = Number(m[2]);
  if (!ROW_BY_ID.has(row)) return null;
  if (!Number.isInteger(col)) return null;
  return { row, col };
}

export function isValidHole(row: RowId, col: number): boolean {
  const spec = ROW_BY_ID.get(row);
  if (!spec) return false;
  if (spec.kind === 'rail') return col >= RAIL_COL_MIN && col <= RAIL_COL_MAX;
  return col >= 1 && col <= COLS;
}

/** World-space centre of a hole on the board's top surface. */
export function holePosition(row: RowId, col: number): [number, number, number] {
  const spec = ROW_BY_ID.get(row);
  const z = spec ? spec.z : 0;
  return [(col - (COLS + 1) / 2) * PITCH, BOARD_TOP, z];
}

export function holePositionById(id: HoleId): [number, number, number] | null {
  const p = parseHole(id);
  if (!p || !isValidHole(p.row, p.col)) return null;
  return holePosition(p.row, p.col);
}

/**
 * Internal connectivity group of a hole — the strip of copper it lands on.
 *
 * Real breadboard rules, modelled exactly:
 *  - Main bank: the five holes A-E of one column are one strip; F-J likewise.
 *  - The centre channel isolates the two banks.
 *  - Each power rail is one continuous strip down the whole board.
 */
export function stripOf(row: RowId, col: number): string {
  const spec = ROW_BY_ID.get(row);
  if (!spec) return `UNKNOWN:${row}${col}`;
  if (spec.kind === 'rail') return `RAIL_${row}`;
  return spec.bank === 'top' ? `TCOL_${col}` : `BCOL_${col}`;
}

export function stripOfHole(id: HoleId): string | null {
  const p = parseHole(id);
  if (!p) return null;
  return stripOf(p.row, p.col);
}

/** Every addressable hole on the board. */
export function allHoles(): Array<{ id: HoleId; row: RowId; col: number; spec: RowSpec }> {
  const out: Array<{ id: HoleId; row: RowId; col: number; spec: RowSpec }> = [];
  for (const spec of ROWS) {
    const min = spec.kind === 'rail' ? RAIL_COL_MIN : 1;
    const max = spec.kind === 'rail' ? RAIL_COL_MAX : COLS;
    for (let col = min; col <= max; col++) {
      out.push({ id: holeId(spec.id, col), row: spec.id, col, spec });
    }
  }
  return out;
}

/** Nearest valid hole to a point on the board surface, or null if out of tolerance. */
export function nearestHole(x: number, z: number): { row: RowId; col: number; id: HoleId } | null {
  const colFloat = x / PITCH + (COLS + 1) / 2;
  const col = Math.round(colFloat);
  let best: RowSpec | null = null;
  let bestDist = Infinity;
  for (const spec of ROWS) {
    const d = Math.abs(spec.z - z);
    if (d < bestDist) {
      bestDist = d;
      best = spec;
    }
  }
  if (!best) return null;
  // Reject clicks that fall in the channel / margins rather than snapping far away.
  if (bestDist > PITCH * 0.75) return null;
  if (Math.abs(colFloat - col) > 0.75) return null;
  if (!isValidHole(best.id, col)) return null;
  return { row: best.id, col, id: holeId(best.id, col) };
}

/** Shift a seat by a rotated pin offset, returning null when it leaves the board. */
export function offsetSeat(
  row: RowId,
  col: number,
  dCol: number,
  dRow: number,
): { row: RowId; col: number } | null {
  const rowIndex = ROW_ORDER.indexOf(row);
  if (rowIndex < 0) return null;
  const targetIndex = rowIndex + dRow;
  const targetRow = ROW_ORDER[targetIndex];
  if (targetRow === undefined) return null;
  const targetCol = col + dCol;
  if (!isValidHole(targetRow, targetCol)) return null;
  return { row: targetRow, col: targetCol };
}

/** Rotate a pitch-unit pin offset by the component rotation. */
export function rotateOffset(dCol: number, dRow: number, rotation: number): { dCol: number; dRow: number } {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return { dCol: -dRow, dRow: dCol };
    case 180:
      return { dCol: -dCol, dRow: -dRow };
    case 270:
      return { dCol: dRow, dRow: -dCol };
    default:
      return { dCol, dRow };
  }
}
