import type { Diagnostic } from '../circuit/diagnostics';
import { hasErrors, sortDiagnostics } from '../circuit/diagnostics';
import {
  boxesOverlap,
  courtyardBox,
  distance,
  padPosition,
  pointSegmentDistance,
  segmentSegmentDistance,
  traceSegments,
  type Point,
} from './geometry';
import { DEFAULT_RULES, type PcbBoard, type PcbDesignRules, type PcbPad, type PcbFootprint } from './types';

export interface PcbCheckResult {
  diagnostics: Diagnostic[];
  passes: boolean;
  rules: PcbDesignRules;
  stats: {
    footprints: number;
    pads: number;
    traces: number;
    nets: number;
    netsFullyRouted: number;
  };
  checkedAt: string;
}

/**
 * Simplified educational PCB checker.
 *
 * ## This is NOT a KiCad-certified DRC.
 * It implements four explicit rule families only:
 *
 *  1. **Connectivity** — every net with two or more pads must have all of its
 *     pads joined into a single group by traces (union-find over trace ends).
 *  2. **Correctness** — a trace must not join pads belonging to different nets.
 *  3. **Clearance** — copper-to-copper spacing, checked as
 *     segment-to-segment and segment-to-pad distance against `rules.clearance`.
 *     Segments of the same net are exempt.
 *  4. **Placement** — footprint courtyards must not overlap, and traces must
 *     stay inside the board outline.
 *
 * Not implemented (and therefore never claimed): annular ring and drill checks,
 * via/stackup rules, thermal relief, impedance, silkscreen-over-pad, solder-mask
 * slivers, acid traps, differential pairs, or manufacturer capability profiles.
 * See README "Path to KiCad DRC" for how this maps onto the real thing.
 */
