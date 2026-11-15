'use client';

import { create } from 'zustand';

import { COMPONENT_DEFS, defOf, defaultState } from '@/lib/circuit/componentDefs';
import { canSeat } from '@/lib/circuit/graph';
import { ROW_ORDER, isValidHole, rotateOffset } from '@/lib/circuit/breadboard';
import { DEFAULT_EXPERIMENT_ID } from '@/lib/circuit/experiments';
import { countBySeverity } from '@/lib/circuit/diagnostics';
import type {
  CircuitDesign,
  ComponentKind,
  Endpoint,
  PlacedComponent,
  Rotation,
  RowId,
  Wire,
} from '@/lib/circuit/types';
import { checkPcb } from '@/lib/pcb/drc';
import { emptyBoard, footprintsFromCircuit } from '@/lib/pcb/footprints';
import { runDeterministic } from '@/lib/sim/deterministic';
import { isMcu } from '@/lib/circuit/solve';
import { runSketch } from '@/lib/mcu/interpreter';
import type { BoardId } from '@/lib/mcu/board';
import { DETERMINISTIC_DESCRIPTOR } from '@/lib/sim/adapter';
import { buildEvidence } from '@/lib/tutor/evidence';
import type { HintLevel, TutorResponseBody } from '@/lib/tutor/types';
import type { DocumentState, LabStore, Version } from './types';

/*
 * Bumped from v1: the shipped starter circuit and the default experiment both
 * changed, and a document saved under v1 pins a returning student to the old
 * three-part bench and a brief that no longer matches it. The v1 payload is
 * left in place rather than deleted, so nothing is destroyed -- it is simply
 * no longer the document that loads.
 */
const STORAGE_KEY = 'boardmaster.v1';
const MAX_HISTORY = 60;


