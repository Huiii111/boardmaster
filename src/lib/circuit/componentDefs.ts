import type { ComponentKind, DeviceEdge, PinDef, PlacedComponent } from './types';
import { BOARDS } from '../mcu/board';

/** Static catalogue entry describing a kind of component. */
export interface ComponentDef {
  kind: ComponentKind;
  name: string;
  category:
    | 'Controller'
    | 'Source'
    | 'Instrument'
    | 'Passive'
    | 'Semiconductor'
    | 'Switch'
    | 'Output'
    | 'Protection'
    | 'Infrastructure';
  /** Reference-designator prefix, e.g. `R` -> `R1`, `R2`. */
  prefix: string;
  blurb: string;
  pins: PinDef[];
  /** Default value in base SI units (ohms / farads / henries / volts / amps). */
  defaultValue: number;
  unit: 'Ω' | 'F' | 'H' | 'V' | 'A' | '';
  editableValue: boolean;
  presets?: number[];
  /** True when the part is inserted into breadboard holes. */
  seatable: boolean;
  searchTerms: string[];
  /**
   * How faithfully the deterministic DC engine models this part. Shown in the
   * UI so a student is never left guessing what the numbers mean.
   */
  fidelity: string;
}

/**
 * Pin offsets are in breadboard pitch units at rotation 0.
 * Through-hole parts straddle columns, exactly as on a physical board.
 */
