import { describe, expect, it } from 'vitest';

import { validateCircuit } from '../validate';
import { analyzeCircuit } from '../solve';
import { buildNetlist, netOfPin, resolvePins, seatIsValid } from '../graph';
import { RED_LED } from '../componentDefs';
import { DEFAULT_EXPERIMENT_ID } from '../experiments';
import type { DiagnosticCode } from '../diagnostics';
import {
  capacitor,
  design,
  goldenLedCircuit,
  led,
  resistor,
  source,
  wireHoleToHole,
  wirePinToHole,
} from './fixtures';

const EXP = DEFAULT_EXPERIMENT_ID;

function codes(list: { code: DiagnosticCode }[]): DiagnosticCode[] {
  return list.map((d) => d.code);
}

describe('netlist extraction', () => {
  it('ties the five holes of one breadboard column into a single net', () => {
    const net = buildNetlist(
      design([resistor('A', 3)], [wireHoleToHole('C03', 'C20')]),
    );
    const r1 = netOfPin(net, 'r1', '1');
    expect(r1).toBeDefined();
    // A03 (pin) and C03 (wire end) are in the same A-E column strip.
    expect(r1?.holes).toContain('A03');
    expect(r1?.holes).toContain('C03');
  });

  it('keeps the two banks isolated across the centre channel', () => {
    const net = buildNetlist(design([], [wireHoleToHole('E05', 'E20')]));
    // E05 is top bank; F05 is bottom bank and must not be in that net.
    const withE05 = net.nets.find((n) => n.holes.includes('E05'));
    expect(withE05).toBeDefined();
    expect(withE05?.holes).not.toContain('F05');
  });

  it('treats each power rail as one continuous strip', () => {
    const net = buildNetlist(
      design([], [wireHoleToHole('TP02', 'A01'), wireHoleToHole('TP29', 'J01')]),
    );
    const rail = net.nets.find((n) => n.name === 'RAIL_TP');
    expect(rail).toBeDefined();
    // Both ends of the rail, plus both wired holes, collapse into one net.
    expect(rail?.holes).toContain('TP02');
    expect(rail?.holes).toContain('TP29');
    expect(rail?.holes).toContain('A01');
    expect(rail?.holes).toContain('J01');
  });

  it('places the + and - rails on different nets', () => {
    const net = buildNetlist(design([], [wireHoleToHole('TP05', 'A05'), wireHoleToHole('TN05', 'J05')]));
    const pos = net.nets.find((n) => n.name === 'RAIL_TP');
    const neg = net.nets.find((n) => n.name === 'RAIL_TN');
    expect(pos?.id).not.toBe(neg?.id);
  });

  it('resolves rotated pin offsets to the right holes', () => {
    const r = resistor('E', 5, 330, 0);
    const pins = resolvePins(r);
    expect(pins.map((p) => p.hole)).toEqual(['E05', 'E09']);

    const flipped = resolvePins(resistor('E', 9, 330, 180));
    expect(flipped.map((p) => p.hole)).toEqual(['E09', 'E05']);
  });

  it('rejects a seat whose second lead falls off the board', () => {
    expect(seatIsValid(resistor('E', 29))).toBe(false);
    expect(seatIsValid(resistor('E', 26))).toBe(true);
  });
});

