import { describe, expect, it } from 'vitest';

import { checkPcb } from '../drc';
import { footprintsFromCircuit, ratsnest } from '../footprints';
import { DEFAULT_RULES, type PcbBoard, type PcbTrace } from '../types';
import { padPosition, segmentSegmentDistance, pointSegmentDistance } from '../geometry';
import { goldenLedCircuit } from '../../circuit/__tests__/fixtures';
import type { DiagnosticCode } from '../../circuit/diagnostics';

function codes(list: { code: DiagnosticCode }[]): DiagnosticCode[] {
  return list.map((d) => d.code);
}

function padPos(board: PcbBoard, padId: string): { x: number; y: number } {
  for (const fp of board.footprints) {
    const pad = fp.pads.find((p) => p.id === padId);
    if (pad) return padPosition(fp, pad);
  }
  throw new Error(`pad ${padId} not found`);
}

function trace(
  id: string,
  board: PcbBoard,
  startPadId: string,
  endPadId: string,
  width = 0.4,
): PcbTrace {
  return {
    id,
    layer: 'top',
    points: [padPos(board, startPadId), padPos(board, endPadId)],
    width,
    startPadId,
    endPadId,
  };
}

/** Lay the three footprints out in a clear row so geometry checks are stable. */
function spacedBoard(): PcbBoard {
  const board = footprintsFromCircuit(goldenLedCircuit());
  const positions: Record<string, { x: number; y: number }> = {
    V1: { x: 12, y: 20 },
    R1: { x: 30, y: 20 },
    D1: { x: 46, y: 20 },
  };
  for (const fp of board.footprints) {
    const p = positions[fp.ref];
    if (p) {
      fp.x = p.x;
      fp.y = p.y;
    }
  }
  return board;
}

describe('footprint derivation from the circuit', () => {
  it('creates one footprint per placeable component, carrying net names', () => {
    const board = footprintsFromCircuit(goldenLedCircuit());
    expect(board.footprints.map((f) => f.ref).sort()).toEqual(['D1', 'R1', 'V1']);

    const d1 = board.footprints.find((f) => f.ref === 'D1');
    const anode = d1?.pads.find((p) => p.pinId === 'a');
    const cathode = d1?.pads.find((p) => p.pinId === 'k');
    // Both LED pads inherit real nets from the circuit netlist.
    expect(anode?.net).toBeTruthy();
    expect(cathode?.net).toBe('RAIL_TN');
    // The anode pad is square, marking polarity on the silkscreen.
    expect(anode?.shape).toBe('square');
  });

  it('uses the real 2.54 mm LED lead pitch', () => {
    const board = footprintsFromCircuit(goldenLedCircuit());
    const d1 = board.footprints.find((f) => f.ref === 'D1');
    const pads = d1?.pads ?? [];
    expect(Math.abs((pads[1]?.dx ?? 0) - (pads[0]?.dx ?? 0))).toBeCloseTo(2.54, 6);
  });

  it('builds a ratsnest only for nets with two or more pads', () => {
    const nets = ratsnest(footprintsFromCircuit(goldenLedCircuit()));
    expect(nets.length).toBeGreaterThan(0);
    for (const n of nets) expect(n.padIds.length).toBeGreaterThanOrEqual(2);
  });

  it('preserves student placement when re-importing', () => {
    const first = spacedBoard();
    const again = footprintsFromCircuit(goldenLedCircuit(), first);
    const r1 = again.footprints.find((f) => f.ref === 'R1');
    expect(r1?.x).toBe(30);
    expect(r1?.y).toBe(20);
  });
});

describe('empty board', () => {
  it('reports no footprints rather than passing', () => {
    const result = checkPcb({ width: 60, height: 40, footprints: [], traces: [] });
    expect(result.passes).toBe(false);
    expect(codes(result.diagnostics)).toContain('PCB_NO_FOOTPRINTS');
  });
});

