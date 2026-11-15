# BoardMaster — AI-Powered Virtual Electronics Laboratory

A browser-based electronics laboratory where students **build circuits themselves**
on a realistic 3D breadboard, run a deterministic electrical analysis, and work
through their mistakes with an AI teaching assistant that is only allowed to cite
the evidence the analysis produced.

It is not a chatbot with a circuit theme, not an automatic circuit designer, and
not a static 3D visualisation. The student does the engineering.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

That is all you need. **No API key is required**: with none configured, the AI
Tutor runs as a clearly-labelled *Local Demo Tutor* with deterministic,
hand-written explanations at all three hint levels, so the app is fully
demonstrable offline.

To enable Claude as the tutor:

```bash
cp .env.example .env.local
# then set ANTHROPIC_API_KEY=sk-ant-...
```

Restart the dev server. The badge in the top toolbar changes from
`Local Demo Tutor` to `Claude (claude-sonnet-5-5)`, and every tutor reply is
tagged with which tutor produced it.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on port 3000 |
| `npm run build` | Production build |
| `npm start` | Serve the production build on port 3000 |
| `npm run typecheck` | `tsc --noEmit`, strict |
| `npm test` | Vitest unit + journey suites |
| `npm run verify` | typecheck → test → build |

### Environment variables

Every variable is optional. See [`.env.example`](.env.example).

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | — | Enables Claude as the tutor. Read **only** on the server. |
| `BOARDMASTER_TUTOR_MODEL` | `claude-sonnet-5-5` | Model id for the tutor. |
| `BOARDMASTER_MAX_TOKENS` | `1400` | Max output tokens (256–8192). |
| `NGSPICE_PATH` | — | Path to an `ngspice` binary to enable the real-SPICE adapter. |

Validation lives in [`src/lib/env.ts`](src/lib/env.ts), which is marked
`server-only`. Malformed values produce a warning banner in the UI rather than a
crash, and the app degrades to the deterministic engine and the local tutor.

---

## The student workflow

1. **Pick an experiment** from the toolbar. The brief states the objectives, the
   target current band and the worked hand calculation.
2. **Place parts.** Click a part in the library to arm it, then click a breadboard
   hole to seat it. Press `R` to rotate before or after placing.
3. **Wire it up.** Press `W`, click a hole or a supply binding post, then click
   the other end.
4. **Run Simulation.** The deterministic engine extracts the netlist and solves
   the DC operating point.
5. **Read the diagnostics.** Each issue carries the numbers it was derived from.
   Hovering an issue highlights the parts it refers to in the 3D scene.
6. **Ask the tutor** at hint level 1, 2 or 3.
7. **Fix it yourself** and re-run. The tutor never edits your design.
8. **Open PCB View.** Footprints are derived from your circuit automatically,
   carrying their net names across. Arrange them and route every net by hand.
   Switch to **3D Fabricated** to see the board as it would come back from
   manufacture.
9. **Run PCB Checks** for connectivity, shorts, clearance and placement.
10. **Compare** any two saved versions to see what changed and what it did to the
    measurements.

Keyboard: `V`/`W`/`X` tools · `R` rotate · `Del` delete · `Esc` cancel ·
`H` reset camera · `Ctrl+Z`/`Ctrl+Shift+Z` · `Ctrl+S` save · `Ctrl+Enter`
simulate · `?` shortcuts.

---

## How the circuit is modelled

The design is stored as a **structured graph**, never as a picture:

```
PlacedComponent ──has──> PinDef[]
      │                     │
      │ seat (row,col)      │ rotated offset
      ▼                     ▼
   Breadboard ──────────> HoleId ──┐
                                    ├──> union-find ──> Net
   Wire (Endpoint ↔ Endpoint) ─────┘
```

Three independent sources of connectivity are merged by union-find in
[`src/lib/circuit/graph.ts`](src/lib/circuit/graph.ts):

1. **Breadboard internals** — the real rules, modelled exactly. Holes A–E of one
   column form one copper strip; F–J form a separate strip; the centre channel
   isolates the two banks; each of the four power rails is one continuous strip.
2. **Jumper wires** — between any two holes and/or free terminals.
3. **Component pins** — resolved to holes through the component's seat and
   rotation.

Because the strip rules are real, the common student mistakes are real too:
putting both leads of a resistor in one column genuinely shorts it out, and the
analyser says so.

## The bench you land on

A first visit opens on a **complete, working lab**: an Arduino Uno wired through
a 330 Ω resistor to an LED, with a matching blink sketch already in the editor.
Pressing **Run Simulation** once runs the sketch, drives the pins, solves the
circuit and lights the LED — **8.45 mA**, clean, no setup. Nobody has to build
something before the lab does anything; clearing the bench is one click.

