import { describe, expect, it } from 'vitest';

import { analyzeCircuit, readMultimeter } from '../solve';
import { validateCircuit } from '../validate';
import { deviceEdges, SIGNAL_DIODE_VF, FUSE_RESISTANCE } from '../componentDefs';
import { DEFAULT_EXPERIMENT_ID } from '../experiments';
import type { ComponentKind, PlacedComponent, RowId } from '../types';
import type { DiagnosticCode } from '../diagnostics';
import { design, goldenLedCircuit, source, wireHoleToHole, wirePinToHole } from './fixtures';

/**
 * Every component in the library must be *solved*, not merely drawn. These
 * tests drive each new part through the deterministic engine and assert the
 * numbers it produces.
 */

const EXP = DEFAULT_EXPERIMENT_ID;

function part(
  kind: ComponentKind,
  id: string,
  row: RowId,
  col: number,
  extra: Partial<PlacedComponent> = {},
): PlacedComponent {
  return {
    id,
    kind,
    label: id.toUpperCase(),
    rotation: 0,
    value: 0,
    seat: { row, col },
    ...extra,
  };
}

/** Supply + rails wired, with the part under test in series with R1 (330 Ω). */
function seriesRig(device: PlacedComponent, deviceInHole: { from: string; to: string }) {
  return design(
    [
      source(5),
      part('resistor', 'r1', 'E', 5, { value: 330 }),
      device,
    ],
    [
      wirePinToHole('v1', 'pos', 'TP10'),
      wireHoleToHole('TP12', 'E05'),
      wireHoleToHole('E09', deviceInHole.from),
      wireHoleToHole(deviceInHole.to, 'TN14'),
      wirePinToHole('v1', 'neg', 'TN18'),
    ],
  );
}

const codes = (r: ReturnType<typeof validateCircuit>): DiagnosticCode[] =>
  r.validation.diagnostics.map((d) => d.code);

describe('switch', () => {
  it('blocks the circuit when open', () => {
    const sw = part('switch', 'sw1', 'G', 5, { closed: false });
    const report = validateCircuit(seriesRig(sw, { from: 'G05', to: 'G08' }), EXP);
    expect(report.analysis.supplyCurrentA).toBe(0);
    expect(report.analysis.branches).toHaveLength(0);
    expect(codes(report)).toContain('SWITCH_OPEN');
  });

  it('conducts with zero resistance when closed', () => {
    const sw = part('switch', 'sw1', 'G', 5, { closed: true });
    const report = validateCircuit(seriesRig(sw, { from: 'G05', to: 'G08' }), EXP);
    const branch = report.analysis.branches.find((b) => b.conducts);
    expect(branch).toBeDefined();
    // The switch adds nothing: current is still set by R1 alone.
    expect(branch?.rTotalOhm).toBe(330);
    expect(report.analysis.supplyCurrentA).toBeCloseTo(5 / 330, 6);
  });

  it('reports the closed switch as carrying the branch current', () => {
    const sw = part('switch', 'sw1', 'G', 5, { closed: true });
    const report = validateCircuit(seriesRig(sw, { from: 'G05', to: 'G08' }), EXP);
    const m = report.analysis.measurements.find((x) => x.componentId === 'sw1');
    expect(Math.abs(m?.currentA ?? 0)).toBeCloseTo(5 / 330, 6);
    expect(m?.voltageV).toBeCloseTo(0, 9); // ideal switch drops nothing
  });
});

describe('push button', () => {
  it('is open until held', () => {
    const released = part('pushbutton', 'sw1', 'G', 5, { closed: false });
    expect(validateCircuit(seriesRig(released, { from: 'G05', to: 'G07' }), EXP).analysis.supplyCurrentA).toBe(0);

    const held = part('pushbutton', 'sw1', 'G', 5, { closed: true });
    expect(
      validateCircuit(seriesRig(held, { from: 'G05', to: 'G07' }), EXP).analysis.supplyCurrentA,
    ).toBeCloseTo(5 / 330, 6);
  });
});

describe('diode', () => {
  it('drops 0.7 V when forward biased', () => {
    const d = part('diode', 'd2', 'G', 5, { value: SIGNAL_DIODE_VF });
    const report = validateCircuit(seriesRig(d, { from: 'G05', to: 'G08' }), EXP);
    const branch = report.analysis.branches.find((b) => b.conducts);
    expect(branch?.vfSumV).toBeCloseTo(0.7, 6);
    // I = (5 - 0.7) / 330
    expect(branch?.currentA).toBeCloseTo(4.3 / 330, 6);
  });

  it('blocks and is reported when reversed', () => {
    const d = part('diode', 'd2', 'G', 5, { value: SIGNAL_DIODE_VF, rotation: 180, seat: { row: 'G', col: 8 } });
    const report = validateCircuit(seriesRig(d, { from: 'G05', to: 'G08' }), EXP);
    expect(report.analysis.supplyCurrentA).toBe(0);
    expect(codes(report)).toContain('DIODE_REVERSED');
  });
});

