import { RED_LED, defOf } from '../circuit/componentDefs';
import { netNameOfPin, resolvePins } from '../circuit/graph';
import { experimentById } from '../circuit/experiments';
import type { CircuitDesign } from '../circuit/types';
import type { SimulationReport } from '../circuit/validate';
import type { PcbCheckResult } from '../pcb/drc';
import type { EngineDescriptor } from '../sim/adapter';
import { isMcu } from '../circuit/solve';
import type { SketchRunResult } from '../mcu/interpreter';
import { formatFarads, formatOhms, formatVolts } from '../format';
import type { TutorEvidence } from './types';

/**
 * Assemble the evidence packet handed to the AI tutor.
 *
 * This is the *only* channel through which the tutor learns about the student's
 * work. It contains no free text written by a model — every field comes from the
 * circuit graph or a deterministic engine.
 */
export function buildEvidence(args: {
  design: CircuitDesign;
  experimentId: string;
  workspace: 'circuit' | 'code' | 'pcb';
  engine: EngineDescriptor;
  report: SimulationReport | null;
  pcbResult: PcbCheckResult | null;
  sketch?: string;
  codeResult?: SketchRunResult | null;
}): TutorEvidence {
  const { design, experimentId, workspace, engine, report, pcbResult, sketch, codeResult } = args;
  const mcu = design.components.find((c) => isMcu(c.kind));
  const experiment = experimentById(experimentId);
  const netlist = report?.analysis.netlist ?? null;

  const valueText = (kind: string, value: number): string => {
    if (kind === 'resistor') return formatOhms(value);
    if (kind === 'capacitor') return formatFarads(value);
    if (kind === 'dc_source' || kind === 'led') return formatVolts(value);
    return String(value);
  };

  const components = design.components
    .filter((c) => c.kind !== 'breadboard')
    .map((c) => {
      const def = defOf(c.kind);
      const pins = resolvePins(c).map((p) => ({
        pin: p.label,
        role: p.role,
        hole: p.hole,
        net: netlist ? netNameOfPin(netlist, c.id, p.pinId) : 'unknown',
      }));
      return {
        id: c.id,
        ref: c.label,
        kind: def.name,
        value: valueText(c.kind, c.value),
        seat: c.seat ? `${c.seat.row}${String(c.seat.col).padStart(2, '0')}` : null,
        rotation: c.rotation,
        pins,
      };
    });

  const describeEndpoint = (e: CircuitDesign['wires'][number]['a']): string => {
    if (e.kind === 'hole') return `hole ${e.hole}`;
    const comp = design.components.find((c) => c.id === e.componentId);
    const def = comp ? defOf(comp.kind) : null;
    const pin = def?.pins.find((p) => p.id === e.pinId);
    return `${comp?.label ?? e.componentId} pin ${pin?.label ?? e.pinId}`;
  };

  const wires = design.wires.map((w) => ({
    id: w.id,
    from: describeEndpoint(w.a),
    to: describeEndpoint(w.b),
  }));

  const nets = (netlist?.nets ?? []).map((n) => ({
    name: n.name,
    holes: n.holes,
    pins: n.pins.map((p) => {
      const comp = design.components.find((c) => c.id === p.componentId);
      const def = comp ? defOf(comp.kind) : null;
      const pin = def?.pins.find((q) => q.id === p.pinId);
      return `${comp?.label ?? p.componentId}.${pin?.label ?? p.pinId}`;
    }),
  }));

  return {
    experiment: {
      id: experiment.id,
      name: experiment.name,
      summary: experiment.summary,
      objectives: experiment.objectives,
      supplyVolts: experiment.supplyVolts,
      targetCurrent: experiment.targetCurrent,
      workedExample: experiment.workedExample,
    },
    workspace,
    engine: { id: engine.kind, label: engine.label, fidelity: engine.fidelity },
    ledModel: {
      name: RED_LED.name,
      vfNominalV: RED_LED.vfNominal,
      iRatedA: RED_LED.iRated,
      iAbsMaxA: RED_LED.iAbsMax,
      note:
        'Constant forward-voltage model: I = (Vsupply - sum(Vf)) / R_total. Not an exponential ' +
        'Shockley diode model. Only the DC operating point is computed.',
    },
    circuit: { components, wires, nets },
    simulation: report
      ? {
          ran: true,
          supply: report.analysis.supply
            ? {
                ref: report.analysis.supply.label,
                volts: report.analysis.supply.volts,
                posNet: report.analysis.supply.posNetName,
                negNet: report.analysis.supply.negNetName,
              }
            : null,
          supplyCurrentA: report.analysis.supplyCurrentA,
          branches: report.analysis.branches.map((b) => ({
            id: b.id,
            path: b.netNames,
            elements: b.elements.map(
              (e) => `${e.label}${e.kind === 'led' ? (e.forward ? ' (forward)' : ' (REVERSED)') : ''}`,
            ),
            conducts: b.conducts,
            blockedReason: b.blockedReason,
            currentA: Number(b.currentA.toFixed(6)),
            rTotalOhm: b.rTotalOhm,
            vfSumV: b.vfSumV,
          })),
          measurements: report.analysis.measurements.map((m) => {
            const out: TutorEvidence['simulation']['measurements'][number] = {
              ref: m.label,
              kind: m.kind,
              currentA: Number(m.currentA.toFixed(6)),
              voltageV: Number(m.voltageV.toFixed(4)),
              powerW: Number(m.powerW.toFixed(6)),
            };
            if (m.lit !== undefined) out.lit = m.lit;
            if (m.reverseBiased !== undefined) out.reverseBiased = m.reverseBiased;
            if (m.shorted !== undefined) out.shorted = m.shorted;
            return out;
          }),
          notes: report.analysis.notes,
        }
      : {
          ran: false,
          supply: null,
          supplyCurrentA: null,
          branches: [],
          measurements: [],
          notes: ['The student has not run the simulation yet.'],
        },
    validation: report
      ? {
          ran: true,
          passes: report.validation.passes,
          diagnostics: report.validation.diagnostics.map((d) => ({
            code: d.code,
            severity: d.severity,
            title: d.title,
            detail: d.detail,
            evidence: d.evidence ?? {},
          })),
        }
      : { ran: false, passes: false, diagnostics: [] },
    code: {
      present: mcu !== undefined,
      board: mcu ? defOf(mcu.kind).name : null,
      source: sketch ?? '',
      ran: codeResult != null,
      ok: codeResult?.ok ?? false,
      errors: (codeResult?.errors ?? []).map((e) => ({
        stage: e.stage,
        message: e.message,
        line: e.line,
        column: e.column,
        ...(e.hint ? { hint: e.hint } : {}),
      })),
      serial: (codeResult?.serial ?? []).map((l) => l.text.replace(/\n$/, '')),
      pins: Object.entries(codeResult?.pinModes ?? {}).map(([pin, mode]) => ({
        pin,
        mode,
        value: codeResult?.pinValues[pin] ?? 0,
        net: mcu && netlist ? netNameOfPin(netlist, mcu.id, pin) : 'unknown',
      })),
      elapsedMs: codeResult?.elapsedMs ?? 0,
      loopsRun: codeResult?.loopsRun ?? 0,
      fidelity:
        'Sketches run on a tree-walking interpreter for a documented Arduino C++ subset. Not avr-gcc, ' +
        'not cycle-accurate AVR emulation; delay() advances a virtual clock.',
    },
    pcb: pcbResult
      ? {
          ran: true,
          passes: pcbResult.passes,
          stats: pcbResult.stats,
          rules: pcbResult.rules,
          diagnostics: pcbResult.diagnostics.map((d) => ({
            code: d.code,
            severity: d.severity,
            title: d.title,
            detail: d.detail,
          })),
        }
      : { ran: false, passes: false, stats: null, rules: null, diagnostics: [] },
  };
}