Two details make that honest rather than staged:

- **Run Simulation runs the sketch first** when a microcontroller is present,
  because the board's pin states *are* the circuit's supply. Solving without
  running the code reported "no power supply" on a circuit whose supply is the
  board.
- **The analyser solves one instant** — the end of the last `loop()`. The
  shipped sketch is written so the LED is on at that instant, and a comment in
  the sketch says so and invites the student to swap the two `digitalWrite`
  lines and watch it finish dark. A sketch that ends with its outputs low is
  reported as **info**, not an error: that is the correct answer for a DC
  operating point, and the Pin trace shows the toggling the single instant
  cannot.

## Writing code that drives the circuit

A student can place an **Arduino Uno** or **ESP32** on the bench, write a sketch
in the **Code** workspace, and have the pins it drives actually light their
circuit.

### What "running" means here — and what it does not

| | |
| --- | --- |
| **Is** | A tree-walking interpreter over the parsed sketch. Real variables, real control flow, real pin writes in real program order. |
| **Is not** | avr-gcc. There is no compilation step and no machine code. |
| **Is not** | A cycle-accurate AVR emulator. Instruction timing is not modelled. |
| **Virtual time** | `delay()` advances a clock instead of blocking, so a 1 Hz blink simulates in microseconds. `millis()` reads that same clock. |
| **Budgets** | Execution stops at a step and virtual-time budget, so `while(true){}` is *reported* rather than hanging the tab. |

Supported: `setup`/`loop`, user functions, `int`/`long`/`float`/`bool`/`char`/
`String`, arrays, `if`/`else`/`while`/`do`/`for`/`break`/`continue`/`return`,
the full operator set with C integer division, and the Arduino API —
`pinMode`, `digitalWrite`, `digitalRead`, `analogWrite`, `analogRead`, `delay`,
`delayMicroseconds`, `millis`, `micros`, `map`, `constrain`, `min`, `max`,
`abs`, `random`, and `Serial.begin/print/println`. Not supported: classes,
pointers, templates, the preprocessor (`#include` lines are skipped).

### Layout: circuit left, code right

The **Code** workspace is a split view — the 3D circuit on the left, the sketch
on the right, with a draggable divider between them. That pairing is the whole
point: press Run and watch the LED light beside the line that lit it.

The left pane overlays the live link between the two: a **Driven pins** readout
showing which pins the sketch is holding HIGH, LOW or at a PWM duty, and the
measured current through any LED that is lit. The right pane stacks the editor
over a tabbed output strip — **Problems**, **Serial**, **Pin trace** — which
switches itself to Problems when a run fails.

Only one workspace is mounted at a time, so this viewport and the 3D Workbench
tab never hold two WebGL contexts at once.

### The bridge between code and circuit

This is the part that makes it a lab rather than two separate toys:

1. The circuit is solved as it stands, giving every net a potential.
2. The sketch runs, and `digitalRead`/`analogRead` read **those** potentials.
3. The pin states it leaves behind are written onto the board component.
4. The circuit is solved again — now an `OUTPUT` pin driven HIGH is a driver in
   the netlist.

A microcontroller pin is **not** an ideal source: it drives through 25 Ω of
output impedance on an Uno. Blinking an LED through 330 Ω gives
**8.45 mA**, not the 9.09 mA an ideal 5 V rail would give, and the model says so.

The solver was generalised from one supply to a list of **drivers** to make this
work, so the bench supply and every driven pin are solved the same way against a
shared ground.

### Errors are real

Every error comes from the interpreter actually failing, with the line and
column it failed at:

- **Syntax** — missing semicolon, unclosed brace, unterminated string
- **Missing structure** — a sketch without `setup()` or `loop()`
- **Pins** — `pinMode(99, …)` on a board with no pin 99; `analogWrite` to a
  non-PWM pin; `digitalWrite` to a pin never set `OUTPUT`
- **Logic** — undeclared variable, unknown function, division by zero,
  array index out of bounds, `Serial.print` before `Serial.begin`
- **Limits** — step budget exceeded, which is how an infinite loop is reported

### The tutor sees all three

The evidence packet now carries the sketch, its errors, its serial output and
the final pin states **with the net each pin reached**. The tutor is instructed
to check the code, the wiring and the result separately, because the commonest
fault is neither alone — it is a sketch driving pin 13 while the LED is wired to
pin 9, which no compiler would ever catch.

### Component library

