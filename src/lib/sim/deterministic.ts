import { validateCircuit } from '../circuit/validate';
import {
  DETERMINISTIC_DESCRIPTOR,
  type EngineDescriptor,
  type SimulationAdapter,
  type SimulationRequest,
  type SimulationResult,
} from './adapter';

/**
 * The always-available engine. Runs entirely in the browser so the lab works
 * offline and with no API key.
 */
export const deterministicAdapter: SimulationAdapter = {
  async describe(): Promise<EngineDescriptor> {
    return DETERMINISTIC_DESCRIPTOR;
  },
  async run(request: SimulationRequest): Promise<SimulationResult> {
    const report = validateCircuit(request.design, request.experimentId);
    return { engine: DETERMINISTIC_DESCRIPTOR, report };
  },
};

/** Synchronous convenience wrapper for client-side use. */
export function runDeterministic(request: SimulationRequest): SimulationResult {
  return {
    engine: DETERMINISTIC_DESCRIPTOR,
    report: validateCircuit(request.design, request.experimentId),
  };
}
