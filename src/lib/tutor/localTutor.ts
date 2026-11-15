import { formatAmps, formatOhms, formatVolts } from '../format';
import type { HintLevel, TutorEvidence } from './types';

/**
 * Local Demo Tutor — a deterministic, rule-based explainer.
 *
 * Used when no ANTHROPIC_API_KEY is configured, so the laboratory is fully
 * demonstrable offline. It is NOT a language model and is always labelled as
 * such in the UI. Each diagnostic code has hand-written text at all three hint
 * levels, written by the same pedagogical rules as the Claude system prompt.
 */

interface LevelledExplanation {
  nudge: (e: Record<string, string | number | boolean>, ev: TutorEvidence) => string;
  explain: (e: Record<string, string | number | boolean>, ev: TutorEvidence) => string;
  solve: (e: Record<string, string | number | boolean>, ev: TutorEvidence) => string;
}

const num = (v: string | number | boolean | undefined, fallback = 0): number =>
  typeof v === 'number' ? v : Number(v ?? fallback) || fallback;

const str = (v: string | number | boolean | undefined, fallback = '?'): string =>
  v === undefined ? fallback : String(v);

const EXPLANATIONS: Record<string, LevelledExplanation> = {
  NO_SUPPLY: {
    nudge: () =>
      'Before anything else: where is the energy in this circuit coming from? Look at what is on the bench and ask yourself what is missing.',
    explain: (_e, ev) =>
      `There is no DC source on the bench, so there is nothing to drive current. The brief asks for a ${ev.experiment.supplyVolts} V supply. What does a circuit need in order for charge to keep moving around the loop?`,
    solve: (_e, ev) =>
      `1. Open the component library and drag **DC Power Supply** onto the bench.\n2. Set its voltage to **${ev.experiment.supplyVolts} V** in the properties panel.\n3. Run a jumper from its **+** post to a hole on the **+ rail**, and from its **−** post to the **− rail**.\n4. Re-run the simulation: the supply current should stop reading 0 A.`,
  },
  NO_LED: {
    nudge: () => 'The experiment is about lighting something. Is that something actually on the board yet?',
    explain: () =>
      'No LED is placed, so there is no load to test. The LED is the device under study here — its polarity and current are what the whole exercise is about. What would you place, and which way round does it need to go?',
    solve: () =>
      '1. Drag **LED (5mm)** from the library onto the breadboard.\n2. Note which lead is the anode (A, the longer lead, flat-sided body marker on the cathode).\n3. Seat it so its two leads land in **different columns** — if both leads share a column they are shorted together.\n4. Run the simulation again.',
  },
  MISSING_RESISTOR: {
    nudge: () =>
      'An LED is not a resistor — its forward voltage barely changes as current rises. So what actually sets the current in your loop? Have a look at what is in series with the LED.',
    explain: (e, ev) => {
      const i = num(e.estimatedCurrentA);
      const max = num(e.ledAbsMaxA, ev.ledModel.iAbsMaxA);
      const detail =
        i > 0
          ? ` With nothing to limit it, the model predicts ${formatAmps(i)} — roughly ${(i / max).toFixed(0)}× the ${formatAmps(max)} absolute maximum.`
          : '';
      return `There is no current-limiting resistance in series with the LED.${detail} A diode's I-V curve is nearly vertical past its knee, so a tiny change in voltage produces an enormous change in current: the LED cannot limit itself. What component would you put in the loop to set the current, and how would you choose its value?`;
    },
    solve: (e, ev) => {
      const vs = ev.experiment.supplyVolts;
      const vf = ev.ledModel.vfNominalV;
      const target = ev.experiment.targetCurrent.max;
      const rMin = Math.ceil((vs - vf) / num(e.ledAbsMaxA, ev.ledModel.iAbsMaxA));
      const rGood = Math.round((vs - vf) / target);
      return `1. Apply KVL around the loop: **V_supply = V_f + I·R**, so **R = (V_supply − V_f) / I**.\n2. With V_supply = ${formatVolts(vs)} and V_f = ${formatVolts(vf)}, you have ${formatVolts(vs - vf)} to drop across the resistor.\n3. For the ${formatAmps(target)} target: R = ${formatVolts(vs - vf)} / ${formatAmps(target)} ≈ **${formatOhms(rGood)}**. The absolute floor before you exceed the LED's ${formatAmps(num(e.ledAbsMaxA, ev.ledModel.iAbsMaxA))} maximum is ${formatOhms(rMin)}.\n4. Place a resistor, set it to **${formatOhms(330)}** (the standard lab choice), and seat it **in series** — one lead sharing a column with the supply feed, the other sharing a column with the LED anode.\n5. Re-run: you should read about ${formatAmps((vs - vf) / 330)}.`;
    },
  },
  LED_REVERSED: {
    nudge: () =>
      'Current can only pass through a diode one way. Look at which of your LED\'s two leads the current reaches first, and compare that with which lead is the anode.',
    explain: (e) =>
      `The LED is in the loop but blocking. Its anode (A) is in hole **${str(e.anodeHole)}** and its cathode (K) is in hole **${str(e.cathodeHole)}** — current arrives at the cathode first. A PN junction only conducts when the anode is at the higher potential; reverse-biased, it stands off the supply voltage and passes essentially no current, which is why the measured current is exactly 0 A. What does that tell you about which way the LED has to face?`,
    solve: (e) =>
      `1. Select the LED on the board.\n2. Press **R** (or use Rotate in the properties panel) to turn it 180°.\n3. After the rotation the anode should sit in **${str(e.cathodeHole)}** and the cathode in **${str(e.anodeHole)}** — the anode must be on the side fed from the supply +.\n4. Re-run the simulation. The current should jump from 0 A to a non-zero value and the LED should light in the 3D view.\n5. Tip for the physical lab: the cathode lead is the shorter one, and the LED body has a flat spot on that side.`,
  },
  OPEN_CIRCUIT: {
    nudge: (e) =>
      `Current needs a complete loop. Start at net **${str(e.posNet)}** and try to trace a continuous path back to **${str(e.negNet)}**, hole by hole. Where does your finger stop?`,
    explain: (e) =>
      `The analyser found no conductive path from the supply + net (**${str(e.posNet)}**) back to the − net (**${str(e.negNet)}**), so this is an open circuit and the current is 0 A everywhere. Remember that the centre channel splits the board: holes A–E of a column are one strip, F–J are a completely separate strip. Which of your connections crosses that channel, and is it actually bridged?`,
    solve: (e) =>
      `1. List the nets in order: supply + → **${str(e.posNet)}** → ... → **${str(e.negNet)}** → supply −.\n2. For each component, check that its two leads sit in **different** columns, and that each column is reached by a wire or another component lead.\n3. The usual culprits are: a missing return jumper to the − rail, and a lead sitting one hole short of the strip you meant.\n4. Add the missing jumper (click one hole, then click the other) and re-run.`,
  },
  FLOATING_PIN: {
    nudge: (e) =>
      `Something in your circuit is connected at one end only. ${str(e.pins, 'One or more pins')} — pick one of those and ask what it is supposed to join to.`,
    explain: (e) =>
      `These pins share a net with nothing else: **${str(e.pins, 'see the issues list')}**. A pin on its own net is electrically dangling, so no current can pass through it. Every pin in a working circuit must share a strip with at least one other pin or a jumper. Which strip was each of those pins meant to land on?`,
    solve: (e) =>
      `1. Select each listed part and read its pin holes in the properties panel: **${str(e.pins, 'see the issues list')}**.\n2. For each dangling pin, decide which net it belongs to in your intended circuit.\n3. Either re-seat the component so the lead lands in the right column, or add a jumper from that hole to the target strip.\n4. Re-run the simulation and confirm the floating-pin error has cleared.`,
  },
  SUPPLY_UNCONNECTED: {
    nudge: () =>
      'The supply is on the bench, but is it actually joined to the board? Look at its two binding posts.',
    explain: (e) =>
      `The supply's terminals are not both wired to the breadboard: + is on net **${str(e.posNet)}** and − on net **${str(e.negNet)}**. A source with a dangling terminal cannot drive current, because there is no complete loop through it. How do you get from a binding post to a breadboard strip?`,
    solve: () =>
      '1. Enable **Wire** mode in the toolbar (or press **W**).\n2. Click the supply\'s red **+** post, then click a hole on the top **+ rail**.\n3. Click the black **−** post, then click a hole on the **− rail**.\n4. Both rails run the full width of the board, so you can then feed your circuit from any hole along them.\n5. Re-run the simulation.',
  },
  SUPPLY_SHORT: {
    nudge: (e) =>
      `Both of your supply terminals seem to end up in the same place. What happens to the voltage across a source whose two terminals are joined by a piece of wire?`,
    explain: (e) =>
      `Supply + and − both land on net **${str(e.net)}**. That is a dead short across the source: the whole ${formatVolts(num(e.supplyV))} appears across a near-zero resistance, so in a real lab the bench supply would hit its current limit or trip. No voltage is left for your circuit. Which of your jumpers connects the two rails together?`,
    solve: (e) =>
      `1. Find the jumper that bridges the + and − nets — they have collapsed into net **${str(e.net)}**.\n2. Select that wire and press **Delete**.\n3. Confirm the + rail and − rail show as two different nets in the measurement panel.\n4. Re-run the simulation.`,
  },
  COMPONENT_SHORTED: {
    nudge: (e) =>
      `Look closely at where ${str(e.component)}'s two leads are sitting. On a breadboard, which holes are already joined together underneath?`,
    explain: (e) =>
      `Both leads of **${str(e.component)}** land on the same net, so there is 0 V across it and no current through it — it has been bypassed entirely. The five holes A–E of one column are a single metal strip, so putting both leads in one column shorts the component out. Which way would you have to orient it so its leads sit on two different strips?`,
    solve: (e) =>
      `1. Select **${str(e.component)}**.\n2. Press **R** until it lies horizontally, spanning several columns rather than sitting within one.\n3. Check the properties panel: its two pins must show **different** hole columns and different net names.\n4. Re-run the simulation — the component should now carry current.`,
  },
  OVERCURRENT: {
    nudge: (e) =>
      `The loop conducts, which is good. Now compare the current the analyser reports with the LED's maximum rating — what do you notice?`,
    explain: (e, ev) =>
      `Branch ${str(e.branch)} carries **${formatAmps(num(e.currentA))}**, above this LED's ${formatAmps(num(e.ledAbsMaxA, ev.ledModel.iAbsMaxA))} absolute maximum. The analyser computed it as (${formatVolts(ev.experiment.supplyVolts)} − ${formatVolts(num(e.vfSumV))}) / ${formatOhms(num(e.rTotalOhm))}. In a real lab the die would overheat within seconds. Rearranging that expression, what resistance would you need to bring the current down?`,
    solve: (e, ev) =>
      `1. Start from **R = (V_supply − V_f) / I**.\n2. The headroom across the resistor is ${formatVolts(ev.experiment.supplyVolts)} − ${formatVolts(num(e.vfSumV))} = ${formatVolts(ev.experiment.supplyVolts - num(e.vfSumV))}.\n3. To stay under the ${formatAmps(num(e.ledAbsMaxA, ev.ledModel.iAbsMaxA))} maximum you need at least **${formatOhms(num(e.minResistorOhm))}**. To hit the brief's ${formatAmps(ev.experiment.targetCurrent.max)} target, use about **${formatOhms(Math.round((ev.experiment.supplyVolts - num(e.vfSumV)) / ev.experiment.targetCurrent.max))}**.\n4. Select the resistor and set its value to **330 Ω** in the properties panel.\n5. Re-run: you should read ≈ ${formatAmps((ev.experiment.supplyVolts - num(e.vfSumV)) / 330)}.`,
  },
  ABOVE_RATED_CURRENT: {
    nudge: () =>
      'Your circuit works and the LED lights. Compare the current with the *recommended* operating current, not just the absolute maximum — is there a difference?',
    explain: (e, ev) =>
      `Branch ${str(e.branch)} carries **${formatAmps(num(e.currentA))}**, which is above the ${formatAmps(num(e.ledRatedA, ev.ledModel.iRatedA))} recommended continuous current but still below the absolute maximum. The LED will be bright but will run hot and degrade faster. Datasheets quote both figures for exactly this reason. Would you ship a design that sits in that gap?`,
    solve: (e, ev) =>
      `1. Currently R = ${formatOhms(num(e.rTotalOhm))}, giving ${formatAmps(num(e.currentA))}.\n2. For the ${formatAmps(ev.experiment.targetCurrent.max)} rated point: R = ${formatVolts(ev.experiment.supplyVolts - ev.ledModel.vfNominalV)} / ${formatAmps(ev.experiment.targetCurrent.max)} ≈ ${formatOhms(Math.round((ev.experiment.supplyVolts - ev.ledModel.vfNominalV) / ev.experiment.targetCurrent.max))}.\n3. Round **up** to the next standard E24 value — **330 Ω** is the conventional choice for a 5 V rail.\n4. Re-run and confirm the current lands inside the ${formatAmps(ev.experiment.targetCurrent.min)}–${formatAmps(ev.experiment.targetCurrent.max)} band.`,
  },
  LED_TOO_DIM: {
    nudge: () =>
      'The polarity and the loop are fine. Now look at the size of the series resistance against the current you are getting — is it doing too much?',
    explain: (e, ev) =>
      `Branch ${str(e.branch)} carries only **${formatAmps(num(e.currentA))}** with ${formatOhms(num(e.rTotalOhm))} in series. Light output is roughly proportional to forward current, so at this level the die is conducting but produces almost no visible light. The brief asks for ${formatAmps(ev.experiment.targetCurrent.min)}–${formatAmps(ev.experiment.targetCurrent.max)}. Which direction does the resistance need to move, and by roughly what factor?`,
    solve: (e, ev) =>
      `1. You have ${formatVolts(ev.experiment.supplyVolts - ev.ledModel.vfNominalV)} across the resistor.\n2. For ${formatAmps(ev.experiment.targetCurrent.max)}: R = ${formatVolts(ev.experiment.supplyVolts - ev.ledModel.vfNominalV)} / ${formatAmps(ev.experiment.targetCurrent.max)} ≈ ${formatOhms(Math.round((ev.experiment.supplyVolts - ev.ledModel.vfNominalV) / ev.experiment.targetCurrent.max))}.\n3. That is about ${(num(e.rTotalOhm) / Math.max(1, Math.round((ev.experiment.supplyVolts - ev.ledModel.vfNominalV) / ev.experiment.targetCurrent.max))).toFixed(0)}× smaller than your current ${formatOhms(num(e.rTotalOhm))}.\n4. Set the resistor to **330 Ω** and re-run.`,
  },
  SUPPLY_BELOW_VF: {
    nudge: () =>
      'Every diode needs a minimum voltage before it conducts at all. Compare your supply setting with the LED\'s forward voltage.',
    explain: (e) =>
      `The branch needs at least ${formatVolts(num(e.requiredVfSumV))} to turn on, but the supply is set to ${formatVolts(num(e.supplyV))}. Below the forward-voltage knee the junction simply does not conduct, so the current is 0 A regardless of what resistor you fit. What is the minimum supply voltage this circuit could possibly work at?`,
    solve: (e, ev) =>
      `1. The LED needs ${formatVolts(num(e.requiredVfSumV))} before it conducts, and the resistor needs some headroom on top to set the current.\n2. Select the supply and raise its voltage to **${formatVolts(ev.experiment.supplyVolts)}**, as the brief specifies.\n3. That leaves ${formatVolts(ev.experiment.supplyVolts - num(e.requiredVfSumV))} across the resistor.\n4. Re-run: the branch should now conduct.`,
  },
  CAPACITOR_REVERSED: {
    nudge: (e) =>
      `${str(e.component)} is an electrolytic. Those have a marked negative side for a reason — check which rail each of its leads reaches.`,
    explain: (e) =>
      `**${str(e.component)}**'s + lead sits on net ${str(e.plusNet)} and its − lead on net ${str(e.minusNet)} — the opposite of what its polarity marking requires. Reverse-biasing an aluminium electrolytic breaks down the oxide dielectric; they vent, sometimes violently. Which way round should the striped lead face relative to the rails?`,
    solve: (e) =>
      `1. Select **${str(e.component)}**.\n2. Press **R** twice to rotate it 180°.\n3. Confirm in the properties panel that its **+** pin is on the positive rail net.\n4. Re-run the checks.`,
  },
  CAPACITOR_BLOCKS_DC: {
    nudge: () =>
      'Have a look at the current reading for your capacitor. Does the number surprise you? Think about what a capacitor is physically — two plates with an insulator between them.',
    explain: (e) =>
      `**${str(e.component)}** reads 0 A, and that is correct, not a bug. At a steady DC operating point an ideal capacitor is an open circuit: once charged, no further charge flows. Its interesting behaviour is in the *transient* — the RC charging curve — which this DC engine does not simulate. What would you need to change about the analysis to see that?`,
    solve: (e) =>
      `1. Accept the 0 A reading: **${str(e.component)}** is doing its job as a DC block.\n2. For the charging behaviour you would need a transient analysis, which this engine does not provide — only the DC operating point.\n3. The time constant you *could* calculate by hand is **τ = R·C**.\n4. Note this limit in your lab report: the engine is a DC branch analyser, not SPICE.`,
  },
  PCB_MISSING_TRACE: {
    nudge: (e) =>
      `Net ${str(e.net, 'one of your nets')} exists in your schematic. Does it exist in copper?`,
    explain: (e) =>
      `Net **${str(e.net)}** connects ${str(e.padCount, 'several')} pads (${str(e.pads, 'see the ratsnest')}) but has no traces at all. A net is a logical idea from the schematic; on a bare board, pads are only connected if copper joins them. The dashed ratsnest lines show what still needs routing. Which pads does this net need to join?`,
    solve: (e) =>
      `1. Switch on **Route** mode in the PCB toolbar.\n2. Click the first pad of net **${str(e.net)}**, click any intermediate grid points you need to dodge other parts, then click the destination pad.\n3. Keep traces of different nets apart — the clearance rule is 0.25 mm.\n4. Press **Run PCB Checks** again; the ratsnest line for this net should disappear.`,
  },
  PCB_NET_UNCONNECTED: {
    nudge: (e) =>
      `Net ${str(e.net, 'one net')} is partly routed. Is every pad on it reachable from every other pad through copper?`,
    explain: (e) =>
      `Net **${str(e.net)}** splits into **${str(e.islands)}** separate copper islands across ${str(e.traces)} traces. Connectivity on a net is transitive: all of its pads must form one single island. Two pads joined to each other but not to the third still leaves the net broken. Which pad is stranded?`,
    solve: (e) =>
      `1. Look for the remaining dashed ratsnest line on net **${str(e.net)}**.\n2. Route a trace from the stranded pad to any pad already in the main island — it does not matter which, as long as they all join up.\n3. Re-run the checks and confirm the island count drops to 1.`,
  },
  PCB_WRONG_CONNECTION: {
    nudge: () =>
      'One of your traces joins two pads that your schematic says should be separate. Compare the net labels at each end of your traces.',
    explain: (e) =>
      `A trace runs from **${str(e.fromPad)}** (net ${str(e.fromNet)}) to **${str(e.toPad)}** (net ${str(e.toNet)}). Those are different nets, so this trace is a short circuit on the finished board — the fabricator will build exactly what you drew. What was that trace supposed to connect to instead?`,
    solve: (e) =>
      `1. Click the offending trace to select it and press **Delete**.\n2. Check the ratsnest to see what net ${str(e.fromNet)} actually needs to reach.\n3. Re-route to a pad that carries the **same** net label.\n4. Re-run the checks.`,
  },
  PCB_CLEARANCE: {
    nudge: () =>
      'Two pieces of copper on your board are closer than the rules allow. Zoom in on the highlighted area — how much gap is really there?',
    explain: (e) =>
      `The measured gap is **${str(e.measuredMm)} mm** where the rule requires **${str(e.requiredMm)} mm** (clearance plus half of each trace width). Below that, etching tolerances and solder bridging make a short likely even though the artwork looks separate. How could you re-route to open that gap up?`,
    solve: (e) =>
      `1. Select the trace flagged as **${str(e.trace, str(e.traceA))}**.\n2. Delete it and re-route with a detour that keeps at least ${str(e.requiredMm)} mm from the other copper — add waypoints to go around rather than through.\n3. If the crossing is unavoidable, route one of the two on the **bottom** layer instead.\n4. Re-run the checks.`,
  },
  PCB_FOOTPRINT_OVERLAP: {
    nudge: (e) =>
      `${str(e.refA)} and ${str(e.refB)} are sitting on top of each other. Think about the physical parts, not just the drawing.`,
    explain: (e) =>
      `The courtyards of **${str(e.refA)}** and **${str(e.refB)}** are closer than the ${str(e.minGapMm)} mm minimum. A courtyard is the keep-out area a part needs for its body and for the assembly machine to place it. Overlapping courtyards means the real parts would physically collide. Where else could one of them go?`,
    solve: (e) =>
      `1. Drag **${str(e.refB)}** to clear space on the board.\n2. Leave at least ${str(e.minGapMm)} mm between courtyard outlines.\n3. Try to keep parts that share a net near each other — it makes routing shorter.\n4. Re-run the checks.`,
  },
  PCB_TRACE_OFF_BOARD: {
    nudge: () => 'Something on your layout extends past the board outline. What happens to copper outside the outline when the board is cut?',
    explain: (e) =>
      `Part of your layout lies outside the ${str(e.boardWidthMm)} × ${str(e.boardHeightMm)} mm board outline. The outline is where the router or V-cutter physically separates the board, so anything beyond it is simply cut away. What would that do to the net it belongs to?`,
    solve: () =>
      '1. Drag the flagged trace or footprint fully inside the board outline.\n2. Keep a small margin from the edge — real fabricators ask for 0.3–0.5 mm.\n3. Re-run the checks.',
  },
  PCB_NO_FOOTPRINTS: {
    nudge: () => 'The board is empty. Where would the footprints come from?',
    explain: () =>
      'There are no footprints on the board. In this workspace the footprints are derived from the components in your circuit, carrying their net assignments across — so the circuit has to exist first. What do you need to do before laying out a PCB?',
    solve: () =>
      '1. Go back to the **3D Workbench** and build the circuit.\n2. Return to **PCB View** and press **Import from circuit**.\n3. Each component becomes a footprint with its pads pre-assigned to the right nets.\n4. Arrange the footprints, then route every net.',
  },
  MODEL_LIMIT: {
    nudge: () => 'Worth knowing: the analyser has flagged a limit in what it can model here. Read the note in the issues list.',
    explain: (_e, ev) =>
      `The analyser has reported a limitation: ${ev.simulation.notes.join(' ') || 'see the issues list.'} This matters because the numbers on screen are only as good as the model behind them. ${ev.engine.fidelity} What would you need to verify this result properly?`,
    solve: (_e, ev) =>
      `1. Read the limitation: ${ev.simulation.notes.join(' ') || 'see the issues list.'}\n2. Simplify your topology to a clear series/parallel arrangement, which this engine handles exactly.\n3. For anything beyond that, hand-check with KVL/KCL or export the netlist to a real SPICE tool.\n4. Note in your lab report that these figures came from **${ev.engine.label}**, not from SPICE.`,
  },
};

