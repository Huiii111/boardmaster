import type { Diagnostic } from '../circuit/diagnostics';
import type { PcbCheckResult } from '../pcb/drc';
import type { Branch, ComponentMeasurement } from '../circuit/solve';

/** How much help the student asked for. */
export type HintLevel = 1 | 2 | 3;

export const HINT_LEVELS: Array<{ level: HintLevel; name: string; blurb: string }> = [
  { level: 1, name: 'Gentle nudge', blurb: 'Points you at the right area and asks a question.' },
  { level: 2, name: 'Specific explanation', blurb: 'Names the fault and explains the underlying principle.' },
  { level: 3, name: 'Guided solution', blurb: 'Walks through the fix step by step, with the numbers.' },
];

/**
 * The structured evidence packet sent to the tutor.
 *
 * Everything here is produced by the deterministic engines. The tutor is
 * instructed to reason only from this packet, so it cannot invent measurements.
 */
export interface TutorEvidence {
  experiment: {
    id: string;
    name: string;
    summary: string;
    objectives: string[];
    supplyVolts: number;
    targetCurrent: { min: number; max: number };
    workedExample: string;
  };
  workspace: 'circuit' | 'code' | 'pcb';
  engine: {
    id: string;
    label: string;
    fidelity: string;
  };
  ledModel: {
    name: string;
    vfNominalV: number;
    iRatedA: number;
    iAbsMaxA: number;
    note: string;
  };
  circuit: {
    components: Array<{
      id: string;
      ref: string;
      kind: string;
      value: string;
      seat: string | null;
      rotation: number;
      pins: Array<{ pin: string; role: string; hole: string | null; net: string }>;
    }>;
    wires: Array<{ id: string; from: string; to: string }>;
    nets: Array<{ name: string; holes: string[]; pins: string[] }>;
  };
  simulation: {
    ran: boolean;
    supply: { ref: string; volts: number; posNet: string; negNet: string } | null;
    supplyCurrentA: number | null;
    branches: Array<{
      id: string;
      path: string[];
      elements: string[];
      conducts: boolean;
      blockedReason: string | null;
      currentA: number;
      rTotalOhm: number;
      vfSumV: number;
    }>;
    measurements: Array<{
      ref: string;
      kind: string;
      currentA: number;
      voltageV: number;
      powerW: number;
      lit?: boolean;
      reverseBiased?: boolean;
      shorted?: boolean;
    }>;
    notes: string[];
  };
  validation: {
    ran: boolean;
    passes: boolean;
    diagnostics: Array<{
      code: string;
      severity: string;
      title: string;
      detail: string;
      evidence: Record<string, string | number | boolean>;
    }>;
  };
  code: {
    /** Present only when a microcontroller is on the bench. */
    present: boolean;
    board: string | null;
    source: string;
    ran: boolean;
    ok: boolean;
    errors: Array<{ stage: string; message: string; line: number; column: number; hint?: string }>;
    serial: string[];
    /** Final pin states the sketch left behind. */
    pins: Array<{ pin: string; mode: string; value: number; net: string }>;
    elapsedMs: number;
    loopsRun: number;
    fidelity: string;
  };
  pcb: {
    ran: boolean;
    passes: boolean;
    stats: PcbCheckResult['stats'] | null;
    rules: PcbCheckResult['rules'] | null;
    diagnostics: Array<{ code: string; severity: string; title: string; detail: string }>;
  };
}

export interface TutorMessage {
  id: string;
  role: 'student' | 'tutor';
  content: string;
  /** Hint level this turn was asked at, for tutor turns. */
  hintLevel?: HintLevel;
  /** Which tutor produced it. */
  source?: 'claude' | 'local-demo';
  /** Diagnostic codes this reply was grounded in. */
  groundedIn?: string[];
  createdAt: string;
  error?: boolean;
}

export interface TutorRequestBody {
  question: string;
  hintLevel: HintLevel;
  evidence: TutorEvidence;
  /** Prior turns, oldest first, for conversational continuity. */
  history: Array<{ role: 'student' | 'tutor'; content: string }>;
}

export interface TutorResponseBody {
  reply: string;
  source: 'claude' | 'local-demo';
  model?: string;
  /** Present when the tutor fell back, so the UI can say why. */
  fallbackReason?: string;
  groundedIn: string[];
  usage?: { inputTokens: number; outputTokens: number };
}

export type { Branch, ComponentMeasurement, Diagnostic, PcbCheckResult };