describe('potentiometer', () => {
  it('splits its track at the wiper', () => {
    const pot = part('potentiometer', 'rv1', 'G', 5, { value: 10000, wiper: 0.25 });
    const edges = deviceEdges(pot);
    expect(edges).toHaveLength(2);
    expect(edges[0]?.resistanceOhm).toBeCloseTo(2500, 6);
    expect(edges[1]?.resistanceOhm).toBeCloseTo(7500, 6);
  });

  it('changes the branch current as the wiper moves', () => {
    // Wired as a rheostat: pin 1 in, wiper out.
    const make = (w: number) =>
      design(
        [source(5), part('potentiometer', 'rv1', 'E', 5, { value: 10000, wiper: w })],
        [
          wirePinToHole('v1', 'pos', 'TP10'),
          wireHoleToHole('TP12', 'E05'),
          wireHoleToHole('E07', 'TN14'),
          wirePinToHole('v1', 'neg', 'TN18'),
        ],
      );

    const quarter = analyzeCircuit(make(0.25));
    const threeQuarter = analyzeCircuit(make(0.75));
    // 1->W is wiper x R, so a larger wiper means more resistance, less current.
    expect(quarter.supplyCurrentA).toBeCloseTo(5 / 2500, 6);
    expect(threeQuarter.supplyCurrentA).toBeCloseTo(5 / 7500, 6);
    expect(quarter.supplyCurrentA).toBeGreaterThan(threeQuarter.supplyCurrentA);
  });

  it('warns when the wiper is left unconnected', () => {
    const wholeTrack = design(
      [source(5), part('potentiometer', 'rv1', 'E', 5, { value: 10000, wiper: 0.5 })],
      [
        wirePinToHole('v1', 'pos', 'TP10'),
        wireHoleToHole('TP12', 'E05'),
        wireHoleToHole('E09', 'TN14'),
        wirePinToHole('v1', 'neg', 'TN18'),
      ],
    );
    expect(codes(validateCircuit(wholeTrack, EXP))).toContain('POT_WIPER_UNUSED');
  });
});

describe('fuse', () => {
  it('adds only its small element resistance while intact', () => {
    const f = part('fuse', 'f1', 'G', 5, { value: 1, blown: false });
    const report = validateCircuit(seriesRig(f, { from: 'G05', to: 'G09' }), EXP);
    const branch = report.analysis.branches.find((b) => b.conducts);
    expect(branch?.rTotalOhm).toBeCloseTo(330 + FUSE_RESISTANCE, 6);
  });

  it('is an open circuit once blown', () => {
    const f = part('fuse', 'f1', 'G', 5, { value: 1, blown: true });
    const report = validateCircuit(seriesRig(f, { from: 'G05', to: 'G09' }), EXP);
    expect(report.analysis.supplyCurrentA).toBe(0);
    expect(codes(report)).toContain('FUSE_BLOWN');
  });

  it('flags a fuse carrying more than its rating', () => {
    // 5 V across 330 ohm is ~15 mA, well over a 5 mA fuse.
    const f = part('fuse', 'f1', 'G', 5, { value: 0.005, blown: false });
    const report = validateCircuit(seriesRig(f, { from: 'G05', to: 'G09' }), EXP);
    expect(codes(report)).toContain('FUSE_OVER_RATING');
    const diag = report.validation.diagnostics.find((d) => d.code === 'FUSE_OVER_RATING');
    expect(Number(diag?.evidence?.measuredA)).toBeGreaterThan(0.005);
  });
});

describe('inductor', () => {
  it('is a short circuit at DC', () => {
    const l = part('inductor', 'l1', 'G', 5, { value: 1e-3 });
    const report = validateCircuit(seriesRig(l, { from: 'G05', to: 'G09' }), EXP);
    const branch = report.analysis.branches.find((b) => b.conducts);
    expect(branch?.rTotalOhm).toBe(330); // the inductor adds nothing
    const m = report.analysis.measurements.find((x) => x.componentId === 'l1');
    expect(m?.voltageV).toBeCloseTo(0, 9);
    expect(codes(report)).toContain('INDUCTOR_DC_SHORT');
  });
});

