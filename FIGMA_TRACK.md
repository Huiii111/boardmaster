# Best-Designed AI Product — track submission

**Written for: hackathon judges on the Figma track.**

> *"An AI product as well designed as it is smart, designed in Figma or built
> with Figma Make. In your demo, explain why you qualify and show evidence of
> how you used Figma."*

This is the short version of why BoardMaster qualifies, and where to look.

**Figma file:** https://www.figma.com/design/CJB4wcLgOLYaC2HvhFWyKF

---

## 1. The claim, in one line

BoardMaster's design system is not documentation *about* the product — it is a
Figma variable library whose every token carries the real CSS custom property
the code reads, so the file and the running app are the same system expressed
twice.

## 2. What is actually in the Figma file

| | |
| --- | --- |
| **Variables** | 70, organised `surface/*`, `border/*`, `text/*`, `accent/*`, `signal/*`, `material/*` |
| **Text styles** | 9, covering the panel-header, readout, caption and note roles |
| **Component sets** | 6, with variants — Button (6 variants × 4 sizes), Badge (6 tones), Panel, Input, Readout, Diagnostic row |
| **Pages** | Foundations, Components, Screens |

The part that matters for this track is the **code syntax**. Every semantic
variable has its WEB syntax set to the exact custom property the stylesheet
uses — `var(--accent-cyan)`, `var(--surface-base)` — so Figma's inspector
hands a developer the token the code already reads, not a hex to re-type.

## 3. Evidence of Figma → code parity

`DESIGN_SYSTEM.md` in this repository is the written contract. Every colour
table carries three columns: the CSS token, the hex, and **the Figma style
name**. A judge can open the Figma file and the stylesheet side by side and
check any row.

Two concrete demonstrations that the parity is real and load-bearing:

**a. A theme change propagated through both.** The product shipped on a dark
charcoal theme, then moved to a light one. Because nothing was hardcoded, the
change was a token-ramp edit in `globals.css` and the same ramp in Figma —
the component sets inherited it. The commit history shows the single-source
change rather than a component-by-component repaint.

**b. The system caught a real accessibility defect.** Re-deriving the contrast
column from the actual values — rather than carrying the dark theme's numbers
over — showed `--text-disabled` at **2.95:1** on the new background, below the
3:1 floor, while being used for real content (stat rows, table headers), not
only for disabled controls. It was darkened to `#708092`, **3.7:1**. The
accents were darkened for the same reason: the dark theme's `#2fe0cf` cyan
scores about **1.5:1** on white and is unreadable as text. Every accent and
signal colour now clears AA as text:

| Token | Hex | On white |
| --- | --- | --- |
| `accent/cyan` | `#0B7A6D` | 5.2:1 — AA |
| `accent/electric` | `#0D6FD1` | 5.0:1 — AA |
| `signal/ok` | `#0B7A52` | 5.4:1 — AA |
| `signal/warn` | `#96580A` | 5.7:1 — AA |
| `signal/error` | `#CA2B2B` | 5.4:1 — AA |
| `signal/info` | `#1A5FCC` | 5.9:1 — AA |

## 4. Why the design *is* the intelligence here

The track asks for a product "as well designed as it is smart". BoardMaster's
central design problem is an honesty problem, and it is solved visually:

- **A simplified model must never look like SPICE.** The fidelity statement is
  a permanent disclosure in the Simulation Status panel whose summary line —
  *"DC operating point only — not SPICE"* — stays visible even when collapsed.
  It is a designed component, not a footnote.
- **Numbers must show their working.** Every branch reading prints the
  derivation beside it, and a test asserts the printed arithmetic evaluates to
  the printed answer. A readout that cannot justify itself is a bug.
- **The AI must be visibly labelled.** When no API key is present the tutor
  runs a deterministic local fallback, and the toolbar badge says so in words
  rather than failing silently or pretending.
- **State must be legible at a glance.** A lit LED drives three cues at once —
  halo, a real light pooling on the board, and body colour — because the most
  important state in the lab was previously the least visible thing on screen.

## 5. Known gap, stated plainly

The Figma file's variables still hold the **dark-theme** values at time of
writing. The retarget was scripted and ready, but the Figma MCP server caps
tool calls on the **Starter** plan and the write was refused mid-task.

Rather than hand-edit 70 variables, the same operation ships as
[`figma/update-tokens.js`](figma/update-tokens.js) — a plugin script that runs
inside Figma, where no MCP quota applies. It renames the document, rewrites
every matched colour variable to the light value, re-sets each one's WEB code
syntax, and prints a report of what it matched and what it did not.

Running it takes about a minute and closes the gap. Claiming the Figma for
Education seat would also lift the MCP cap.

## 6. Where to look, in order

1. `DESIGN_SYSTEM.md` — the written contract, with Figma style names
2. The Figma file above — Foundations page, variables panel
3. `src/app/globals.css` — the token ramp the variables mirror
4. `src/components/ui/primitives.tsx` — the component sets, in code
5. `figma/update-tokens.js` — the parity kept mechanical, not manual
