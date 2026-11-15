import type { CircuitDesign, PlacedComponent, Rotation, RowId, Wire } from '../types';

/** Test helpers for constructing circuit graphs without the UI. */

export function source(volts = 5): PlacedComponent {
  return {
    id: 'v1',
    kind: 'dc_source',
    label: 'V1',
    rotation: 0,
    value: volts,
    seat: null,
    benchPos: [0, 0, 1.9],
  };
}

export function led(row: RowId, col: number, rotation: Rotation = 0, id = 'd1'): PlacedComponent {
  return { id, kind: 'led', label: id.toUpperCase(), rotation, value: 2, seat: { row, col } };
}

export function resistor(
  row: RowId,
  col: number,
  ohms = 330,
  rotation: Rotation = 0,
  id = 'r1',
): PlacedComponent {
  return { id, kind: 'resistor', label: id.toUpperCase(), rotation, value: ohms, seat: { row, col } };
}

export function capacitor(
  row: RowId,
  col: number,
  farads = 1e-5,
  rotation: Rotation = 0,
  id = 'c1',
): PlacedComponent {
  return {
    id,
    kind: 'capacitor',
    label: id.toUpperCase(),
    rotation,
    value: farads,
    seat: { row, col },
  };
}

let wireCounter = 0;
export function wireHoleToHole(a: string, b: string, color = '#f87171'): Wire {
  return { id: `w${++wireCounter}`, a: { kind: 'hole', hole: a }, b: { kind: 'hole', hole: b }, color };
}

export function wirePinToHole(
  componentId: string,
  pinId: string,
  hole: string,
  color = '#f87171',
): Wire {
  return {
    id: `w${++wireCounter}`,
    a: { kind: 'pin', componentId, pinId },
    b: { kind: 'hole', hole },
    color,
  };
}

export function design(components: PlacedComponent[], wires: Wire[]): CircuitDesign {
  return { components, wires };
}

/**
 * The reference correct circuit from the experiment brief.
 *
 *   V1 +  --jumper--> TP10 (+ rail)
 *   TP10 --jumper--> E05 (strip TCOL_5)
 *   R1   E05 -> E09   (330 ohm, spans 4 columns)
 *   D1   anode E09, cathode E11
 *   E11  --jumper--> TN12 (- rail)
 *   TN12 --jumper--> V1 -
 *
 * Expected: I = (5 - 2.0) / 330 = 9.09 mA
 */
export function goldenLedCircuit(ohms = 330, supplyV = 5): CircuitDesign {
  return design(
    [source(supplyV), resistor('E', 5, ohms), led('E', 9)],
    [
      wirePinToHole('v1', 'pos', 'TP10'),
      wireHoleToHole('TP12', 'E05'),
      wireHoleToHole('E11', 'TN14'),
      wirePinToHole('v1', 'neg', 'TN18', '#111827'),
    ],
  );
}
