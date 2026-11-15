import { buildNetlist, netOfPin, resolvePins } from './graph';
import { RED_LED, defOf, deviceEdges, isSource } from './componentDefs';
import type { CircuitDesign, ComponentKind, Netlist } from './types';
import { boardDef, type BoardId } from '../mcu/board';

/** Anything that can push current into the circuit. */
export interface Driver {
  id: string;
  label: string;
  /** Net the driver pushes into. */
  netId: string;
  volts: number;
  /** Output impedance, ohms. Zero for the ideal bench supply. */
  resistanceOhm: number;
  kind: 'supply' | 'mcu_pin';
  componentId?: string;
  pinId?: string;
}

const MCU_KINDS: ComponentKind[] = ['arduino_uno', 'esp32'];

export function isMcu(kind: ComponentKind): kind is BoardId {
  return MCU_KINDS.includes(kind);
}

/** The net a microcontroller's GND pin lands on, used as the 0 V reference. */
function mcuGroundNet(design: CircuitDesign, netlist: Netlist): string | null {
  for (const c of design.components) {
    if (!isMcu(c.kind)) continue;
    for (const pin of boardDef(c.kind).pins) {
      if (pin.kind !== 'ground') continue;
      const net = netOfPin(netlist, c.id, pin.id);
      if (net) return net.id;
    }
  }
  return null;
}

/**
 * Deterministic DC branch analyser - engine id `deterministic-branch-v1`.
 *
 * ## What this engine is
 * A topological branch solver for the series/parallel DC circuits covered by the
 * LED experiment. It is an *educational* model, not a SPICE simulation:
 *
 *  - Nets are found exactly, from the real breadboard strip rules.
 *  - Every conducting path from supply + to supply - is enumerated.
 *  - Each path is then solved as an independent series branch.
 *
 * ## LED model (constant forward-voltage drop)
 * The LED is modelled as the first-year textbook constant-drop device:
 *
 *      I = (V_supply - sum(V_f)) / R_total
 *
 * With V_supply = 5 V, V_f = 2.0 V and R_total = 330 ohm this gives
 * I = 3 / 330 = 9.09 mA, matching the standard hand calculation.
 *
 * When `R_total` is zero there is no external current limit, so the constant-drop
 * model would predict infinite current. In that case - and only in that case -
 * we fall back to the LED's bulk series resistance `rSeries` to produce a finite,
 * clearly-flagged estimate of the destructive current.
 *
 * ## Known limits (reported, never hidden)
 * - DC operating point only. No transient, AC or frequency response.
 * - Capacitors are ideal DC open circuits; they carry no steady-state current.
 * - Branches are solved independently. A component shared between two paths
 *   (a bridged or ladder network) is outside the model and is reported as such
 *   via the `sharedElements` field rather than silently mis-solved.
 */
export const ENGINE_ID = 'deterministic-branch-v1' as const;

export type BlockReason =
  | 'reverse_biased_led'
  | 'supply_below_forward_voltage'
  | 'no_supply'
  | 'no_path';

export interface BranchElement {
  componentId: string;
  label: string;
  kind: ComponentKind;
  /** Pin the branch current enters through. */
  entryPinId: string;
  exitPinId: string;
  /** For polarised parts: true when traversed in the conducting direction. */
  forward: boolean;
  /** Resistance contributed to the branch, ohms. */
  resistanceOhm: number;
  /** Junction drop contributed to the branch, volts. 0 for ohmic parts. */
  forwardVoltageV: number;
  /** True when current through this path produces light. */
  emissive: boolean;
  /** Sub-device label for multi-die parts, e.g. the `G` die of an RGB LED. */
  subLabel: string | null;
}

export interface Branch {
  id: string;
  /** Net ids visited, from supply + to supply -. */
  netPath: string[];
  /** Net names, for feedback text. */
  netNames: string[];
  elements: BranchElement[];
  conducts: boolean;
  blockedReason: BlockReason | null;
  currentA: number;
  /** Sum of external resistors on the branch, ohms. */
  rTotalOhm: number;
  /**
   * The driver's own output resistance, ohms. Zero for the ideal bench supply,
   * 25-40 for a microcontroller pin. It is published separately so the panels
   * can show a derivation that actually reproduces `currentA`: quoting
   * `rTotalOhm` alone made the printed sum disagree with the printed answer.
   */
  rSourceOhm: number;
  /** Sum of LED forward-voltage drops on the branch, volts. */
  vfSumV: number;
  /** True when the only current limit is the LED's own bulk resistance. */
  unlimited: boolean;
  /** Which driver pushed this branch: the supply, or a microcontroller pin. */
  driverId: string;
  driverLabel: string;
  driverVolts: number;
}