/** Fallback for codes without bespoke text. */
function genericExplanation(
  d: { code: string; title: string; detail: string },
  level: HintLevel,
): string {
  if (level === 1) {
    return `Take a look at this: ${d.title.toLowerCase()}. Work through what the analyser found and see whether you can tell why it matters.`;
  }
  if (level === 2) {
    return `${d.title}. ${d.detail} What change to your design would address that?`;
  }
  return `${d.title}\n\n${d.detail}\n\nMake that change, then re-run the checks to confirm it has cleared.`;
}

/** Choose the diagnostic the student most needs to deal with next. */
function primaryDiagnostic(
  evidence: TutorEvidence,
): { code: string; severity: string; title: string; detail: string; evidence: Record<string, string | number | boolean> } | null {
  const pool =
    evidence.workspace === 'pcb' && evidence.pcb.ran
      ? evidence.pcb.diagnostics.map((d) => ({ ...d, evidence: {} as Record<string, string | number | boolean> }))
      : evidence.validation.diagnostics;

  const order = ['error', 'warning', 'info'];
  for (const sev of order) {
    const found = pool.find((d) => d.severity === sev);
    if (found) return found;
  }
  return null;
}

/**
 * Produce a deterministic tutor reply.
 *
 * Same evidence + same hint level + same question => byte-identical output.
 */