export const COMPONENT_DEFS: Record<ComponentKind, ComponentDef> = {
  /* ------------------------------- sources ------------------------------- */
  dc_source: {
    kind: 'dc_source',
    name: 'DC Power Supply',
    category: 'Source',
    prefix: 'V',
    blurb: 'Bench DC supply with +/− binding posts. Wire it to the board with jumpers.',
    pins: [
      { id: 'pos', label: '+', role: 'pos', dCol: 0, dRow: 0 },
      { id: 'neg', label: '−', role: 'neg', dCol: 0, dRow: 0 },
    ],
    defaultValue: 5,
    unit: 'V',
    editableValue: true,
    presets: [1.5, 3.3, 5, 9, 12],
    seatable: false,
    searchTerms: ['power', 'supply', 'dc', 'source', 'volt', '5v', 'psu', 'bench'],
    fidelity: 'Ideal voltage source: zero output impedance, no current limit modelled.',
  },
  battery: {
    kind: 'battery',
    name: 'Battery (AA cell holder)',
    category: 'Source',
    prefix: 'BT',
    blurb: 'Two AA cells in a holder, 3 V nominal. Seats on the board like a part.',
    pins: [
      { id: 'pos', label: '+', role: 'pos', dCol: 0, dRow: 0 },
      { id: 'neg', label: '−', role: 'neg', dCol: 5, dRow: 0 },
    ],
    defaultValue: 3,
    unit: 'V',
    editableValue: true,
    presets: [1.5, 3, 4.5, 6, 9],
    seatable: true,
    searchTerms: ['battery', 'cell', 'aa', 'holder', 'portable', 'bt'],
    fidelity: 'Ideal voltage source. Internal resistance and discharge curve are not modelled.',
  },

  battery_pack: {
    kind: 'battery_pack',
    name: 'Battery pack (6×AA)',
    category: 'Source',
    prefix: 'BT',
    blurb: 'Bench battery holder, 9 V nominal. Wire it to the board from its snap terminals.',
    pins: [
      { id: 'pos', label: '+', role: 'pos', dCol: 0, dRow: 0 },
      { id: 'neg', label: '−', role: 'neg', dCol: 0, dRow: 0 },
    ],
    defaultValue: 9,
    unit: 'V',
    editableValue: true,
    presets: [3, 4.5, 6, 9, 12],
    seatable: false,
    searchTerms: ['battery', 'pack', 'holder', 'aa', 'bench', 'portable', 'bt'],
    fidelity: 'Ideal voltage source. Internal resistance and discharge curve are not modelled.',
  },
  multimeter: {
    kind: 'multimeter',
    name: 'Digital multimeter',
    category: 'Instrument',
    prefix: 'M',
    blurb: 'Bench DMM. Clip the probes to two points and read the DC potential between them.',
    pins: [
      { id: 'red', label: 'VΩ', role: 'terminal', dCol: 0, dRow: 0 },
      { id: 'black', label: 'COM', role: 'terminal', dCol: 0, dRow: 0 },
    ],
    defaultValue: 0,
    unit: '',
    editableValue: false,
    seatable: false,
    searchTerms: ['multimeter', 'dmm', 'meter', 'voltmeter', 'probe', 'measure', 'volt'],
    fidelity:
      'Ideal voltmeter: infinite input impedance, so attaching it never changes the circuit. Reads the DC operating point only.',
  },

  arduino_uno: {
    kind: 'arduino_uno',
    name: 'Arduino Uno',
    category: 'Controller',
    prefix: 'U',
    blurb: '5 V ATmega328P board. Write a sketch in the Code panel to drive its pins.',
    pins: BOARDS.arduino_uno.pins.map((p) => ({
      id: p.id,
      label: p.label,
      role: p.kind === 'ground' ? ('neg' as const) : p.kind === 'power' ? ('pos' as const) : ('terminal' as const),
      dCol: 0,
      dRow: 0,
    })),
    defaultValue: 5,
    unit: 'V',
    editableValue: false,
    seatable: false,
    searchTerms: ['arduino', 'uno', 'mcu', 'microcontroller', 'atmega', 'board', 'code'],
    fidelity: BOARDS.arduino_uno.fidelity,
  },
  esp32: {
    kind: 'esp32',
    name: 'ESP32 DevKit',
    category: 'Controller',
    prefix: 'U',
    blurb: '3.3 V dual-core board. Its pins are NOT 5 V tolerant.',
    pins: BOARDS.esp32.pins.map((p) => ({
      id: p.id,
      label: p.label,
      role: p.kind === 'ground' ? ('neg' as const) : p.kind === 'power' ? ('pos' as const) : ('terminal' as const),
      dCol: 0,
      dRow: 0,
    })),
    defaultValue: 3.3,
    unit: 'V',
    editableValue: false,
    seatable: false,
    searchTerms: ['esp32', 'wifi', 'mcu', 'microcontroller', 'devkit', 'board', 'code'],
    fidelity: BOARDS.esp32.fidelity,
  },

  /* ------------------------------- passives ------------------------------- */
  resistor: {
    kind: 'resistor',
    name: 'Resistor',
    category: 'Passive',
    prefix: 'R',
    blurb: '1/4 W axial carbon-film resistor with E24 colour bands.',
    pins: [
      { id: '1', label: '1', role: 'terminal', dCol: 0, dRow: 0 },
      { id: '2', label: '2', role: 'terminal', dCol: 4, dRow: 0 },
    ],
    defaultValue: 330,
    unit: 'Ω',
    editableValue: true,
    presets: [100, 220, 330, 470, 1000, 2200, 4700, 10000],
    seatable: true,
    searchTerms: ['resistor', 'ohm', 'passive', 'r', 'current limit'],
    fidelity: 'Exact. Ohmic, temperature-independent, no tolerance band applied.',
  },
  potentiometer: {
    kind: 'potentiometer',
    name: 'Potentiometer (10 kΩ)',
    category: 'Passive',
    prefix: 'RV',
    blurb: 'Three-terminal variable resistor. The wiper splits the track into two resistances.',
    pins: [
      { id: '1', label: '1', role: 'terminal', dCol: 0, dRow: 0 },
      { id: 'w', label: 'W', role: 'wiper', dCol: 2, dRow: 0 },
      { id: '3', label: '3', role: 'terminal', dCol: 4, dRow: 0 },
    ],
    defaultValue: 10000,
    unit: 'Ω',
    editableValue: true,
    presets: [1000, 5000, 10000, 50000, 100000],
    seatable: true,
    searchTerms: ['potentiometer', 'pot', 'variable', 'trimmer', 'rheostat', 'dimmer', 'rv'],
    fidelity: 'Exact. Linear taper: pin1–W is wiper × R, W–pin3 is (1 − wiper) × R.',
  },
  photoresistor: {
    kind: 'photoresistor',
    name: 'Photoresistor (LDR)',
    category: 'Passive',
    prefix: 'LDR',
    blurb: 'Light-dependent resistor. Resistance falls as illumination rises.',
    pins: [
      { id: '1', label: '1', role: 'terminal', dCol: 0, dRow: 0 },
      { id: '2', label: '2', role: 'terminal', dCol: 2, dRow: 0 },
    ],
    defaultValue: 10000,
    unit: 'Ω',
    editableValue: true,
    presets: [1000, 5000, 10000, 50000],
    seatable: true,
    searchTerms: ['ldr', 'photoresistor', 'light', 'sensor', 'photocell', 'cds'],
    fidelity:
      'Resistance is set by the illumination slider, not by a physical light model: R = R_dark × (1 − 0.98 × illumination).',
  },
  capacitor: {
    kind: 'capacitor',
    name: 'Capacitor (electrolytic)',
    category: 'Passive',
    prefix: 'C',
    blurb: 'Radial electrolytic capacitor. Polarised: the striped side is negative.',
    pins: [
      { id: 'p', label: '+', role: 'pos', dCol: 0, dRow: 0 },
      { id: 'n', label: '−', role: 'neg', dCol: 2, dRow: 0 },
    ],
    defaultValue: 1e-5,
    unit: 'F',
    editableValue: true,
    presets: [1e-7, 1e-6, 1e-5, 1e-4, 4.7e-4],
    seatable: true,
    searchTerms: ['capacitor', 'cap', 'farad', 'electrolytic', 'c', 'smoothing', 'decoupling'],
    fidelity: 'Ideal DC open circuit. Charging transients and ESR are not modelled.',
  },
  inductor: {
    kind: 'inductor',
    name: 'Inductor',
    category: 'Passive',
    prefix: 'L',
    blurb: 'Axial choke. At DC an ideal inductor is simply a wire.',
    pins: [
      { id: '1', label: '1', role: 'terminal', dCol: 0, dRow: 0 },
      { id: '2', label: '2', role: 'terminal', dCol: 4, dRow: 0 },
    ],
    defaultValue: 1e-3,
    unit: 'H',
    editableValue: true,
    presets: [1e-5, 1e-4, 1e-3, 1e-2],
    seatable: true,
    searchTerms: ['inductor', 'coil', 'choke', 'henry', 'l'],
    fidelity: 'Ideal DC short circuit (0 Ω). Winding resistance and di/dt are not modelled.',
  },

  /* ---------------------------- semiconductors ---------------------------- */
  led: {
    kind: 'led',
    name: 'LED (5mm)',
    category: 'Semiconductor',
    prefix: 'D',
    blurb: 'Red 5 mm through-hole LED. Polarised: current flows anode → cathode.',
    pins: [
      { id: 'a', label: 'A', role: 'anode', dCol: 0, dRow: 0 },
      { id: 'k', label: 'K', role: 'cathode', dCol: 2, dRow: 0 },
    ],
    defaultValue: 2.0,
    unit: 'V',
    editableValue: false,
    seatable: true,
    searchTerms: ['led', 'light', 'indicator', 'red', 'lamp'],
    fidelity: 'Constant forward-voltage model, V_f = 2.0 V. Not an exponential diode model.',
  },
  rgb_led: {
    kind: 'rgb_led',
    name: 'RGB LED (common cathode)',
    category: 'Semiconductor',
    prefix: 'D',
    blurb: 'Three dies in one package sharing a cathode. Each colour needs its own resistor.',
    pins: [
      { id: 'ar', label: 'R', role: 'anode', dCol: 0, dRow: 0 },
      { id: 'k', label: 'K', role: 'common', dCol: 1, dRow: 0 },
      { id: 'ag', label: 'G', role: 'anode', dCol: 2, dRow: 0 },
      { id: 'ab', label: 'B', role: 'anode', dCol: 3, dRow: 0 },
    ],
    defaultValue: 2.0,
    unit: 'V',
    editableValue: false,
    seatable: true,
    searchTerms: ['rgb', 'led', 'colour', 'color', 'tricolour', 'multicolour'],
    fidelity: 'Three constant-V_f dies: red 2.0 V, green 3.0 V, blue 3.0 V. Solved independently.',
  },
  diode: {
    kind: 'diode',
    name: 'Diode (1N4148)',
    category: 'Semiconductor',
    prefix: 'D',
    blurb: 'Small-signal silicon diode. Conducts one way only, dropping about 0.7 V.',
    pins: [
      { id: 'a', label: 'A', role: 'anode', dCol: 0, dRow: 0 },
      { id: 'k', label: 'K', role: 'cathode', dCol: 3, dRow: 0 },
    ],
    defaultValue: 0.7,
    unit: 'V',
    editableValue: false,
    seatable: true,
    searchTerms: ['diode', 'rectifier', '1n4148', 'signal', 'protection', 'flyback'],
    fidelity: 'Constant forward-voltage model, V_f = 0.7 V. Reverse leakage and breakdown ignored.',
  },

  /* ------------------------------- switches ------------------------------- */
  switch: {
    kind: 'switch',
    name: 'Toggle switch (SPST)',
    category: 'Switch',
    prefix: 'SW',
    blurb: 'Single-pole single-throw slide switch. Latches in whichever position you set.',
    pins: [
      { id: '1', label: '1', role: 'terminal', dCol: 0, dRow: 0 },
      { id: '2', label: '2', role: 'terminal', dCol: 3, dRow: 0 },
    ],
    defaultValue: 0,
    unit: '',
    editableValue: false,
    seatable: true,
    searchTerms: ['switch', 'spst', 'toggle', 'slide', 'on', 'off', 'sw'],
    fidelity: 'Ideal: 0 Ω closed, open circuit when off. No contact resistance or bounce.',
  },
  pushbutton: {
    kind: 'pushbutton',
    name: 'Push button (momentary)',
    category: 'Switch',
    prefix: 'SW',
    blurb: 'Tactile momentary switch. Conducts only while held down.',
    pins: [
      { id: '1', label: '1', role: 'terminal', dCol: 0, dRow: 0 },
      { id: '2', label: '2', role: 'terminal', dCol: 2, dRow: 0 },
    ],
    defaultValue: 0,
    unit: '',
    editableValue: false,
    seatable: true,
    searchTerms: ['button', 'push', 'momentary', 'tactile', 'switch', 'press'],
    fidelity: 'Ideal: 0 Ω while held, open circuit when released. No bounce modelled.',
  },

  /* -------------------------- protection + output -------------------------- */
  fuse: {
    kind: 'fuse',
    name: 'Fuse',
    category: 'Protection',
    prefix: 'F',
    blurb: 'Glass cartridge fuse. Opens permanently once its rated current is exceeded.',
    pins: [
      { id: '1', label: '1', role: 'terminal', dCol: 0, dRow: 0 },
      { id: '2', label: '2', role: 'terminal', dCol: 4, dRow: 0 },
    ],
    defaultValue: 0.1,
    unit: 'A',
    editableValue: true,
    presets: [0.05, 0.1, 0.25, 0.5, 1],
    seatable: true,
    searchTerms: ['fuse', 'protection', 'overcurrent', 'blow', 'safety', 'f'],
    fidelity: 'Ideal: 0.05 Ω intact, open once blown. Blows instantly above rating — no I²t curve.',
  },
  buzzer: {
    kind: 'buzzer',
    name: 'Piezo buzzer',
    category: 'Output',
    prefix: 'BZ',
    blurb: 'Active piezo sounder. Polarised, and behaves as a resistive load at DC.',
    pins: [
      { id: 'p', label: '+', role: 'pos', dCol: 0, dRow: 0 },
      { id: 'n', label: '−', role: 'neg', dCol: 2, dRow: 0 },
    ],
    defaultValue: 100,
    unit: 'Ω',
    editableValue: true,
    presets: [16, 32, 100, 300],
    seatable: true,
    searchTerms: ['buzzer', 'piezo', 'sound', 'speaker', 'alarm', 'beep', 'bz'],
    fidelity: 'Modelled as a polarised resistive load. Acoustic output is not simulated.',
  },

  /* ----------------------------- infrastructure ----------------------------- */
  breadboard: {
    kind: 'breadboard',
    name: 'Breadboard (half-size)',
    category: 'Infrastructure',
    prefix: 'BB',
    blurb: '30-column solderless breadboard. A–E and F–J strips, four power rails.',
    pins: [],
    defaultValue: 0,
    unit: '',
    editableValue: false,
    seatable: false,
    searchTerms: ['breadboard', 'protoboard', 'board', 'bb'],
    fidelity: 'Strip connectivity is modelled exactly, including the centre channel.',
  },
};

