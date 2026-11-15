/**
 * BoardMaster — structured circuit graph types.
 *
 * The student's design is stored as a *graph*, never as a picture:
 *   PlacedComponent -> PinDef[]  (pins)
 *   Pin -> breadboard hole | free terminal
 *   Jumper wires + breadboard internal strips -> Nets
 *
 * Every electrical conclusion in the app is derived from this graph.
 */

export type ComponentKind =
  /* sources */
  | 'dc_source'
  | 'battery'
  | 'battery_pack'
  /* instruments */
  | 'multimeter'
  /* microcontrollers */
  | 'arduino_uno'
  | 'esp32'
  /* passives */
  | 'resistor'
  | 'potentiometer'
  | 'photoresistor'
  | 'capacitor'
  | 'inductor'
  /* semiconductors */
  | 'led'
  | 'rgb_led'
  | 'diode'
  /* electromechanical */
  | 'switch'
  | 'pushbutton'
  /* protection + output */
  | 'fuse'
  | 'buzzer'
  /* infrastructure */
  | 'breadboard';

/** Semantic role of a pin. Polarity-bearing roles drive polarity validation. */
export type PinRole = 'anode' | 'cathode' | 'pos' | 'neg' | 'terminal' | 'wiper' | 'common';

export type Rotation = 0 | 90 | 180 | 270;

/** Breadboard row identifiers. TP/TN/BP/BN are the four power-rail strips. */
export type RowId = 'TP' | 'TN' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'BN' | 'BP';

/** A breadboard hole address, e.g. `E14`, `TP07`. */
export type HoleId = string;

export interface PinDef {
  /** Stable id, unique within the component. */
  id: string;
  /** Short label rendered in the UI, e.g. `A`, `K`, `+`. */
  label: string;
  role: PinRole;
  /**
   * Offset from the component's seat, in breadboard pitch units, at rotation 0.
   * dCol = columns to the right, dRow = rows "down" the board (towards J).
   */
  dCol: number;
  dRow: number;
}

export interface PlacedComponent {
  id: string;
  kind: ComponentKind;
  /** Reference designator, e.g. `D1`, `R1`, `V1`. */
  label: string;
  rotation: Rotation;
  /** Primary value: ohms for resistors, farads for capacitors, volts for sources. */
  value: number;
  /** Seat of the component's origin pin on the breadboard, or null when free-standing. */
  seat: { row: RowId; col: number } | null;
  /** World position for bench instruments that are not seated on the breadboard. */
  benchPos?: [number, number, number];

  /* --- per-device state, only meaningful for some kinds --- */
  /** Switches and push buttons: true while conducting. */
  closed?: boolean;
  /** Potentiometer wiper position, 0 (pin 1) .. 1 (pin 3). */
  wiper?: number;
  /** Fuse: set once the deterministic engine has seen it exceed its rating. */
  blown?: boolean;
  /** Photoresistor: simulated illumination, 0 (dark) .. 1 (bright). */
  illumination?: number;
  /**
   * Microcontrollers: the pin states the student's sketch left behind after the
   * last run. An `output` pin with a non-zero value becomes a driver in the
   * netlist, which is how code lights an LED.
   */
  mcuPins?: Record<string, { mode: 'input' | 'output' | 'input_pullup'; value: number }>;
}

/**
 * One conducting path *inside* a component.
 *
 * A plain resistor has a single edge; a potentiometer has two (either side of
 * the wiper); an RGB LED has three dies sharing a common cathode. Modelling
 * components as a list of internal edges is what lets the solver handle parts
 * with more than two pins without special cases.
 */
export interface DeviceEdge {
  fromPin: string;
  toPin: string;
  /** Series resistance of this path, ohms. */
  resistanceOhm: number;
  /** Forward-voltage drop, volts. 0 for non-junction devices. */
  forwardVoltageV: number;
  /** True when the path only conducts from `fromPin` to `toPin`. */
  polarised: boolean;
  /** False when the path is open: an off switch, a blown fuse, a capacitor at DC. */
  conducts: boolean;
  /** Why it does not conduct, for honest diagnostics. */
  openReason?: 'switch_open' | 'fuse_blown' | 'dc_blocked';
  /** Sub-device label, e.g. the `R` die of an RGB LED. */
  label?: string;
  /** Emits light when forward current flows. */
  emissive?: boolean;
}

