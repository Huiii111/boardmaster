import type { CircuitDesign } from '../circuit/types';
import type { SimulationReport } from '../circuit/validate';

/**
 * Simulation adapter boundary.
 *
 * Two implementations exist:
 *  - `deterministic` — the in-browser educational branch analyser (always available).
 *  - `ngspice`       — a server-side adapter that shells out to a real ngspice binary.
 *
 * The UI always labels which engine produced the numbers on screen. If ngspice is
 * not installed the adapter reports `available: false` and the app falls back to
 * the deterministic engine. It never emits placeholder "SPICE" numbers.
 */

export type EngineKind = 'deterministic' | 'ngspice';

export interface EngineDescriptor {
  kind: EngineKind;
  /** Short label for the status badge. */
  label: string;
  /** Longer, honest description of fidelity. */
  fidelity: string;
  available: boolean;
  /** Why it is unavailable, when it is. */
  unavailableReason?: string;
}

export interface SimulationRequest {
  design: CircuitDesign;
  experimentId: string;
}

export interface SimulationResult {
  engine: EngineDescriptor;
  report: SimulationReport;
  /** Raw engine output, when the engine produces one (ngspice log, netlist). */
  rawLog?: string;
  /** Generated SPICE netlist, when applicable. */
  netlistText?: string;
}

export interface SimulationAdapter {
  describe(): Promise<EngineDescriptor>;
  run(request: SimulationRequest): Promise<SimulationResult>;
}

export const DETERMINISTIC_DESCRIPTOR: EngineDescriptor = {
  kind: 'deterministic',
  label: 'Deterministic engine',
  fidelity:
    'Educational DC branch analyser. Exact net extraction from breadboard strip rules; ' +
    'LED modelled as a constant forward-voltage drop. DC operating point only — not SPICE.',
  available: true,
};
