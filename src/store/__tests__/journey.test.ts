import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getInitialDocument, useLabStore } from '../useLabStore';
import { localTutorReply } from '@/lib/tutor/localTutor';
import { buildEvidence } from '@/lib/tutor/evidence';
import { DETERMINISTIC_DESCRIPTOR } from '@/lib/sim/adapter';
import { resolvePins } from '@/lib/circuit/graph';
import { toSpiceNetlist } from '@/lib/sim/netlistSpice';
import type { DiagnosticCode } from '@/lib/circuit/diagnostics';

/**
 * End-to-end test of the documented learning workflow, driving the real store.
 *
 * This is the closest thing to a browser test without a browser: every action
 * here is the same action the UI dispatches.
 */

function codes(): DiagnosticCode[] {
  return (useLabStore.getState().report?.validation.diagnostics ?? []).map((d) => d.code);
}

function resetStore(): void {
  const s = useLabStore.getState();
  s.resetBench();
  s.clearTutor();
  useLabStore.setState({
    versions: [],
    past: [],
    future: [],
    report: null,
    pcbResult: null,
    toasts: [],
    selection: { kind: null, id: null },
    tool: 'select',
    wireAnchor: null,
    engine: DETERMINISTIC_DESCRIPTOR,
  });
}

beforeEach(() => {
  resetStore();
});

describe('step 1-4: build a circuit and run the analysis', () => {
  it('an empty bench never reports a pass', () => {
    useLabStore.getState().runSimulation();
    expect(useLabStore.getState().report?.validation.passes).toBe(false);
    expect(codes()).toContain('NO_SUPPLY');
  });

  it('builds the reference circuit through store actions and passes', () => {
    const s = useLabStore.getState();

    // Place the parts, exactly as the library sidebar does.
    s.placeBenchComponent('dc_source', [0, 0, 1.75]);
    s.placeComponent('resistor', 'E', 5);
    s.placeComponent('led', 'E', 9);

    const state = useLabStore.getState();
    const v1 = state.design.components.find((c) => c.kind === 'dc_source');
    expect(v1).toBeDefined();
    expect(state.design.components).toHaveLength(3);
    expect(state.design.components.map((c) => c.label).sort()).toEqual(['D1', 'R1', 'V1']);

    // Wire it up, exactly as the wire tool does: anchor then complete.
    const api = useLabStore.getState();
    api.beginWire({ kind: 'pin', componentId: v1!.id, pinId: 'pos' });
    api.completeWire({ kind: 'hole', hole: 'TP10' });
    useLabStore.getState().beginWire({ kind: 'hole', hole: 'TP12' });
    useLabStore.getState().completeWire({ kind: 'hole', hole: 'E05' });
    useLabStore.getState().beginWire({ kind: 'hole', hole: 'E11' });
    useLabStore.getState().completeWire({ kind: 'hole', hole: 'TN14' });
    useLabStore.getState().beginWire({ kind: 'pin', componentId: v1!.id, pinId: 'neg' });
    useLabStore.getState().completeWire({ kind: 'hole', hole: 'TN18' });

    expect(useLabStore.getState().design.wires).toHaveLength(4);

    useLabStore.getState().runSimulation();
    const report = useLabStore.getState().report;
    expect(report).not.toBeNull();
    expect(report?.validation.passes).toBe(true);
    expect(report?.analysis.supplyCurrentA).toBeCloseTo(3 / 330, 6);
  });

  it('rejects a seat that would hang a lead off the board', () => {
    useLabStore.getState().placeComponent('resistor', 'E', 29);
    expect(useLabStore.getState().design.components).toHaveLength(0);
    expect(useLabStore.getState().toasts.some((t) => t.kind === 'warning')).toBe(true);
  });

  it('refuses a second DC supply', () => {
    useLabStore.getState().placeBenchComponent('dc_source', [0, 0, 1.75]);
    useLabStore.getState().placeBenchComponent('dc_source', [1, 0, 1.75]);
    expect(useLabStore.getState().design.components.filter((c) => c.kind === 'dc_source')).toHaveLength(1);
  });

  it('refuses a wire with two identical endpoints', () => {
    useLabStore.getState().beginWire({ kind: 'hole', hole: 'E05' });
    useLabStore.getState().completeWire({ kind: 'hole', hole: 'E05' });
    expect(useLabStore.getState().design.wires).toHaveLength(0);
  });

  it('invalidates stale results as soon as the design changes', () => {
    useLabStore.getState().loadStarterCircuit();
    useLabStore.getState().runSimulation();
    expect(useLabStore.getState().report).not.toBeNull();

    // Changing the resistor must clear the old numbers rather than keep showing them.
    const r1 = useLabStore.getState().design.components.find((c) => c.kind === 'resistor');
    useLabStore.getState().setComponentValue(r1!.id, 1000);
    expect(useLabStore.getState().report).toBeNull();
  });
});