describe('golden LED circuit — the brief\'s worked example', () => {
  const report = validateCircuit(goldenLedCircuit(330, 5), EXP);

  it('passes validation', () => {
    expect(report.validation.passes).toBe(true);
    expect(codes(report.validation.diagnostics)).toContain('CIRCUIT_VALID');
    expect(report.validation.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
  });

  it('computes I = (5 - 2.0) / 330 = 9.09 mA', () => {
    const branch = report.analysis.branches.find((b) => b.conducts);
    expect(branch).toBeDefined();
    expect(branch?.currentA).toBeCloseTo(3 / 330, 6);
    // 9.09 mA, matching the hand calculation in the brief.
    expect((branch?.currentA ?? 0) * 1000).toBeCloseTo(9.0909, 3);
  });

  it('reports the LED as lit and the resistor voltage drop', () => {
    const d1 = report.analysis.measurements.find((m) => m.componentId === 'd1');
    const r1 = report.analysis.measurements.find((m) => m.componentId === 'r1');
    expect(d1?.lit).toBe(true);
    expect(d1?.voltageV).toBeCloseTo(2.0, 6);
    // V_R = I * R = 9.09 mA * 330 ohm = 3.0 V
    expect(r1?.voltageV).toBeCloseTo(3.0, 5);
    expect(r1?.powerW).toBeCloseTo((3 / 330) * 3.0, 6);
  });

  it('reports the supply current and power', () => {
    expect(report.analysis.supplyCurrentA).toBeCloseTo(3 / 330, 6);
    expect(report.analysis.supplyPowerW).toBeCloseTo((3 / 330) * 5, 6);
  });

  it('names the engine and never claims to be SPICE', () => {
    expect(report.analysis.engine).toBe('deterministic-branch-v1');
  });
});

describe('fault 1 — reversed LED polarity', () => {
  // Same circuit, LED rotated 180 degrees so the cathode faces the resistor.
  const reversed = goldenLedCircuit();
  const d1 = reversed.components.find((c) => c.id === 'd1');
  if (d1) {
    d1.rotation = 180;
    d1.seat = { row: 'E', col: 11 }; // keep the same two holes, swapped roles
  }
  const report = validateCircuit(reversed, EXP);

  it('detects the reversal', () => {
    expect(codes(report.validation.diagnostics)).toContain('LED_REVERSED');
    expect(report.validation.passes).toBe(false);
  });

  it('reports zero current, not a guess', () => {
    const m = report.analysis.measurements.find((x) => x.componentId === 'd1');
    expect(m?.currentA).toBe(0);
    expect(m?.reverseBiased).toBe(true);
    expect(m?.lit).toBe(false);
    expect(report.analysis.supplyCurrentA).toBe(0);
  });

  it('cites the actual anode and cathode holes as evidence', () => {
    const diag = report.validation.diagnostics.find((x) => x.code === 'LED_REVERSED');
    expect(diag?.evidence?.anodeHole).toBe('E11');
    expect(diag?.evidence?.cathodeHole).toBe('E09');
  });
});

describe('fault 2 — missing resistor', () => {
  // LED wired straight across the rails.
  const noResistor = design(
    [source(5), led('E', 9)],
    [
      wirePinToHole('v1', 'pos', 'TP10'),
      wireHoleToHole('TP12', 'E09'),
      wireHoleToHole('E11', 'TN14'),
      wirePinToHole('v1', 'neg', 'TN18'),
    ],
  );
  const report = validateCircuit(noResistor, EXP);

  it('flags the missing current limit as an error', () => {
    expect(codes(report.validation.diagnostics)).toContain('MISSING_RESISTOR');
    expect(report.validation.passes).toBe(false);
  });

  it('reports a finite, destructive current from the documented fallback', () => {
    const branch = report.analysis.branches.find((b) => b.conducts);
    expect(branch?.unlimited).toBe(true);
    expect(branch?.rTotalOhm).toBe(0);
    // (5 - 2.0) / 12 ohm bulk resistance = 250 mA
    expect(branch?.currentA).toBeCloseTo(3 / RED_LED.rSeries, 6);
    expect(branch?.currentA ?? 0).toBeGreaterThan(RED_LED.iAbsMax);
    expect(Number.isFinite(branch?.currentA)).toBe(true);
  });
});

describe('fault 3 — open circuit', () => {
  // The return wire to the negative rail is missing.
  const open = design(
    [source(5), resistor('E', 5), led('E', 9)],
    [
      wirePinToHole('v1', 'pos', 'TP10'),
      wireHoleToHole('TP12', 'E05'),
      wirePinToHole('v1', 'neg', 'TN18'),
    ],
  );
  const report = validateCircuit(open, EXP);

  it('detects the break', () => {
    const c = codes(report.validation.diagnostics);
    // The dangling cathode is reported as floating, and the loop as open.
    expect(c).toContain('FLOATING_PIN');
    expect(report.validation.passes).toBe(false);
    expect(report.analysis.branches).toHaveLength(0);
    expect(report.analysis.supplyCurrentA).toBe(0);
  });

  it('names the unconnected pin', () => {
    const diag = report.validation.diagnostics.find((x) => x.code === 'FLOATING_PIN');
    expect(String(diag?.evidence?.pins)).toContain('D1');
  });
});

describe('fault 4 — supply not connected', () => {
  const unwired = design([source(5), resistor('E', 5), led('E', 9)], []);
  const report = validateCircuit(unwired, EXP);

  it('flags the unwired supply', () => {
    expect(codes(report.validation.diagnostics)).toContain('SUPPLY_UNCONNECTED');
    expect(report.validation.passes).toBe(false);
  });
});

describe('fault 5 — shorted component (both leads in one strip)', () => {
  // The resistor is rotated 90 degrees, putting both leads in column 5 (A-E strip).
  const shorted = design(
    [source(5), resistor('A', 5, 330, 90), led('E', 9)],
    [
      wirePinToHole('v1', 'pos', 'TP10'),
      wireHoleToHole('TP12', 'A05'),
      wireHoleToHole('E09', 'E05'),
      wireHoleToHole('E11', 'TN14'),
      wirePinToHole('v1', 'neg', 'TN18'),
    ],
  );
  const report = validateCircuit(shorted, EXP);

  it('detects that the resistor is bypassed', () => {
    expect(codes(report.validation.diagnostics)).toContain('COMPONENT_SHORTED');
    expect(report.validation.passes).toBe(false);
  });

  it('reports the LED as over-current because nothing limits it', () => {
    const c = codes(report.validation.diagnostics);
    expect(c.some((x) => x === 'MISSING_RESISTOR' || x === 'OVERCURRENT')).toBe(true);
  });
});

describe('fault 6 — supply short', () => {
  const shortCircuit = design(
    [source(5)],
    [
      wirePinToHole('v1', 'pos', 'TP10'),
      wirePinToHole('v1', 'neg', 'TP20'),
    ],
  );
  const report = validateCircuit(shortCircuit, EXP);

  it('detects + and - on the same net', () => {
    expect(codes(report.validation.diagnostics)).toContain('SUPPLY_SHORT');
    expect(report.validation.passes).toBe(false);
  });
});

describe('current-band checks', () => {
  it('warns above the 20 mA rated current', () => {
    const report = validateCircuit(goldenLedCircuit(100, 5), EXP);
    const branch = report.analysis.branches.find((b) => b.conducts);
    expect(branch?.currentA).toBeCloseTo(3 / 100, 6); // 30 mA
    const c = codes(report.validation.diagnostics);
    // 30 mA is exactly the absolute max, so this lands on the rated-current warning.
    expect(c.some((x) => x === 'ABOVE_RATED_CURRENT' || x === 'OVERCURRENT')).toBe(true);
  });

  it('errors above the 30 mA absolute maximum', () => {
    const report = validateCircuit(goldenLedCircuit(47, 5), EXP);
    const branch = report.analysis.branches.find((b) => b.conducts);
    expect((branch?.currentA ?? 0) * 1000).toBeCloseTo(63.83, 1);
    expect(codes(report.validation.diagnostics)).toContain('OVERCURRENT');
    expect(report.validation.passes).toBe(false);
  });

  it('suggests a minimum resistor value as evidence', () => {
    const report = validateCircuit(goldenLedCircuit(47, 5), EXP);
    const diag = report.validation.diagnostics.find((x) => x.code === 'OVERCURRENT');
    // (5 - 2) / 0.030 = 100 ohm
    expect(diag?.evidence?.minResistorOhm).toBe(100);
  });

  it('warns when the LED is too dim to see', () => {
    const report = validateCircuit(goldenLedCircuit(1_000_000, 5), EXP);
    expect(codes(report.validation.diagnostics)).toContain('LED_TOO_DIM');
  });

  it('detects a supply below the forward voltage', () => {
    const report = validateCircuit(goldenLedCircuit(330, 1.5), EXP);
    expect(codes(report.validation.diagnostics)).toContain('SUPPLY_BELOW_VF');
    const branch = report.analysis.branches[0];
    expect(branch?.conducts).toBe(false);
    expect(branch?.blockedReason).toBe('supply_below_forward_voltage');
  });
});

describe('capacitors at DC', () => {
  const withCap = goldenLedCircuit();
  withCap.components.push(capacitor('F', 5, 1e-5));
  withCap.wires.push(wireHoleToHole('F05', 'TP20'), wireHoleToHole('F07', 'TN20'));
  const report = validateCircuit(withCap, 'rc-smoothing');

  it('treats the capacitor as a DC open circuit', () => {
    expect(report.analysis.dcBlockedBy).toContain('c1');
    const m = report.analysis.measurements.find((x) => x.componentId === 'c1');
    expect(m?.currentA).toBe(0);
  });

  it('says so explicitly rather than hiding it', () => {
    expect(codes(report.validation.diagnostics)).toContain('CAPACITOR_BLOCKS_DC');
  });

  it('leaves the LED branch unaffected', () => {
    const branch = report.analysis.branches.find((b) => b.conducts);
    expect(branch?.currentA).toBeCloseTo(3 / 330, 6);
  });
});

describe('determinism and purity', () => {
  it('produces identical results for identical input', () => {
    const a = analyzeCircuit(goldenLedCircuit());
    const b = analyzeCircuit(goldenLedCircuit());
    expect(a.supplyCurrentA).toBe(b.supplyCurrentA);
    expect(a.branches.map((x) => x.netNames.join('>'))).toEqual(
      b.branches.map((x) => x.netNames.join('>')),
    );
  });

  it('does not mutate the input design', () => {
    const input = goldenLedCircuit();
    const snapshot = JSON.stringify(input);
    validateCircuit(input, EXP);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('an empty bench produces errors, never a pass', () => {
    const report = validateCircuit({ components: [], wires: [] }, EXP);
    expect(report.validation.passes).toBe(false);
    expect(codes(report.validation.diagnostics)).toContain('NO_SUPPLY');
    expect(codes(report.validation.diagnostics)).toContain('NO_LED');
  });
});

describe('node potentials (what the multimeter reads)', () => {
  it('pins ground at 0 V and the positive rail at the supply voltage', () => {
    const a = analyzeCircuit(goldenLedCircuit(330, 5));
    expect(a.groundNet).toBeTruthy();
    expect(a.nodeVoltages[a.groundNet!]).toBe(0);
    expect(a.nodeVoltages[a.supply!.posNet!]).toBe(5);
  });

  it('puts the resistor/LED junction at the LED forward voltage', () => {
    // 5 V across R1 then D1: the midpoint must sit at V_f = 2.0 V above ground,
    // because the LED drops exactly that.
    const a = analyzeCircuit(goldenLedCircuit(330, 5));
    const branch = a.branches.find((b) => b.conducts)!;
    const midNetId = branch.netPath[1]!;
    expect(a.nodeVoltages[midNetId]).toBeCloseTo(2.0, 6);
  });

  it('the drops around the loop sum to the supply voltage', () => {
    const a = analyzeCircuit(goldenLedCircuit(330, 5));
    const branch = a.branches.find((b) => b.conducts)!;
    const drops = branch.elements.reduce(
      (sum, el) =>
        sum + (el.forwardVoltageV > 0 ? el.forwardVoltageV : branch.currentA * el.resistanceOhm),
      0,
    );
    expect(drops).toBeCloseTo(5, 6); // KVL
  });

  it('leaves floating nets without a potential rather than calling them 0 V', () => {
    const open = design(
      [source(5), resistor('E', 5), led('E', 9)],
      [wirePinToHole('v1', 'pos', 'TP10'), wireHoleToHole('TP12', 'E05'), wirePinToHole('v1', 'neg', 'TN18')],
    );
    const a = analyzeCircuit(open);
    const ledCathodeNet = a.netlist.pinNet['d1.k'];
    expect(ledCathodeNet).toBeDefined();
    expect(a.nodeVoltages[ledCathodeNet!]).toBeUndefined();
  });

  it('tracks the divider ratio of a potentiometer wiper', () => {
    const make = (w: number) =>
      analyzeCircuit(
        design(
          [
            source(10),
            {
              id: 'rv1',
              kind: 'potentiometer',
              label: 'RV1',
              rotation: 0,
              value: 10000,
              seat: { row: 'E', col: 5 },
              wiper: w,
            },
          ],
          [
            wirePinToHole('v1', 'pos', 'TP10'),
            wireHoleToHole('TP12', 'E05'),
            wireHoleToHole('E09', 'TN14'),
            wirePinToHole('v1', 'neg', 'TN18'),
          ],
        ),
      );

    // Wired across the whole track, the wiper net sits at (1 - w) x Vsupply.
    const a = make(0.3);
    const wiperNet = a.netlist.pinNet['rv1.w'];
    expect(a.nodeVoltages[wiperNet!]).toBeCloseTo(7.0, 5);
  });
});