export type LocalTutorReason = 'no-key' | 'api-failed';

export function localTutorReply(args: {
  question: string;
  hintLevel: HintLevel;
  evidence: TutorEvidence;
  /** Why the local tutor is answering, so the header never misstates it. */
  reason?: LocalTutorReason;
}): { reply: string; groundedIn: string[] } {
  const { question, hintLevel, evidence, reason = 'no-key' } = args;
  const header =
    reason === 'api-failed'
      ? '**Local Demo Tutor** — deterministic rule-based explanations. The Claude API could not be reached, so this reply is not from Claude.\n\n'
      : '**Local Demo Tutor** — deterministic rule-based explanations. No API key is configured, so this is not Claude.\n\n';

  // Nothing analysed yet.
  if (!evidence.validation.ran && !evidence.pcb.ran) {
    return {
      reply:
        header +
        'I can only comment on evidence from the analysis engines, and nothing has been run yet. ' +
        'Build your circuit on the breadboard, then press **Run Simulation** — I will then be able to see ' +
        'the netlist, the branch currents and any faults, and we can work through them together.',
      groundedIn: [],
    };
  }

  const diag = primaryDiagnostic(evidence);

  // Everything passes.
  if (!diag || diag.severity === 'pass') {
    const branch = evidence.simulation.branches.find((b) => b.conducts);
    const measured = branch
      ? `The analyser reports ${formatAmps(branch.currentA)} through branch ${branch.id} with ${formatOhms(branch.rTotalOhm)} in series and ${formatVolts(branch.vfSumV)} dropped across the LED.`
      : 'The checks have come back clean.';
    const verify =
      hintLevel >= 2 && branch
        ? `\n\nCheck it yourself: (${formatVolts(evidence.experiment.supplyVolts)} − ${formatVolts(branch.vfSumV)}) / ${formatOhms(branch.rTotalOhm)} = ${formatAmps(branch.currentA)}. Does your hand calculation agree?`
        : '';
    const next =
      hintLevel === 3
        ? `\n\nNext steps:\n1. Save this as a version so you can compare later.\n2. Open **PCB View** and import these components as footprints.\n3. Route every net, then run the PCB checks.`
        : '';
    return {
      reply:
        header +
        `No errors in the current evidence. ${measured} Worth remembering that this came from **${evidence.engine.label}** — ${evidence.engine.fidelity}${verify}${next}`,
      groundedIn: ['CIRCUIT_VALID'],
    };
  }

  const explanation = EXPLANATIONS[diag.code];
  const body = explanation
    ? hintLevel === 1
      ? explanation.nudge(diag.evidence, evidence)
      : hintLevel === 2
        ? explanation.explain(diag.evidence, evidence)
        : explanation.solve(diag.evidence, evidence)
    : genericExplanation(diag, hintLevel);

  const remaining = (evidence.workspace === 'pcb' ? evidence.pcb.diagnostics : evidence.validation.diagnostics)
    .filter((x) => x.severity === 'error').length;
  const tail =
    remaining > 1
      ? `\n\n_There ${remaining === 2 ? 'is 1 other error' : `are ${remaining - 1} other errors`} outstanding — fix this one first and re-run, because faults often cascade._`
      : '';

  const asked = question.trim().length > 0 ? `> ${question.trim()}\n\n` : '';

  return {
    reply: header + asked + body + tail,
    groundedIn: [diag.code],
  };
}