export const LIBRARY_ORDER: ComponentKind[] = [
  'arduino_uno',
  'esp32',
  'dc_source',
  'battery_pack',
  'battery',
  'multimeter',
  'resistor',
  'potentiometer',
  'photoresistor',
  'capacitor',
  'inductor',
  'led',
  'rgb_led',
  'diode',
  'switch',
  'pushbutton',
  'fuse',
  'buzzer',
  'breadboard',
];

export function defOf(kind: ComponentKind): ComponentDef {
  return COMPONENT_DEFS[kind];
}

export function pinDef(kind: ComponentKind, pinId: string): PinDef | undefined {
  return COMPONENT_DEFS[kind].pins.find((p) => p.id === pinId);
}

/** Kinds that drive the circuit rather than load it. */
export function isSource(kind: ComponentKind): boolean {
  return kind === 'dc_source' || kind === 'battery' || kind === 'battery_pack';
}

/** Instruments observe the circuit without being part of it. */
export function isInstrument(kind: ComponentKind): boolean {
  return kind === 'multimeter';
}

/* ---------------- LED device model (documented, educational) ---------------- */

/**
 * Simplified junction model used by the deterministic engine.
 *
 * We use a *piecewise-linear* device: below `vfKnee` it is an open circuit;
 * above it, a `vfNominal` voltage source in series with `rSeries`. This is the
 * standard first-year approximation and is deliberately NOT a Shockley
 * exponential model — see README "Simulation fidelity".
 */