export interface ComponentMeasurement {
  componentId: string;
  label: string;
  kind: ComponentKind;
  /** Current through the part, amps (signed: positive = pin0 to pin1). */
  currentA: number;
  /** Voltage across the part, volts. */
  voltageV: number;
  powerW: number;
  /** LED only. */
  lit?: boolean;
  brightness?: number;
  reverseBiased?: boolean;
  /** True when both pins land on the same net, shorting the part out. */
  shorted?: boolean;
  /** Switches, push buttons and fuses: the device is an open circuit. */
  open?: boolean;
  /** Fuse carrying more than its rating. */
  overRating?: boolean;
  /** RGB LED: which dies are lit, e.g. ['R','B']. */
  litChannels?: string[];
}

export interface CircuitAnalysis {
  engine: typeof ENGINE_ID;
  /** The analysis completed. This says nothing about whether the circuit is correct. */
  completed: boolean;
  netlist: Netlist;
  supply:
    | {
        componentId: string;
        label: string;
        volts: number;
        posNet: string | null;
        negNet: string | null;
        posNetName: string;
        negNetName: string;
      }
    | null;
  branches: Branch[];
  measurements: ComponentMeasurement[];
  /**
   * DC potential of each net, volts, referenced to the supply's negative
   * terminal. Only nets that lie on a conducting path get an entry: a net that
   * is floating has no defined potential, and saying so is more honest than
   * reporting 0 V.
   */
  nodeVoltages: Record<string, number>;
  /** Net id used as the 0 V reference. */
  groundNet: string | null;
  /** Everything pushing current: the supply, plus any driven MCU pins. */
  drivers: Driver[];
  /** Total current delivered by the supply, amps. */
  supplyCurrentA: number;
  supplyPowerW: number;
  /** Component ids that appear on more than one branch (outside the model). */
  sharedElements: string[];
  /** Capacitors found on a would-be DC path (blocking it). */
  dcBlockedBy: string[];
  /** Devices that are open: switches that are off, fuses that have blown. */
  openDevices: Array<{ componentId: string; reason: string }>;
  notes: string[];
}

const MAX_DEPTH = 14;
const MAX_PATHS = 64;

/**
 * One traversable edge in the net graph.
 *
 * Built from a component's `deviceEdges()`, so a part with more than two pins
 * (a potentiometer's two track halves, an RGB LED's three dies) contributes
 * several edges without the solver needing to know what kind it is.
 */
interface Edge {
  componentId: string;
  /** Distinguishes several edges belonging to the same component. */
  edgeKey: string;
  from: string;
  to: string;
  entryPinId: string;
  exitPinId: string;
  resistanceOhm: number;
  forwardVoltageV: number;
  /** True when traversing this edge in its conducting direction. */
  forward: boolean;
  polarised: boolean;
  emissive: boolean;
  subLabel: string | null;
}