describe('step 5-7: diagnose, ask for help, then fix', () => {
  it('detects the reversed LED, explains it, and clears after the fix', () => {
    useLabStore.getState().loadFaultyCircuit();
    useLabStore.getState().runSimulation();

    // The fault is found deterministically.
    expect(codes()).toContain('LED_REVERSED');
    expect(useLabStore.getState().report?.validation.passes).toBe(false);
    expect(useLabStore.getState().report?.analysis.supplyCurrentA).toBe(0);

    // The tutor's evidence packet carries the real holes, nothing invented.
    const st = useLabStore.getState();
    const evidence = buildEvidence({
      design: st.design,
      experimentId: st.experimentId,
      workspace: 'circuit',
      engine: st.engine,
      report: st.report,
      pcbResult: null,
    });
    const diag = evidence.validation.diagnostics.find((d) => d.code === 'LED_REVERSED');
    expect(diag?.evidence.anodeHole).toBe('E11');
    expect(diag?.evidence.cathodeHole).toBe('E09');

    const hint = localTutorReply({ question: 'why is it dark?', hintLevel: 3, evidence });
    expect(hint.groundedIn).toEqual(['LED_REVERSED']);
    // The level-3 explanation quotes the real holes from the evidence.
    expect(hint.reply).toContain('E09');
    expect(hint.reply).toContain('E11');

    // The student applies the fix themselves.
    const led = useLabStore.getState().design.components.find((c) => c.kind === 'led');
    useLabStore.getState().rotateComponent(led!.id, 180);
    useLabStore.getState().runSimulation();

    expect(codes()).not.toContain('LED_REVERSED');
    expect(useLabStore.getState().report?.validation.passes).toBe(true);
    expect(useLabStore.getState().report?.analysis.supplyCurrentA).toBeCloseTo(3 / 330, 6);
  });

  it('escalates help across the three hint levels without leaking the answer early', () => {
    useLabStore.getState().loadFaultyCircuit();
    useLabStore.getState().runSimulation();
    const st = useLabStore.getState();
    const evidence = buildEvidence({
      design: st.design,
      experimentId: st.experimentId,
      workspace: 'circuit',
      engine: st.engine,
      report: st.report,
      pcbResult: null,
    });

    const l1 = localTutorReply({ question: 'help', hintLevel: 1, evidence }).reply;
    const l2 = localTutorReply({ question: 'help', hintLevel: 2, evidence }).reply;
    const l3 = localTutorReply({ question: 'help', hintLevel: 3, evidence }).reply;

    // Level 1 nudges only: it must not name the fix or the holes.
    expect(l1).not.toContain('180');
    expect(l1).not.toContain('E09');
    // Level 2 explains the principle but still withholds the explicit action.
    expect(l2).not.toContain('180');
    expect(l2.toLowerCase()).toContain('anode');
    // Level 3 gives the step-by-step fix.
    expect(l3).toContain('180');
    expect(l3.length).toBeGreaterThan(l1.length);
  });

  it('is deterministic: same evidence gives byte-identical output', () => {
    useLabStore.getState().loadFaultyCircuit();
    useLabStore.getState().runSimulation();
    const st = useLabStore.getState();
    const evidence = buildEvidence({
      design: st.design,
      experimentId: st.experimentId,
      workspace: 'circuit',
      engine: st.engine,
      report: st.report,
      pcbResult: null,
    });
    const a = localTutorReply({ question: 'q', hintLevel: 2, evidence }).reply;
    const b = localTutorReply({ question: 'q', hintLevel: 2, evidence }).reply;
    expect(a).toBe(b);
  });

  it('refuses to comment when nothing has been analysed', () => {
    const st = useLabStore.getState();
    const evidence = buildEvidence({
      design: st.design,
      experimentId: st.experimentId,
      workspace: 'circuit',
      engine: st.engine,
      report: null,
      pcbResult: null,
    });
    const reply = localTutorReply({ question: 'is it right?', hintLevel: 3, evidence }).reply;
    expect(reply).toContain('Run Simulation');
    expect(evidence.simulation.ran).toBe(false);
  });

  it('posts a tutor turn through the store against a stubbed route', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          reply: 'Look at D1 again.',
          source: 'local-demo',
          groundedIn: ['LED_REVERSED'],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    useLabStore.getState().loadFaultyCircuit();
    useLabStore.getState().runSimulation();
    await useLabStore.getState().askTutor('Why is my LED dark?', 2);

    const messages = useLabStore.getState().tutorMessages;
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe('student');
    expect(messages[1]?.role).toBe('tutor');
    expect(messages[1]?.content).toBe('Look at D1 again.');
    expect(messages[1]?.hintLevel).toBe(2);
    expect(useLabStore.getState().tutorBusy).toBe(false);

    // The request body carried the structured evidence, not free text.
    const init = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body));
    expect(body.hintLevel).toBe(2);
    expect(body.evidence.validation.diagnostics.some((d: { code: string }) => d.code === 'LED_REVERSED')).toBe(
      true,
    );
    vi.unstubAllGlobals();
  });

  it('surfaces a tutor failure without losing the circuit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    useLabStore.getState().loadStarterCircuit();
    useLabStore.getState().runSimulation();
    const before = useLabStore.getState().report?.analysis.supplyCurrentA;

    await useLabStore.getState().askTutor('review please', 1);
    const last = useLabStore.getState().tutorMessages.at(-1);
    expect(last?.error).toBe(true);
    expect(last?.content).toContain('network down');
    // The analysis is untouched.
    expect(useLabStore.getState().report?.analysis.supplyCurrentA).toBe(before);
    vi.unstubAllGlobals();
  });
});