export interface LedModel {
  name: string;
  vfNominal: number;
  vfKnee: number;
  rSeries: number;
  iRated: number;
  iAbsMax: number;
  iVisible: number;
  vReverseMax: number;
}

export const RED_LED: LedModel = {
  name: 'Red 5 mm (generic GaAsP)',
  vfNominal: 2.0,
  vfKnee: 1.7,
  rSeries: 12,
  iRated: 0.02,
  iAbsMax: 0.03,
  iVisible: 0.001,
  vReverseMax: 5,
};

/** Forward voltages of the three RGB dies. */
export const RGB_VF: Record<string, number> = { ar: 2.0, ag: 3.0, ab: 3.0 };

/** Silicon small-signal diode. */
export const SIGNAL_DIODE_VF = 0.7;

/** Resistance a fuse adds while intact, ohms. */
export const FUSE_RESISTANCE = 0.05;

/* --------------------------------------------------------------------------
 * Device edges — the electrical behaviour of each kind
 * -------------------------------------------------------------------------- */

const openEdge = (
  fromPin: string,
  toPin: string,
  reason: NonNullable<DeviceEdge['openReason']>,
): DeviceEdge => ({
  fromPin,
  toPin,
  resistanceOhm: 0,
  forwardVoltageV: 0,
  polarised: false,
  conducts: false,
  openReason: reason,
});