export type Endpoint =
  | { kind: 'hole'; hole: HoleId }
  | { kind: 'pin'; componentId: string; pinId: string };

/**
 * Physical style of a patch lead. Purely a rendering and ergonomics choice —
 * all three are ideal conductors electrically, which the UI states plainly.
 */
export type WireKind = 'dupont' | 'solid' | 'alligator' | 'banana';

export interface Wire {
  id: string;
  a: Endpoint;
  b: Endpoint;
  color: string;
  /** Defaults to 'dupont' for wires saved before cable types existed. */
  kind?: WireKind;
}

export interface WireKindDef {
  kind: WireKind;
  name: string;
  blurb: string;
  /** Conductor radius in world units. */
  radius: number;
  /** How high the lead arcs over the board. 0 = lies flat. */
  arc: number;
  searchTerms: string[];
}

export const WIRE_KINDS: WireKindDef[] = [
  {
    kind: 'dupont',
    name: 'Dupont jumper',
    blurb: 'Stranded flexible lead with moulded ends. Arcs over the board.',
    radius: 0.015,
    arc: 1,
    searchTerms: ['dupont', 'jumper', 'flexible', 'stranded', 'patch'],
  },
  {
    kind: 'solid',
    name: 'Solid-core jumper',
    blurb: 'Stiff 22 AWG wire bent into right angles. Lies flat for tidy builds.',
    radius: 0.012,
    arc: 0,
    searchTerms: ['solid', 'core', 'awg', 'stiff', 'tidy', 'kit'],
  },
  {
    kind: 'alligator',
    name: 'Alligator clip lead',
    blurb: 'Crocodile clips on a flexible lead. For clipping onto posts and legs.',
    radius: 0.018,
    arc: 1.35,
    searchTerms: ['alligator', 'crocodile', 'clip', 'croc', 'test lead'],
  },
  {
    kind: 'banana',
    name: 'Banana test lead',
    blurb: '4 mm banana plugs on a thick silicone lead. For bench supply posts.',
    radius: 0.024,
    arc: 1.6,
    searchTerms: ['banana', '4mm', 'test', 'lead', 'bench', 'plug'],
  },
];

/** Standard patch-lead colours, with the conventional meanings. */
export const WIRE_COLORS: Array<{ hex: string; name: string }> = [
  { hex: '#ef4444', name: 'Red — positive supply' },
  { hex: '#111827', name: 'Black — ground / return' },
  { hex: '#22c55e', name: 'Green' },
  { hex: '#eab308', name: 'Yellow' },
  { hex: '#3b82f6', name: 'Blue' },
  { hex: '#f8fafc', name: 'White' },
  { hex: '#a855f7', name: 'Violet' },
  { hex: '#f97316', name: 'Orange' },
];

export interface CircuitDesign {
  components: PlacedComponent[];
  wires: Wire[];
}

/* ------------------------------------------------------------------ */
/* Derived (netlist) representation                                   */
/* ------------------------------------------------------------------ */

/** A node identifier used by the union-find pass. */
export type NodeKey = string;

export interface Net {
  /** Canonical net id (the union-find root key). */
  id: string;
  /** Human-facing name, e.g. `N1`, or `RAIL_TP` for a power rail. */
  name: string;
  /** Every node key merged into this net. */
  members: NodeKey[];
  /** Breadboard holes belonging to this net. */
  holes: HoleId[];
  /** Component pins landing on this net. */
  pins: Array<{ componentId: string; pinId: string }>;
}

export interface Netlist {
  nets: Net[];
  /** node key -> net id */
  netOf: Record<NodeKey, string>;
  /** `${componentId}.${pinId}` -> net id. Absent when the pin is unconnected. */
  pinNet: Record<string, string>;
}