Nineteen parts, **every one of which the engine actually solves**. Nothing in
the library is decorative: each declares a `fidelity` string that the UI shows,
stating exactly how faithfully it is modelled.

| Part | Modelled as |
| --- | --- |
| DC power supply | Ideal voltage source |
| Battery (2×AA holder) | Ideal voltage source, seats on the board |
| Resistor | Ohmic, E24 colour bands |
| **Potentiometer** | Three-terminal, linear taper: 1–W is `wiper × R`, W–3 is `(1 − wiper) × R` |
| **Photoresistor (LDR)** | `R = R_dark × (1 − 0.98 × illumination)`, driven by a slider |
| Capacitor | Ideal DC open circuit |
| **Inductor** | Ideal DC short circuit (0 Ω) |
| LED | Constant `V_f` = 2.0 V, emits light |
| **RGB LED** | Three dies sharing a cathode: 2.0 / 3.0 / 3.0 V, solved independently |
| **Diode (1N4148)** | Constant `V_f` = 0.7 V, blocks when reversed |
| **Toggle switch (SPST)** | 0 Ω closed, open circuit off |
| **Push button** | Same, momentary — conducts only while held |
| **Fuse** | 0.05 Ω intact, permanent open once blown, flagged above its rating |
| **Piezo buzzer** | Polarised resistive load |

Components are decomposed into **device edges** — the internal conducting paths
of a part — in [`componentDefs.ts`](src/lib/circuit/componentDefs.ts). That is
the single place a part's physics lives, which is how a three-pin potentiometer
and a four-pin RGB LED work without the solver special-casing them.

Switches, the pot wiper, LDR illumination and fuse replacement are all live
controls in the properties panel, so a student can change the circuit's state
and re-run without rebuilding it.

### Library thumbnails are the real models

Each catalogue entry shows a render of **the actual 3D mesh** that part will
place, not a generic glyph.

Giving each of the fifteen entries its own `<Canvas>` would mean fifteen WebGL
contexts, and browsers cap out around sixteen. Instead
[`PartThumbnails.tsx`](src/components/three/PartThumbnails.tsx) mounts **one**
hidden renderer that walks the catalogue, renders each part with per-part
framing, captures it with `toDataURL`, caches the PNG in `sessionStorage`, then
unmounts and releases the context. Parts are shot against a transparent
background like a catalogue photo; the sidebar tile supplies a soft overhead
light pool so dark-bodied parts still read.

The read side lives in a separate
[`thumbnailStore.ts`](src/components/three/thumbnailStore.ts) with **no three.js
import**. That seam matters: when the sidebar imported the hook from the module
that builds the thumbnails, bundling pulled the entire 3D runtime into the
initial page chunk and first load went from 149 kB to 448 kB for every student,
including those who never opened the workbench.

### Bench instruments

Three instruments stand on the bench beside the board, wired to it with jumpers
from their terminals exactly like any other source:

| Instrument | What it does |
| --- | --- |
| DC bench supply | Ideal voltage source, 1.5–12 V |
| **Battery pack (6×AA)** | Ideal voltage source, 9 V nominal |
| **Digital multimeter** | Reads the DC potential between its two probes |

The multimeter is an **ideal voltmeter**: `deviceEdges()` returns no conducting
path for it, so attaching it physically cannot change the circuit it measures.
A test asserts the supply current is identical to twelve decimal places with and
without the meter connected.

Its reading comes from real node potentials. The solver now walks each
conducting branch from the supply's positive net, subtracting each element's
drop, and stores the potential of every net
(`CircuitAnalysis.nodeVoltages`). Probing across the LED in the reference
circuit reads **2.000 V** — its forward voltage — because that is what the
solver computed, not because a display was hard-coded.

A probe on a **floating** net has no defined potential, and the meter says
`PROBE ON FLOATING NET` rather than reading a misleading 0 V.

#### No oscilloscope, and why

A scope belongs on this bench, but the engine solves a **DC operating point** —
it has no transient or AC analysis. A scope drawing a waveform would be drawing
a fiction, which is the one thing this project does not do. Adding one honestly
means first adding transient analysis to the engine; until then the bench has no
scope rather than a fake one.

### Cables

Four lead styles, chosen from the sidebar along with one of eight standard
colours:

| Style | Routing |
| --- | --- |
| Dupont jumper | Stranded, arcs over the board |
| Solid-core jumper | Stiff wire bent into right angles, lying flat |
| Alligator clip lead | Flexible, with crocodile jaws at each end |
| Banana test lead | Thick silicone with 4 mm plugs, for the bench supply |

All four are **ideal conductors in the analyser** — the UI says so explicitly,
so nobody concludes their cable choice changed the measurement. A test asserts
the measured current is identical across all four styles.

