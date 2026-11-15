import { describe, expect, it } from 'vitest';

import { runSketch } from '../interpreter';
import { analyzeCircuit } from '@/lib/circuit/solve';
import { describeBranchCurrent } from '@/lib/format';
import { goldenLedCircuit } from '@/lib/circuit/__tests__/fixtures';
import type { CircuitDesign, PlacedComponent, Wire } from '@/lib/circuit/types';

/**
 * The bridge: a sketch's pin states must actually drive the circuit, and the
 * circuit's voltages must actually be what the sketch reads back.
 *
 * This is the pair of claims the whole feature rests on, so they are tested
 * end to end rather than in isolation.
 */

let wireId = 0;
const wire = (a: Wire['a'], b: Wire['b']): Wire => ({
  id: `w${++wireId}`,
  a,
  b,
  color: '#ef4444',
  kind: 'dupont',
});

function uno(pins: PlacedComponent['mcuPins']): PlacedComponent {
  return {
    id: 'u1',
    kind: 'arduino_uno',
    label: 'U1',
    rotation: 0,
    value: 5,
    seat: null,
    benchPos: [0, 0, 2.1],
    ...(pins ? { mcuPins: pins } : {}),
  };
}

/** D13 -> 330 ohm -> LED -> GND, the canonical first Arduino circuit. */
function blinkCircuit(pins: PlacedComponent['mcuPins']): CircuitDesign {
  return {
    components: [
      uno(pins),
      { id: 'r1', kind: 'resistor', label: 'R1', rotation: 0, value: 330, seat: { row: 'E', col: 5 } },
      { id: 'd1', kind: 'led', label: 'D1', rotation: 0, value: 2, seat: { row: 'E', col: 9 } },
    ],
    wires: [
      wire({ kind: 'pin', componentId: 'u1', pinId: 'd13' }, { kind: 'hole', hole: 'E05' }),
      wire({ kind: 'hole', hole: 'E11' }, { kind: 'hole', hole: 'J20' }),
      // H20 and J20 are the same bottom-bank strip, so this ties GND to the
      // LED cathode. (J22 would be a different column, and a different net.)
      wire({ kind: 'pin', componentId: 'u1', pinId: 'gnd1' }, { kind: 'hole', hole: 'H20' }),
    ],
  };
}

describe('code drives the circuit', () => {
  it('lights the LED when the sketch drives D13 HIGH', () => {
    const a = analyzeCircuit(blinkCircuit({ d13: { mode: 'output', value: 1 } }));

    const branch = a.branches.find((b) => b.conducts);
    expect(branch).toBeDefined();
    expect(branch?.driverLabel).toContain('pin 13');

    // I = (5 V - 2.0 V) / (330 + 25 ohm pin impedance)
    expect(branch?.currentA).toBeCloseTo(3 / 355, 6);

    const led = a.measurements.find((m) => m.componentId === 'd1');
    expect(led?.lit).toBe(true);
  });

  it('leaves the LED dark when the pin is driven LOW', () => {
    const a = analyzeCircuit(blinkCircuit({ d13: { mode: 'output', value: 0 } }));
    expect(a.branches.filter((b) => b.conducts)).toHaveLength(0);
    expect(a.measurements.find((m) => m.componentId === 'd1')?.lit).toBe(false);
  });

  it('leaves the LED dark when the pin is an input', () => {
    const a = analyzeCircuit(blinkCircuit({ d13: { mode: 'input', value: 0 } }));
    expect(a.branches.filter((b) => b.conducts)).toHaveLength(0);
  });

  it('accounts for the pin not being an ideal source', () => {
    // An ideal 5 V source would give 3/330 = 9.09 mA; a real pin's 25 ohm
    // output impedance drops that to 8.45 mA, and the model says so.
    const a = analyzeCircuit(blinkCircuit({ d13: { mode: 'output', value: 1 } }));
    const branch = a.branches.find((b) => b.conducts);
    expect(branch!.currentA).toBeLessThan(3 / 330);
    expect(branch!.currentA).toBeCloseTo(0.00845, 5);
  });

  it('reports a PWM duty as its mean level', () => {
    const a = analyzeCircuit(blinkCircuit({ d13: { mode: 'output', value: 0.5 } }));
    const driver = a.drivers.find((d) => d.kind === 'mcu_pin');
    expect(driver?.volts).toBeCloseTo(2.5, 6);
  });
});

describe('the full loop: sketch -> pins -> circuit', () => {
  const BLINK = `
void setup() {
  pinMode(13, OUTPUT);
}
void loop() {
  digitalWrite(13, HIGH);
  delay(500);
  digitalWrite(13, LOW);
  delay(500);
}`;

  it('runs the sketch, then solves the circuit it produced', () => {
    const run = runSketch(BLINK, 'arduino_uno', { loopIterations: 1 });
    expect(run.ok).toBe(true);

    // The sketch ends with the pin LOW, so the LED is dark at the final state.
    const atEnd = analyzeCircuit(
      blinkCircuit({ d13: { mode: run.pinModes.d13!, value: run.pinValues.d13! } }),
    );
    expect(atEnd.measurements.find((m) => m.componentId === 'd1')?.lit).toBe(false);

    // Replaying the trace, the LED is lit for exactly the HIGH half.
    const litStates = run.events
      .filter((e) => e.pin === 'd13' && e.mode === 'output')
      .map(
        (e) =>
          analyzeCircuit(blinkCircuit({ d13: { mode: 'output', value: e.value } })).measurements.find(
            (m) => m.componentId === 'd1',
          )?.lit ?? false,
      );
    expect(litStates).toContain(true);
    expect(litStates).toContain(false);
  });

  it('a sketch that forgets pinMode produces a real error, not a dark LED', () => {
    const run = runSketch(
      'void setup(){}\nvoid loop(){ digitalWrite(13, HIGH); }',
      'arduino_uno',
    );
    expect(run.ok).toBe(false);
    expect(run.errors[0]?.message).toContain('not an OUTPUT');
    // and no pin was driven, so the circuit genuinely has no driver
    const a = analyzeCircuit(blinkCircuit(run.pinValues.d13 !== undefined ? { d13: { mode: 'output', value: run.pinValues.d13 } } : {}));
    expect(a.branches.filter((b) => b.conducts)).toHaveLength(0);
  });
});

