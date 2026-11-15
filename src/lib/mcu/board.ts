/**
 * Microcontroller board definitions.
 *
 * A board is a component whose pins the student wires to the breadboard, and
 * whose pin *states* are driven by their code. That is the whole bridge between
 * the editor and the circuit: an OUTPUT pin driven HIGH becomes a 5 V source in
 * the netlist, and `digitalRead` sees the potential the solver computed.
 */

export type BoardId = 'arduino_uno' | 'esp32';

export type PinMode = 'input' | 'output' | 'input_pullup';
export type PinKind = 'digital' | 'analog' | 'power' | 'ground';

export interface BoardPin {
  /** Pin id used in wiring, e.g. `d13`, `a0`, `v5`, `gnd1`. */
  id: string;
  /** Silkscreen label, e.g. `13`, `A0`, `5V`, `GND`. */
  label: string;
  kind: PinKind;
  /** Number the sketch refers to: `digitalWrite(13, HIGH)`. */
  number: number | null;
  /** True when the pin can do PWM via analogWrite. */
  pwm: boolean;
  /** Position along the header, in breadboard pitch units from the board origin. */
  x: number;
  /** Which header row: -1 = back header, +1 = front header. */
  row: -1 | 1;
}

export interface BoardDef {
  id: BoardId;
  name: string;
  blurb: string;
  /** Logic level, volts. */
  logicVolts: number;
  /** Maximum current a pin may source or sink, amps. */
  pinCurrentMax: number;
  /** Resolution of analogRead. */
  adcMax: number;
  /** Output impedance of a driven pin, ohms. Real pins are not ideal sources. */
  pinResistance: number;
  pins: BoardPin[];
  fidelity: string;
}

function digital(n: number, x: number, row: -1 | 1, pwm = false): BoardPin {
  return { id: `d${n}`, label: String(n), kind: 'digital', number: n, pwm, x, row };
}

function analog(n: number, x: number, row: -1 | 1): BoardPin {
  // A0..A5 are digital pins 14..19 on an Uno, which is how sketches address them.
  return { id: `a${n}`, label: `A${n}`, kind: 'analog', number: 14 + n, pwm: false, x, row };
}

const UNO_PINS: BoardPin[] = [
  // back header: D0..D13
  ...Array.from({ length: 14 }, (_, n) =>
    digital(n, -6.5 + n, -1, n === 3 || n === 5 || n === 6 || n === 9 || n === 10 || n === 11),
  ),
  // front header: power then analog in
  { id: 'v5', label: '5V', kind: 'power', number: null, pwm: false, x: -6.5, row: 1 },
  { id: 'v33', label: '3V3', kind: 'power', number: null, pwm: false, x: -5.5, row: 1 },
  { id: 'gnd1', label: 'GND', kind: 'ground', number: null, pwm: false, x: -4.5, row: 1 },
  { id: 'gnd2', label: 'GND', kind: 'ground', number: null, pwm: false, x: -3.5, row: 1 },
  { id: 'vin', label: 'VIN', kind: 'power', number: null, pwm: false, x: -2.5, row: 1 },
  ...Array.from({ length: 6 }, (_, n) => analog(n, -0.5 + n, 1)),
];

export const BOARDS: Record<BoardId, BoardDef> = {
  arduino_uno: {
    id: 'arduino_uno',
    name: 'Arduino Uno',
    blurb: '5 V ATmega328P board. 14 digital pins (6 PWM), 6 analog inputs.',
    logicVolts: 5,
    pinCurrentMax: 0.04,
    adcMax: 1023,
    pinResistance: 25,
    pins: UNO_PINS,
    fidelity:
      'Pin-level model: an OUTPUT pin is a 5 V source behind 25 Ω, an INPUT pin is high impedance. ' +
      'Sketches run on an interpreter for a documented C++ subset, not on compiled AVR machine code.',
  },
  esp32: {
    id: 'esp32',
    name: 'ESP32 DevKit',
    blurb: '3.3 V dual-core board. Careful: its pins are NOT 5 V tolerant.',
    logicVolts: 3.3,
    pinCurrentMax: 0.012,
    adcMax: 4095,
    pinResistance: 40,
    pins: [
      ...[2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23].map((n, i) =>
        digital(n, -6.5 + i, -1, true),
      ),
      { id: 'v5', label: '5V', kind: 'power', number: null, pwm: false, x: -6.5, row: 1 },
      { id: 'v33', label: '3V3', kind: 'power', number: null, pwm: false, x: -5.5, row: 1 },
      { id: 'gnd1', label: 'GND', kind: 'ground', number: null, pwm: false, x: -4.5, row: 1 },
      { id: 'gnd2', label: 'GND', kind: 'ground', number: null, pwm: false, x: -3.5, row: 1 },
      ...[32, 33, 34, 35, 36, 39].map((n, i) => ({
        id: `a${i}`,
        label: `${n}`,
        kind: 'analog' as const,
        number: n,
        pwm: false,
        x: -2.5 + i,
        row: 1 as const,
      })),
    ],
    fidelity:
      'Pin-level model at 3.3 V logic. Wi-Fi, Bluetooth, RTOS tasks and the dual cores are not simulated.',
  },
};

export function boardDef(id: BoardId): BoardDef {
  return BOARDS[id];
}

/** Find the pin a sketch means by a number, e.g. `13` or `A0` (14). */
export function pinByNumber(board: BoardDef, n: number): BoardPin | undefined {
  return board.pins.find((p) => p.number === n);
}