let idCounter = 0;
function uid(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

/** Next free reference designator for a kind, e.g. R1, R2. */
function nextLabel(components: PlacedComponent[], kind: ComponentKind): string {
  const prefix = defOf(kind).prefix;
  // Scan by *prefix*, not by kind: several kinds deliberately share one
  // designator prefix (switch and push button are both SW; LED, RGB LED and
  // diode are all D). Keying off the kind handed out duplicate references like
  // two SW1s, which then made the diagnostics and the tutor ambiguous about
  // which part they meant.
  const used = new Set(
    components
      .filter((c) => defOf(c.kind).prefix === prefix)
      .map((c) => Number(c.label.slice(prefix.length)))
      .filter((n) => Number.isInteger(n) && n > 0),
  );
  let n = 1;
  while (used.has(n)) n += 1;
  return `${prefix}${n}`;
}

/**
 * Shift a seat by a whole number of columns/rows, returning null if that would
 * leave the board. Used to keep a part centred while it rotates.
 */
function adjustSeatForRotation(
  seat: { row: RowId; col: number },
  dCol: number,
  dRow: number,
): { row: RowId; col: number } | null {
  const rowIndex = ROW_ORDER.indexOf(seat.row);
  if (rowIndex < 0) return null;
  const targetRow = ROW_ORDER[rowIndex + dRow];
  if (targetRow === undefined) return null;
  const targetCol = seat.col + dCol;
  if (!isValidHole(targetRow, targetCol)) return null;
  return { row: targetRow, col: targetCol };
}

function documentOf(state: LabStore): DocumentState {
  return {
    projectName: state.projectName,
    experimentId: state.experimentId,
    design: state.design,
    board: state.board,
    sketch: state.sketch,
  };
}

const DEFAULT_SKETCH = `// Everything on the breadboard is wired to this board, and this sketch
// decides what it all does. Press Run sketch (or Ctrl+Enter here).
//
//   D13 -> R1 -> D1       a plain on/off indicator
//   D9  -> R2 -> D2       a PWM pin, so this one can be dimmed
//   D2  <- SW1            a button to GND, read with the internal pull-up
//   A0  <- RV1 wiper      a 10k pot across 5V and GND

const int LED_PIN = 13;   // plain digital output
const int DIM_PIN = 9;    // PWM-capable output
const int BUTTON  = 2;    // button to GND
const int KNOB    = A0;   // potentiometer wiper

void setup() {
  Serial.begin(9600);
  pinMode(LED_PIN, OUTPUT);
  pinMode(DIM_PIN, OUTPUT);
  // INPUT_PULLUP means the pin idles HIGH and the button pulls it LOW,
  // so no external resistor is needed.
  pinMode(BUTTON, INPUT_PULLUP);
  Serial.println("BoardMaster ready");
}

void loop() {
  int knob = analogRead(KNOB);        // 0..1023 from the divider
  int level = map(knob, 0, 1023, 0, 255);
  analogWrite(DIM_PIN, level);        // D2 brightness follows the knob

  // The button idles HIGH and reads LOW while held, so invert it.
  int pressed = digitalRead(BUTTON) == LOW;
  digitalWrite(LED_PIN, pressed ? LOW : HIGH);

  Serial.print("knob=");
  Serial.print(knob);
  Serial.print("  level=");
  Serial.println(level);
  delay(100);
}
`;

/**
 * The bench a student sees on their very first visit.
 *
 * A complete, wired, code-controlled group rather than a drawer of parts:
 * every component on the board is reachable from the sketch, and between them
 * they cover the four things a beginner needs -- digital out, PWM out, digital
 * in, analog in. Pressing Run produces a real result immediately, so nobody
 * has to build something before the lab does anything, and clearing the bench
 * is one click.
 *
 * Everything sits in the lower bank (rows F-J) on the near rails, because the
 * board stands in front of the breadboard: wiring to the far rails made every
 * lead arc right across the work area and hid the parts underneath it.
 *
 *   rails  BP = 5V from U1, BN = GND from U1   (both at the near edge)
 *   R1  G02..G06   D13 feeds col 2
 *   D1  G06..G08   anode shares col 6 with R1; cathode col 8 -> GND
 *   R2  G11..G15   D9 (PWM) feeds col 11
 *   D2  G15..G17   cathode col 17 -> GND
 *   SW1 G20..G22   D2 reads col 20; col 22 -> GND
 *   RV1 G25..G29   GND -> col 25, wiper col 27 -> A0, 5V -> col 29
 */
function starterDesign(): CircuitDesign {
  const u1 = 'seed-u1';
  const lead = (id: string, a: Wire['a'], b: Wire['b'], color: string): Wire => ({
    id,
    a,
    b,
    color,
    kind: 'dupont',
  });
  const pin = (pinId: string): Wire['a'] => ({ kind: 'pin', componentId: u1, pinId });
  const hole = (h: string): Wire['a'] => ({ kind: 'hole', hole: h });

  const RED = '#ef4444';
  const BLACK = '#111827';
  const GREEN = '#22c55e';
  const BLUE = '#3b82f6';
  const YELLOW = '#eab308';

  return {
    components: [
      {
        id: u1,
        kind: 'arduino_uno',
        label: 'U1',
        rotation: 0,
        value: 5,
        seat: null,
        benchPos: [0, 0, 2.0],
      },
      // --- outputs -----------------------------------------------------
      { id: 'seed-r1', kind: 'resistor', label: 'R1', rotation: 0, value: 330, seat: { row: 'G', col: 2 } },
      { id: 'seed-d1', kind: 'led', label: 'D1', rotation: 0, value: 2, seat: { row: 'G', col: 6 } },
      { id: 'seed-r2', kind: 'resistor', label: 'R2', rotation: 0, value: 330, seat: { row: 'G', col: 11 } },
      { id: 'seed-d2', kind: 'led', label: 'D2', rotation: 0, value: 2, seat: { row: 'G', col: 15 } },
      // --- inputs ------------------------------------------------------
      {
        id: 'seed-sw1',
        kind: 'pushbutton',
        label: 'SW1',
        rotation: 0,
        value: 0,
        seat: { row: 'G', col: 20 },
        closed: false,
      },
      {
        id: 'seed-rv1',
        kind: 'potentiometer',
        label: 'RV1',
        rotation: 0,
        value: 10000,
        seat: { row: 'G', col: 25 },
        wiper: 0.5,
      },
    ],
    wires: [
      // the board feeds the near rails
      lead('seed-w1', pin('v5'), hole('BP03'), RED),
      lead('seed-w2', pin('gnd1'), hole('BN03'), BLACK),

      // D13 -> R1 -> D1 -> GND
      lead('seed-w3', pin('d13'), hole('J02'), GREEN),
      lead('seed-w4', hole('J08'), hole('BN08'), BLACK),

      // D9 (PWM) -> R2 -> D2 -> GND
      lead('seed-w5', pin('d9'), hole('J11'), YELLOW),
      lead('seed-w6', hole('J17'), hole('BN17'), BLACK),

      // SW1 pulls D2 down to GND when pressed
      lead('seed-w7', pin('d2'), hole('J20'), BLUE),
      lead('seed-w8', hole('J22'), hole('BN22'), BLACK),

      // RV1 across 5V and GND, wiper to A0.
      // 5V goes to pin 3 (col 29) and ground to pin 1 (col 25), not the other
      // way round: `wiper` is the fraction of track measured from pin 1, so
      // feeding pin 1 from 5V makes the reading fall as the knob is turned up.
      lead('seed-w9', hole('BN25'), hole('J25'), BLACK),
      lead('seed-w10', pin('a0'), hole('J27'), BLUE),
      lead('seed-w11', hole('J29'), hole('BP29'), RED),
    ],
  };
}

const INITIAL_DOCUMENT: DocumentState = {
  projectName: 'Arduino LED Lab',
  experimentId: DEFAULT_EXPERIMENT_ID,
  design: starterDesign(),
  board: emptyBoard(),
  sketch: DEFAULT_SKETCH,
};

/**
 * The pristine starting document, before any persistence is applied.
 * Exposed so tests can assert that a first-time visitor gets a working lab.
 */
export function getInitialDocument(): DocumentState {
  return {
    ...INITIAL_DOCUMENT,
    design: starterDesign(),
    board: emptyBoard(),
  };
}

/* ----------------------------- persistence ----------------------------- */

interface PersistedShape {
  version: 1;
  projectName: string;
  experimentId: string;
  design: DocumentState['design'];
  board: DocumentState['board'];
  sketch?: string;
  versions: Version[];
}

function persist(state: LabStore): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: PersistedShape = {
      version: 1,
      projectName: state.projectName,
      experimentId: state.experimentId,
      design: state.design,
      board: state.board,
      sketch: state.sketch,
      versions: state.versions.slice(0, 20),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage can be unavailable (private mode, quota). Persistence is a
    // convenience only; the app must keep working without it.
  }
}