describe('the circuit feeds back into the code', () => {
  /** A button pulling D2 to 5 V, read by the sketch. */
  function buttonCircuit(pressed: boolean): CircuitDesign {
    return {
      components: [
        uno({ d2: { mode: 'input', value: 0 } }),
        { id: 'v1', kind: 'dc_source', label: 'V1', rotation: 0, value: 5, seat: null, benchPos: [0, 0, 1.78] },
        {
          id: 'sw1',
          kind: 'pushbutton',
          label: 'SW1',
          rotation: 0,
          value: 0,
          seat: { row: 'E', col: 5 },
          closed: pressed,
        },
      ],
      wires: [
        wire({ kind: 'pin', componentId: 'v1', pinId: 'pos' }, { kind: 'hole', hole: 'E05' }),
        wire({ kind: 'hole', hole: 'E07' }, { kind: 'hole', hole: 'J10' }),
        wire({ kind: 'pin', componentId: 'u1', pinId: 'd2' }, { kind: 'hole', hole: 'H10' }),
        wire({ kind: 'pin', componentId: 'v1', pinId: 'neg' }, { kind: 'hole', hole: 'B20' }),
        wire({ kind: 'pin', componentId: 'u1', pinId: 'gnd1' }, { kind: 'hole', hole: 'A20' }),
      ],
    };
  }

  const SKETCH =
    'void setup(){ pinMode(2, INPUT); pinMode(13, OUTPUT); }\n' +
    'void loop(){ digitalWrite(13, digitalRead(2)); }';

  it('digitalRead sees the voltage the solver computed', () => {
    const run = (pressed: boolean) => {
      const analysis = analyzeCircuit(buttonCircuit(pressed));
      return runSketch(SKETCH, 'arduino_uno', {
        loopIterations: 1,
        readPinVolts: (pinId) => {
          const net = analysis.netlist.pinNet[`u1.${pinId}`];
          if (!net) return null;
          const v = analysis.nodeVoltages[net];
          return v === undefined ? null : v;
        },
      });
    };

    // Button closed: D2 sits on the 5 V net, so the sketch mirrors it to D13.
    expect(run(true).pinValues.d13).toBe(1);
    // Button open: D2 is floating, which reads LOW on a plain INPUT.
    expect(run(false).pinValues.d13).toBe(0);
  });
});

describe('power is attributed to whichever driver supplied it', () => {
  it('reports real power for a circuit driven by a microcontroller pin', () => {
    // Regression: power was computed as total current x the *bench supply*
    // voltage, so every code-driven circuit reported 0 W while showing a
    // non-zero current.
    const a = analyzeCircuit(blinkCircuit({ d13: { mode: 'output', value: 1 } }));
    expect(a.supplyCurrentA).toBeCloseTo(3 / 355, 6);
    expect(a.supplyPowerW).toBeGreaterThan(0);
    // P = V_pin x I = 5 V x 8.45 mA
    expect(a.supplyPowerW).toBeCloseTo(5 * (3 / 355), 6);
  });

  it('still reports zero power when nothing conducts', () => {
    const a = analyzeCircuit(blinkCircuit({ d13: { mode: 'output', value: 0 } }));
    expect(a.supplyPowerW).toBe(0);
  });
});

describe('the printed derivation reproduces the printed number', () => {
  /**
   * The panel shows `I = (V - Vf) / R = <current>`. If the left side does not
   * evaluate to the right side, the lab is showing a student arithmetic that
   * does not work -- worse than showing nothing. It read
   * `(supply.volts - Vf) / rTotalOhm`, which for a pin-driven circuit printed
   * "(0 V - 2.00 V) / 330" beside an answer of 8.45 mA.
   */
  const evaluate = (text: string): number => {
    const m = /^I = \(([\d.]+) V \u2212 ([\d.]+) V\) \/ (.+) = /.exec(text);
    expect(m, `unparseable derivation: ${text}`).not.toBeNull();
    const ohms = [...m![3]!.matchAll(/([\d.]+) \u03a9/g)].map((x) => Number(x[1]));
    expect(ohms.length).toBeGreaterThan(0);
    return (Number(m![1]) - Number(m![2])) / ohms.reduce((a, b) => a + b, 0);
  };

  it('holds for a pin-driven branch, pin impedance included', () => {
    const a = analyzeCircuit(blinkCircuit({ d13: { mode: 'output', value: 1 } }));
    const b = a.branches.find((x) => x.conducts)!;
    const text = describeBranchCurrent(b);
    expect(text).toContain('5.00 V');
    expect(text).toContain('25.0 \u03a9');
    expect(evaluate(text)).toBeCloseTo(b.currentA, 6);
  });

  it('holds for the bench supply, which has no source resistance to show', () => {
    const a = analyzeCircuit(goldenLedCircuit());
    const b = a.branches.find((x) => x.conducts)!;
    const text = describeBranchCurrent(b);
    expect(b.rSourceOhm).toBe(0);
    expect(text).not.toContain('+');
    expect(evaluate(text)).toBeCloseTo(b.currentA, 6);
    // the worked example from the brief
    expect(b.currentA).toBeCloseTo(0.00909, 5);
  });
});