export function analyzeCircuit(design: CircuitDesign): CircuitAnalysis {
  const netlist = buildNetlist(design);
  const notes: string[] = [];
  const byId = new Map(design.components.map((c) => [c.id, c]));

  /* ---------- supply ---------- */
  // Either kind of source drives the circuit; the bench supply wins if both
  // are present, since that is what the experiment briefs specify.
  // Any source kind drives the circuit. The bench supply wins when several are
  // present, since that is what the experiment briefs specify.
  const source =
    design.components.find((c) => c.kind === 'dc_source') ??
    design.components.find((c) => isSource(c.kind)) ??
    null;
  const posNet = source ? netOfPin(netlist, source.id, 'pos') : undefined;
  const negNet = source ? netOfPin(netlist, source.id, 'neg') : undefined;

  const supply = source
    ? {
        componentId: source.id,
        label: source.label,
        volts: source.value,
        posNet: posNet?.id ?? null,
        negNet: negNet?.id ?? null,
        posNetName: posNet?.name ?? 'unconnected',
        negNetName: negNet?.name ?? 'unconnected',
      }
    : null;

  /* ---------- build the DC edge list from each device's internal paths ---------- */
  const edges: Edge[] = [];
  const dcBlockedBy: string[] = [];
  const openDevices: Array<{ componentId: string; reason: string }> = [];

  for (const c of design.components) {
    if (isSource(c.kind) || c.kind === 'breadboard') continue;

    for (const de of deviceEdges(c)) {
      const nFrom = netOfPin(netlist, c.id, de.fromPin);
      const nTo = netOfPin(netlist, c.id, de.toPin);
      if (!nFrom || !nTo) continue;
      if (nFrom.id === nTo.id) continue; // shorted out; carries no branch current

      if (!de.conducts) {
        if (de.openReason === 'dc_blocked') dcBlockedBy.push(c.id);
        else if (de.openReason) openDevices.push({ componentId: c.id, reason: de.openReason });
        continue;
      }

      const key = `${de.fromPin}>${de.toPin}`;
      const base = {
        componentId: c.id,
        edgeKey: key,
        resistanceOhm: de.resistanceOhm,
        forwardVoltageV: de.forwardVoltageV,
        polarised: de.polarised,
        emissive: de.emissive === true,
        subLabel: de.label ?? null,
      };
      // Forward traversal, then the reverse one. A polarised device still gets
      // a reverse edge so the solver can *detect* a backwards part and say so,
      // rather than silently showing an open circuit.
      edges.push({ ...base, from: nFrom.id, to: nTo.id, entryPinId: de.fromPin, exitPinId: de.toPin, forward: true });
      edges.push({ ...base, from: nTo.id, to: nFrom.id, entryPinId: de.toPin, exitPinId: de.fromPin, forward: !de.polarised });
    }
  }

  const adjacency = new Map<string, Edge[]>();
  for (const e of edges) {
    const list = adjacency.get(e.from);
    if (list) list.push(e);
    else adjacency.set(e.from, [e]);
  }

  /* ---------- drivers ---------- */
  // Anything that can push current into the circuit. The bench supply is one;
  // so is every microcontroller pin the student's code is driving HIGH. Each is
  // solved against the same ground, which is what lets a sketch light an LED.
  const drivers: Driver[] = [];
  const groundNet = supply?.negNet ?? mcuGroundNet(design, netlist);

  if (supply?.posNet) {
    drivers.push({
      id: supply.componentId,
      label: supply.label,
      netId: supply.posNet,
      volts: supply.volts,
      resistanceOhm: 0,
      kind: 'supply',
    });
  }

  for (const c of design.components) {
    if (!isMcu(c.kind)) continue;
    const board = boardDef(c.kind);

    /*
     * The board's 5V and 3V3 header pins are real supplies.
     *
     * Only driven I/O pins used to count as drivers, so a sensor divider wired
     * to the 5V rail -- the single most common thing a student wires on a
     * breadboard -- sat at no potential at all, and analogRead() came back 0
     * however the knob was turned. The regulator behind these pins is stiff,
     * unlike an I/O pin's 25-40 ohm output stage, so the source resistance is
     * nominal rather than the pin figure.
     */
    for (const rail of ['v5', 'v33'] as const) {
      const pin = board.pins.find((bp) => bp.id === rail);
      if (!pin) continue;
      // Every header pin is given a net whether or not anything is attached, so
      // presence of a net is not evidence of a connection. A header pin can
      // only reach the circuit through a wire, so that is what is checked --
      // otherwise an untouched board contributed a phantom 5 V driver sitting
      // on an island, which showed up in the drivers list and in the tutor's
      // evidence as a supply the student had not wired.
      const wired = design.wires.some(
        (w) =>
          (w.a.kind === 'pin' && w.a.componentId === c.id && w.a.pinId === rail) ||
          (w.b.kind === 'pin' && w.b.componentId === c.id && w.b.pinId === rail),
      );
      if (!wired) continue;
      const net = netOfPin(netlist, c.id, rail);
      if (!net) continue;
      drivers.push({
        id: `${c.id}.${rail}`,
        label: `${c.label} ${pin.label}`,
        netId: net.id,
        volts: rail === 'v5' ? 5 : 3.3,
        resistanceOhm: 0.5,
        kind: 'mcu_pin',
        componentId: c.id,
        pinId: rail,
      });
    }

    for (const [pinId, state] of Object.entries(c.mcuPins ?? {})) {
      if (state.mode !== 'output' || state.value <= 0) continue;
      const net = netOfPin(netlist, c.id, pinId);
      if (!net) continue;
      const pin = board.pins.find((bp) => bp.id === pinId);
      drivers.push({
        id: `${c.id}.${pinId}`,
        label: `${c.label} pin ${pin?.label ?? pinId}`,
        netId: net.id,
        // A PWM duty is reported as its mean level, which is what a DC
        // operating-point solver can honestly say about a square wave.
        volts: board.logicVolts * state.value,
        resistanceOhm: board.pinResistance,
        kind: 'mcu_pin',
        componentId: c.id,
        pinId,
      });
    }
  }

  /* ---------- enumerate simple paths from each driver to ground ---------- */
  const rawPaths: Array<{ path: Edge[]; driver: Driver }> = [];

  if (groundNet) {
    for (const driver of drivers) {
      if (driver.netId === groundNet) continue;
      const visitedNets = new Set<string>([driver.netId]);
      // Track used *edges*, not used components. A component with several
      // internal paths may legitimately contribute more than one of them to a
      // single loop — a potentiometer wired across its whole track is exactly
      // that: current enters pin 1, leaves at the wiper, and continues to pin 3.
      const usedEdges = new Set<string>();
      const edgeId = (e: Edge): string => `${e.componentId}|${e.edgeKey}`;
      const stack: Edge[] = [];

      const dfs = (net: string, depth: number): void => {
        if (rawPaths.length >= MAX_PATHS || depth > MAX_DEPTH) return;
        for (const e of adjacency.get(net) ?? []) {
          if (usedEdges.has(edgeId(e))) continue;
          if (e.to === groundNet) {
            rawPaths.push({ path: [...stack, e], driver });
            if (rawPaths.length >= MAX_PATHS) return;
            continue;
          }
          if (visitedNets.has(e.to)) continue;
          visitedNets.add(e.to);
          usedEdges.add(edgeId(e));
          stack.push(e);
          dfs(e.to, depth + 1);
          stack.pop();
          usedEdges.delete(edgeId(e));
          visitedNets.delete(e.to);
        }
      };
      dfs(driver.netId, 0);
    }

    if (rawPaths.length >= MAX_PATHS) {
      notes.push(
        `Path enumeration stopped at ${MAX_PATHS} paths. The reported currents cover the first ${MAX_PATHS} paths only.`,
      );
    }
  }

  const netName = (id: string): string => netlist.nets.find((n) => n.id === id)?.name ?? id;

  /* ---------- solve each branch ---------- */
  const branches: Branch[] = rawPaths.map(({ path, driver }, index) => {
    const elements: BranchElement[] = path.map((e) => {
      const comp = byId.get(e.componentId);
      const kind: ComponentKind = comp ? comp.kind : 'resistor';
      return {
        componentId: e.componentId,
        label: comp ? comp.label : e.componentId,
        kind,
        entryPinId: e.entryPinId,
        exitPinId: e.exitPinId,
        // The edge already knows whether this traversal is the conducting
        // direction, including for parts with several internal paths.
        forward: e.forward,
        resistanceOhm: e.resistanceOhm,
        forwardVoltageV: e.forwardVoltageV,
        emissive: e.emissive,
        subLabel: e.subLabel,
      };
    });

    const netPath = [path[0]?.from ?? '', ...path.map((e) => e.to)].filter((s) => s.length > 0);
    const rTotalOhm = elements.reduce((sum, el) => sum + el.resistanceOhm, 0);
    // Every junction on the branch drops its forward voltage, whatever the part.
    const vfSumV = elements.reduce((sum, el) => sum + el.forwardVoltageV, 0);
    const junctions = elements.filter((el) => el.forwardVoltageV > 0);
    const rBulk = junctions.length * RED_LED.rSeries;
    const vs = driver.volts;
    // A microcontroller pin is not an ideal source: its output impedance is in
    // series with whatever the student connected.
    const rTotalWithDriver = rTotalOhm + driver.resistanceOhm;

    let conducts = true;
    let blockedReason: BlockReason | null = null;
    let currentA = 0;
    let unlimited = false;

    if (drivers.length === 0) {
      conducts = false;
      blockedReason = 'no_supply';
    } else if (elements.some((el) => !el.forward)) {
      conducts = false;
      blockedReason = 'reverse_biased_led';
    } else if (vs <= vfSumV) {
      conducts = false;
      blockedReason = 'supply_below_forward_voltage';
    } else if (rTotalWithDriver > 0) {
      currentA = (vs - vfSumV) / rTotalWithDriver;
    } else {
      // No external current limit: fall back to the LED bulk resistance so the
      // reported figure is finite and honestly flagged as destructive.
      unlimited = true;
      const rFallback = rBulk > 0 ? rBulk : 1e-3;
      currentA = (vs - vfSumV) / rFallback;
    }

    return {
      id: `B${index + 1}`,
      netPath,
      netNames: netPath.map(netName),
      elements,
      conducts,
      blockedReason,
      currentA,
      rTotalOhm,
      rSourceOhm: driver.resistanceOhm,
      vfSumV,
      unlimited,
      driverId: driver.id,
      driverLabel: driver.label,
      driverVolts: driver.volts,
    };
  });

  /* ---------- shared-element detection (model limit) ---------- */
  const appearance = new Map<string, number>();
  for (const b of branches) {
    for (const el of b.elements) {
      appearance.set(el.componentId, (appearance.get(el.componentId) ?? 0) + 1);
    }
  }
  const sharedElements = [...appearance.entries()].filter(([, n]) => n > 1).map(([id]) => id);
  if (sharedElements.length > 0) {
    notes.push(
      'One or more components lie on several current paths. The branch analyser solves paths independently, so these currents are approximate - this topology is outside the supported model.',
    );
  }
  if (dcBlockedBy.length > 0) {
    notes.push(
      'Capacitors are ideal open circuits at DC, so they carry no steady-state current in this model.',
    );
  }

  /* ---------- per-component measurements ---------- */
  // Derived from the device edges that actually carried current, so a part with
  // several internal paths (a pot's two halves, an RGB LED's three dies) is
  // measured correctly rather than assumed to be a single two-pin element.
  const measurements: ComponentMeasurement[] = design.components
    .filter((c) => c.kind !== 'breadboard' && !isSource(c.kind))
    .map((c) => {
      const myEdges = deviceEdges(c);

      // A part is shorted out only if every one of its internal paths is.
      const shorted =
        myEdges.length > 0 &&
        myEdges.every((de) => {
          const a = netOfPin(netlist, c.id, de.fromPin);
          const b = netOfPin(netlist, c.id, de.toPin);
          return Boolean(a && b && a.id === b.id);
        });

      let currentA = 0;
      let voltageV = 0;
      let reverseOnPath = false;
      let litCurrent = 0;
      const litChannels: string[] = [];

      for (const b of branches) {
        for (const el of b.elements) {
          if (el.componentId !== c.id) continue;
          if (!el.forward && el.forwardVoltageV > 0) reverseOnPath = true;
          if (!b.conducts) continue;
          const signed = el.forward ? b.currentA : -b.currentA;
          currentA += signed;
          // Voltage across this part on this branch: IR for ohmic paths, the
          // junction drop for diodes and LEDs.
          voltageV += el.forwardVoltageV > 0
            ? el.forwardVoltageV
            : Math.abs(signed) * el.resistanceOhm;
          if (el.emissive && b.currentA >= RED_LED.iVisible) {
            litCurrent = Math.max(litCurrent, b.currentA);
            if (el.subLabel && !litChannels.includes(el.subLabel)) litChannels.push(el.subLabel);
          }
        }
      }

      const m: ComponentMeasurement = {
        componentId: c.id,
        label: c.label,
        kind: c.kind,
        currentA,
        voltageV,
        powerW: Math.abs(currentA) * voltageV,
      };

      if (c.kind === 'led' || c.kind === 'rgb_led') {
        m.lit = litCurrent >= RED_LED.iVisible;
        m.brightness = Math.max(0, Math.min(1, Math.sqrt(Math.max(0, litCurrent) / RED_LED.iRated)));
        m.reverseBiased = reverseOnPath && litCurrent === 0;
        if (litChannels.length > 0) m.litChannels = litChannels;
      }
      if (c.kind === 'diode') m.reverseBiased = reverseOnPath && currentA === 0;
      if (c.kind === 'switch' || c.kind === 'pushbutton') m.open = c.closed !== true;
      if (c.kind === 'fuse') {
        m.open = c.blown === true;
        // Report the fuse against its own rating, so the UI can flag it.
        m.overRating = !c.blown && Math.abs(currentA) > Math.max(0, c.value);
      }
      if (shorted) m.shorted = true;
      return m;
    });

  /* ---------- node potentials ---------- */
  // Walk each conducting branch from the supply's positive net, subtracting
  // each element's drop. This is what the multimeter reads.
  /*
   * Node potentials, measured from whichever driver feeds the branch.
   *
   * This used to be gated on the bench supply existing. In a board-only
   * circuit `supply` is null, so not a single net was assigned a potential --
   * which meant digitalRead() and analogRead() could never see anything a
   * microcontroller itself was powering. A potentiometer across the board's
   * own 5V and GND pins read 0 no matter where the wiper sat.
   */
  const nodeVoltages: Record<string, number> = {};
  if (groundNet) {
    nodeVoltages[groundNet] = 0;

    // Every driver holds its own net at its open-circuit potential. A 5 V rail
    // with nothing drawing from it still sits at 5 V.
    for (const d of drivers) {
      if (d.netId !== groundNet) nodeVoltages[d.netId] = d.volts;
    }

    for (const b of branches) {
      if (!b.conducts) continue;
      // Once current flows, the driver's own output impedance drops some of
      // it before the first net: an I/O pin is not an ideal source.
      let v = b.driverVolts - b.currentA * b.rSourceOhm;
      const start = b.netPath[0];
      if (start && start !== groundNet) {
        const prev = nodeVoltages[start];
        // Branches are solved independently, so two sharing a driver can
        // disagree about the loaded potential. Take the more loaded of the
        // two rather than whichever happened to be enumerated last.
        nodeVoltages[start] = prev === undefined ? v : Math.min(prev, v);
      }

      b.elements.forEach((el, i) => {
        const drop =
          el.forwardVoltageV > 0 ? el.forwardVoltageV : b.currentA * el.resistanceOhm;
        v -= drop;
        const netId = b.netPath[i + 1];
        // The final hop lands on ground, which is already pinned at 0 V.
        if (netId && netId !== groundNet) nodeVoltages[netId] = v;
      });
    }
  }

  // Potentials also reach nets that carry no current at all. A closed switch
  // feeding a high-impedance input passes no current, yet the input genuinely
  // sits at the source potential — and that is exactly what digitalRead must
  // see. Since I = 0 through those edges, V = IR = 0 across them, so the
  // potential propagates unchanged. Junctions (anything with a forward drop)
  // are excluded: a non-conducting diode does not equalise its two sides.
  const carrying = new Set<string>();
  for (const b of branches) {
    if (!b.conducts) continue;
    for (const el of b.elements) carrying.add(`${el.componentId}|${el.entryPinId}>${el.exitPinId}`);
  }

  const zeroDropAdjacency = new Map<string, string[]>();
  for (const e of edges) {
    if (e.forwardVoltageV !== 0) continue;
    const key = `${e.componentId}|${e.edgeKey}`;
    const reverseKey = `${e.componentId}|${e.exitPinId}>${e.entryPinId}`;
    if (carrying.has(key) || carrying.has(reverseKey)) continue;
    const list = zeroDropAdjacency.get(e.from);
    if (list) list.push(e.to);
    else zeroDropAdjacency.set(e.from, [e.to]);
  }

  const queue = Object.keys(nodeVoltages);
  while (queue.length > 0) {
    const net = queue.shift() as string;
    const v = nodeVoltages[net];
    if (v === undefined) continue;
    for (const next of zeroDropAdjacency.get(net) ?? []) {
      if (nodeVoltages[next] !== undefined) continue;
      nodeVoltages[next] = v;
      queue.push(next);
    }
  }

  const supplyCurrentA = branches.reduce((sum, b) => sum + (b.conducts ? b.currentA : 0), 0);

  return {
    engine: ENGINE_ID,
    completed: true,
    netlist,
    supply,
    branches,
    measurements,
    nodeVoltages,
    groundNet,
    drivers,
    supplyCurrentA,
    // Each branch is powered by its own driver, which may be a microcontroller
    // pin rather than the bench supply. Multiplying the total current by
    // `supply.volts` reported 0 W for every code-driven circuit.
    supplyPowerW: branches.reduce(
      (sum, b) => sum + (b.conducts ? b.currentA * b.driverVolts : 0),
      0,
    ),
    sharedElements,
    dcBlockedBy,
    openDevices,
    notes,
  };
}