function readPersisted(): PersistedShape | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as PersistedShape).version === 1 &&
      typeof (parsed as PersistedShape).design === 'object'
    ) {
      return parsed as PersistedShape;
    }
    return null;
  } catch {
    return null;
  }
}

/* -------------------------------- store -------------------------------- */

export const useLabStore = create<LabStore>((set, get) => {
  /** Apply a document mutation, recording it in the undo stack. */
  const commit = (mutate: (doc: DocumentState) => DocumentState, options?: { silent?: boolean }): void => {
    const state = get();
    const before = documentOf(state);
    const after = mutate(before);
    set({
      ...after,
      past: [...state.past, before].slice(-MAX_HISTORY),
      future: [],
      // Editing invalidates stale results so the UI can never show numbers
      // that do not belong to what is on the bench.
      ...(options?.silent ? {} : { report: null, pcbResult: null, simulationError: null }),
    });
    persist(get());
  };

  const toast = (kind: 'info' | 'success' | 'warning' | 'error', message: string): void => {
    const id = uid('toast');
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      }, 4200);
    }
  };

  return {
    /* ----------------------------- state ----------------------------- */
    ...INITIAL_DOCUMENT,

    workspace: 'circuit',
    tool: 'select',
    placingKind: null,
    placingRotation: 0,
    selection: { kind: null, id: null },
    hoveredHole: null,
    wireAnchor: null,
    librarySearch: '',
    wireKind: 'dupont',
    wireColor: '#ef4444',
    toasts: [],
    highlighted: [],

    report: null,
    codeResult: null,
    codeRunning: false,
    engine: DETERMINISTIC_DESCRIPTOR,
    simulating: false,
    simulationError: null,
    pcbResult: null,
    pcbChecking: false,

    tutorMessages: [],
    tutorBusy: false,
    hintLevel: 1,
    autoSpeak: false,
    speakingMessageId: null,

    versions: [],
    compareLeftId: null,
    compareRightId: null,

    past: [],
    future: [],

    server: { loading: true, error: null, tutor: null, engines: null, speech: null, warnings: [] },
    hydrated: false,

    /* ---------------------------- ui actions ---------------------------- */
    setWorkspace: (workspace) => {
      set({ workspace, wireAnchor: null });
      if (workspace !== 'pcb') return;

      // Entering the PCB view with an empty board used to show nothing but an
      // "Empty board" message, because footprints only appeared after the
      // student found the Import button. The board is *derived* from the
      // circuit, so derive it automatically instead of making that a step.
      //
      // Deliberately not pushed onto the undo stack: it is generated state, and
      // re-entering the view regenerates it. Existing placement is preserved by
      // footprintsFromCircuit, so this never clobbers a layout in progress.
      const state = get();
      const placeable = state.design.components.filter((c) => c.kind !== 'breadboard');
      if (state.board.footprints.length > 0 || placeable.length === 0) return;

      const next = footprintsFromCircuit(state.design, state.board);
      set({ board: next, pcbResult: null });
      persist(get());
      toast(
        'info',
        `Imported ${next.footprints.length} footprint${next.footprints.length === 1 ? '' : 's'} from your circuit. Arrange them, then route every net.`,
      );
    },

    setTool: (tool) =>
      set({ tool, wireAnchor: null, placingKind: tool === 'place' ? get().placingKind : null }),

    armPlacement: (kind) =>
      set(
        kind
          ? { placingKind: kind, tool: 'place', wireAnchor: null, selection: { kind: null, id: null } }
          : { placingKind: null, tool: 'select' },
      ),

    rotatePlacement: () =>
      set((s) => ({ placingRotation: (((s.placingRotation + 90) % 360) as Rotation) })),

    setLibrarySearch: (librarySearch) => set({ librarySearch }),

    setWireKind: (wireKind) => set({ wireKind }),

    setWireColor: (wireColor) => set({ wireColor }),

    setWireStyle: (id, patch) =>
      commit(
        (doc) => ({
          ...doc,
          design: {
            ...doc.design,
            wires: doc.design.wires.map((w) => (w.id === id ? { ...w, ...patch } : w)),
          },
        }),
        // Restyling a lead is cosmetic: it does not change connectivity, so the
        // existing analysis stays valid.
        { silent: true },
      ),

    select: (selection) => set({ selection, highlighted: [] }),

    setHoveredHole: (hoveredHole) => set({ hoveredHole }),

    setHighlighted: (highlighted) => set({ highlighted }),

    setProjectName: (name) => commit((doc) => ({ ...doc, projectName: name }), { silent: true }),

    setExperiment: (id) => {
      commit((doc) => ({ ...doc, experimentId: id }));
      toast('info', `Experiment switched. Re-run the simulation to check against the new brief.`);
    },

    /* -------------------------- circuit editing -------------------------- */
    placeComponent: (kind, row, col) => {
      const def = COMPONENT_DEFS[kind];
      if (!def.seatable) {
        toast('warning', `${def.name} is a bench instrument — drop it on the bench, not the board.`);
        return;
      }
      const rotation = get().placingRotation;
      if (!canSeat(kind, row, col, rotation)) {
        toast('warning', `${def.name} will not fit at ${row}${col} in this orientation. Press R to rotate.`);
        return;
      }
      const id = uid(kind);
      commit((doc) => ({
        ...doc,
        design: {
          ...doc.design,
          components: [
            ...doc.design.components,
            {
              id,
              kind,
              label: nextLabel(doc.design.components, kind),
              rotation,
              value: def.defaultValue,
              seat: { row, col },
              ...defaultState(kind),
            },
          ],
        },
      }));
      set({ selection: { kind: 'component', id }, tool: 'select', placingKind: null });
    },

    placeBenchComponent: (kind, pos) => {
      const def = COMPONENT_DEFS[kind];
      if (kind === 'breadboard') {
        toast('info', 'The breadboard is already on the bench — this MVP uses a single half-size board.');
        set({ tool: 'select', placingKind: null });
        return;
      }
      // One of each bench instrument: the experiments assume a single source,
      // and a second meter would just clutter the bench.
      const SINGLETON: Partial<Record<ComponentKind, string>> = {
        dc_source: 'Only one DC supply is supported in this experiment.',
        arduino_uno: 'One microcontroller at a time — the Code panel targets a single board.',
        esp32: 'One microcontroller at a time — the Code panel targets a single board.',
        battery_pack: 'Only one battery pack is supported in this experiment.',
        multimeter: 'One multimeter is enough — move its probes to measure elsewhere.',
      };
      const limit = SINGLETON[kind];
      if (limit && get().design.components.some((c) => c.kind === kind)) {
        toast('warning', limit);
        set({ tool: 'select', placingKind: null });
        return;
      }

      // Lay the bench out like a real one rather than stacking everything at
      // the same spot in front of the board.
      const BENCH_SPOT: Partial<Record<ComponentKind, [number, number, number]>> = {
        arduino_uno: [0, 0, 2.0],
        esp32: [0, 0, 2.0],
        dc_source: [0, 0, 1.78],
        battery_pack: [-1.32, 0, 1.62],
        multimeter: [1.42, 0, 1.55],
      };
      const spot = BENCH_SPOT[kind] ?? pos;
      const id = uid(kind);
      commit((doc) => ({
        ...doc,
        design: {
          ...doc.design,
          components: [
            ...doc.design.components,
            {
              id,
              kind,
              label: nextLabel(doc.design.components, kind),
              rotation: 0,
              value: def.defaultValue,
              seat: null,
              benchPos: spot,
              ...defaultState(kind),
            },
          ],
        },
      }));
      set({ selection: { kind: 'component', id }, tool: 'select', placingKind: null });
    },

    moveComponent: (id, row, col) => {
      const comp = get().design.components.find((c) => c.id === id);
      if (!comp) return;
      if (!canSeat(comp.kind, row, col, comp.rotation)) {
        toast('warning', `${comp.label} will not fit at ${row}${col} in this orientation.`);
        return;
      }
      commit((doc) => ({
        ...doc,
        design: {
          ...doc.design,
          components: doc.design.components.map((c) => (c.id === id ? { ...c, seat: { row, col } } : c)),
        },
      }));
    },

    moveBenchComponent: (id, pos) =>
      commit((doc) => ({
        ...doc,
        design: {
          ...doc.design,
          components: doc.design.components.map((c) => (c.id === id ? { ...c, benchPos: pos } : c)),
        },
      })),

    rotateComponent: (id, delta = 90) => {
      const comp = get().design.components.find((c) => c.id === id);
      if (!comp) return;
      const rotation = ((((comp.rotation + delta) % 360) + 360) % 360) as Rotation;

      // Free-standing bench instruments just spin in place.
      if (!comp.seat) {
        commit((doc) => ({
          ...doc,
          design: {
            ...doc.design,
            components: doc.design.components.map((c) => (c.id === id ? { ...c, rotation } : c)),
          },
        }));
        return;
      }

      // Rotate about the part's own centre, not about its origin pin, so that
      // turning a two-lead part 180 degrees swaps its leads between the SAME two
      // holes — which is what pulling the part out and reinserting it does on a
      // real breadboard. Rotating about the origin pin would instead walk the
      // far lead into a different hole and silently break the circuit.
      const def = defOf(comp.kind);
      const pinCount = def.pins.length || 1;
      const centroidCol = def.pins.reduce((sum, p) => sum + p.dCol, 0) / pinCount;
      const centroidRow = def.pins.reduce((sum, p) => sum + p.dRow, 0) / pinCount;
      const before = rotateOffset(centroidCol, centroidRow, comp.rotation);
      const after = rotateOffset(centroidCol, centroidRow, rotation);

      const seat = adjustSeatForRotation(
        comp.seat,
        Math.round(before.dCol - after.dCol),
        Math.round(before.dRow - after.dRow),
      );

      // Prefer the centre-preserving seat; fall back to rotating in place.
      const candidates = seat ? [seat, comp.seat] : [comp.seat];
      const target = candidates.find((s) => canSeat(comp.kind, s.row, s.col, rotation));
      if (!target) {
        toast('warning', `${comp.label} cannot rotate here — a lead would leave the board.`);
        return;
      }

      commit((doc) => ({
        ...doc,
        design: {
          ...doc.design,
          components: doc.design.components.map((c) =>
            c.id === id ? { ...c, rotation, seat: target } : c,
          ),
        },
      }));
    },

    setComponentValue: (id, value) =>
      commit((doc) => ({
        ...doc,
        design: {
          ...doc.design,
          components: doc.design.components.map((c) =>
            c.id === id ? { ...c, value: Number.isFinite(value) ? value : c.value } : c,
          ),
        },
      })),

    setComponentClosed: (id, closed) =>
      commit((doc) => ({
        ...doc,
        design: {
          ...doc.design,
          components: doc.design.components.map((c) => (c.id === id ? { ...c, closed } : c)),
        },
      })),

    setComponentWiper: (id, wiper) =>
      commit((doc) => ({
        ...doc,
        design: {
          ...doc.design,
          components: doc.design.components.map((c) =>
            c.id === id ? { ...c, wiper: Math.min(1, Math.max(0, wiper)) } : c,
          ),
        },
      })),

    setComponentIllumination: (id, illumination) =>
      commit((doc) => ({
        ...doc,
        design: {
          ...doc.design,
          components: doc.design.components.map((c) =>
            c.id === id ? { ...c, illumination: Math.min(1, Math.max(0, illumination)) } : c,
          ),
        },
      })),

    replaceFuse: (id) => {
      commit((doc) => ({
        ...doc,
        design: {
          ...doc.design,
          components: doc.design.components.map((c) => (c.id === id ? { ...c, blown: false } : c)),
        },
      }));
      toast('info', 'Fuse replaced. Fix the cause before running again, or it will blow straight away.');
    },

    setComponentLabel: (id, label) =>
      commit(
        (doc) => ({
          ...doc,
          design: {
            ...doc.design,
            components: doc.design.components.map((c) =>
              c.id === id ? { ...c, label: label.trim().slice(0, 8) || c.label } : c,
            ),
          },
        }),
        { silent: true },
      ),

    deleteComponent: (id) => {
      const comp = get().design.components.find((c) => c.id === id);
      commit((doc) => ({
        ...doc,
        design: {
          components: doc.design.components.filter((c) => c.id !== id),
          // Wires referencing the deleted part go with it.
          wires: doc.design.wires.filter(
            (w) =>
              !(w.a.kind === 'pin' && w.a.componentId === id) &&
              !(w.b.kind === 'pin' && w.b.componentId === id),
          ),
        },
        board: {
          ...doc.board,
          footprints: doc.board.footprints.filter((f) => f.componentId !== id),
        },
      }));
      set({ selection: { kind: null, id: null } });
      if (comp) toast('info', `${comp.label} deleted.`);
    },

    /* ------------------------------ wiring ------------------------------ */
    beginWire: (endpoint) => set({ wireAnchor: endpoint, tool: 'wire' }),

    completeWire: (endpoint) => {
      const anchor = get().wireAnchor;
      if (!anchor) {
        set({ wireAnchor: endpoint });
        return;
      }
      const same =
        anchor.kind === endpoint.kind &&
        ((anchor.kind === 'hole' && endpoint.kind === 'hole' && anchor.hole === endpoint.hole) ||
          (anchor.kind === 'pin' &&
            endpoint.kind === 'pin' &&
            anchor.componentId === endpoint.componentId &&
            anchor.pinId === endpoint.pinId));
      if (same) {
        set({ wireAnchor: null });
        toast('warning', 'A wire needs two different endpoints.');
        return;
      }
      const id = uid('wire');
      const { wireColor: color, wireKind: kind } = get();
      commit((doc) => ({
        ...doc,
        design: {
          ...doc.design,
          wires: [...doc.design.wires, { id, a: anchor, b: endpoint, color, kind }],
        },
      }));
      set({ wireAnchor: null, selection: { kind: 'wire', id } });
    },

    cancelWire: () => set({ wireAnchor: null }),

    deleteWire: (id) => {
      commit((doc) => ({
        ...doc,
        design: { ...doc.design, wires: doc.design.wires.filter((w) => w.id !== id) },
      }));
      set({ selection: { kind: null, id: null } });
      toast('info', 'Jumper removed.');
    },

    /* ---------------------------- pcb editing ---------------------------- */
    importFootprints: () => {
      const { design, board } = get();
      if (design.components.filter((c) => c.kind !== 'breadboard').length === 0) {
        toast('warning', 'Build the circuit first — footprints are derived from your placed components.');
        return;
      }
      const next = footprintsFromCircuit(design, board);
      commit((doc) => ({ ...doc, board: next }));
      toast(
        'success',
        `Imported ${next.footprints.length} footprint${next.footprints.length === 1 ? '' : 's'} with nets from the circuit.`,
      );
    },

    moveFootprint: (id, x, y) =>
      commit((doc) => ({
        ...doc,
        board: {
          ...doc.board,
          footprints: doc.board.footprints.map((f) => (f.id === id ? { ...f, x, y } : f)),
        },
      })),

    rotateFootprint: (id) =>
      commit((doc) => ({
        ...doc,
        board: {
          ...doc.board,
          footprints: doc.board.footprints.map((f) =>
            f.id === id ? { ...f, rotation: (f.rotation + 90) % 360 } : f,
          ),
        },
      })),

    addTrace: (points, startPadId, endPadId) => {
      if (points.length < 2) return;
      const id = uid('t');
      commit((doc) => ({
        ...doc,
        board: {
          ...doc.board,
          traces: [...doc.board.traces, { id, layer: 'top', points, width: 0.4, startPadId, endPadId }],
        },
      }));
      set({ selection: { kind: 'trace', id } });
    },

    deleteTrace: (id) => {
      commit((doc) => ({
        ...doc,
        board: { ...doc.board, traces: doc.board.traces.filter((t) => t.id !== id) },
      }));
      set({ selection: { kind: null, id: null } });
    },

    clearTraces: () => {
      commit((doc) => ({ ...doc, board: { ...doc.board, traces: [] } }));
      toast('info', 'All traces cleared.');
    },

    /* --------------------------- running checks --------------------------- */
    runSimulation: () => {
      // When a microcontroller is on the bench, its pin states ARE the circuit's
      // input, and those come from the sketch. Solving without running the code
      // first would report "no power supply" on a circuit whose supply is the
      // board — so the one prominent button does the whole job.
      if (get().design.components.some((c) => isMcu(c.kind))) {
        get().runCode();
        return;
      }

      set({ simulating: true, simulationError: null });
      try {
        const { design, experimentId } = get();
        const result = runDeterministic({ design, experimentId });
        const counts = countBySeverity(result.report.validation.diagnostics);
        set({ report: result.report, engine: result.engine, simulating: false });
        get().saveVersion(undefined, 'simulation');
        if (result.report.validation.passes) {
          toast('success', 'Simulation complete — circuit valid.');
        } else if (counts.error > 0) {
          toast('error', `Simulation complete — ${counts.error} error${counts.error === 1 ? '' : 's'} found.`);
        } else {
          toast('warning', 'Simulation complete — review the warnings.');
        }
      } catch (error) {
        set({
          simulating: false,
          simulationError: error instanceof Error ? error.message : String(error),
        });
        toast('error', 'The analyser failed. See the simulation panel for details.');
      }
    },

    setSketch: (sketch) => commit((doc) => ({ ...doc, sketch }), { silent: true }),

    /**
     * Run the student's sketch, then re-solve the circuit it drives.
     *
     * Order matters and is slightly circular, which is honest about the
     * hardware: the sketch reads pin voltages, and the pins it drives change
     * those voltages. We solve the circuit as it stands, run the sketch against
     * those voltages, write the resulting pin states back, and solve again.
     * One pass settles the common cases (blink, button-to-LED); genuinely
     * self-referential circuits are reported as outside the model rather than
     * iterated to a fixed point.
     */
    runCode: () => {
      const state = get();
      const mcu = state.design.components.find((c) => isMcu(c.kind));
      if (!mcu) {
        toast('warning', 'Place an Arduino Uno or ESP32 on the bench before running a sketch.');
        return;
      }

      set({ codeRunning: true });
      try {
        // 1. The circuit as it stands, so the sketch can read its pins.
        const before = runDeterministic({
          design: state.design,
          experimentId: state.experimentId,
        }).report.analysis;

        const readPinVolts = (pinId: string): number | null => {
          const netId = before.netlist.pinNet[`${mcu.id}.${pinId}`];
          if (!netId) return null;
          const v = before.nodeVoltages[netId];
          return v === undefined ? null : v;
        };

        // 2. Execute the sketch.
        const result = runSketch(state.sketch, mcu.kind as BoardId, {
          loopIterations: 4,
          readPinVolts,
        });

        // 3. Write the pin states it left behind onto the board component, so
        //    the solver sees them as drivers.
        const mcuPins: NonNullable<PlacedComponent['mcuPins']> = {};
        for (const [pinId, mode] of Object.entries(result.pinModes)) {
          mcuPins[pinId] = { mode, value: result.pinValues[pinId] ?? 0 };
        }

        commit((doc) => ({
          ...doc,
          design: {
            ...doc.design,
            components: doc.design.components.map((c) => (c.id === mcu.id ? { ...c, mcuPins } : c)),
          },
        }));

        // 4. Solve again, now with the driven pins in play.
        const after = runDeterministic({
          design: get().design,
          experimentId: get().experimentId,
        });

        set({ codeResult: result, codeRunning: false, report: after.report, engine: after.engine });

        if (!result.ok) {
          const first = result.errors[0];
          toast('error', first ? `Line ${first.line}: ${first.message}` : 'The sketch did not run.');
        } else {
          const driven = Object.values(mcuPins).filter((p) => p.mode === 'output').length;
          toast(
            'success',
            `Sketch ran: ${result.loopsRun} loop${result.loopsRun === 1 ? '' : 's'}, ` +
              `${result.elapsedMs} ms simulated, ${driven} pin${driven === 1 ? '' : 's'} driven.`,
          );
        }
      } catch (error) {
        set({ codeRunning: false });
        toast('error', `The interpreter failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },

    runPcbChecks: () => {
      set({ pcbChecking: true });
      try {
        const result = checkPcb(get().board);
        set({ pcbResult: result, pcbChecking: false });
        get().saveVersion(undefined, 'pcb-check');
        const counts = countBySeverity(result.diagnostics);
        if (result.passes) toast('success', 'PCB checks passed (simplified rules).');
        else if (counts.error > 0) toast('error', `PCB checks found ${counts.error} error${counts.error === 1 ? '' : 's'}.`);
        else toast('warning', 'PCB checks complete — review the warnings.');
      } catch (error) {
        set({ pcbChecking: false });
        toast('error', `PCB checker failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },

    /* ------------------------------- tutor ------------------------------- */
    setHintLevel: (hintLevel) => set({ hintLevel }),

    setAutoSpeak: (autoSpeak) => set({ autoSpeak }),

    setSpeakingMessageId: (speakingMessageId) => set({ speakingMessageId }),

    askTutor: async (question, level) => {
      const state = get();
      const hintLevel: HintLevel = level ?? state.hintLevel;
      const trimmed = question.trim();
      if (trimmed.length === 0 || state.tutorBusy) return;

      const studentMessage = {
        id: uid('msg'),
        role: 'student' as const,
        content: trimmed,
        createdAt: new Date().toISOString(),
      };
      set({
        tutorMessages: [...state.tutorMessages, studentMessage],
        tutorBusy: true,
        hintLevel,
      });

      const evidence = buildEvidence({
        design: state.design,
        experimentId: state.experimentId,
        workspace: state.workspace === 'pcb' ? 'pcb' : state.workspace === 'code' ? 'code' : 'circuit',
        engine: state.engine,
        report: state.report,
        pcbResult: state.pcbResult,
        sketch: state.sketch,
        codeResult: state.codeResult,
      });

      try {
        const response = await fetch('/api/tutor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: trimmed,
            hintLevel,
            evidence,
            history: state.tutorMessages.slice(-8).map((m) => ({ role: m.role, content: m.content })),
          }),
        });

        if (!response.ok) {
          const detail: unknown = await response.json().catch(() => null);
          const message =
            typeof detail === 'object' && detail !== null && 'error' in detail
              ? String((detail as { error: unknown }).error)
              : `Request failed with status ${response.status}.`;
          throw new Error(message);
        }

        const data = (await response.json()) as TutorResponseBody;
        set((s) => ({
          tutorBusy: false,
          tutorMessages: [
            ...s.tutorMessages,
            {
              id: uid('msg'),
              role: 'tutor',
              content: data.reply,
              hintLevel,
              source: data.source,
              groundedIn: data.groundedIn,
              createdAt: new Date().toISOString(),
            },
          ],
        }));
        if (data.fallbackReason && data.source === 'local-demo') {
          set((s) => ({ server: { ...s.server, tutor: { mode: 'local-demo', model: null, label: 'Local Demo Tutor' } } }));
        }
      } catch (error) {
        set((s) => ({
          tutorBusy: false,
          tutorMessages: [
            ...s.tutorMessages,
            {
              id: uid('msg'),
              role: 'tutor',
              content: `I could not reach the tutor service: ${
                error instanceof Error ? error.message : String(error)
              }\n\nYour circuit and its analysis results are unaffected. Try again, or read the issues list — every diagnostic there is generated locally and explains itself.`,
              hintLevel,
              createdAt: new Date().toISOString(),
              error: true,
            },
          ],
        }));
      }
    },

    clearTutor: () => set({ tutorMessages: [] }),

    /* ------------------------------ versions ------------------------------ */
    saveVersion: (label, reason = 'manual') => {
      const state = get();
      const counts = state.report
        ? countBySeverity(state.report.validation.diagnostics)
        : { error: 0, warning: 0, info: 0, pass: 0 };

      const version: Version = {
        id: uid('ver'),
        label: label?.trim() || `${reason === 'manual' ? 'Save' : reason === 'simulation' ? 'Simulation run' : reason === 'pcb-check' ? 'PCB check' : 'Autosave'} ${state.versions.length + 1}`,
        createdAt: new Date().toISOString(),
        reason,
        design: structuredClone(state.design),
        board: structuredClone(state.board),
        experimentId: state.experimentId,
        summary: {
          simulated: state.report !== null,
          passes: state.report?.validation.passes ?? false,
          errors: counts.error,
          warnings: counts.warning,
          supplyCurrentA: state.report?.analysis.supplyCurrentA ?? null,
          pcbChecked: state.pcbResult !== null,
          pcbPasses: state.pcbResult?.passes ?? false,
        },
      };

      set((s) => {
        const versions = [version, ...s.versions].slice(0, 20);
        return {
          versions,
          // Default the comparison to "newest vs the one before it".
          compareLeftId: s.compareLeftId ?? versions[1]?.id ?? null,
          compareRightId: version.id,
        };
      });
      persist(get());
      if (reason === 'manual') toast('success', `Saved "${version.label}".`);
    },

    restoreVersion: (id) => {
      const version = get().versions.find((v) => v.id === id);
      if (!version) return;
      commit((doc) => ({
        ...doc,
        experimentId: version.experimentId,
        design: structuredClone(version.design),
        board: structuredClone(version.board),
      }));
      set({ selection: { kind: null, id: null }, workspace: 'circuit' });
      toast('info', `Restored "${version.label}". Re-run the simulation to check it.`);
    },

    deleteVersion: (id) => {
      set((s) => ({
        versions: s.versions.filter((v) => v.id !== id),
        compareLeftId: s.compareLeftId === id ? null : s.compareLeftId,
        compareRightId: s.compareRightId === id ? null : s.compareRightId,
      }));
      persist(get());
    },

    setCompare: (side, id) =>
      set(side === 'left' ? { compareLeftId: id } : { compareRightId: id }),

    /* ------------------------------ history ------------------------------ */
    undo: () => {
      const state = get();
      const previous = state.past[state.past.length - 1];
      if (!previous) {
        toast('info', 'Nothing left to undo.');
        return;
      }
      set({
        ...previous,
        past: state.past.slice(0, -1),
        future: [documentOf(state), ...state.future].slice(0, MAX_HISTORY),
        report: null,
        pcbResult: null,
        selection: { kind: null, id: null },
        wireAnchor: null,
      });
      persist(get());
    },

    redo: () => {
      const state = get();
      const next = state.future[0];
      if (!next) {
        toast('info', 'Nothing left to redo.');
        return;
      }
      set({
        ...next,
        past: [...state.past, documentOf(state)].slice(-MAX_HISTORY),
        future: state.future.slice(1),
        report: null,
        pcbResult: null,
        selection: { kind: null, id: null },
        wireAnchor: null,
      });
      persist(get());
    },

    /* ----------------------------- lifecycle ----------------------------- */
    resetBench: () => {
      commit((doc) => ({ ...doc, design: { components: [], wires: [] }, board: emptyBoard() }));
      set({ selection: { kind: null, id: null }, wireAnchor: null, codeResult: null });
      toast('info', 'Bench cleared. "Load reference circuit" brings the starter back.');
    },

    /**
     * Load the brief's reference circuit. Used by the demo "Load example" action
     * so a presenter can show a known-good board instantly. The student still
     * has to run the simulation to find out whether it is correct.
     */
    loadStarterCircuit: () => {
      const v1 = uid('dc_source');
      const r1 = uid('resistor');
      const d1 = uid('led');
      commit((doc) => ({
        ...doc,
        design: {
          components: [
            { id: v1, kind: 'dc_source', label: 'V1', rotation: 0, value: 5, seat: null, benchPos: [0, 0, 1.75] },
            { id: r1, kind: 'resistor', label: 'R1', rotation: 0, value: 330, seat: { row: 'E', col: 5 } },
            { id: d1, kind: 'led', label: 'D1', rotation: 0, value: 2, seat: { row: 'E', col: 9 } },
          ],
          wires: [
            { id: uid('wire'), a: { kind: 'pin', componentId: v1, pinId: 'pos' }, b: { kind: 'hole', hole: 'TP10' }, color: '#ef4444' },
            { id: uid('wire'), a: { kind: 'hole', hole: 'TP12' }, b: { kind: 'hole', hole: 'E05' }, color: '#ef4444' },
            { id: uid('wire'), a: { kind: 'hole', hole: 'E11' }, b: { kind: 'hole', hole: 'TN14' }, color: '#111827' },
            { id: uid('wire'), a: { kind: 'pin', componentId: v1, pinId: 'neg' }, b: { kind: 'hole', hole: 'TN18' }, color: '#111827' },
          ],
        },
        board: emptyBoard(),
      }));
      toast('info', 'Reference circuit loaded. Press Run Simulation to check it.');
    },

    /** Same circuit with the LED reversed — for demonstrating fault detection. */
    loadFaultyCircuit: () => {
      get().loadStarterCircuit();
      const led = get().design.components.find((c) => c.kind === 'led');
      if (!led) return;
      commit((doc) => ({
        ...doc,
        design: {
          ...doc.design,
          components: doc.design.components.map((c) =>
            c.id === led.id ? { ...c, rotation: 180, seat: { row: 'E', col: 11 } } : c,
          ),
        },
      }));
      toast('warning', 'Loaded a circuit with a deliberate fault. Run the simulation and see what the analyser says.');
    },

    hydrate: () => {
      if (get().hydrated) return;
      const saved = readPersisted();
      if (saved) {
        set({
          projectName: saved.projectName,
          experimentId: saved.experimentId,
          design: saved.design,
          board: saved.board,
          sketch: saved.sketch ?? DEFAULT_SKETCH,
          versions: saved.versions ?? [],
          hydrated: true,
        });
      } else {
        set({ hydrated: true });
      }
    },

    fetchServerStatus: async () => {
      try {
        const response = await fetch('/api/status', { cache: 'no-store' });
        if (!response.ok) throw new Error(`status ${response.status}`);
        const data = (await response.json()) as {
          tutor: { mode: 'claude' | 'local-demo'; model: string | null; label: string };
          engines: { deterministic: typeof DETERMINISTIC_DESCRIPTOR; ngspice: typeof DETERMINISTIC_DESCRIPTOR };
          speech: { elevenlabs: boolean; voiceId: string | null; label: string };
          warnings: string[];
        };
        set({
          server: {
            loading: false,
            error: null,
            tutor: data.tutor,
            engines: data.engines,
            speech: data.speech,
            warnings: data.warnings,
          },
        });
      } catch (error) {
        set({
          server: {
            loading: false,
            error: error instanceof Error ? error.message : String(error),
            tutor: null,
            engines: null,
            speech: null,
            warnings: [],
          },
        });
      }
    },

    pushToast: (kind, message) => toast(kind, message),

    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  };
});

/**
 * Development-only handle on the store.
 *
 * Lets end-to-end checks drive the real application state (place parts, route
 * traces, run checks) instead of simulating pointer events against the 3D
 * canvas. Stripped from production builds, and never read by app code.
 */
if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
  (window as unknown as { __labStore?: typeof useLabStore }).__labStore = useLabStore;
}

/** Selector helper: the currently selected component, if any. */
export function useSelectedComponent(): PlacedComponent | null {
  return useLabStore((s) => {
    if (s.selection.kind !== 'component' || !s.selection.id) return null;
    return s.design.components.find((c) => c.id === s.selection.id) ?? null;
  });
}

export type { Endpoint, RowId };
