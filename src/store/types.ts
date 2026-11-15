import type {
  CircuitDesign,
  ComponentKind,
  Endpoint,
  HoleId,
  Rotation,
  RowId,
  WireKind,
} from '@/lib/circuit/types';
import type { SimulationReport } from '@/lib/circuit/validate';
import type { PcbBoard } from '@/lib/pcb/types';
import type { PcbCheckResult } from '@/lib/pcb/drc';
import type { EngineDescriptor } from '@/lib/sim/adapter';
import type { HintLevel, TutorMessage } from '@/lib/tutor/types';
import type { SketchRunResult } from '@/lib/mcu/interpreter';

/** The two workspaces. */
export type Workspace = 'circuit' | 'code' | 'pcb' | 'compare';

/** What a click on the 3D scene currently does. */
export type Tool = 'select' | 'wire' | 'place' | 'delete';

export interface Selection {
  kind: 'component' | 'wire' | 'pad' | 'trace' | 'footprint' | null;
  id: string | null;
}

/** A saved snapshot the student can compare against. */
export interface Version {
  id: string;
  label: string;
  createdAt: string;
  reason: 'manual' | 'simulation' | 'pcb-check' | 'auto';
  design: CircuitDesign;
  board: PcbBoard;
  experimentId: string;
  /** Validation summary captured at save time, when one existed. */
  summary: {
    simulated: boolean;
    passes: boolean;
    errors: number;
    warnings: number;
    supplyCurrentA: number | null;
    pcbChecked: boolean;
    pcbPasses: boolean;
  };
}

export interface Toast {
  id: string;
  kind: 'info' | 'success' | 'warning' | 'error';
  message: string;
}

/** Status of the server capability probe. */
export interface ServerStatus {
  loading: boolean;
  error: string | null;
  tutor: { mode: 'claude' | 'local-demo'; model: string | null; label: string } | null;
  engines: { deterministic: EngineDescriptor; ngspice: EngineDescriptor } | null;
  speech: { elevenlabs: boolean; voiceId: string | null; label: string } | null;
  warnings: string[];
}

/** The slice of state that undo/redo operates on. */
export interface DocumentState {
  projectName: string;
  experimentId: string;
  design: CircuitDesign;
  board: PcbBoard;
  /** The student's Arduino sketch. */
  sketch: string;
}

export interface LabState extends DocumentState {
  /* ----- ui ----- */
  workspace: Workspace;
  tool: Tool;
  /** Component kind armed for placement, when `tool === 'place'`. */
  placingKind: ComponentKind | null;
  placingRotation: Rotation;
  selection: Selection;
  hoveredHole: HoleId | null;
  /** First endpoint of a wire being drawn. */
  wireAnchor: Endpoint | null;
  librarySearch: string;
  /** Cable style used for the next jumper drawn. */
  wireKind: WireKind;
  /** Colour used for the next jumper drawn. */
  wireColor: string;
  toasts: Toast[];
  /** Component ids the UI should highlight (from a diagnostic). */
  highlighted: string[];

  /* ----- results ----- */
  report: SimulationReport | null;
  /** Result of the last sketch run, or null if it has never been run. */
  codeResult: SketchRunResult | null;
  codeRunning: boolean;
  engine: EngineDescriptor;
  simulating: boolean;
  simulationError: string | null;
  pcbResult: PcbCheckResult | null;
  pcbChecking: boolean;

  /* ----- tutor ----- */
  tutorMessages: TutorMessage[];
  tutorBusy: boolean;
  hintLevel: HintLevel;

  /* ----- voice ----- */
  /** Speak each new tutor reply automatically. */
  autoSpeak: boolean;
  /** Id of the message currently being spoken, if any. */
  speakingMessageId: string | null;

  /* ----- versions ----- */
  versions: Version[];
  compareLeftId: string | null;
  compareRightId: string | null;

  /* ----- history ----- */
  past: DocumentState[];
  future: DocumentState[];

  /* ----- server ----- */
  server: ServerStatus;
  hydrated: boolean;
}

export interface LabActions {
  /* workspace + tools */
  setWorkspace: (w: Workspace) => void;
  setTool: (t: Tool) => void;
  armPlacement: (kind: ComponentKind | null) => void;
  rotatePlacement: () => void;
  setLibrarySearch: (q: string) => void;
  setWireKind: (kind: WireKind) => void;
  setWireColor: (color: string) => void;
  /** Change an existing jumper's style or colour. */
  setWireStyle: (id: string, patch: { kind?: WireKind; color?: string }) => void;
  select: (sel: Selection) => void;
  setHoveredHole: (hole: HoleId | null) => void;
  setHighlighted: (ids: string[]) => void;

  /* project */
  setProjectName: (name: string) => void;
  setExperiment: (id: string) => void;

  /* circuit editing */
  placeComponent: (kind: ComponentKind, row: RowId, col: number) => void;
  placeBenchComponent: (kind: ComponentKind, pos: [number, number, number]) => void;
  moveComponent: (id: string, row: RowId, col: number) => void;
  moveBenchComponent: (id: string, pos: [number, number, number]) => void;
  rotateComponent: (id: string, delta?: number) => void;
  setComponentValue: (id: string, value: number) => void;
  /** Toggle a switch or hold a push button. */
  setComponentClosed: (id: string, closed: boolean) => void;
  /** Potentiometer wiper, 0..1. */
  setComponentWiper: (id: string, wiper: number) => void;
  /** Photoresistor illumination, 0..1. */
  setComponentIllumination: (id: string, illumination: number) => void;
  /** Replace a blown fuse. */
  replaceFuse: (id: string) => void;
  setComponentLabel: (id: string, label: string) => void;
  deleteComponent: (id: string) => void;

  /* wiring */
  beginWire: (endpoint: Endpoint) => void;
  completeWire: (endpoint: Endpoint) => void;
  cancelWire: () => void;
  deleteWire: (id: string) => void;

  /* pcb editing */
  importFootprints: () => void;
  moveFootprint: (id: string, x: number, y: number) => void;
  rotateFootprint: (id: string) => void;
  addTrace: (points: Array<{ x: number; y: number }>, startPadId: string | null, endPadId: string | null) => void;
  deleteTrace: (id: string) => void;
  clearTraces: () => void;

  /* running checks */
  runSimulation: () => void;
  setSketch: (source: string) => void;
  /** Compile-and-run the sketch, then re-solve the circuit it drives. */
  runCode: () => void;
  runPcbChecks: () => void;

  /* tutor */
  setHintLevel: (level: HintLevel) => void;
  setAutoSpeak: (on: boolean) => void;
  setSpeakingMessageId: (id: string | null) => void;
  askTutor: (question: string, level?: HintLevel) => Promise<void>;
  clearTutor: () => void;

  /* versions */
  saveVersion: (label?: string, reason?: Version['reason']) => void;
  restoreVersion: (id: string) => void;
  deleteVersion: (id: string) => void;
  setCompare: (side: 'left' | 'right', id: string | null) => void;

  /* history */
  undo: () => void;
  redo: () => void;

  /* lifecycle */
  resetBench: () => void;
  loadStarterCircuit: () => void;
  loadFaultyCircuit: () => void;
  hydrate: () => void;
  fetchServerStatus: () => Promise<void>;
  pushToast: (kind: Toast['kind'], message: string) => void;
  dismissToast: (id: string) => void;
}

export type LabStore = LabState & LabActions;