### The deterministic engine

`deterministic-branch-v1` — [`src/lib/circuit/solve.ts`](src/lib/circuit/solve.ts).

It enumerates every simple path from supply `+` to supply `−` through the
two-terminal parts, then solves each path as a series branch.

**LED model — constant forward-voltage drop:**

```
I = (V_supply − Σ V_f) / R_total
```

With `V_supply = 5 V`, `V_f = 2.0 V`, `R_total = 330 Ω`:

```
I = (5 − 2.0) / 330 = 9.09 mA
```

which is exactly the first-year hand calculation, and is asserted in the test
suite.

When `R_total` is zero there is no external current limit, so the constant-drop
model would predict infinite current. In **that case only**, the engine falls
back to the LED's documented bulk series resistance (12 Ω) to produce a finite,
explicitly-flagged estimate of the destructive current — `(5 − 2) / 12 = 250 mA`,
about 8× the 30 mA absolute maximum. The diagnostic says which model produced the
number.

**Device parameters** (`RED_LED` in
[`componentDefs.ts`](src/lib/circuit/componentDefs.ts)): `V_f` 2.0 V, knee 1.7 V,
bulk R 12 Ω, rated 20 mA, absolute max 30 mA, visible from ~1 mA, reverse
stand-off 5 V.

### Faults the validator detects

All in [`src/lib/circuit/validate.ts`](src/lib/circuit/validate.ts), each a pure
function of the graph and the solved operating point. None can be satisfied by
clicking a button.

| Code | Severity | What it catches |
| --- | --- | --- |
| `NO_SUPPLY` | error | No DC source on the bench |
| `SUPPLY_UNCONNECTED` | error | A binding post not wired to the board |
| `SUPPLY_SHORT` | error | `+` and `−` collapsed onto one net |
| `NO_LED` | error | Experiment requires an LED |
| `LED_NOT_SEATED` | error | Part on the bench, or a lead off the board |
| `OPEN_CIRCUIT` | error | No conductive path from `+` back to `−` |
| `FLOATING_PIN` | error | A pin sharing a net with nothing else |
| `LED_REVERSED` | error | Current reaches the cathode first — cites both holes |
| `MISSING_RESISTOR` | error | No current limit in series with the LED |
| `COMPONENT_SHORTED` | error | Both leads on the same copper strip |
| `OVERCURRENT` | error | Above the 30 mA absolute maximum |
| `SUPPLY_BELOW_VF` | error | Supply below the forward-voltage knee |
| `CAPACITOR_REVERSED` | error | Electrolytic reverse-biased across the rails |
| `ABOVE_RATED_CURRENT` | warning | Above 20 mA rated, below absolute max |
| `LED_TOO_DIM` | warning/info | Below visible threshold or below the brief's band |
| `CAPACITOR_BLOCKS_DC` | info | 0 A through a capacitor at DC — correct, stated plainly |
| `MODEL_LIMIT` | info | Topology outside the supported model |
| `CIRCUIT_VALID` | pass | Closed loop, correct polarity, current in band |

### Simulation fidelity — what this is and is not

The engine label and its honest fidelity statement are shown in the Simulation
Status panel at all times.

**What it does:** exact net extraction from real breadboard rules; every
source-to-ground path enumerated; each branch solved with Ohm's law and the
constant-drop LED model; per-component current, voltage and power.

**What it does not do — and never claims to:** no transient or AC analysis, no
exponential Shockley diode model, no temperature coefficients, no tolerances, no
noise. Capacitors are ideal DC open circuits. Branches are solved independently,
so a component shared between two paths is **reported** as outside the model
(`sharedElements` → a `MODEL_LIMIT` diagnostic) rather than silently mis-solved.

**SPICE:** there is a real adapter boundary at
[`src/lib/sim/adapter.ts`](src/lib/sim/adapter.ts) with two implementations —
`deterministic` (always available) and `ngspice` (optional). The ngspice adapter
probes the binary, generates a genuine SPICE netlist, runs `.op` and returns the
raw log. If the binary is absent it reports `available: false` with the reason,
and the app stays on the deterministic engine.

**The app never fabricates SPICE results.** You can view and export the generated
netlist at any time, but generating a netlist is not the same as running SPICE,
and the UI does not conflate the two. A test asserts that the on-screen engine
label never claims to be SPICE when the deterministic engine produced the numbers.

> ngspice was **not** installed in the environment this was built in, so the
> ngspice path is implemented and type-checked but has not been executed against
> a real binary. Parsing ngspice operating-point output into per-component
> measurements is the next step for that adapter; until it exists the UI shows the
> deterministic numbers and the raw SPICE log side by side, each labelled.

