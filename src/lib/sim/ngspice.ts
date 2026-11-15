import 'server-only';

import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { readServerEnv } from '../env';
import { validateCircuit } from '../circuit/validate';
import { toSpiceNetlist } from './netlistSpice';
import type {
  EngineDescriptor,
  SimulationAdapter,
  SimulationRequest,
  SimulationResult,
} from './adapter';

const execFileAsync = promisify(execFile);

/**
 * ngspice adapter — optional, real-SPICE path.
 *
 * Enabled by setting `NGSPICE_PATH` to an ngspice executable. When the binary is
 * absent or fails, `describe()` reports `available: false` and the app stays on
 * the deterministic engine. This adapter NEVER synthesises SPICE output: if
 * ngspice did not run, no SPICE numbers are produced.
 *
 * Current scope: generates the netlist, runs `.op`, and returns the raw log
 * alongside the deterministic validation (which supplies the pedagogical
 * diagnostics). Parsing ngspice operating-point output into per-component
 * measurements is the next step for this adapter — until that exists, the UI
 * shows the deterministic numbers and the raw SPICE log side by side, clearly
 * labelled, rather than mixing the two.
 */

let probeCache: EngineDescriptor | null = null;

export async function probeNgspice(): Promise<EngineDescriptor> {
  if (probeCache) return probeCache;

  const { env } = readServerEnv();
  const base: EngineDescriptor = {
    kind: 'ngspice',
    label: 'ngspice (real SPICE)',
    fidelity:
      'Full SPICE DC operating-point solve using an exponential diode model. Requires a local ngspice binary.',
    available: false,
  };

  if (!env.ngspicePath) {
    probeCache = {
      ...base,
      unavailableReason:
        'NGSPICE_PATH is not set. Install ngspice and point NGSPICE_PATH at the binary to enable real SPICE simulation.',
    };
    return probeCache;
  }

  try {
    const { stdout, stderr } = await execFileAsync(env.ngspicePath, ['--version'], {
      timeout: 5000,
      windowsHide: true,
    });
    const version = `${stdout}${stderr}`.split('\n')[0]?.trim() ?? 'unknown version';
    probeCache = { ...base, available: true, label: `ngspice (${version})` };
  } catch (error) {
    probeCache = {
      ...base,
      unavailableReason: `Could not execute "${env.ngspicePath}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  return probeCache;
}

export const ngspiceAdapter: SimulationAdapter = {
  describe: probeNgspice,

  async run(request: SimulationRequest): Promise<SimulationResult> {
    const descriptor = await probeNgspice();
    const netlistText = toSpiceNetlist(request.design);

    // The deterministic engine always supplies the teaching diagnostics; SPICE
    // contributes its raw solve on top. They are never merged silently.
    const report = validateCircuit(request.design, request.experimentId);

    if (!descriptor.available) {
      return { engine: descriptor, report, netlistText };
    }

    const { env } = readServerEnv();
    let dir: string | null = null;
    try {
      dir = await mkdtemp(join(tmpdir(), 'boardmaster-spice-'));
      const file = join(dir, 'circuit.cir');
      await writeFile(file, netlistText, 'utf8');
      const { stdout, stderr } = await execFileAsync(
        env.ngspicePath as string,
        ['-b', file],
        { timeout: 15000, windowsHide: true },
      );
      return { engine: descriptor, report, netlistText, rawLog: `${stdout}\n${stderr}`.trim() };
    } catch (error) {
      return {
        engine: {
          ...descriptor,
          available: false,
          unavailableReason: `ngspice run failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
        report,
        netlistText,
      };
    } finally {
      if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  },
};
