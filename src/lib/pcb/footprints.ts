import { buildNetlist, netOfPin } from '../circuit/graph';
import { defOf } from '../circuit/componentDefs';
import type { CircuitDesign, ComponentKind } from '../circuit/types';
import type { PcbBoard, PcbFootprint, PcbPad } from './types';

/** Footprint library entry: pad geometry in mm, mapped to circuit pin ids. */
interface FootprintTemplate {
  name: string;
  courtyard: { w: number; h: number };
  pads: Array<{ number: string; pinId: string; dx: number; dy: number; size: number; shape: 'round' | 'square' }>;
}

/**
 * A tiny footprint library. Pad pitches follow the real parts:
 *  - 5 mm LED: 2.54 mm lead pitch, square pad marks the anode.
 *  - DIN0207 axial resistor: 7.62 mm pitch.
 *  - Radial electrolytic: 2.54 mm pitch.
 *  - Supply connector: 2-pin 5.08 mm screw terminal.
 */
const TEMPLATES: Record<ComponentKind, FootprintTemplate | null> = {
  led: {
    name: 'LED_D5.0mm',
    courtyard: { w: 6.2, h: 5.6 },
    pads: [
      { number: '1', pinId: 'a', dx: -1.27, dy: 0, size: 1.8, shape: 'square' },
      { number: '2', pinId: 'k', dx: 1.27, dy: 0, size: 1.8, shape: 'round' },
    ],
  },
  resistor: {
    name: 'R_Axial_DIN0207',
    courtyard: { w: 9.4, h: 3.0 },
    pads: [
      { number: '1', pinId: '1', dx: -3.81, dy: 0, size: 1.6, shape: 'round' },
      { number: '2', pinId: '2', dx: 3.81, dy: 0, size: 1.6, shape: 'round' },
    ],
  },
  capacitor: {
    name: 'CP_Radial_D6.3mm_P2.50mm',
    courtyard: { w: 7.0, h: 7.0 },
    pads: [
      { number: '1', pinId: 'p', dx: -1.27, dy: 0, size: 1.7, shape: 'square' },
      { number: '2', pinId: 'n', dx: 1.27, dy: 0, size: 1.7, shape: 'round' },
    ],
  },
  dc_source: {
    name: 'TerminalBlock_P5.08mm_2pin',
    courtyard: { w: 12.0, h: 8.0 },
    pads: [
      { number: '1', pinId: 'pos', dx: -2.54, dy: 0, size: 2.2, shape: 'square' },
      { number: '2', pinId: 'neg', dx: 2.54, dy: 0, size: 2.2, shape: 'round' },
    ],
  },
  battery: {
    name: 'BatteryHolder_2xAA',
    courtyard: { w: 16.0, h: 11.0 },
    pads: [
      { number: '1', pinId: 'pos', dx: -6.35, dy: 0, size: 2.2, shape: 'square' },
      { number: '2', pinId: 'neg', dx: 6.35, dy: 0, size: 2.2, shape: 'round' },
    ],
  },
  potentiometer: {
    name: 'Potentiometer_Alps_RK097',
    courtyard: { w: 11.0, h: 10.0 },
    pads: [
      { number: '1', pinId: '1', dx: -2.5, dy: 0, size: 1.8, shape: 'square' },
      { number: '2', pinId: 'w', dx: 0, dy: 0, size: 1.8, shape: 'round' },
      { number: '3', pinId: '3', dx: 2.5, dy: 0, size: 1.8, shape: 'round' },
    ],
  },
  photoresistor: {
    name: 'LDR_5mm_P2.54mm',
    courtyard: { w: 6.5, h: 5.0 },
    pads: [
      { number: '1', pinId: '1', dx: -1.27, dy: 0, size: 1.7, shape: 'round' },
      { number: '2', pinId: '2', dx: 1.27, dy: 0, size: 1.7, shape: 'round' },
    ],
  },
  inductor: {
    name: 'L_Axial_DIN0414',
    courtyard: { w: 12.0, h: 4.5 },
    pads: [
      { number: '1', pinId: '1', dx: -5.08, dy: 0, size: 1.8, shape: 'round' },
      { number: '2', pinId: '2', dx: 5.08, dy: 0, size: 1.8, shape: 'round' },
    ],
  },
  rgb_led: {
    name: 'LED_RGB_D5.0mm_CC',
    courtyard: { w: 8.5, h: 6.0 },
    pads: [
      { number: '1', pinId: 'ar', dx: -3.81, dy: 0, size: 1.6, shape: 'square' },
      { number: '2', pinId: 'k', dx: -1.27, dy: 0, size: 1.6, shape: 'round' },
      { number: '3', pinId: 'ag', dx: 1.27, dy: 0, size: 1.6, shape: 'round' },
      { number: '4', pinId: 'ab', dx: 3.81, dy: 0, size: 1.6, shape: 'round' },
    ],
  },
  diode: {
    name: 'D_DO-35_P7.62mm',
    courtyard: { w: 9.0, h: 3.0 },
    pads: [
      { number: '1', pinId: 'a', dx: -3.81, dy: 0, size: 1.6, shape: 'square' },
      { number: '2', pinId: 'k', dx: 3.81, dy: 0, size: 1.6, shape: 'round' },
    ],
  },
  switch: {
    name: 'SW_Slide_SPST_CK_JS102011',
    courtyard: { w: 10.0, h: 6.5 },
    pads: [
      { number: '1', pinId: '1', dx: -3.81, dy: 0, size: 1.8, shape: 'square' },
      { number: '2', pinId: '2', dx: 3.81, dy: 0, size: 1.8, shape: 'round' },
    ],
  },
  pushbutton: {
    name: 'SW_Push_6mm_Tactile',
    courtyard: { w: 7.5, h: 7.5 },
    pads: [
      { number: '1', pinId: '1', dx: -2.54, dy: 0, size: 1.7, shape: 'square' },
      { number: '2', pinId: '2', dx: 2.54, dy: 0, size: 1.7, shape: 'round' },
    ],
  },
  fuse: {
    name: 'Fuseholder_5x20mm',
    courtyard: { w: 24.0, h: 7.0 },
    pads: [
      { number: '1', pinId: '1', dx: -10.16, dy: 0, size: 2.2, shape: 'square' },
      { number: '2', pinId: '2', dx: 10.16, dy: 0, size: 2.2, shape: 'round' },
    ],
  },
  buzzer: {
    name: 'Buzzer_D12mm_P7.6mm',
    courtyard: { w: 13.0, h: 13.0 },
    pads: [
      { number: '1', pinId: 'p', dx: -3.8, dy: 0, size: 2.0, shape: 'square' },
      { number: '2', pinId: 'n', dx: 3.8, dy: 0, size: 2.0, shape: 'round' },
    ],
  },
  battery_pack: {
    name: 'BatteryHolder_6xAA_Bench',
    courtyard: { w: 18.0, h: 12.0 },
    pads: [
      { number: '1', pinId: 'pos', dx: -7.62, dy: 0, size: 2.2, shape: 'square' },
      { number: '2', pinId: 'neg', dx: 7.62, dy: 0, size: 2.2, shape: 'round' },
    ],
  },
  // Instruments observe the board; they are never fabricated onto it.
  multimeter: null,
  // Dev boards plug into a shield or headers rather than being a footprint here.
  arduino_uno: null,
  esp32: null,
  breadboard: null,
};