describe('connectivity checks', () => {
  it('flags every net as unrouted when there are no traces', () => {
    const board = spacedBoard();
    const result = checkPcb(board);
    expect(result.passes).toBe(false);
    expect(codes(result.diagnostics)).toContain('PCB_MISSING_TRACE');
    expect(result.stats.netsFullyRouted).toBe(0);
  });

  it('flags a net that is only partly routed', () => {
    // Build a net with three pads and route only two of them.
    const board = spacedBoard();
    const v1 = board.footprints.find((f) => f.ref === 'V1');
    const r1 = board.footprints.find((f) => f.ref === 'R1');
    const d1 = board.footprints.find((f) => f.ref === 'D1');
    if (!v1 || !r1 || !d1) throw new Error('fixture');

    // Force three pads onto one shared net.
    const shared = 'NSHARED';
    (v1.pads[0] as { net: string | null }).net = shared;
    (r1.pads[0] as { net: string | null }).net = shared;
    (d1.pads[0] as { net: string | null }).net = shared;

    board.traces = [trace('T1', board, v1.pads[0]!.id, r1.pads[0]!.id)];
    const result = checkPcb(board);
    const diag = result.diagnostics.find((x) => x.code === 'PCB_NET_UNCONNECTED');
    expect(diag).toBeDefined();
    expect(diag?.evidence?.islands).toBe(2);
  });

  it('passes once every net is fully routed', () => {
    const board = spacedBoard();
    const byRef = (ref: string) => board.footprints.find((f) => f.ref === ref);
    const v1 = byRef('V1');
    const r1 = byRef('R1');
    const d1 = byRef('D1');
    if (!v1 || !r1 || !d1) throw new Error('fixture');

    const v1pos = v1.pads.find((p) => p.pinId === 'pos')!;
    const v1neg = v1.pads.find((p) => p.pinId === 'neg')!;
    const r1a = r1.pads.find((p) => p.number === '1')!;
    const r1b = r1.pads.find((p) => p.number === '2')!;
    const anode = d1.pads.find((p) => p.pinId === 'a')!;
    const cathode = d1.pads.find((p) => p.pinId === 'k')!;

    // Route the three nets of the series circuit by hand, exactly as a student
    // would: the two rail nets detour around the parts so that no trace crosses
    // another net's copper, and the N1 link runs straight between R1 and D1.
    const t1 = trace('T1', board, v1pos.id, r1a.id);
    const t1a = padPos(board, v1pos.id);
    const t1b = padPos(board, r1a.id);
    // RAIL_TP routes above the parts.
    t1.points = [t1a, { x: t1a.x, y: 6 }, { x: t1b.x, y: 6 }, t1b];

    const t2 = trace('T2', board, r1b.id, anode.id);

    const t3 = trace('T3', board, cathode.id, v1neg.id);
    const t3a = padPos(board, cathode.id);
    const t3b = padPos(board, v1neg.id);
    // RAIL_TN routes below the parts, so it never meets RAIL_TP.
    t3.points = [t3a, { x: t3a.x, y: 35 }, { x: t3b.x, y: 35 }, t3b];

    board.traces = [t1, t2, t3];

    const result = checkPcb(board);
    expect(result.diagnostics.filter((x) => x.severity === 'error')).toHaveLength(0);
    expect(result.passes).toBe(true);
    expect(codes(result.diagnostics)).toContain('PCB_VALID');
    expect(result.stats.netsFullyRouted).toBe(result.stats.nets);
  });
});

describe('correctness checks', () => {
  it('detects a trace joining two different nets', () => {
    const board = spacedBoard();
    const r1 = board.footprints.find((f) => f.ref === 'R1')!;
    const d1 = board.footprints.find((f) => f.ref === 'D1')!;
    const r1a = r1.pads.find((p) => p.number === '1')!;
    const cathode = d1.pads.find((p) => p.pinId === 'k')!;
    expect(r1a.net).not.toBe(cathode.net);

    board.traces = [trace('TBAD', board, r1a.id, cathode.id)];
    const result = checkPcb(board);
    const diag = result.diagnostics.find((x) => x.code === 'PCB_WRONG_CONNECTION');
    expect(diag).toBeDefined();
    expect(diag?.severity).toBe('error');
    expect(diag?.evidence?.fromNet).toBe(r1a.net);
    expect(diag?.evidence?.toNet).toBe(cathode.net);
  });

  it('warns about a trace that stops in free copper', () => {
    const board = spacedBoard();
    const r1 = board.footprints.find((f) => f.ref === 'R1')!;
    board.traces = [
      {
        id: 'TDANGLE',
        layer: 'top',
        points: [padPos(board, r1.pads[0]!.id), { x: 24, y: 30 }],
        width: 0.4,
        startPadId: r1.pads[0]!.id,
        endPadId: null,
      },
    ];
    const result = checkPcb(board);
    const diag = result.diagnostics.find((x) => x.code === 'PCB_MISSING_TRACE' && x.evidence?.trace === 'TDANGLE');
    expect(diag).toBeDefined();
    expect(diag?.evidence?.danglingEnds).toBe('end');
  });
});