/** Pins that are not electrically joined to anything else. */
export function findFloatingPins(
  design: CircuitDesign,
  netlist: Netlist,
): Array<{ componentId: string; label: string; pinId: string; pinLabel: string }> {
  const out: Array<{ componentId: string; label: string; pinId: string; pinLabel: string }> = [];
  for (const c of design.components) {
    if (c.kind === 'breadboard') continue;
    // Unused header pins on a dev board are entirely normal — nobody wires all
    // twenty — so flagging them as floating would bury the real faults.
    if (isMcu(c.kind)) continue;
    for (const p of resolvePins(c)) {
      const net = netOfPin(netlist, c.id, p.pinId);
      // A pin is floating when it has no net, or its net holds no other pin.
      const otherPins = net
        ? net.pins.filter((q) => !(q.componentId === c.id && q.pinId === p.pinId))
        : [];
      if (!net || otherPins.length === 0) {
        out.push({ componentId: c.id, label: c.label, pinId: p.pinId, pinLabel: p.label });
      }
    }
  }
  return out;
}

/* --------------------------------------------------------------------------
 * Instruments
 * -------------------------------------------------------------------------- */

export interface MeterReading {
  /** Formatted for the instrument's display. */
  display: string;
  /** What is being measured, or why there is no reading. */
  caption: string;
  /** The measured value in volts, or null when there is nothing to read. */
  volts: number | null;
  live: boolean;
}

