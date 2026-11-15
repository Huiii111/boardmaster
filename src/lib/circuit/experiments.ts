import type { ComponentKind } from './types';

/** A guided laboratory exercise with explicit, checkable requirements. */
export interface Experiment {
  id: string;
  name: string;
  summary: string;
  /** Learning objectives shown in the brief. */
  objectives: string[];
  /** Parts the student is expected to use, with required counts. */
  requires: Array<{ kind: ComponentKind; min: number; why: string }>;
  /** Supply voltage the brief specifies. */
  supplyVolts: number;
  /** Target LED current band the brief asks the student to hit, amps. */
  targetCurrent: { min: number; max: number };
  /** Worked example shown in the brief. */
  workedExample: string;
  /** Whether the deterministic engine fully supports checking this experiment. */
  supported: boolean;
}

export const EXPERIMENTS: Experiment[] = [
  {
    /*
     * The brief the lab opens with, and the one the shipped starter circuit and
     * starter sketch actually satisfy.
     *
     * Previously the lab opened on `led-series-5v`, which tells the student to
     * build from a bench supply through the power rails -- while the bench in
     * front of them held an Arduino driving the LED from pin 13, no supply and
     * no rails in use. The first thing a new student read contradicted the
     * first thing they saw, and the worked example's 9.09 mA disagreed with the
     * 8.45 mA the analyser reported for that circuit.
     */
    id: 'mcu-blink',
    name: 'MCU 01 — Control the board from code',
    summary:
      'An Arduino wired to two LEDs, a push button and a potentiometer. Every part on the ' +
      'breadboard is reachable from the sketch: digital out, PWM out, digital in, analog in.',
    objectives: [
      'Trace each path: D13 → R1 → D1 → GND, and D9 → R2 → D2 → GND.',
      'Declare a pin with pinMode() before digitalWrite() or analogWrite() touches it.',
      'Read SW1 with INPUT_PULLUP — it idles HIGH and reads LOW while held.',
      'Read RV1 with analogRead() and scale it with map() to dim D2.',
      'Predict the current by hand, remembering that a real pin is not an ideal source.',
    ],
    requires: [
      { kind: 'arduino_uno', min: 1, why: 'The board is what powers and controls the circuit.' },
      { kind: 'led', min: 1, why: 'The LED is the load under test.' },
      {
        kind: 'resistor',
        min: 1,
        why: 'An LED has no internal current limit, so a series resistor is mandatory.',
      },
    ],
    supplyVolts: 5,
    targetCurrent: { min: 0.005, max: 0.02 },
    workedExample:
      'V_pin = 5 V, V_f = 2.0 V, R = 330 Ω. An Arduino output pin has roughly 25 Ω of its own ' +
      'output impedance, so I = (5 − 2.0) / (330 + 25) = 8.45 mA, not the 9.09 mA an ideal ' +
      '5 V source would give. Both sit safely below the 20 mA rated current.',
    supported: true,
  },
  {
    id: 'led-series-5v',
    name: 'LED 01 — Current-limited LED on 5 V',
    summary:
      'Build a series circuit that lights a red LED from a 5 V supply at a safe current, using the breadboard power rails.',
    objectives: [
      'Identify LED anode and cathode and insert the LED with correct polarity.',
      'Choose a series resistor that limits forward current to a safe value.',
      'Use the breadboard power rails and A–E / F–J strips correctly.',
      'Predict the current by hand, then confirm it against the analyser.',
    ],
    requires: [
      { kind: 'dc_source', min: 1, why: 'The circuit needs a 5 V DC source.' },
      { kind: 'led', min: 1, why: 'The LED is the load under test.' },
      {
        kind: 'resistor',
        min: 1,
        why: 'An LED has no internal current limit, so a series resistor is mandatory.',
      },
    ],
    supplyVolts: 5,
    targetCurrent: { min: 0.005, max: 0.02 },
    workedExample:
      'V_supply = 5 V, V_f = 2.0 V, R = 330 Ω  ->  I = (5 − 2.0) / 330 = 9.09 mA. ' +
      'That sits comfortably below the 20 mA rated current.',
    supported: true,
  },
  {
    id: 'rc-smoothing',
    name: 'LED 02 — Decoupling capacitor (DC inspection only)',
    summary:
      'Add a decoupling capacitor across the rails and observe that it carries no steady-state DC current.',
    objectives: [
      'Recognise that an ideal capacitor is an open circuit at DC.',
      'Observe capacitor polarity requirements for electrolytics.',
    ],
    requires: [
      { kind: 'dc_source', min: 1, why: 'The circuit needs a DC source.' },
      { kind: 'led', min: 1, why: 'The LED remains the indicator.' },
      { kind: 'resistor', min: 1, why: 'The series resistor still sets the current.' },
      { kind: 'capacitor', min: 1, why: 'The capacitor is the part under inspection.' },
    ],
    supplyVolts: 5,
    targetCurrent: { min: 0.005, max: 0.02 },
    workedExample:
      'At DC the capacitor branch carries 0 A. Transient behaviour (the RC time constant ' +
      'τ = RC) is NOT simulated by this engine — only the DC operating point is.',
    supported: true,
  },
];

export const DEFAULT_EXPERIMENT_ID = 'mcu-blink';

export function experimentById(id: string): Experiment {
  return EXPERIMENTS.find((e) => e.id === id) ?? (EXPERIMENTS[0] as Experiment);
}