describe('clearance checks', () => {
  it('detects two crossing traces on the same layer', () => {
    const board = spacedBoard();
    const v1 = board.footprints.find((f) => f.ref === 'V1')!;
    const d1 = board.footprints.find((f) => f.ref === 'D1')!;
    board.traces = [
      {
        id: 'TA',
        layer: 'top',
        points: [
          { x: 20, y: 25 },
          { x: 40, y: 32 },
        ],
        width: 0.4,
        startPadId: v1.pads[0]!.id,
        endPadId: null,
      },
      {
        id: 'TB',
        layer: 'top',
        points: [
          { x: 20, y: 32 },
          { x: 40, y: 25 },
        ],
        width: 0.4,
        startPadId: d1.pads[0]!.id,
        endPadId: null,
      },
    ];
    const result = checkPcb(board);
    const diag = result.diagnostics.find((x) => x.code === 'PCB_CLEARANCE');
    expect(diag).toBeDefined();
    expect(diag?.severity).toBe('error');
    expect(diag?.evidence?.measuredMm).toBe(0);
  });

  it('allows crossings on opposite layers', () => {
    const board = spacedBoard();
    const v1 = board.footprints.find((f) => f.ref === 'V1')!;
    const d1 = board.footprints.find((f) => f.ref === 'D1')!;
    board.traces = [
      {
        id: 'TA',
        layer: 'top',
        points: [
          { x: 20, y: 25 },
          { x: 40, y: 32 },
        ],
        width: 0.4,
        startPadId: v1.pads[0]!.id,
        endPadId: null,
      },
      {
        id: 'TB',
        layer: 'bottom',
        points: [
          { x: 20, y: 32 },
          { x: 40, y: 25 },
        ],
        width: 0.4,
        startPadId: d1.pads[0]!.id,
        endPadId: null,
      },
    ];
    const result = checkPcb(board);
    const crossing = result.diagnostics.filter(
      (x) => x.code === 'PCB_CLEARANCE' && x.evidence?.measuredMm === 0,
    );
    expect(crossing).toHaveLength(0);
  });

  it('flags a near-miss that is inside the clearance rule', () => {
    const board = spacedBoard();
    const v1 = board.footprints.find((f) => f.ref === 'V1')!;
    const d1 = board.footprints.find((f) => f.ref === 'D1')!;
    // Two parallel traces 0.3 mm apart: with 0.4 mm widths the required gap is
    // 0.25 + 0.2 + 0.2 = 0.65 mm, so 0.3 mm is a violation.
    board.traces = [
      {
        id: 'TA',
        layer: 'top',
        points: [
          { x: 20, y: 30.0 },
          { x: 40, y: 30.0 },
        ],
        width: 0.4,
        startPadId: v1.pads[0]!.id,
        endPadId: null,
      },
      {
        id: 'TB',
        layer: 'top',
        points: [
          { x: 20, y: 30.3 },
          { x: 40, y: 30.3 },
        ],
        width: 0.4,
        startPadId: d1.pads[0]!.id,
        endPadId: null,
      },
    ];
    const result = checkPcb(board);
    const diag = result.diagnostics.find(
      (x) => x.code === 'PCB_CLEARANCE' && x.evidence?.traceA === 'TA',
    );
    expect(diag).toBeDefined();
    expect(Number(diag?.evidence?.measuredMm)).toBeCloseTo(0.3, 3);
    expect(Number(diag?.evidence?.requiredMm)).toBeCloseTo(0.65, 3);
  });

  it('exempts traces on the same net', () => {
    const board = spacedBoard();
    const v1 = board.footprints.find((f) => f.ref === 'V1')!;
    const pad = v1.pads[0]!;
    board.traces = [
      {
        id: 'TA',
        layer: 'top',
        points: [
          { x: 20, y: 30.0 },
          { x: 40, y: 30.0 },
        ],
        width: 0.4,
        startPadId: pad.id,
        endPadId: null,
      },
      {
        id: 'TB',
        layer: 'top',
        points: [
          { x: 20, y: 30.1 },
          { x: 40, y: 30.1 },
        ],
        width: 0.4,
        startPadId: pad.id,
        endPadId: null,
      },
    ];
    const result = checkPcb(board);
    const between = result.diagnostics.filter(
      (x) => x.code === 'PCB_CLEARANCE' && x.evidence?.traceA === 'TA' && x.evidence?.traceB === 'TB',
    );
    expect(between).toHaveLength(0);
  });

  it('flags a trace running too close to a foreign pad', () => {
    const board = spacedBoard();
    const r1 = board.footprints.find((f) => f.ref === 'R1')!;
    const d1 = board.footprints.find((f) => f.ref === 'D1')!;
    const foreign = d1.pads.find((p) => p.pinId === 'k')!;
    const pos = padPos(board, foreign.id);
    board.traces = [
      {
        id: 'TNEAR',
        layer: 'top',
        points: [
          { x: pos.x - 5, y: pos.y + 0.2 },
          { x: pos.x + 5, y: pos.y + 0.2 },
        ],
        width: 0.4,
        startPadId: r1.pads[0]!.id,
        endPadId: null,
      },
    ];
    const result = checkPcb(board);
    const diag = result.diagnostics.find(
      (x) => x.code === 'PCB_CLEARANCE' && x.evidence?.pad === 'D1.2',
    );
    expect(diag).toBeDefined();
    expect(diag?.severity).toBe('error');
  });

  it('warns about a trace below the minimum width', () => {
    const board = spacedBoard();
    const r1 = board.footprints.find((f) => f.ref === 'R1')!;
    board.traces = [
      {
        id: 'TTHIN',
        layer: 'top',
        points: [
          { x: 20, y: 35 },
          { x: 30, y: 35 },
        ],
        width: 0.1,
        startPadId: r1.pads[0]!.id,
        endPadId: null,
      },
    ];
    const result = checkPcb(board);
    const diag = result.diagnostics.find((x) => x.evidence?.trace === 'TTHIN' && x.code === 'PCB_CLEARANCE');
    expect(diag).toBeDefined();
    expect(diag?.evidence?.minWidthMm).toBe(DEFAULT_RULES.minTraceWidth);
  });
});

