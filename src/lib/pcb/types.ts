import type { ComponentKind } from '../circuit/types';

/**
 * Simplified PCB layout model.
 *
 * Units are millimetres throughout, with the origin at the board's top-left.
 * The model is intentionally a small subset of a real EDA data model, chosen so
 * it maps cleanly onto KiCad concepts later (see `docs/` note in README):
 *   Footprint  -> KiCad FOOTPRINT
 *   Pad        -> KiCad PAD (with its net)
 *   Trace      -> KiCad SEGMENT on a copper layer
 */

export type PcbLayer = 'top' | 'bottom';

export interface PcbPad {
  id: string;
  /** Pad number as printed on the footprint, e.g. `1`, `2`. */
  number: string;
  /** Position relative to the footprint origin, mm, before rotation. */
  dx: number;
  dy: number;
  /** Pad diameter (round) or side length (square), mm. */
  size: number;
  shape: 'round' | 'square';
  /** Circuit pin this pad corresponds to. */
  pinId: string;
  /** Net name inherited from the circuit netlist, or null when unassigned. */
  net: string | null;
}

export interface PcbFootprint {
  id: string;
  /** Reference designator, matching the circuit component. */
  ref: string;
  /** Circuit component this footprint realises. */
  componentId: string;
  kind: ComponentKind;
  /** Footprint name, e.g. `LED_D5.0mm`, `R_Axial_DIN0207`. */
  name: string;
  x: number;
  y: number;
  /** Rotation in degrees, one of 0/90/180/270. */
  rotation: number;
  /** Courtyard size (bounding box) in mm, at rotation 0. */
  courtyard: { w: number; h: number };
  pads: PcbPad[];
}

export interface PcbTrace {
  id: string;
  layer: PcbLayer;
  /** Ordered points, mm. The first and last should land on pads. */
  points: Array<{ x: number; y: number }>;
  /** Trace width, mm. */
  width: number;
  /** Pads the two ends attach to, when they snap to a pad. */
  startPadId: string | null;
  endPadId: string | null;
}

export interface PcbBoard {
  /** Board outline size, mm. */
  width: number;
  height: number;
  footprints: PcbFootprint[];
  traces: PcbTrace[];
}

/** The explicit, simplified design rules this checker enforces. */
export interface PcbDesignRules {
  /** Minimum copper-to-copper clearance, mm. */
  clearance: number;
  /** Minimum trace width, mm. */
  minTraceWidth: number;
  /** Minimum gap between component courtyards, mm. */
  courtyardGap: number;
  /** Distance within which a trace end counts as landing on a pad, mm. */
  padSnap: number;
}

export const DEFAULT_RULES: PcbDesignRules = {
  clearance: 0.25,
  minTraceWidth: 0.25,
  courtyardGap: 0.2,
  padSnap: 0.6,
};

export const BOARD_GRID_MM = 1.27; // 50 mil, a common routing grid