export const DEFAULT_BOARD_SIZE = { width: 60.96, height: 40.64 }; // 2.4" x 1.6"

/**
 * Derive PCB footprints from the student's circuit, carrying the net names across.
 *
 * The student still does the layout work: footprints are dropped in a neat
 * starting row and every trace must be routed by hand. Nothing is auto-routed.
 */
export function footprintsFromCircuit(design: CircuitDesign, board?: PcbBoard): PcbBoard {
  const netlist = buildNetlist(design);
  const width = board?.width ?? DEFAULT_BOARD_SIZE.width;
  const height = board?.height ?? DEFAULT_BOARD_SIZE.height;

  const placeable = design.components.filter((c) => TEMPLATES[c.kind] !== null);
  const existing = new Map((board?.footprints ?? []).map((f) => [f.componentId, f]));

  const footprints: PcbFootprint[] = [];
  let cursorX = 12;
  let cursorY = 12;

  for (const c of placeable) {
    const tpl = TEMPLATES[c.kind];
    if (!tpl) continue;
    const def = defOf(c.kind);

    const pads: PcbPad[] = tpl.pads.map((p) => {
      const net = netOfPin(netlist, c.id, p.pinId);
      return {
        id: `${c.id}:${p.number}`,
        number: p.number,
        dx: p.dx,
        dy: p.dy,
        size: p.size,
        shape: p.shape,
        pinId: p.pinId,
        net: net ? net.name : null,
      };
    });

    const prior = existing.get(c.id);
    // Keep the student's existing placement; only refresh nets and geometry.
    const x = prior ? prior.x : cursorX;
    const y = prior ? prior.y : cursorY;
    const rotation = prior ? prior.rotation : 0;

    if (!prior) {
      cursorX += Math.max(tpl.courtyard.w, 10) + 4;
      if (cursorX > width - 14) {
        cursorX = 12;
        cursorY += 14;
      }
    }

    footprints.push({
      id: prior ? prior.id : `fp-${c.id}`,
      ref: c.label,
      componentId: c.id,
      kind: c.kind,
      name: tpl.name,
      x: Math.min(Math.max(x, tpl.courtyard.w / 2), width - tpl.courtyard.w / 2),
      y: Math.min(Math.max(y, tpl.courtyard.h / 2), height - tpl.courtyard.h / 2),
      rotation,
      courtyard: tpl.courtyard,
      pads,
    });
    void def;
  }

  // Drop traces whose pads no longer exist.
  const padIds = new Set(footprints.flatMap((f) => f.pads.map((p) => p.id)));
  const traces = (board?.traces ?? []).filter(
    (t) =>
      (t.startPadId === null || padIds.has(t.startPadId)) &&
      (t.endPadId === null || padIds.has(t.endPadId)),
  );

  return { width, height, footprints, traces };
}

export function emptyBoard(): PcbBoard {
  return { ...DEFAULT_BOARD_SIZE, footprints: [], traces: [] };
}

/** Nets that need routing, with their pads — used to draw the ratsnest. */
export function ratsnest(board: PcbBoard): Array<{ net: string; padIds: string[] }> {
  const map = new Map<string, string[]>();
  for (const fp of board.footprints) {
    for (const pad of fp.pads) {
      if (!pad.net) continue;
      const arr = map.get(pad.net);
      if (arr) arr.push(pad.id);
      else map.set(pad.net, [pad.id]);
    }
  }
  return [...map.entries()]
    .filter(([, pads]) => pads.length >= 2)
    .map(([net, padIds]) => ({ net, padIds }));
}