describe('placement checks', () => {
  it('detects overlapping footprints', () => {
    const board = spacedBoard();
    const r1 = board.footprints.find((f) => f.ref === 'R1')!;
    const d1 = board.footprints.find((f) => f.ref === 'D1')!;
    d1.x = r1.x;
    d1.y = r1.y;
    const result = checkPcb(board);
    const diag = result.diagnostics.find((x) => x.code === 'PCB_FOOTPRINT_OVERLAP');
    expect(diag).toBeDefined();
    expect(diag?.severity).toBe('error');
  });

  it('detects a trace that leaves the board outline', () => {
    const board = spacedBoard();
    const r1 = board.footprints.find((f) => f.ref === 'R1')!;
    board.traces = [
      {
        id: 'TOUT',
        layer: 'top',
        points: [
          { x: 20, y: 20 },
          { x: board.width + 10, y: 20 },
        ],
        width: 0.4,
        startPadId: r1.pads[0]!.id,
        endPadId: null,
      },
    ];
    const result = checkPcb(board);
    expect(codes(result.diagnostics)).toContain('PCB_TRACE_OFF_BOARD');
  });
});

describe('geometry primitives', () => {
  it('measures parallel segment distance', () => {
    const d = segmentSegmentDistance({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 2 }, { x: 10, y: 2 });
    expect(d).toBeCloseTo(2, 9);
  });

  it('returns zero for intersecting segments', () => {
    const d = segmentSegmentDistance({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 });
    expect(d).toBe(0);
  });

  it('measures point-to-segment distance including endpoints', () => {
    expect(pointSegmentDistance({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(3, 9);
    expect(pointSegmentDistance({ x: -4, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(4, 9);
  });

  it('rotates pad positions about the footprint origin', () => {
    const board = spacedBoard();
    const r1 = board.footprints.find((f) => f.ref === 'R1')!;
    const before = padPosition(r1, r1.pads[0]!);
    r1.rotation = 90;
    const after = padPosition(r1, r1.pads[0]!);
    expect(after.x).toBeCloseTo(r1.x, 6);
    expect(after.y).toBeCloseTo(r1.y - 3.81, 6);
    expect(before.y).toBeCloseTo(r1.y, 6);
  });
});
