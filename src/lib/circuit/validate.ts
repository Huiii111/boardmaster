import { RED_LED, SIGNAL_DIODE_VF, defOf } from './componentDefs';
import { netOfPin, resolvePins, seatIsValid } from './graph';
import { analyzeCircuit, findFloatingPins, type CircuitAnalysis } from './solve';
import type { Diagnostic } from './diagnostics';
import { hasErrors, sortDiagnostics } from './diagnostics';
import { experimentById, type Experiment } from './experiments';
import type { CircuitDesign } from './types';
import { describeBranchCurrent, formatAmps, formatOhms, formatVolts } from '../format';

export interface ValidationResult {
  diagnostics: Diagnostic[];
  /** True only when no `error` diagnostic was produced. Never set by a button press. */
  passes: boolean;
  experimentId: string;
  checkedAt: string;
}

export interface SimulationReport {
  analysis: CircuitAnalysis;
  validation: ValidationResult;
}

/**
 * Deterministic validation of the student's circuit against an experiment brief.
 *
 * Each check below is a pure function of the circuit graph and the solver output.
 * No check can be satisfied by pressing a button.
 */
export function validateCircuit(design: CircuitDesign, experimentId: string): SimulationReport {
  const experiment: Experiment = experimentById(experimentId);
  const analysis = analyzeCircuit(design);
  const { netlist } = analysis;
  const d: Diagnostic[] = [];

  const leds = design.components.filter((c) => c.kind === 'led');
  const resistors = design.components.filter((c) => c.kind === 'resistor');
  const capacitors = design.components.filter((c) => c.kind === 'capacitor');
  const sources = design.components.filter((c) => c.kind === 'dc_source');

  /* ---------- 1. required parts present ---------- */
  for (const req of experiment.requires) {
    const have = design.components.filter((c) => c.kind === req.kind).length;
    if (have >= req.min) continue;
    const def = defOf(req.kind);
    if (req.kind === 'dc_source') {
      // A microcontroller driving its pins IS the power source for the circuit,
      // so the brief's "needs a supply" requirement is already satisfied.
      if (analysis.drivers.length > 0) continue;

      const mcu = design.components.find((c) => c.kind === 'arduino_uno' || c.kind === 'esp32');
      if (mcu) {
        const outputs = Object.entries(mcu.mcuPins ?? {}).filter(([, p]) => p.mode === 'output');
        if (outputs.length > 0) {
          // The sketch ran and configured outputs; it simply ends with them low.
          // That is the honest answer for a DC operating point, not a fault:
          // the solver shows one instant, and this instant is the end of the run.
          d.push({
            code: 'MODEL_LIMIT',
            severity: 'info',
            title: `${mcu.label} ends the sketch with every output LOW`,
            detail:
              `The analyser shows the circuit at a single instant — the end of the last loop() — and ` +
              `${outputs.map(([pin]) => pin.toUpperCase()).join(', ')} finish LOW, so nothing is lit now. ` +
              'The Pin trace in the Code panel shows the pin toggling over the whole run.',
            evidence: {
              board: mcu.label,
              outputsConfigured: outputs.length,
              allLowAtEnd: true,
            },
            target: { componentIds: [mcu.id] },
          });
          continue;
        }
        d.push({
          code: 'NO_SUPPLY',
          severity: 'error',
          title: `${mcu.label} is not driving any pin`,
          detail:
            `${mcu.label} is on the bench, but your sketch never sets a pin to OUTPUT, so nothing is ` +
            'powering the circuit. Add pinMode(pin, OUTPUT) in setup() and drive it in loop().',
          evidence: { board: mcu.label, outputsConfigured: 0 },
          target: { componentIds: [mcu.id] },
        });
        continue;
      }
      d.push({
        code: 'NO_SUPPLY',
        severity: 'error',
        title: 'No DC power supply on the bench',
        detail: `This experiment needs a ${experiment.supplyVolts} V DC source. ${req.why}`,
        evidence: { required: req.min, found: have, expectedSupplyV: experiment.supplyVolts },
      });
    } else if (req.kind === 'led') {
      d.push({
        code: 'NO_LED',
        severity: 'error',
        title: 'No LED placed',
        detail: req.why,
        evidence: { required: req.min, found: have },
      });
    } else if (req.kind === 'resistor') {
      d.push({
        code: 'MISSING_RESISTOR',
        severity: 'error',
        title: 'No series resistor placed',
        detail: `${req.why} Without one, the current is limited only by the LED's own bulk resistance.`,
        evidence: { required: req.min, found: have, ledAbsMaxA: RED_LED.iAbsMax },
      });
    } else if (req.kind === 'arduino_uno' || req.kind === 'esp32') {
      // A bench supply drives the circuit just as well as a board does, so this
      // is only a fault when nothing at all is driving it.
      if (sources.length > 0 || analysis.drivers.length > 0) continue;
      d.push({
        code: 'NO_SUPPLY',
        severity: 'error',
        title: `No ${def.name} on the bench`,
        detail: `${req.why} Place one from the library, or use a DC supply instead.`,
        evidence: { required: req.min, found: have },
      });
    } else {
      d.push({
        code: 'MODEL_LIMIT',
        severity: 'warning',
        title: `${def.name} missing`,
        detail: req.why,
        evidence: { required: req.min, found: have },
      });
    }
  }

  /* ---------- 2. seating ---------- */
  for (const c of design.components) {
    const def = defOf(c.kind);
    if (!def.seatable) continue;
    if (!c.seat) {
      d.push({
        code: 'LED_NOT_SEATED',
        severity: 'error',
        title: `${c.label} is not inserted into the breadboard`,
        detail: `${c.label} (${def.name}) is on the bench but not plugged into any hole, so its pins are not connected to anything.`,
        evidence: { component: c.label },
        target: { componentIds: [c.id] },
      });
      continue;
    }
    if (!seatIsValid(c)) {
      d.push({
        code: 'LED_NOT_SEATED',
        severity: 'error',
        title: `${c.label} does not fit at its current position`,
        detail: `At least one lead of ${c.label} falls outside the board. Move or rotate it so both leads land in valid holes.`,
        evidence: { component: c.label, seat: `${c.seat.row}${c.seat.col}`, rotation: c.rotation },
        target: { componentIds: [c.id] },
      });
    }
  }

  /* ---------- 3. supply wiring ---------- */
  if (sources.length > 0) {
    const src = sources[0];
    if (src) {
      const pos = netOfPin(netlist, src.id, 'pos');
      const neg = netOfPin(netlist, src.id, 'neg');
      const posLoose = !pos || pos.pins.length + pos.holes.length <= 1;
      const negLoose = !neg || neg.pins.length + neg.holes.length <= 1;
      if (posLoose || negLoose) {
        const loose = [posLoose ? '+' : null, negLoose ? '−' : null].filter(Boolean).join(' and ');
        d.push({
          code: 'SUPPLY_UNCONNECTED',
          severity: 'error',
          title: `Supply ${loose} terminal${loose.includes('and') ? 's are' : ' is'} not wired up`,
          detail: `Run a jumper wire from the supply ${loose} binding post to the breadboard. Click a terminal, then click a hole.`,
          evidence: {
            component: src.label,
            posNet: pos?.name ?? 'unconnected',
            negNet: neg?.name ?? 'unconnected',
          },
          target: { componentIds: [src.id] },
        });
      }
      if (pos && neg && pos.id === neg.id) {
        d.push({
          code: 'SUPPLY_SHORT',
          severity: 'error',
          title: 'Supply + and − are shorted together',
          detail:
            `Both supply terminals land on the same net (${pos.name}). That is a dead short across ` +
            'the source: no voltage can appear across your circuit, and a real bench supply would ' +
            'current-limit or trip.',
          evidence: { net: pos.name, supplyV: src.value },
          target: { componentIds: [src.id], netNames: [pos.name] },
        });
      }
    }
  }

  /* ---------- 4. floating pins ---------- */
  const floating = findFloatingPins(design, netlist);
  if (floating.length > 0) {
    const byComponent = new Map<string, string[]>();
    for (const f of floating) {
      const arr = byComponent.get(f.label);
      if (arr) arr.push(f.pinLabel);
      else byComponent.set(f.label, [f.pinLabel]);
    }
    const listing = [...byComponent.entries()].map(([label, pins]) => `${label} pin ${pins.join('/')}`);
    d.push({
      code: 'FLOATING_PIN',
      severity: 'error',
      title: `${floating.length} pin${floating.length === 1 ? '' : 's'} not connected to anything`,
      detail: `Unconnected: ${listing.join(', ')}. Every pin in a working circuit must share a net with at least one other pin.`,
      evidence: { count: floating.length, pins: listing.join(', ') },
      target: {
        componentIds: [...new Set(floating.map((f) => f.componentId))],
        pinIds: floating.map((f) => `${f.componentId}.${f.pinId}`),
      },
    });
  }

  /* ---------- 5. shorted-out components ---------- */
  for (const m of analysis.measurements) {
    if (!m.shorted) continue;
    const net = design.components.find((c) => c.id === m.componentId);
    const def = net ? defOf(net.kind) : null;
    d.push({
      code: 'COMPONENT_SHORTED',
      severity: 'error',
      title: `${m.label} is shorted out`,
      detail:
        `Both leads of ${m.label} land on the same net, so there is 0 V across it and no current ` +
        `flows through it. On a breadboard this usually means both leads are in the same 5-hole strip ` +
        `(the same column within A–E or F–J)${def ? ` — spread ${m.label} across two different columns` : ''}.`,
      evidence: { component: m.label },
      target: { componentIds: [m.componentId] },
    });
  }

  /* ---------- 6. conduction / open circuit ---------- */
  const conducting = analysis.branches.filter((b) => b.conducts);
  const ledOnAnyPath = analysis.branches.some((b) => b.elements.some((e) => e.kind === 'led'));
  const supplyWired =
    analysis.supply !== null && analysis.supply.posNet !== null && analysis.supply.negNet !== null;

  if (supplyWired && analysis.branches.length === 0 && leds.length > 0) {
    d.push({
      code: 'OPEN_CIRCUIT',
      severity: 'error',
      title: 'Open circuit — no complete path from + to −',
      detail:
        `There is no conductive path from the supply + net (${analysis.supply?.posNetName}) back to the ` +
        `− net (${analysis.supply?.negNetName}). Current can only flow around a closed loop. Trace your ` +
        'circuit hole by hole and find the gap — remember that the centre channel separates A–E from F–J.',
      evidence: {
        posNet: analysis.supply?.posNetName ?? 'unconnected',
        negNet: analysis.supply?.negNetName ?? 'unconnected',
        pathsFound: 0,
      },
      target: {
        netNames: [analysis.supply?.posNetName ?? '', analysis.supply?.negNetName ?? ''].filter(Boolean),
      },
    });
  }

  /* ---------- 7. LED polarity ---------- */
  for (const m of analysis.measurements) {
    if (m.kind !== 'led' || !m.reverseBiased) continue;
    const led = design.components.find((c) => c.id === m.componentId);
    const pins = led ? resolvePins(led) : [];
    const anode = pins.find((p) => p.role === 'anode');
    const cathode = pins.find((p) => p.role === 'cathode');
    d.push({
      code: 'LED_REVERSED',
      severity: 'error',
      title: `${m.label} is connected backwards`,
      detail:
        `${m.label} sits on a path from the supply, but current reaches its cathode (K) first. ` +
        'A diode only conducts from anode to cathode, so it blocks and stays dark. ' +
        `Anode is in hole ${anode?.hole ?? '?'}, cathode in hole ${cathode?.hole ?? '?'} — ` +
        'rotate the LED 180° to swap them.',
      evidence: {
        component: m.label,
        anodeHole: anode?.hole ?? 'unconnected',
        cathodeHole: cathode?.hole ?? 'unconnected',
        currentA: 0,
        reverseStandoffV: RED_LED.vReverseMax,
      },
      target: { componentIds: [m.componentId] },
    });
  }

  /**
   * The PWM duty behind a branch, or null when its driver is not a dimmed pin.
   *
   * An LED on a pin at partial duty is dim *because the sketch dimmed it*. The
   * current-limit advice below is written for a resistor that is too large, so
   * without this it told a student to reduce resistance when the only thing
   * "wrong" was their own analogWrite() value.
   */
  const pwmDutyOf = (branch: (typeof analysis.branches)[number]): number | null => {
    const driver = analysis.drivers.find((dr) => dr.id === branch.driverId);
    if (!driver || driver.kind !== 'mcu_pin' || !driver.componentId || !driver.pinId) return null;
    const owner = design.components.find((x) => x.id === driver.componentId);
    const state = owner?.mcuPins?.[driver.pinId];
    if (!state || state.mode !== 'output') return null;
    return state.value > 0 && state.value < 1 ? state.value : null;
  };

  /* ---------- 8. current-limit checks ---------- */
  for (const b of conducting) {
    const ledsOnBranch = b.elements.filter((e) => e.kind === 'led');
    if (ledsOnBranch.length === 0) continue;
    const labels = ledsOnBranch.map((e) => e.label);

    if (b.unlimited) {
      d.push({
        code: 'MISSING_RESISTOR',
        severity: 'error',
        title: `No current-limiting resistor in series with ${labels.join(', ')}`,
        detail:
          `Branch ${b.id} runs ${b.netNames.join(' → ')} with 0 Ω of external resistance. ` +
          `An LED is not a resistor: its forward voltage barely changes with current, so the current ` +
          `is set entirely by whatever resistance is in the loop. Using only the LED's bulk resistance ` +
          `(${formatOhms(RED_LED.rSeries)}) the model predicts ${formatAmps(b.currentA)} — ` +
          `about ${(b.currentA / RED_LED.iAbsMax).toFixed(0)}× the ${formatAmps(RED_LED.iAbsMax)} ` +
          'absolute maximum. A real LED would be destroyed.',
        evidence: {
          branch: b.id,
          rTotalOhm: 0,
          estimatedCurrentA: Number(b.currentA.toFixed(4)),
          ledAbsMaxA: RED_LED.iAbsMax,
          model: 'bulk-resistance fallback (no external limit)',
        },
        target: { componentIds: ledsOnBranch.map((e) => e.componentId) },
      });
      continue;
    }

    if (b.currentA > RED_LED.iAbsMax) {
      d.push({
        code: 'OVERCURRENT',
        severity: 'error',
        title: `${labels.join(', ')} above absolute maximum current`,
        detail:
          `Branch ${b.id} carries ${formatAmps(b.currentA)}, over the ${formatAmps(RED_LED.iAbsMax)} ` +
          `absolute maximum for this LED. Calculation: (${formatVolts(analysis.supply?.volts ?? 0)} − ` +
          `${formatVolts(b.vfSumV)}) / ${formatOhms(b.rTotalOhm)} = ${formatAmps(b.currentA)}. ` +
          'Increase the series resistance.',
        evidence: {
          branch: b.id,
          currentA: Number(b.currentA.toFixed(5)),
          rTotalOhm: b.rTotalOhm,
          vfSumV: b.vfSumV,
          ledAbsMaxA: RED_LED.iAbsMax,
          minResistorOhm: Math.ceil(
            ((analysis.supply?.volts ?? 0) - b.vfSumV) / RED_LED.iAbsMax,
          ),
        },
        target: { componentIds: ledsOnBranch.map((e) => e.componentId) },
      });
    } else if (b.currentA > RED_LED.iRated) {
      d.push({
        code: 'ABOVE_RATED_CURRENT',
        severity: 'warning',
        title: `${labels.join(', ')} above rated current`,
        detail:
          `Branch ${b.id} carries ${formatAmps(b.currentA)}, above the ${formatAmps(RED_LED.iRated)} ` +
          'recommended continuous current but below the absolute maximum. The LED will light brightly ' +
          'but will run hot and age faster.',
        evidence: {
          branch: b.id,
          currentA: Number(b.currentA.toFixed(5)),
          ledRatedA: RED_LED.iRated,
          rTotalOhm: b.rTotalOhm,
        },
        target: { componentIds: ledsOnBranch.map((e) => e.componentId) },
      });
    } else if (b.currentA < RED_LED.iVisible) {
      const duty = pwmDutyOf(b);
      d.push({
        code: 'LED_TOO_DIM',
        severity: duty === null ? 'warning' : 'info',
        title:
          duty === null
            ? `${labels.join(', ')} will be effectively dark`
            : `${labels.join(', ')} is dimmed to ${Math.round(duty * 100)}% by your sketch`,
        detail:
          duty === null
            ? `Branch ${b.id} carries only ${formatAmps(b.currentA)} with ${formatOhms(b.rTotalOhm)} in ` +
              `series — below the ~${formatAmps(RED_LED.iVisible)} needed for a visible glow. Reduce the resistance.`
            : `Branch ${b.id} carries ${formatAmps(b.currentA)}, the mean of a ` +
              `${Math.round(duty * 100)}% duty cycle on ${b.driverLabel}. That is below the ` +
              `~${formatAmps(RED_LED.iVisible)} a steady current needs to glow visibly. This is the ` +
              'sketch dimming the LED, not a wiring fault — raise the analogWrite() value to brighten it.',
        evidence: {
          branch: b.id,
          currentA: Number(b.currentA.toFixed(6)),
          rTotalOhm: b.rTotalOhm,
          visibleThresholdA: RED_LED.iVisible,
        },
        target: { componentIds: ledsOnBranch.map((e) => e.componentId) },
      });
    } else if (b.currentA < experiment.targetCurrent.min) {
      const duty = pwmDutyOf(b);
      d.push({
        code: 'LED_TOO_DIM',
        severity: 'info',
        title:
          duty === null
            ? `${labels.join(', ')} below the brief's target band`
            : `${labels.join(', ')} is dimmed to ${Math.round(duty * 100)}% by your sketch`,
        detail:
          duty === null
            ? `Branch ${b.id} carries ${formatAmps(b.currentA)}. The brief asks for ` +
              `${formatAmps(experiment.targetCurrent.min)}–${formatAmps(experiment.targetCurrent.max)}. ` +
              'The LED lights, but dimly.'
            : `Branch ${b.id} carries ${formatAmps(b.currentA)}, the mean of a ` +
              `${Math.round(duty * 100)}% duty cycle on ${b.driverLabel}. The brief's ` +
              `${formatAmps(experiment.targetCurrent.min)}–${formatAmps(experiment.targetCurrent.max)} ` +
              'band describes a steady current, so a deliberately dimmed LED sits below it by design.',
          evidence: {
          branch: b.id,
          currentA: Number(b.currentA.toFixed(6)),
          targetMinA: experiment.targetCurrent.min,
          targetMaxA: experiment.targetCurrent.max,
        },
        target: { componentIds: ledsOnBranch.map((e) => e.componentId) },
      });
    }
  }

  /* ---------- 9. supply below forward voltage ---------- */
  for (const b of analysis.branches) {
    if (b.blockedReason !== 'supply_below_forward_voltage') continue;
    const labels = b.elements.filter((e) => e.kind === 'led').map((e) => e.label);
    d.push({
      code: 'SUPPLY_BELOW_VF',
      severity: 'error',
      title: 'Supply voltage below the LED forward voltage',
      detail:
        `Branch ${b.id} needs at least ${formatVolts(b.vfSumV)} to turn on ` +
        `(${labels.length} LED${labels.length === 1 ? '' : 's'} in series), but the supply is only ` +
        `${formatVolts(analysis.supply?.volts ?? 0)}. The LED cannot conduct, so no current flows.`,
      evidence: {
        branch: b.id,
        supplyV: analysis.supply?.volts ?? 0,
        requiredVfSumV: b.vfSumV,
      },
      target: { componentIds: b.elements.map((e) => e.componentId) },
    });
  }

  /* ---------- 10. capacitor checks ---------- */
  for (const cap of capacitors) {
    const pos = netOfPin(netlist, cap.id, 'p');
    const neg = netOfPin(netlist, cap.id, 'n');
    const supplyPos = analysis.supply?.posNet;
    const supplyNeg = analysis.supply?.negNet;
    if (pos && neg && supplyPos && supplyNeg && pos.id === supplyNeg && neg.id === supplyPos) {
      d.push({
        code: 'CAPACITOR_REVERSED',
        severity: 'error',
        title: `${cap.label} is connected with reverse polarity`,
        detail:
          `${cap.label} is an electrolytic capacitor: its + lead sits on the supply − net ` +
          `(${pos.name}) and its − lead on the + net (${neg.name}). Reverse-biasing an electrolytic ` +
          'causes it to vent or fail. Rotate it 180°.',
        evidence: { component: cap.label, plusNet: pos.name, minusNet: neg.name },
        target: { componentIds: [cap.id] },
      });
    }
    if (analysis.dcBlockedBy.includes(cap.id)) {
      d.push({
        code: 'CAPACITOR_BLOCKS_DC',
        severity: 'info',
        title: `${cap.label} carries no DC current`,
        detail:
          `${cap.label} is modelled as an ideal open circuit at DC, so the steady-state current ` +
          'through it is 0 A. Charging transients are not simulated by this engine.',
        evidence: { component: cap.label, steadyStateCurrentA: 0 },
        target: { componentIds: [cap.id] },
      });
    }
  }

  /* ---------- 10b. switches, fuses, diodes and pots ---------- */
  for (const c of design.components) {
    const m = analysis.measurements.find((x) => x.componentId === c.id);

    if ((c.kind === 'switch' || c.kind === 'pushbutton') && c.closed !== true) {
      const onPath = analysis.openDevices.some((o) => o.componentId === c.id);
      d.push({
        code: 'SWITCH_OPEN',
        severity: onPath ? 'warning' : 'info',
        title: `${c.label} is open`,
        detail:
          `${c.label} is ${c.kind === 'pushbutton' ? 'not being held down' : 'switched off'}, so it is an ` +
          'open circuit and no current can pass through it. ' +
          (c.kind === 'pushbutton'
            ? 'Hold it in the properties panel to close the contacts.'
            : 'Toggle it in the properties panel to close the contacts.'),
        evidence: { component: c.label, closed: false, resistanceOhm: 'infinite' },
        target: { componentIds: [c.id] },
      });
    }

    if (c.kind === 'fuse') {
      if (c.blown) {
        d.push({
          code: 'FUSE_BLOWN',
          severity: 'error',
          title: `${c.label} has blown`,
          detail:
            `${c.label} is rated ${formatAmps(c.value)} and has already been blown by an overcurrent, ` +
            'so it is now a permanent open circuit. Fix the fault that caused it, then replace the fuse ' +
            'from the properties panel.',
          evidence: { component: c.label, ratingA: c.value, blown: true },
          target: { componentIds: [c.id] },
        });
      } else if (m?.overRating) {
        d.push({
          code: 'FUSE_OVER_RATING',
          severity: 'error',
          title: `${c.label} is carrying more than its rating`,
          detail:
            `${c.label} is rated ${formatAmps(c.value)} but the branch carries ` +
            `${formatAmps(Math.abs(m.currentA))}. A real fuse would open within moments. Reduce the ` +
            'current or fit a higher-rated fuse — but only if the rest of the circuit can take it.',
          evidence: {
            component: c.label,
            ratingA: c.value,
            measuredA: Number(Math.abs(m.currentA).toFixed(5)),
          },
          target: { componentIds: [c.id] },
        });
      }
    }

    if (c.kind === 'diode' && m?.reverseBiased) {
      const pins = resolvePins(c);
      d.push({
        code: 'DIODE_REVERSED',
        severity: 'error',
        title: `${c.label} is connected backwards`,
        detail:
          `Current reaches ${c.label}'s cathode (K) first, so the junction is reverse biased and blocks. ` +
          `Anode is in hole ${pins.find((p) => p.role === 'anode')?.hole ?? '?'}, cathode in ` +
          `${pins.find((p) => p.role === 'cathode')?.hole ?? '?'}. The banded end is the cathode.`,
        evidence: { component: c.label, currentA: 0, forwardVoltageV: SIGNAL_DIODE_VF },
        target: { componentIds: [c.id] },
      });
    }

    if (c.kind === 'buzzer' && m && m.currentA < 0) {
      d.push({
        code: 'BUZZER_REVERSED',
        severity: 'warning',
        title: `${c.label} is wired with reverse polarity`,
        detail:
          `${c.label} is an active piezo sounder: its + lead must sit at the higher potential. ` +
          'Wired backwards it will not sound. Rotate it 180°.',
        evidence: { component: c.label, currentA: Number(m.currentA.toFixed(5)) },
        target: { componentIds: [c.id] },
      });
    }

    if (c.kind === 'potentiometer') {
      const wiperNet = netOfPin(netlist, c.id, 'w');
      const wiperUsed = wiperNet ? wiperNet.pins.length > 1 : false;
      if (!wiperUsed) {
        d.push({
          code: 'POT_WIPER_UNUSED',
          severity: 'warning',
          title: `${c.label}'s wiper is not connected`,
          detail:
            `${c.label} is wired through pins 1 and 3 only, so it behaves as a fixed ` +
            `${formatOhms(c.value)} resistor and turning it changes nothing. Connect the wiper (W) ` +
            'to use it as a variable resistor or a voltage divider.',
          evidence: {
            component: c.label,
            trackOhm: c.value,
            wiper: c.wiper ?? 0.5,
            wiperNet: wiperNet?.name ?? 'unconnected',
          },
          target: { componentIds: [c.id] },
        });
      }
    }

    if (c.kind === 'inductor' && m && Math.abs(m.currentA) > 0) {
      d.push({
        code: 'INDUCTOR_DC_SHORT',
        severity: 'info',
        title: `${c.label} behaves as a wire at DC`,
        detail:
          `An ideal inductor has no resistance, so at a steady DC operating point ${c.label} drops 0 V ` +
          'and simply passes current. Its interesting behaviour is in the transient (V = L·di/dt), which ' +
          'this DC engine does not simulate.',
        evidence: { component: c.label, voltageV: 0, inductanceH: c.value },
        target: { componentIds: [c.id] },
      });
    }
  }

  /* ---------- 11. model limits ---------- */
  for (const note of analysis.notes) {
    d.push({
      code: 'MODEL_LIMIT',
      severity: 'info',
      title: 'Analyser limitation',
      detail: note,
      evidence: { engine: analysis.engine },
      target: analysis.sharedElements.length > 0 ? { componentIds: analysis.sharedElements } : undefined,
    });
  }

  /* ---------- 12. unused extras ---------- */
  if (resistors.length > 0 && conducting.length > 0) {
    const unusedResistors = resistors.filter(
      (r) => !conducting.some((b) => b.elements.some((e) => e.componentId === r.id)),
    );
    for (const r of unusedResistors) {
      d.push({
        code: 'FLOATING_PIN',
        severity: 'warning',
        title: `${r.label} is not in the current path`,
        detail:
          `${r.label} (${formatOhms(r.value)}) is placed but no current flows through it, so it has no ` +
          'effect on the circuit. Check which strips its two leads land on.',
        evidence: { component: r.label, resistanceOhm: r.value, currentA: 0 },
        target: { componentIds: [r.id] },
      });
    }
  }

  /* ---------- 13. pass ---------- */
  const errorsFound = hasErrors(d);
  if (!errorsFound && conducting.length > 0 && ledOnAnyPath) {
    const litBranch = conducting.find((b) => b.elements.some((e) => e.kind === 'led'));
    if (litBranch) {
      d.push({
        code: 'CIRCUIT_VALID',
        severity: 'pass',
        title: 'Circuit is valid and the LED conducts',
        detail:
          `Closed loop found: ${litBranch.netNames.join(' → ')}. ` +
          `${describeBranchCurrent(litBranch)}, within the ` +
          `${formatAmps(experiment.targetCurrent.min)}–${formatAmps(experiment.targetCurrent.max)} target band.`,
        evidence: {
          branch: litBranch.id,
          currentA: Number(litBranch.currentA.toFixed(6)),
          rTotalOhm: litBranch.rTotalOhm,
          vfSumV: litBranch.vfSumV,
          supplyV: litBranch.driverVolts,
        },
      });
    }
  }

  return {
    analysis,
    validation: {
      diagnostics: sortDiagnostics(d),
      passes: !errorsFound && conducting.length > 0 && ledOnAnyPath,
      experimentId: experiment.id,
      checkedAt: new Date().toISOString(),
    },
  };
}