describe('step 8-9: PCB layout and checks', () => {
  it('imports footprints from the circuit with nets attached', () => {
    useLabStore.getState().loadStarterCircuit();
    useLabStore.getState().runSimulation();
    useLabStore.getState().importFootprints();

    const board = useLabStore.getState().board;
    expect(board.footprints.map((f) => f.ref).sort()).toEqual(['D1', 'R1', 'V1']);
    const cathode = board.footprints
      .find((f) => f.ref === 'D1')
      ?.pads.find((p) => p.pinId === 'k');
    expect(cathode?.net).toBe('RAIL_TN');
  });

  it('will not import from an empty bench', () => {
    useLabStore.getState().importFootprints();
    expect(useLabStore.getState().board.footprints).toHaveLength(0);
    expect(useLabStore.getState().toasts.some((t) => t.kind === 'warning')).toBe(true);
  });

  it('reports unrouted nets, then passes once routed by hand', () => {
    useLabStore.getState().loadStarterCircuit();
    useLabStore.getState().runSimulation();
    useLabStore.getState().importFootprints();

    useLabStore.getState().runPcbChecks();
    let result = useLabStore.getState().pcbResult;
    expect(result?.passes).toBe(false);
    expect(result?.diagnostics.map((d) => d.code)).toContain('PCB_MISSING_TRACE');

    // Lay the parts out in a row and route the three nets with detours.
    const positions: Record<string, { x: number; y: number }> = {
      V1: { x: 12, y: 20 },
      R1: { x: 30, y: 20 },
      D1: { x: 46, y: 20 },
    };
    for (const fp of useLabStore.getState().board.footprints) {
      const p = positions[fp.ref];
      if (p) useLabStore.getState().moveFootprint(fp.id, p.x, p.y);
    }

    const board = useLabStore.getState().board;
    const pad = (ref: string, pin: string) => {
      const fp = board.footprints.find((f) => f.ref === ref);
      const p = fp?.pads.find((q) => q.pinId === pin);
      if (!fp || !p) throw new Error(`pad ${ref}.${pin}`);
      return { id: p.id, x: fp.x + p.dx, y: fp.y + p.dy };
    };

    const vPos = pad('V1', 'pos');
    const vNeg = pad('V1', 'neg');
    const r1 = pad('R1', '1');
    const r2 = pad('R1', '2');
    const anode = pad('D1', 'a');
    const cathode = pad('D1', 'k');

    // RAIL_TP above the parts, RAIL_TN below, so no net crosses another.
    useLabStore
      .getState()
      .addTrace(
        [vPos, { x: vPos.x, y: 6 }, { x: r1.x, y: 6 }, r1],
        vPos.id,
        r1.id,
      );
    useLabStore.getState().addTrace([r2, anode], r2.id, anode.id);
    useLabStore
      .getState()
      .addTrace(
        [cathode, { x: cathode.x, y: 35 }, { x: vNeg.x, y: 35 }, vNeg],
        cathode.id,
        vNeg.id,
      );

    useLabStore.getState().runPcbChecks();
    result = useLabStore.getState().pcbResult;
    expect(result?.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(result?.passes).toBe(true);
    expect(result?.stats.netsFullyRouted).toBe(result?.stats.nets);
  });

  it('catches a trace that shorts two nets', () => {
    useLabStore.getState().loadStarterCircuit();
    useLabStore.getState().runSimulation();
    useLabStore.getState().importFootprints();
    const board = useLabStore.getState().board;
    const r1 = board.footprints.find((f) => f.ref === 'R1')!;
    const d1 = board.footprints.find((f) => f.ref === 'D1')!;
    const a = r1.pads.find((p) => p.number === '1')!;
    const b = d1.pads.find((p) => p.pinId === 'k')!;
    expect(a.net).not.toBe(b.net);

    useLabStore
      .getState()
      .addTrace([{ x: r1.x, y: r1.y }, { x: d1.x, y: d1.y }], a.id, b.id);
    useLabStore.getState().runPcbChecks();
    expect(useLabStore.getState().pcbResult?.diagnostics.map((d) => d.code)).toContain(
      'PCB_WRONG_CONNECTION',
    );
  });
});

describe('step 10: versions and comparison', () => {
  it('snapshots a version on every simulation run', () => {
    useLabStore.getState().loadStarterCircuit();
    useLabStore.getState().runSimulation();
    expect(useLabStore.getState().versions).toHaveLength(1);
    useLabStore.getState().runSimulation();
    expect(useLabStore.getState().versions).toHaveLength(2);
    expect(useLabStore.getState().versions[0]?.reason).toBe('simulation');
  });

  it('captures the before/after story of a fix', () => {
    // Before: faulty.
    useLabStore.getState().loadFaultyCircuit();
    useLabStore.getState().runSimulation();
    const before = useLabStore.getState().versions[0];
    expect(before?.summary.passes).toBe(false);
    expect(before?.summary.errors).toBeGreaterThan(0);

    // After: fixed.
    const led = useLabStore.getState().design.components.find((c) => c.kind === 'led');
    useLabStore.getState().rotateComponent(led!.id, 180);
    useLabStore.getState().runSimulation();
    const after = useLabStore.getState().versions[0];

    expect(after?.summary.passes).toBe(true);
    expect(after?.summary.errors).toBe(0);
    expect(after?.summary.supplyCurrentA).toBeCloseTo(3 / 330, 6);
    // The compare screen defaults to newest vs previous.
    expect(useLabStore.getState().compareRightId).toBe(after?.id);
  });

  it('restores a version faithfully', () => {
    useLabStore.getState().loadStarterCircuit();
    useLabStore.getState().runSimulation();
    const good = useLabStore.getState().versions[0];

    useLabStore.getState().resetBench();
    expect(useLabStore.getState().design.components).toHaveLength(0);

    useLabStore.getState().restoreVersion(good!.id);
    expect(useLabStore.getState().design.components).toHaveLength(3);

    // Restoring does not assert correctness; the student must re-run.
    expect(useLabStore.getState().report).toBeNull();
    useLabStore.getState().runSimulation();
    expect(useLabStore.getState().report?.validation.passes).toBe(true);
  });
});

describe('undo / redo', () => {
  it('reverses and replays edits', () => {
    useLabStore.getState().placeBenchComponent('dc_source', [0, 0, 1.75]);
    useLabStore.getState().placeComponent('resistor', 'E', 5);
    expect(useLabStore.getState().design.components).toHaveLength(2);

    useLabStore.getState().undo();
    expect(useLabStore.getState().design.components).toHaveLength(1);
    useLabStore.getState().undo();
    expect(useLabStore.getState().design.components).toHaveLength(0);

    useLabStore.getState().redo();
    expect(useLabStore.getState().design.components).toHaveLength(1);
    useLabStore.getState().redo();
    expect(useLabStore.getState().design.components).toHaveLength(2);
  });

  it('undoes a value change', () => {
    useLabStore.getState().placeComponent('resistor', 'E', 5);
    const id = useLabStore.getState().design.components[0]!.id;
    useLabStore.getState().setComponentValue(id, 1000);
    expect(useLabStore.getState().design.components[0]?.value).toBe(1000);
    useLabStore.getState().undo();
    expect(useLabStore.getState().design.components[0]?.value).toBe(330);
  });

  it('is a no-op at the ends of the stack', () => {
    useLabStore.getState().undo();
    useLabStore.getState().redo();
    expect(useLabStore.getState().design.components).toHaveLength(0);
  });

  it('removes wires attached to a deleted component', () => {
    useLabStore.getState().placeBenchComponent('dc_source', [0, 0, 1.75]);
    const v1 = useLabStore.getState().design.components[0]!;
    useLabStore.getState().beginWire({ kind: 'pin', componentId: v1.id, pinId: 'pos' });
    useLabStore.getState().completeWire({ kind: 'hole', hole: 'TP10' });
    expect(useLabStore.getState().design.wires).toHaveLength(1);

    useLabStore.getState().deleteComponent(v1.id);
    expect(useLabStore.getState().design.wires).toHaveLength(0);
  });
});

describe('SPICE netlist export', () => {
  it('exports a netlist with ground at node 0 and a diode model', () => {
    useLabStore.getState().loadStarterCircuit();
    const text = toSpiceNetlist(useLabStore.getState().design, 'test');
    expect(text).toContain('.model DLED D(');
    expect(text).toContain('.op');
    expect(text).toContain('.end');
    // The supply negative becomes SPICE node 0.
    expect(/^V1 \S+ 0 DC 5$/m.test(text)).toBe(true);
    expect(/^R1 \S+ \S+ 330$/m.test(text)).toBe(true);
    expect(/^D1 \S+ 0 DLED$/m.test(text)).toBe(true);
  });

  it('generating a netlist is not the same as running SPICE', () => {
    // The deterministic engine is what produced the on-screen numbers, and it
    // says so. Nothing in the app labels these results as SPICE output.
    useLabStore.getState().loadStarterCircuit();
    useLabStore.getState().runSimulation();
    expect(useLabStore.getState().engine.kind).toBe('deterministic');
    expect(useLabStore.getState().engine.label).not.toMatch(/spice/i);
    expect(useLabStore.getState().report?.analysis.engine).toBe('deterministic-branch-v1');
  });
});

describe('rotation preserves the holes a part occupies', () => {
  it('a 180 degree turn swaps the LED leads between the same two holes', () => {
    // Regression: rotating about the origin pin used to walk the far lead into
    // a different hole, silently breaking the circuit the student had wired.
    useLabStore.getState().placeComponent('led', 'E', 9);
    const id = useLabStore.getState().design.components[0]!.id;

    const holesOf = (): string[] =>
      resolvePins(useLabStore.getState().design.components.find((c) => c.id === id)!)
        .map((p) => p.hole ?? '?')
        .sort();

    const before = holesOf();
    expect(before).toEqual(['E09', 'E11']);

    useLabStore.getState().rotateComponent(id, 180);
    expect(holesOf()).toEqual(before);

    // The leads have genuinely swapped roles.
    const comp = useLabStore.getState().design.components.find((c) => c.id === id)!;
    const pins = resolvePins(comp);
    expect(pins.find((p) => p.role === 'anode')?.hole).toBe('E11');
    expect(pins.find((p) => p.role === 'cathode')?.hole).toBe('E09');
  });

  it('a 180 degree turn keeps a resistor in the same two holes', () => {
    useLabStore.getState().placeComponent('resistor', 'E', 5);
    const id = useLabStore.getState().design.components[0]!.id;
    const holesOf = (): string[] =>
      resolvePins(useLabStore.getState().design.components.find((c) => c.id === id)!)
        .map((p) => p.hole ?? '?')
        .sort();

    expect(holesOf()).toEqual(['E05', 'E09']);
    useLabStore.getState().rotateComponent(id, 180);
    expect(holesOf()).toEqual(['E05', 'E09']);
  });

  it('a 90 degree turn keeps the part centred on the same midpoint', () => {
    useLabStore.getState().placeComponent('resistor', 'E', 5);
    const id = useLabStore.getState().design.components[0]!.id;
    useLabStore.getState().rotateComponent(id, 90);
    const comp = useLabStore.getState().design.components.find((c) => c.id === id)!;
    const holes = resolvePins(comp).map((p) => p.hole);
    // Centre stays at column 7; the part now straddles the centre channel,
    // which is a legal (and realistic) vertical placement.
    expect(holes).toEqual(['C07', 'G07']);
  });

  it('refuses a rotation that cannot fit anywhere', () => {
    useLabStore.getState().placeComponent('resistor', 'A', 1);
    const id = useLabStore.getState().design.components[0]!.id;
    const rotationBefore = useLabStore.getState().design.components[0]!.rotation;
    useLabStore.getState().rotateComponent(id, 90);
    const after = useLabStore.getState().design.components[0]!;
    // Either it found a legal seat, or it declined and left the part untouched.
    if (after.rotation === rotationBefore) {
      expect(useLabStore.getState().toasts.some((t) => t.kind === 'warning')).toBe(true);
    }
    expect(resolvePins(after).every((p) => !p.offBoard)).toBe(true);
  });
});

describe('working with no Claude credit', () => {
  it('states the correct reason when no key is configured', () => {
    useLabStore.getState().loadFaultyCircuit();
    useLabStore.getState().runSimulation();
    const st = useLabStore.getState();
    const evidence = buildEvidence({
      design: st.design,
      experimentId: st.experimentId,
      workspace: 'circuit',
      engine: st.engine,
      report: st.report,
      pcbResult: null,
    });

    const noKey = localTutorReply({ question: 'q', hintLevel: 2, evidence }).reply;
    expect(noKey).toContain('No API key is configured');
    expect(noKey).not.toContain('could not be reached');
  });

  it('states the correct reason when the API call failed', () => {
    // Regression: the fallback used to claim "no API key is configured" even
    // when a key WAS set and the call had failed (expired credit, 401, outage),
    // which told the student something untrue about their own setup.
    useLabStore.getState().loadFaultyCircuit();
    useLabStore.getState().runSimulation();
    const st = useLabStore.getState();
    const evidence = buildEvidence({
      design: st.design,
      experimentId: st.experimentId,
      workspace: 'circuit',
      engine: st.engine,
      report: st.report,
      pcbResult: null,
    });

    const failed = localTutorReply({
      question: 'q',
      hintLevel: 2,
      evidence,
      reason: 'api-failed',
    }).reply;
    expect(failed).toContain('could not be reached');
    expect(failed).not.toContain('No API key is configured');
  });

  it('still teaches the full lesson with no credit at all', () => {
    // The entire pedagogical loop must work without the Claude API: the
    // analysis is local, and the local tutor covers all three hint levels.
    useLabStore.getState().loadFaultyCircuit();
    useLabStore.getState().runSimulation();
    expect(codes()).toContain('LED_REVERSED');

    const st = useLabStore.getState();
    const evidence = buildEvidence({
      design: st.design,
      experimentId: st.experimentId,
      workspace: 'circuit',
      engine: st.engine,
      report: st.report,
      pcbResult: null,
    });
    for (const level of [1, 2, 3] as const) {
      const r = localTutorReply({ question: 'help', hintLevel: level, evidence });
      expect(r.reply.length).toBeGreaterThan(80);
      expect(r.groundedIn).toEqual(['LED_REVERSED']);
    }

    // And the student can still complete the fix and be told they succeeded.
    const led = useLabStore.getState().design.components.find((c) => c.kind === 'led');
    useLabStore.getState().rotateComponent(led!.id, 180);
    useLabStore.getState().runSimulation();
    expect(useLabStore.getState().report?.validation.passes).toBe(true);
  });
});

describe('reaching the PCB without a hidden step', () => {
  it('derives footprints automatically when entering the PCB view', () => {
    // Regression: the PCB view used to open on an "Empty board" message until
    // the student found the Import button, so the board simply looked absent.
    useLabStore.getState().loadStarterCircuit();
    expect(useLabStore.getState().board.footprints).toHaveLength(0);

    useLabStore.getState().setWorkspace('pcb');

    const board = useLabStore.getState().board;
    expect(board.footprints).toHaveLength(3);
    expect(board.footprints.flatMap((f) => f.pads)).toHaveLength(6);
    expect(board.footprints.every((f) => f.pads.every((p) => p.net !== null))).toBe(true);
  });

  it('does not clobber a layout the student has already arranged', () => {
    useLabStore.getState().loadStarterCircuit();
    useLabStore.getState().setWorkspace('pcb');

    const r1 = useLabStore.getState().board.footprints.find((f) => f.ref === 'R1');
    useLabStore.getState().moveFootprint(r1!.id, 41, 17);

    // Leave and come back: placement must survive.
    useLabStore.getState().setWorkspace('circuit');
    useLabStore.getState().setWorkspace('pcb');

    const again = useLabStore.getState().board.footprints.find((f) => f.ref === 'R1');
    expect(again?.x).toBe(41);
    expect(again?.y).toBe(17);
  });

  it('does nothing when there is no circuit to derive from', () => {
    useLabStore.getState().setWorkspace('pcb');
    expect(useLabStore.getState().board.footprints).toHaveLength(0);
    expect(useLabStore.getState().workspace).toBe('pcb');
  });

  it('keeps the circuit simulation result when entering the PCB view', () => {
    // Switching views is not an edit, so it must not invalidate the analysis.
    useLabStore.getState().loadStarterCircuit();
    useLabStore.getState().runSimulation();
    const before = useLabStore.getState().report?.analysis.supplyCurrentA;

    useLabStore.getState().setWorkspace('pcb');
    expect(useLabStore.getState().report?.analysis.supplyCurrentA).toBe(before);
    expect(useLabStore.getState().board.footprints.length).toBeGreaterThan(0);
  });
});

describe('reference designators are unique', () => {
  it('does not reuse a designator across kinds that share a prefix', () => {
    // Regression: switch and push button both use the SW prefix, and LED,
    // RGB LED and diode all use D. Allocating per-kind handed out two SW1s
    // and three D1s, leaving diagnostics ambiguous about which part they meant.
    const s = useLabStore.getState();
    s.placeComponent('switch', 'E', 2);
    s.placeComponent('pushbutton', 'E', 8);
    s.placeComponent('led', 'G', 2);
    s.placeComponent('rgb_led', 'G', 8);
    s.placeComponent('diode', 'G', 14);

    const labels = useLabStore.getState().design.components.map((c) => c.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toContain('SW1');
    expect(labels).toContain('SW2');
    expect(labels).toContain('D1');
    expect(labels).toContain('D2');
    expect(labels).toContain('D3');
  });

  it('reuses a freed number after a delete', () => {
    const s = useLabStore.getState();
    s.placeComponent('resistor', 'E', 2);
    s.placeComponent('resistor', 'E', 8);
    const r1 = useLabStore.getState().design.components.find((c) => c.label === 'R1');
    useLabStore.getState().deleteComponent(r1!.id);
    useLabStore.getState().placeComponent('resistor', 'E', 14);
    const labels = useLabStore.getState().design.components.map((c) => c.label).sort();
    expect(labels).toEqual(['R1', 'R2']);
  });
});

describe('cable styles', () => {
  it('uses the selected style and colour for new leads', () => {
    const s = useLabStore.getState();
    s.setWireKind('alligator');
    s.setWireColor('#22c55e');
    s.beginWire({ kind: 'hole', hole: 'TP05' });
    s.completeWire({ kind: 'hole', hole: 'TN05' });

    const w = useLabStore.getState().design.wires[0];
    expect(w?.kind).toBe('alligator');
    expect(w?.color).toBe('#22c55e');
  });

  it('treats every cable style as an ideal conductor', () => {
    // The choice of lead must never change the measured result.
    const build = (kind: 'dupont' | 'solid' | 'alligator' | 'banana') => {
      useLabStore.getState().resetBench();
      useLabStore.getState().loadStarterCircuit();
      const api = useLabStore.getState();
      api.setWireKind(kind);
      // Restyle every existing lead, then re-run.
      for (const w of api.design.wires) api.setWireStyle(w.id, { kind });
      useLabStore.getState().runSimulation();
      return useLabStore.getState().report?.analysis.supplyCurrentA ?? -1;
    };

    const results = (['dupont', 'solid', 'alligator', 'banana'] as const).map(build);
    for (const r of results) expect(r).toBeCloseTo(3 / 330, 9);
    expect(new Set(results).size).toBe(1);
  });

  it('restyling a lead does not invalidate the analysis', () => {
    useLabStore.getState().loadStarterCircuit();
    useLabStore.getState().runSimulation();
    const before = useLabStore.getState().report?.analysis.supplyCurrentA;

    const w = useLabStore.getState().design.wires[0];
    useLabStore.getState().setWireStyle(w!.id, { kind: 'solid', color: '#eab308' });

    expect(useLabStore.getState().report?.analysis.supplyCurrentA).toBe(before);
    expect(useLabStore.getState().design.wires[0]?.kind).toBe('solid');
  });
});

describe('the default bench works out of the box', () => {
  // Asserted against the pristine initial document rather than live state, so
  // these verify what a student actually sees on a first visit.
  it('ships a complete circuit and a matching sketch', () => {
    const doc = getInitialDocument();
    expect(doc.design.components.map((c) => c.kind).sort()).toEqual([
      'arduino_uno',
      'led',
      'led',
      'potentiometer',
      'pushbutton',
      'resistor',
      'resistor',
    ]);
    // Every part is wired; nothing is left sitting on the board unconnected.
    expect(doc.design.wires).toHaveLength(11);
    expect(doc.sketch).toContain('pinMode');
    expect(doc.sketch).toContain('digitalWrite');
    expect(doc.sketch).toContain('analogWrite');
    expect(doc.sketch).toContain('analogRead');
    expect(doc.sketch).toContain('digitalRead');
  });

  it('leaves no component stranded off the netlist', async () => {
    const { analyzeCircuit } = await import('@/lib/circuit/solve');
    const doc = getInitialDocument();
    const a = analyzeCircuit(doc.design);
    // A part whose pins share no net with anything else is decoration. The
    // shipped bench used to be exactly that: a drawer of parts dropped on the
    // board, none of them reachable from the sketch.
    for (const c of doc.design.components) {
      if (c.kind === 'arduino_uno') continue;
      const nets = Object.entries(a.netlist.pinNet)
        .filter(([k]) => k.startsWith(`${c.id}.`))
        .map(([, net]) => net);
      expect(nets.length, `${c.label} has no pins`).toBeGreaterThan(0);
      for (const net of nets) {
        const sharers = Object.entries(a.netlist.pinNet).filter(
          ([k, n]) => n === net && !k.startsWith(`${c.id}.`),
        );
        expect(sharers.length, `${c.label} net ${net} connects to nothing`).toBeGreaterThan(0);
      }
    }
  });

  it('runs the sketch and lights the LED with no setup at all', async () => {
    const { runSketch } = await import('@/lib/mcu/interpreter');
    const { analyzeCircuit } = await import('@/lib/circuit/solve');
    const doc = getInitialDocument();

    const run = runSketch(doc.sketch, 'arduino_uno', { loopIterations: 1 });
    expect(run.ok).toBe(true);
    expect(run.errors).toEqual([]);

    // Drive the pins the sketch left HIGH and solve the shipped circuit.
    const withPins = {
      ...doc.design,
      components: doc.design.components.map((c) =>
        c.kind === 'arduino_uno'
          ? { ...c, mcuPins: { d13: { mode: 'output' as const, value: 1 } } }
          : c,
      ),
    };
    const analysis = analyzeCircuit(withPins);
    const led = analysis.measurements.find((m) => m.kind === 'led');
    expect(led?.lit).toBe(true);
    // (5 V - 2.0 V) / (330 + 25 ohm pin impedance)
    expect(led?.currentA).toBeCloseTo(3 / 355, 6);
  });

  it('passes validation with no errors as shipped', async () => {
    const { validateCircuit } = await import('@/lib/circuit/validate');
    const doc = getInitialDocument();
    const withPins = {
      ...doc.design,
      components: doc.design.components.map((c) =>
        c.kind === 'arduino_uno'
          ? { ...c, mcuPins: { d13: { mode: 'output' as const, value: 1 } } }
          : c,
      ),
    };
    const report = validateCircuit(withPins, doc.experimentId);
    const errors = report.validation.diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toEqual([]);
    expect(report.validation.passes).toBe(true);
  });
});