describe('photoresistor', () => {
  it('falls to about 2% of dark resistance in full light', () => {
    const dark = deviceEdges(part('photoresistor', 'ldr1', 'G', 5, { value: 10000, illumination: 0 }));
    const bright = deviceEdges(part('photoresistor', 'ldr1', 'G', 5, { value: 10000, illumination: 1 }));
    expect(dark[0]?.resistanceOhm).toBeCloseTo(10000, 6);
    expect(bright[0]?.resistanceOhm).toBeCloseTo(200, 6);
  });

  it('raises the current as illumination rises', () => {
    const make = (lux: number) =>
      design(
        [source(5), part('photoresistor', 'ldr1', 'E', 5, { value: 10000, illumination: lux })],
        [
          wirePinToHole('v1', 'pos', 'TP10'),
          wireHoleToHole('TP12', 'E05'),
          wireHoleToHole('E07', 'TN14'),
          wirePinToHole('v1', 'neg', 'TN18'),
        ],
      );
    expect(analyzeCircuit(make(1)).supplyCurrentA).toBeGreaterThan(
      analyzeCircuit(make(0)).supplyCurrentA,
    );
  });
});

describe('buzzer', () => {
  it('behaves as a polarised resistive load', () => {
    const bz = part('buzzer', 'bz1', 'G', 5, { value: 100 });
    const report = validateCircuit(seriesRig(bz, { from: 'G05', to: 'G07' }), EXP);
    const branch = report.analysis.branches.find((b) => b.conducts);
    expect(branch?.rTotalOhm).toBe(430); // 330 + 100
    expect(report.analysis.supplyCurrentA).toBeCloseTo(5 / 430, 6);
  });

  it('does not conduct when wired backwards', () => {
    const bz = part('buzzer', 'bz1', 'G', 5, { value: 100, rotation: 180, seat: { row: 'G', col: 7 } });
    const report = validateCircuit(seriesRig(bz, { from: 'G05', to: 'G07' }), EXP);
    expect(report.analysis.supplyCurrentA).toBe(0);
  });
});

describe('battery as an alternative source', () => {
  it('drives the circuit when no bench supply is present', () => {
    const d = design(
      [
        { id: 'bt1', kind: 'battery', label: 'BT1', rotation: 0, value: 3, seat: { row: 'J', col: 1 } },
        part('resistor', 'r1', 'E', 5, { value: 330 }),
      ],
      [
        wireHoleToHole('J01', 'E05'),
        wireHoleToHole('E09', 'J06'),
      ],
    );
    const analysis = analyzeCircuit(d);
    expect(analysis.supply?.label).toBe('BT1');
    expect(analysis.supply?.volts).toBe(3);
    expect(analysis.supplyCurrentA).toBeCloseTo(3 / 330, 6);
  });
});

describe('RGB LED', () => {
  it('exposes three independently solved dies', () => {
    const rgb = part('rgb_led', 'd3', 'E', 10, { value: 2 });
    const edges = deviceEdges(rgb);
    expect(edges).toHaveLength(3);
    expect(edges.map((e) => e.toPin)).toEqual(['k', 'k', 'k']);
    expect(edges.map((e) => e.forwardVoltageV)).toEqual([2.0, 3.0, 3.0]);
    expect(edges.every((e) => e.emissive)).toBe(true);
  });

  it('lights only the channel that is driven', () => {
    // Drive the red anode only; green and blue are left unconnected.
    const d = design(
      [source(5), part('resistor', 'r1', 'E', 5, { value: 330 }), part('rgb_led', 'd3', 'E', 9, { value: 2 })],
      [
        wirePinToHole('v1', 'pos', 'TP10'),
        wireHoleToHole('TP12', 'E05'),
        wireHoleToHole('E10', 'TN14'),
        wirePinToHole('v1', 'neg', 'TN18'),
      ],
    );
    const analysis = analyzeCircuit(d);
    const m = analysis.measurements.find((x) => x.componentId === 'd3');
    expect(m?.litChannels).toEqual(['R']);
    expect(m?.lit).toBe(true);
    // I = (5 - 2.0) / 330, the red die's forward voltage.
    expect(analysis.supplyCurrentA).toBeCloseTo(3 / 330, 6);
  });
});

describe('every catalogue part is modelled, not decorative', () => {
  it('declares a fidelity statement for every kind', async () => {
    const { COMPONENT_DEFS, LIBRARY_ORDER } = await import('../componentDefs');
    for (const kind of LIBRARY_ORDER) {
      const def = COMPONENT_DEFS[kind];
      expect(def.fidelity.length).toBeGreaterThan(20);
      expect(def.name.length).toBeGreaterThan(0);
    }
  });

  it('gives every load part at least one device edge', async () => {
    const { LIBRARY_ORDER, COMPONENT_DEFS, isSource, isInstrument, defaultState } =
      await import('../componentDefs');
    const { isMcu } = await import('../solve');
    for (const kind of LIBRARY_ORDER) {
      // Sources and microcontroller pins are *drivers*, and instruments are
      // observers; none of them is a conducting element.
      if (isSource(kind) || isInstrument(kind) || isMcu(kind) || kind === 'breadboard') continue;
      const def = COMPONENT_DEFS[kind];
      const c: PlacedComponent = {
        id: 'x',
        kind,
        label: 'X1',
        rotation: 0,
        value: def.defaultValue,
        seat: { row: 'E', col: 5 },
        ...defaultState(kind),
      };
      expect(deviceEdges(c).length).toBeGreaterThan(0);
    }
  });

  it('gives instruments NO device edges, so measuring cannot disturb the circuit', async () => {
    const { LIBRARY_ORDER, isInstrument, defaultState, COMPONENT_DEFS } =
      await import('../componentDefs');
    const instruments = LIBRARY_ORDER.filter(isInstrument);
    expect(instruments.length).toBeGreaterThan(0);
    for (const kind of instruments) {
      const c: PlacedComponent = {
        id: 'x',
        kind,
        label: 'M1',
        rotation: 0,
        value: COMPONENT_DEFS[kind].defaultValue,
        seat: null,
        ...defaultState(kind),
      };
      // An ideal voltmeter has infinite input impedance: no conducting path.
      expect(deviceEdges(c)).toHaveLength(0);
    }
  });
});