/**
 * Decompose a placed component into its internal conducting paths.
 *
 * This is the single place that defines what each part *does* electrically.
 * The solver works only from these edges, so adding a part means adding its
 * physics here — never special-casing the solver.
 */
export function deviceEdges(c: PlacedComponent): DeviceEdge[] {
  const R = Math.max(0, c.value);

  switch (c.kind) {
    case 'resistor':
      return [
        { fromPin: '1', toPin: '2', resistanceOhm: R, forwardVoltageV: 0, polarised: false, conducts: true },
      ];

    case 'photoresistor': {
      // Bright light drops the cell to ~2% of its dark resistance.
      const lit = Math.min(1, Math.max(0, c.illumination ?? 0));
      return [
        {
          fromPin: '1',
          toPin: '2',
          resistanceOhm: Math.max(50, R * (1 - 0.98 * lit)),
          forwardVoltageV: 0,
          polarised: false,
          conducts: true,
        },
      ];
    }

    case 'potentiometer': {
      const w = Math.min(1, Math.max(0, c.wiper ?? 0.5));
      return [
        { fromPin: '1', toPin: 'w', resistanceOhm: R * w, forwardVoltageV: 0, polarised: false, conducts: true },
        { fromPin: 'w', toPin: '3', resistanceOhm: R * (1 - w), forwardVoltageV: 0, polarised: false, conducts: true },
      ];
    }

    case 'inductor':
      // Ideal inductor at a DC operating point is a wire.
      return [
        { fromPin: '1', toPin: '2', resistanceOhm: 0, forwardVoltageV: 0, polarised: false, conducts: true },
      ];

    case 'capacitor':
      return [openEdge('p', 'n', 'dc_blocked')];

    case 'led':
      return [
        {
          fromPin: 'a',
          toPin: 'k',
          resistanceOhm: 0,
          forwardVoltageV: RED_LED.vfNominal,
          polarised: true,
          conducts: true,
          emissive: true,
        },
      ];

    case 'rgb_led':
      return (['ar', 'ag', 'ab'] as const).map((anode) => ({
        fromPin: anode,
        toPin: 'k',
        resistanceOhm: 0,
        forwardVoltageV: RGB_VF[anode] ?? 2.0,
        polarised: true,
        conducts: true,
        emissive: true,
        label: anode === 'ar' ? 'R' : anode === 'ag' ? 'G' : 'B',
      }));

    case 'diode':
      return [
        {
          fromPin: 'a',
          toPin: 'k',
          resistanceOhm: 0,
          forwardVoltageV: SIGNAL_DIODE_VF,
          polarised: true,
          conducts: true,
        },
      ];

    case 'switch':
    case 'pushbutton':
      return c.closed
        ? [{ fromPin: '1', toPin: '2', resistanceOhm: 0, forwardVoltageV: 0, polarised: false, conducts: true }]
        : [openEdge('1', '2', 'switch_open')];

    case 'fuse':
      return c.blown
        ? [openEdge('1', '2', 'fuse_blown')]
        : [
            {
              fromPin: '1',
              toPin: '2',
              resistanceOhm: FUSE_RESISTANCE,
              forwardVoltageV: 0,
              polarised: false,
              conducts: true,
            },
          ];

    case 'buzzer':
      return [
        {
          fromPin: 'p',
          toPin: 'n',
          resistanceOhm: Math.max(1, R),
          forwardVoltageV: 0,
          polarised: true,
          conducts: true,
        },
      ];

    // A voltmeter has (ideally) infinite input impedance, so it contributes no
    // conducting path at all. Returning no edges is exactly right: attaching it
    // cannot change the circuit it is measuring.
    // A microcontroller's pins are modelled as drivers by the solver, not as
    // internal conducting paths, so it contributes no device edges here.
    case 'arduino_uno':
    case 'esp32':
    case 'multimeter':
    case 'dc_source':
    case 'battery':
    case 'battery_pack':
    case 'breadboard':
    default:
      return [];
  }
}

/** Default per-device state for a freshly placed part. */
export function defaultState(kind: ComponentKind): Partial<PlacedComponent> {
  switch (kind) {
    case 'switch':
      return { closed: false };
    case 'pushbutton':
      return { closed: false };
    case 'potentiometer':
      return { wiper: 0.5 };
    case 'photoresistor':
      return { illumination: 0 };
    case 'fuse':
      return { blown: false };
    default:
      return {};
  }
}