---

## The AI teaching assistant

### Architecture

```
Browser                          Server (never reaches the client)
───────                          ─────────────────────────────────
deterministic engine
      │
      ▼
buildEvidence()  ──POST /api/tutor──>  validate body
  structured JSON                           │
                                            ├─ no key ──> Local Demo Tutor
                                            │             (deterministic)
                                            └─ key ─────> Claude
                                                           │
                                            Anthropic SDK + system prompt
```

The API key is read only in [`src/lib/env.ts`](src/lib/env.ts) (marked
`server-only`) from the route handler at
[`src/app/api/tutor/route.ts`](src/app/api/tutor/route.ts). The Anthropic SDK is
never imported into a client component — verified by grepping the built client
chunks.

### The evidence packet

The tutor's only window onto the student's work
([`src/lib/tutor/evidence.ts`](src/lib/tutor/evidence.ts)): the experiment brief,
the engine descriptor and its fidelity statement, the LED model parameters, every
component with its pins/holes/nets, every jumper, the full netlist, the solved
branches, per-component measurements, model-limit notes, the validator's
diagnostics **with the evidence numbers each was derived from**, and the PCB check
results.

### The guardrails

From [`src/lib/tutor/prompt.ts`](src/lib/tutor/prompt.ts), the tutor must:

- cite only numbers present in the evidence packet;
- discuss only faults the deterministic checks reported;
- never claim to have modified the design — it has no tools and no write access;
- state uncertainty explicitly, and flag model limits;
- never describe output as SPICE unless the engine actually was ngspice;
- respect the hint level, which matters more than being helpful.

Each reply carries provenance badges in the UI: the hint level, which tutor
answered, and how many deterministic diagnostic codes it was grounded in.

### Hint levels

| Level | Behaviour |
| --- | --- |
| **1 — Gentle nudge** | Points at the right region, asks one question. Names at most one object. No fault name, no fix, no arithmetic. |
| **2 — Specific explanation** | Names the fault, explains the physical principle, asks what change would address it. Still withholds the explicit action. |
| **3 — Guided solution** | Step-by-step fix with the arithmetic, plus a check to confirm it worked. |

The escalation is enforced by tests: the level-1 reply for a reversed LED must not
contain `180` or the hole addresses; the level-3 reply must.

### Running with no Claude credit

The laboratory is designed to be fully usable with no Anthropic account at all.
There are two distinct cases, and both are handled and tested:

| Situation | What happens |
| --- | --- |
| **No `ANTHROPIC_API_KEY` set** | `/api/status` reports `local-demo`; the toolbar badge reads *Local Demo Tutor*; every reply opens with "No API key is configured, so this is not Claude." |
| **Key set but the call fails** (expired credit, 401, rate limit, outage) | The route catches it, answers with the Local Demo Tutor at **HTTP 200**, and sets `fallbackReason` to the real API error. The reply opens with "The Claude API could not be reached, so this reply is not from Claude." |

In both cases **none of the teaching is lost**, because none of it depends on the
API:

- the netlist extraction, the DC solve and all 18 fault checks run locally in the
  browser;
- the 3D workbench, the PCB editor, the DRC and version comparison never call
  out at all;
- the Local Demo Tutor has hand-written explanations for every diagnostic code at
  all three hint levels, with the same pedagogical rules as the Claude prompt —
  it quotes the student's real hole addresses and currents from the evidence
  packet, and it withholds the answer at levels 1 and 2 exactly as Claude is
  instructed to.

A lesson is therefore never blocked by billing or by an outage; the only thing
lost is Claude's ability to answer free-form questions outside the pre-written
explanations.

---

### Spoken explanations

The tutor's replies can be read aloud — useful for accessibility, and for
following a fix while both hands are on the circuit.

Two engines, the same degradation pattern as the tutor itself:

| Engine | When | Needs |
| --- | --- | --- |
| **Browser speech** (`speechSynthesis`) | Default | Nothing. Works offline, no key, no cost. |
| **ElevenLabs** | When `ELEVENLABS_API_KEY` is set | A key, read only by `src/app/api/speech/route.ts`. |

With no key the route returns `204` and the client speaks locally; if an
ElevenLabs call fails for any reason the client falls back to browser speech
rather than going silent. The badge in the tutor panel says which engine is live.