describe('multimeter', () => {
  it('reads the supply voltage across the rails', () => {
    const d = goldenLedCircuit(330, 5);
    d.components.push({
      id: 'm1', kind: 'multimeter', label: 'M1', rotation: 0, value: 0, seat: null,
      benchPos: [1.65, 0, 1.55],
    });
    d.wires.push(
      wirePinToHole('m1', 'red', 'TP20'),
      wirePinToHole('m1', 'black', 'TN20'),
    );
    const a = analyzeCircuit(d);
    const r = readMultimeter(a, 'm1');
    expect(r.live).toBe(true);
    expect(r.volts).toBeCloseTo(5, 6);
    expect(r.display).toBe('5.000 V');
  });

  it('reads the LED forward voltage when probed across it', () => {
    const d = goldenLedCircuit(330, 5);
    d.components.push({
      id: 'm1', kind: 'multimeter', label: 'M1', rotation: 0, value: 0, seat: null,
    });
    // D1 spans E09 (anode) to E11 (cathode).
    d.wires.push(wirePinToHole('m1', 'red', 'E09'), wirePinToHole('m1', 'black', 'E11'));
    const r = readMultimeter(analyzeCircuit(d), 'm1');
    expect(r.volts).toBeCloseTo(2.0, 6);
  });

  it('does not change the circuit it measures', () => {
    const without = analyzeCircuit(goldenLedCircuit(330, 5));
    const withMeter = goldenLedCircuit(330, 5);
    withMeter.components.push({
      id: 'm1', kind: 'multimeter', label: 'M1', rotation: 0, value: 0, seat: null,
    });
    withMeter.wires.push(
      wirePinToHole('m1', 'red', 'TP20'),
      wirePinToHole('m1', 'black', 'TN20'),
    );
    const after = analyzeCircuit(withMeter);
    expect(after.supplyCurrentA).toBeCloseTo(without.supplyCurrentA, 12);
    expect(after.branches.length).toBe(without.branches.length);
  });

  it('says so plainly when a probe is on a floating net', () => {
    const d = goldenLedCircuit(330, 5);
    d.components.push({
      id: 'm1', kind: 'multimeter', label: 'M1', rotation: 0, value: 0, seat: null,
    });
    d.wires.push(wirePinToHole('m1', 'red', 'J25'), wirePinToHole('m1', 'black', 'TN20'));
    const r = readMultimeter(analyzeCircuit(d), 'm1');
    expect(r.volts).toBeNull();
    expect(r.caption).toContain('FLOATING');
  });

  it('reports free probes rather than inventing a reading', () => {
    const d = goldenLedCircuit(330, 5);
    d.components.push({
      id: 'm1', kind: 'multimeter', label: 'M1', rotation: 0, value: 0, seat: null,
    });
    const r = readMultimeter(analyzeCircuit(d), 'm1');
    expect(r.volts).toBeNull();
    expect(r.display).toBe('- - -');
  });
});

describe('bench battery pack', () => {
  it('drives the circuit exactly like the bench supply', () => {
    const d = design(
      [
        { id: 'bt1', kind: 'battery_pack', label: 'BT1', rotation: 0, value: 9, seat: null,
          benchPos: [-1.55, 0, 1.6] },
        part('resistor', 'r1', 'E', 5, { value: 330 }),
      ],
      [
        wirePinToHole('bt1', 'pos', 'TP10'),
        wireHoleToHole('TP12', 'E05'),
        wireHoleToHole('E09', 'TN14'),
        wirePinToHole('bt1', 'neg', 'TN18'),
      ],
    );
    const a = analyzeCircuit(d);
    expect(a.supply?.label).toBe('BT1');
    expect(a.supply?.volts).toBe(9);
    expect(a.supplyCurrentA).toBeCloseTo(9 / 330, 6);
  });
});