/**
 * Read a multimeter probed across two nets.
 *
 * An ideal voltmeter contributes no device edges, so attaching it cannot change
 * the circuit — the reading is simply the difference between two solved node
 * potentials. A probe on a floating net has no defined potential, and that is
 * reported as such rather than silently read as 0 V.
 */
export function readMultimeter(analysis: CircuitAnalysis, componentId: string): MeterReading {
  const red = analysis.netlist.pinNet[`${componentId}.red`];
  const black = analysis.netlist.pinNet[`${componentId}.black`];

  if (!red || !black) {
    return {
      display: '- - -',
      caption: !red && !black ? 'BOTH PROBES FREE' : 'ONE PROBE FREE',
      volts: null,
      live: false,
    };
  }
  if (red === black) {
    return { display: '0.000 V', caption: 'PROBES ON ONE NET', volts: 0, live: true };
  }
  if (!analysis.supply) {
    return { display: '- - -', caption: 'NO SUPPLY', volts: null, live: false };
  }

  const vRed = analysis.nodeVoltages[red];
  const vBlack = analysis.nodeVoltages[black];
  if (vRed === undefined || vBlack === undefined) {
    return {
      display: '- - -',
      caption: 'PROBE ON FLOATING NET',
      volts: null,
      live: false,
    };
  }

  const volts = vRed - vBlack;
  const magnitude = Math.abs(volts);
  const display =
    magnitude >= 1
      ? `${volts.toFixed(3)} V`
      : magnitude >= 1e-3
        ? `${(volts * 1000).toFixed(1)} mV`
        : `${(volts * 1e6).toFixed(0)} \u00b5V`;

  const redName = analysis.netlist.nets.find((n) => n.id === red)?.name ?? '?';
  const blackName = analysis.netlist.nets.find((n) => n.id === black)?.name ?? '?';

  return { display, caption: `${redName} \u2192 ${blackName}`, volts, live: true };
}