Markdown is converted to speakable text first
([`src/lib/voice/speech.ts`](src/lib/voice/speech.ts)) so the tutor does not read
asterisks aloud, and engineering notation is expanded the way a demonstrator
would say it: `9.09 mA` becomes "9.09 milliamps", `4.7 kΩ` becomes
"4.7 kilohms", `1. Select the LED` becomes "Step 1. Select the LED". Unit
letters only expand after a digit, so "A Volt is a unit" is left alone. All of
that is unit-tested.

Per-message **Listen** buttons sit in each reply's provenance footer; the speaker
icon in the panel header toggles auto-reading of every new reply.

## The PCB workspace

Footprints are **derived from the circuit**, carrying their net assignments across
([`src/lib/pcb/footprints.ts`](src/lib/pcb/footprints.ts)), with real pad
geometry: 2.54 mm LED lead pitch with a square anode pad, 7.62 mm DIN0207 axial
resistor, 2.5 mm radial electrolytic, 5.08 mm two-pin terminal block. Re-importing
preserves the student's existing placement.

Nothing is auto-routed. The student arranges the footprints and routes each trace
by clicking a pad, adding waypoints to dodge obstacles, and clicking the
destination pad.

### Fabricated-board preview (3D)

The PCB workspace has two views. **2D Layout** is the editor; **3D Fabricated**
renders the same board as it would come back from manufacture — 1.6 mm FR4,
35 µm copper, plated through-holes, HASL pads, silkscreen, and the mounted
through-hole parts.

Everything in that view is generated from the student's own `PcbBoard`: their
footprint placement, their routed traces, their net assignments. It is
deliberately not a stock PCB model, because a canned model would show someone
else's board and would not change when a net is re-routed. Re-route a trace and
the 3D board changes with it.

Controls: six solder-mask colours, a **Solder mask** toggle (off exposes the bare
copper so the routing is fully legible), **Silkscreen** and **Components**
toggles. Traces flagged by the checker are highlighted in red in 3D, so a
clearance error is visible on the board rather than only in a list.

### Simplified educational PCB checker

[`src/lib/pcb/drc.ts`](src/lib/pcb/drc.ts) — **not a KiCad-certified DRC.** It
implements exactly four explicit rule families:

1. **Connectivity** — every net with ≥2 pads must form a single copper island
   (union-find over trace ends). Reports the island count.
2. **Correctness** — a trace must not join pads on different nets.
3. **Clearance** — segment-to-segment and segment-to-pad distances against
   `clearance + ½w₁ + ½w₂`. Same-net copper is exempt; different layers do not
   interact.
4. **Placement** — courtyards must not overlap; traces and footprints must stay
   inside the board outline.

Default rules: clearance 0.25 mm, min trace width 0.25 mm, courtyard gap 0.2 mm,
routing grid 1.27 mm (50 mil), board 60.96 × 40.64 mm.

**Not implemented, and therefore never claimed:** annular ring and drill checks,
via and stackup rules, thermal relief, impedance control, silkscreen-over-pad,
solder-mask slivers, acid traps, differential pairs, manufacturer capability
profiles.

### Path to KiCad DRC

The data model was chosen to map onto KiCad concepts one-to-one, so the checker
can be replaced rather than rewritten:

| BoardMaster | KiCad |
| --- | --- |
| `PcbFootprint` | `FOOTPRINT` |
| `PcbPad` (with `net`) | `PAD` + net assignment |
| `PcbTrace` (points, width, layer) | `SEGMENT` on a copper layer |
| `PcbDesignRules` | `BOARD_DESIGN_SETTINGS` constraints |
| `checkPcb()` | `DRC_ENGINE` |

`checkPcb()` is a pure function of `(PcbBoard, PcbDesignRules)`, so a real
integration means writing a `PcbBoard` → `.kicad_pcb` serialiser and shelling out
to `kicad-cli pcb drc --format json`, then mapping its violations onto the
existing `Diagnostic` shape. Everything downstream — the UI, the highlighting, the
tutor evidence — already speaks `Diagnostic` and would not change.

---

## Design system in Figma

The design system is not a screenshot pasted into Figma — it is built from the
same tokens the application ships.

**File:** https://www.figma.com/design/CJB4wcLgOLYaC2HvhFWyKF

| Built | Detail |
| --- | --- |
| **70 variables** | 4 collections: `Primitives` (raw hexes, scoped `[]` so they stay out of pickers), `Color` (semantic, aliased to primitives), `Spacing`, `Radius` |
| **Code syntax** | Every semantic variable carries its real CSS custom property as WEB syntax — `var(--accent-cyan)`, `var(--surface-base)` — so Figma's inspector shows the exact token the code uses |
| **Scopes** | Set explicitly on every variable (`TEXT_FILL`, `STROKE_COLOR`, `GAP`, `CORNER_RADIUS`, …), never left as `ALL_SCOPES` |
| **9 text styles** | The type ramp from DESIGN_SYSTEM.md §2, including the uppercase `type/micro` eyebrow and the tabular `type/data` monospace |
| **3 effect styles** | `shadow/panel`, `shadow/glow`, `shadow/inset` |
| **6 component sets, 38 variants** | Button (6 styles × 3 states), Badge (6 tones), Readout (4 tones), Input (4 states), Panel (subtitle on/off), Diagnostic row (4 severities) |