export function checkPcb(board: PcbBoard, rules: PcbDesignRules = DEFAULT_RULES): PcbCheckResult {
  const d: Diagnostic[] = [];

  interface PadRef {
    pad: PcbPad;
    fp: PcbFootprint;
    pos: Point;
  }

  const padRefs: PadRef[] = [];
  for (const fp of board.footprints) {
    for (const pad of fp.pads) padRefs.push({ pad, fp, pos: padPosition(fp, pad) });
  }
  const padById = new Map(padRefs.map((p) => [p.pad.id, p]));

  /* ---------- 0. nothing to check ---------- */
  if (board.footprints.length === 0) {
    d.push({
      code: 'PCB_NO_FOOTPRINTS',
      severity: 'error',
      title: 'No footprints on the board',
      detail:
        'The PCB workspace derives footprints from the components in your circuit. Place the circuit ' +
        'components first, then import them onto the board.',
      evidence: { footprints: 0 },
    });
    return {
      diagnostics: d,
      passes: false,
      rules,
      stats: { footprints: 0, pads: 0, traces: 0, nets: 0, netsFullyRouted: 0 },
      checkedAt: new Date().toISOString(),
    };
  }

  /* ---------- 1. group pads by net ---------- */
  const netPads = new Map<string, PadRef[]>();
  for (const ref of padRefs) {
    if (!ref.pad.net) continue;
    const arr = netPads.get(ref.pad.net);
    if (arr) arr.push(ref);
    else netPads.set(ref.pad.net, [ref]);
  }

  /* ---------- 2. wrong-net traces ---------- */
  for (const trace of board.traces) {
    const a = trace.startPadId ? padById.get(trace.startPadId) : undefined;
    const b = trace.endPadId ? padById.get(trace.endPadId) : undefined;
    if (!a || !b) continue;
    if (a.pad.net && b.pad.net && a.pad.net !== b.pad.net) {
      d.push({
        code: 'PCB_WRONG_CONNECTION',
        severity: 'error',
        title: `Trace shorts net ${a.pad.net} to net ${b.pad.net}`,
        detail:
          `A trace runs from ${a.fp.ref} pad ${a.pad.number} (net ${a.pad.net}) to ${b.fp.ref} ` +
          `pad ${b.pad.number} (net ${b.pad.net}). Those pads are on different nets in your circuit, ` +
          'so this trace is a short circuit on the finished board.',
        evidence: {
          trace: trace.id,
          fromPad: `${a.fp.ref}.${a.pad.number}`,
          fromNet: a.pad.net,
          toPad: `${b.fp.ref}.${b.pad.number}`,
          toNet: b.pad.net,
        },
        target: { traceIds: [trace.id], padIds: [a.pad.id, b.pad.id] },
      });
    }
  }

  /* ---------- 3. connectivity per net ---------- */
  let netsFullyRouted = 0;
  for (const [net, pads] of netPads) {
    if (pads.length < 2) {
      netsFullyRouted += 1; // a single-pad net needs no routing
      continue;
    }

    // Union-find over pads, joined by traces whose two ends land on pads.
    const parent = new Map<string, string>(pads.map((p) => [p.pad.id, p.pad.id]));
    const find = (k: string): string => {
      let root = k;
      while (parent.get(root) !== root) root = parent.get(root) as string;
      return root;
    };
    const union = (x: string, y: string): void => {
      const rx = find(x);
      const ry = find(y);
      if (rx !== ry) parent.set(rx, ry);
    };

    const netTraces = board.traces.filter((t) => {
      const a = t.startPadId ? padById.get(t.startPadId) : undefined;
      const b = t.endPadId ? padById.get(t.endPadId) : undefined;
      return (a?.pad.net === net && b?.pad.net === net) || a?.pad.net === net || b?.pad.net === net;
    });

    for (const t of netTraces) {
      if (!t.startPadId || !t.endPadId) continue;
      const a = padById.get(t.startPadId);
      const b = padById.get(t.endPadId);
      if (a?.pad.net === net && b?.pad.net === net) union(a.pad.id, b.pad.id);
    }

    const groups = new Set(pads.map((p) => find(p.pad.id)));

    if (netTraces.length === 0) {
      d.push({
        code: 'PCB_MISSING_TRACE',
        severity: 'error',
        title: `Net ${net} has no traces at all`,
        detail:
          `Net ${net} connects ${pads.length} pads (${pads
            .map((p) => `${p.fp.ref}.${p.pad.number}`)
            .join(', ')}) but nothing routes between them. On a bare board these pads are electrically ` +
          'separate — the net exists in the schematic only.',
        evidence: {
          net,
          padCount: pads.length,
          pads: pads.map((p) => `${p.fp.ref}.${p.pad.number}`).join(', '),
          traces: 0,
        },
        target: { netNames: [net], padIds: pads.map((p) => p.pad.id) },
      });
    } else if (groups.size > 1) {
      d.push({
        code: 'PCB_NET_UNCONNECTED',
        severity: 'error',
        title: `Net ${net} is only partly routed`,
        detail:
          `Net ${net} splits into ${groups.size} separate copper islands. Every pad on a net must be ` +
          `reachable from every other pad through copper. Pads on this net: ${pads
            .map((p) => `${p.fp.ref}.${p.pad.number}`)
            .join(', ')}.`,
        evidence: { net, islands: groups.size, padCount: pads.length, traces: netTraces.length },
        target: { netNames: [net], padIds: pads.map((p) => p.pad.id) },
      });
    } else {
      netsFullyRouted += 1;
    }
  }

  /* ---------- 4. dangling trace ends ---------- */
  for (const trace of board.traces) {
    const ends: Array<'start' | 'end'> = [];
    if (!trace.startPadId) ends.push('start');
    if (!trace.endPadId) ends.push('end');
    if (ends.length === 0) continue;
    d.push({
      code: 'PCB_MISSING_TRACE',
      severity: 'warning',
      title: `Trace ${trace.id} has a dangling ${ends.join(' and ')}`,
      detail:
        `This trace does not land on a pad at its ${ends.join(' or ')}. A trace that stops in free ` +
        'copper connects nothing. Delete it or extend it to a pad.',
      evidence: { trace: trace.id, danglingEnds: ends.join(',') },
      target: { traceIds: [trace.id] },
    });
  }

  /* ---------- 5. trace width ---------- */
  for (const trace of board.traces) {
    if (trace.width >= rules.minTraceWidth) continue;
    d.push({
      code: 'PCB_CLEARANCE',
      severity: 'warning',
      title: `Trace ${trace.id} is narrower than the minimum width`,
      detail: `Width ${trace.width.toFixed(2)} mm is below the ${rules.minTraceWidth.toFixed(
        2,
      )} mm minimum in these simplified rules.`,
      evidence: { trace: trace.id, widthMm: trace.width, minWidthMm: rules.minTraceWidth },
      target: { traceIds: [trace.id] },
    });
  }

  /* ---------- 6. clearance: trace vs trace ---------- */
  const reported = new Set<string>();
  for (let i = 0; i < board.traces.length; i++) {
    for (let j = i + 1; j < board.traces.length; j++) {
      const t1 = board.traces[i];
      const t2 = board.traces[j];
      if (!t1 || !t2) continue;
      if (t1.layer !== t2.layer) continue;
      const n1 = t1.startPadId ? padById.get(t1.startPadId)?.pad.net : null;
      const n2 = t2.startPadId ? padById.get(t2.startPadId)?.pad.net : null;
      if (n1 && n2 && n1 === n2) continue; // same net may touch

      const required = rules.clearance + t1.width / 2 + t2.width / 2;
      let worst = Infinity;
      for (const [a1, a2] of traceSegments(t1)) {
        for (const [b1, b2] of traceSegments(t2)) {
          worst = Math.min(worst, segmentSegmentDistance(a1, a2, b1, b2));
        }
      }
      if (worst < required) {
        const key = `${t1.id}|${t2.id}`;
        if (reported.has(key)) continue;
        reported.add(key);
        d.push({
          code: 'PCB_CLEARANCE',
          severity: worst === 0 ? 'error' : 'warning',
          title:
            worst === 0
              ? `Traces ${t1.id} and ${t2.id} cross on the same layer`
              : `Clearance violation between traces ${t1.id} and ${t2.id}`,
          detail:
            worst === 0
              ? `These two traces are on the ${t1.layer} layer and physically cross, so they would be ` +
                'shorted together in copper. Route one around the other, or move it to the other layer.'
              : `Copper-to-copper gap is ${worst.toFixed(2)} mm; the rule requires ${required.toFixed(
                  2,
                )} mm (${rules.clearance.toFixed(2)} mm clearance plus half of each trace width).`,
          evidence: {
            traceA: t1.id,
            traceB: t2.id,
            measuredMm: Number(worst.toFixed(3)),
            requiredMm: Number(required.toFixed(3)),
            layer: t1.layer,
          },
          target: { traceIds: [t1.id, t2.id] },
        });
      }
    }
  }

  /* ---------- 7. clearance: trace vs foreign pad ---------- */
  for (const trace of board.traces) {
    const traceNet =
      (trace.startPadId ? padById.get(trace.startPadId)?.pad.net : null) ??
      (trace.endPadId ? padById.get(trace.endPadId)?.pad.net : null) ??
      null;
    for (const ref of padRefs) {
      if (ref.pad.net && traceNet && ref.pad.net === traceNet) continue;
      if (trace.startPadId === ref.pad.id || trace.endPadId === ref.pad.id) continue;
      const required = rules.clearance + trace.width / 2 + ref.pad.size / 2;
      let worst = Infinity;
      for (const [a, b] of traceSegments(trace)) {
        worst = Math.min(worst, pointSegmentDistance(ref.pos, a, b));
      }
      if (worst < required) {
        d.push({
          code: 'PCB_CLEARANCE',
          severity: 'error',
          title: `Trace ${trace.id} runs too close to ${ref.fp.ref} pad ${ref.pad.number}`,
          detail:
            `The gap is ${worst.toFixed(2)} mm but the rule requires ${required.toFixed(2)} mm. ` +
            `That pad is on net ${ref.pad.net ?? 'unassigned'}, so touching it would short two nets ` +
            'together.',
          evidence: {
            trace: trace.id,
            pad: `${ref.fp.ref}.${ref.pad.number}`,
            padNet: ref.pad.net ?? 'unassigned',
            measuredMm: Number(worst.toFixed(3)),
            requiredMm: Number(required.toFixed(3)),
          },
          target: { traceIds: [trace.id], padIds: [ref.pad.id] },
        });
      }
    }
  }

  /* ---------- 8. footprint courtyard overlap ---------- */
  for (let i = 0; i < board.footprints.length; i++) {
    for (let j = i + 1; j < board.footprints.length; j++) {
      const a = board.footprints[i];
      const b = board.footprints[j];
      if (!a || !b) continue;
      if (boxesOverlap(courtyardBox(a), courtyardBox(b), rules.courtyardGap)) {
        d.push({
          code: 'PCB_FOOTPRINT_OVERLAP',
          severity: 'error',
          title: `${a.ref} and ${b.ref} overlap`,
          detail:
            `The courtyards of ${a.ref} (${a.name}) and ${b.ref} (${b.name}) are closer than the ` +
            `${rules.courtyardGap.toFixed(2)} mm minimum gap. The parts would physically collide on ` +
            'the assembled board.',
          evidence: {
            refA: a.ref,
            refB: b.ref,
            minGapMm: rules.courtyardGap,
          },
          target: { componentIds: [a.componentId, b.componentId] },
        });
      }
    }
  }

  /* ---------- 9. off-board geometry ---------- */
  for (const trace of board.traces) {
    const outside = trace.points.some(
      (p) => p.x < 0 || p.y < 0 || p.x > board.width || p.y > board.height,
    );
    if (outside) {
      d.push({
        code: 'PCB_TRACE_OFF_BOARD',
        severity: 'error',
        title: `Trace ${trace.id} leaves the board outline`,
        detail: `Part of this trace lies outside the ${board.width} x ${board.height} mm board outline and would be cut off during fabrication.`,
        evidence: { trace: trace.id, boardWidthMm: board.width, boardHeightMm: board.height },
        target: { traceIds: [trace.id] },
      });
    }
  }
  for (const fp of board.footprints) {
    const box = courtyardBox(fp);
    if (box.x < 0 || box.y < 0 || box.x + box.w > board.width || box.y + box.h > board.height) {
      d.push({
        code: 'PCB_TRACE_OFF_BOARD',
        severity: 'error',
        title: `${fp.ref} hangs over the board edge`,
        detail: `${fp.ref}'s courtyard extends past the ${board.width} x ${board.height} mm outline. Move it fully inside the board.`,
        evidence: { ref: fp.ref, boardWidthMm: board.width, boardHeightMm: board.height },
        target: { componentIds: [fp.componentId] },
      });
    }
  }

  /* ---------- 10. unassigned pads ---------- */
  const unassigned = padRefs.filter((p) => !p.pad.net);
  if (unassigned.length > 0) {
    d.push({
      code: 'PCB_NET_UNCONNECTED',
      severity: 'info',
      title: `${unassigned.length} pad${unassigned.length === 1 ? '' : 's'} have no net assigned`,
      detail:
        `These pads have no net because the matching pin is unconnected in your circuit: ` +
        `${unassigned.map((p) => `${p.fp.ref}.${p.pad.number}`).join(', ')}. Fix the circuit wiring ` +
        'first, then re-import the footprints.',
      evidence: { count: unassigned.length },
      target: { padIds: unassigned.map((p) => p.pad.id) },
    });
  }

  /* ---------- 11. pass ---------- */
  const stats = {
    footprints: board.footprints.length,
    pads: padRefs.length,
    traces: board.traces.length,
    nets: netPads.size,
    netsFullyRouted,
  };

  const errorsFound = hasErrors(d);
  if (!errorsFound && netPads.size > 0 && netsFullyRouted === netPads.size) {
    const totalLength = board.traces.reduce(
      (sum, t) => sum + traceSegments(t).reduce((s, [a, b]) => s + distance(a, b), 0),
      0,
    );
    d.push({
      code: 'PCB_VALID',
      severity: 'pass',
      title: 'Board passes the simplified checks',
      detail:
        `All ${netPads.size} nets are fully routed across ${board.traces.length} traces ` +
        `(${totalLength.toFixed(1)} mm of copper), with no clearance or placement violations under ` +
        'these simplified rules. This is not a substitute for a manufacturer DRC.',
      evidence: {
        nets: netPads.size,
        traces: board.traces.length,
        copperLengthMm: Number(totalLength.toFixed(2)),
        clearanceRuleMm: rules.clearance,
      },
    });
  }

  return {
    diagnostics: sortDiagnostics(d),
    passes: !errorsFound && netPads.size > 0 && netsFullyRouted === netPads.size,
    rules,
    stats,
    checkedAt: new Date().toISOString(),
  };
}