Fills, strokes, radii, padding and gaps are **bound to variables**, not
hardcoded, so changing `accent/cyan` in Figma updates every component. Each
component set's description names the source file it mirrors, e.g. *"Style maps
1:1 to the `variant` prop of Button in src/components/ui/primitives.tsx."*

**A bug this caught:** the tinted components (all five coloured Badge tones, and
the danger Button) rendered as solid blocks with invisible labels. Setting
`opacity` by spreading the paint returned from `setBoundVariableForPaint` is
silently dropped — the opacity has to be part of the paint object handed *to*
that call. Verified fixed by reading the fill opacities back (`0.12` across the
board).

### Not yet in Figma

Hit the **Figma Starter plan's MCP tool-call limit** partway through. Outstanding:
the three screen mockups, the foundations specimen page, and Code Connect
mappings. The Starter plan also caps the file at 3 pages, so the structure is
`Foundations / Components / Screens` rather than a separate cover page.

## Project structure

```
src/
├── app/
│   ├── layout.tsx, page.tsx, error.tsx, not-found.tsx
│   ├── globals.css                 design tokens (see DESIGN_SYSTEM.md)
│   └── api/
│       ├── tutor/route.ts          Claude + validation + fallback (server only)
│       └── status/route.ts          non-secret capability probe
├── lib/
│   ├── circuit/
│   │   ├── types.ts                the circuit graph
│   │   ├── breadboard.ts           geometry + real strip connectivity
│   │   ├── componentDefs.ts        part catalogue + LED device model
│   │   ├── graph.ts                union-find netlist extraction
│   │   ├── solve.ts                deterministic DC branch analyser
│   │   ├── validate.ts             the fault rules
│   │   ├── diagnostics.ts          shared diagnostic vocabulary
│   │   ├── experiments.ts          experiment briefs
│   │   └── __tests__/
│   ├── pcb/
│   │   ├── types.ts, geometry.ts, footprints.ts, drc.ts
│   │   └── __tests__/
│   ├── sim/
│   │   ├── adapter.ts              engine boundary
│   │   ├── deterministic.ts        always available
│   │   ├── ngspice.ts              optional, server only
│   │   └── netlistSpice.ts         SPICE netlist generation
│   ├── tutor/
│   │   ├── types.ts, evidence.ts, prompt.ts, localTutor.ts
│   ├── env.ts                      server-only env validation
│   └── format.ts                   engineering notation, colour bands
├── store/
│   ├── types.ts, useLabStore.ts    Zustand + undo/redo + versions
│   └── __tests__/journey.test.ts   end-to-end workflow test
└── components/
    ├── ui/primitives.tsx           Button, Panel, Badge, Input, Readout…
    ├── layout/                     TopToolbar, sidebars, panels, LabShell
    ├── three/                      Breadboard, Parts, Jumper, Workbench
    ├── pcb/PcbWorkspace.tsx
    ├── tutor/TutorPanel.tsx
    └── versions/CompareVersions.tsx
```

State is persisted to `localStorage` under `circuitmentor-3d.v1` (design, board,
project name, experiment, last 20 versions). Every read and write is wrapped in
`try/catch`, so private mode or a blocked quota degrades gracefully instead of
breaking the app.

---

## Tests

```bash
npm test
```

196 tests across seven suites:

- **`lib/circuit`** (33) — breadboard strip rules, bank isolation, rail
  continuity, rotated pin resolution, the 9.09 mA golden calculation, and each
  fault class with its evidence fields. Also asserts purity: the validator never
  mutates the input design, and identical input gives identical output.
- **`lib/pcb`** (22) — footprint derivation and net inheritance, connectivity and
  island counting, wrong-net shorts, dangling ends, clearance (crossings,
  near-misses, same-net exemption, layer independence, foreign pads), courtyard
  overlap, off-board geometry, and the geometry primitives.
- **`lib/circuit/devices`** (22) — every new part driven through the solver:
  switch open/closed, button held, diode forward and reversed, pot wiper split,
  fuse intact/blown/over-rating, inductor as a DC short, LDR illumination,
  buzzer polarity, battery as an alternative source, RGB channel selection.
- **`lib/mcu`** (46) — the interpreter (lexer positions, control flow, C integer
  division, short-circuiting, arrays, user functions, determinism) and every
  error class above; plus the code-to-circuit bridge, both directions.
- **`lib/voice`** (17) — markdown-to-speech conversion: markup stripping, spoken
  engineering units, step numbering, and deterministic voice selection.
- **`store`** (33) — the full ten-step workflow driven through the real store:
  build → simulate → diagnose → ask the tutor at all three levels → fix →
  re-simulate → import footprints → route → check → version compare, plus
  undo/redo, stale-result invalidation, tutor failure handling, and the
  centre-preserving rotation regression.

### Bugs found during development

Four real defects were caught and fixed before shipping; the first by the test
suite, the rest by a review pass over the 3D layer.

1. **Rotation moved the wrong lead.** Rotating a seated two-lead part 180°
   rotated it about its **origin pin**, walking the far lead into a different
   hole and silently breaking a circuit the student had already wired. The fix
   rotates about the part's own **centre**, so a 180° turn swaps the leads
   between the same two holes — exactly what pulling the part out and reinserting
   it does on a real breadboard. Three regression tests pin this behaviour.
2. **All 390 breadboard holes rendered at the origin.** The instanced-mesh
   matrices were written inside a `useMemo`, which runs during render while the
   ref is still `null`, so they were never applied. Moved to `useLayoutEffect`.
3. **A blocked CDN could blank the entire 3D scene.** drei's `<Text>` calls
   `suspend()` while preloading a font, and troika resolves its default font from
   jsdelivr at runtime. With no boundary, a slow or blocked CDN would suspend the
   whole scene subtree and show an empty bench. Every label now sits in its own
   `Suspense` boundary ([`SafeText`](src/components/three/SafeText.tsx)), so
   fonts can fail and the board, parts and wires still render and stay
   interactive.
4. **An avoidable runtime CDN fetch.** drei's `<Environment preset="city">`
   downloads an HDR environment map at runtime. Replaced with explicit hemisphere
   and fill lights.

### Offline behaviour

After fixes 3 and 4 the only remaining runtime network dependency in the 3D view
is troika's font resolver. If it is unreachable, the engraved labels (hole
numbers, row letters, `A`/`K`, reference designators, the supply's digits) do not
appear; **everything else still works**, and no information is carried by text
alone — the LED's cathode is marked by its flat flange and shorter lead, the
supply posts are colour-coded red and black, and the rails carry painted polarity
stripes. Self-hosting a `.ttf` and passing it to `SafeText` would remove this
dependency entirely; troika cannot use the `.woff2` files `next/font` produces.

---

## Verified

- `npm run typecheck` — clean under `strict` plus `noUncheckedIndexedAccess`.
- `npm test` — 196/196 passing.
- `npm run build` — succeeds.
- `/api/status` returns the honest capability report (tutor mode, both engines,
  env warnings).
- `/api/tutor` returns correctly escalating replies at levels 1/2/3 that quote
  only the hole addresses present in the evidence, and rejects malformed bodies
  with 400 and a specific message.
- `/api/speech` returns `204 X-Speech-Engine: browser-fallback` with no key, and
  rejects empty text with 400.
- Driven end-to-end in headless Chrome over the DevTools Protocol: build the
  circuit → run the analyser (9.09 mA, VALID) → introduce the reversed-LED fault
  (0 A, `LED_REVERSED`) → import footprints → route three nets → PCB checks pass
  (`3/3 nets routed, 0 errors`) → fabricated 3D preview renders.
- The built client chunks contain no occurrence of `ANTHROPIC_API_KEY`,
  `anthropicApiKey`, `sk-ant`, or the Anthropic SDK.

## Known gaps

- **ngspice is untested against a real binary** — see Simulation fidelity above.
- **No browser-automation test.** No headless browser was available in the build
  environment, so the 3D interaction layer (orbit, drag-to-reseat, click-to-wire)
  was verified by driving the store through the same state transitions the
  pointer handlers dispatch, plus a review pass over the pointer and render code
  — which is how bugs 2–4 above were found. The rendered output itself has not
  been visually confirmed.
- **3D labels need network access** for troika's font resolver — see Offline
  behaviour above. Degrades gracefully.
- **Desktop only.** The three-column bench layout needs ≥1280px and has no mobile
  breakpoint, by design.
- **One supply per bench**, and a single fixed half-size breadboard.
- **DC only**, so the second experiment inspects a capacitor at DC rather than
  showing its transient.

---

## Licence

Built for a university hackathon. No licence asserted.
