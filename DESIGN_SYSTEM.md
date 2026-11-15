# BoardMaster — Design System

The visual language of a premium engineering workstation: dark graphite surfaces,
electric blue and cyan signal accents, tabular instrument readouts, and a subtle
technical grid. Deliberately **not** a generic AI dashboard — no purple gradients,
no rounded pill chrome, no decorative illustration.

Every token below exists in two places that must stay in sync:

| Where | File |
| --- | --- |
| CSS custom properties | [`src/app/globals.css`](src/app/globals.css) |
| Tailwind theme | [`tailwind.config.ts`](tailwind.config.ts) |

All values are plain hex, px and ms, so this document can be recreated in
**Figma Starter (free)** with no paid features: local styles, variables and
components are all that is required.

---

## 1. Colour tokens

### 1.1 Surfaces

Six steps of graphite, from the void behind the 3D viewport up to the active
state of an interactive row.

| Token | Hex | Figma style name | Use |
| --- | --- | --- | --- |
| `--surface-void` | `#E7ECF2` | `surface/void` | 3D canvas backdrop, scene fog |
| `--surface-base` | `#F2F5F9` | `surface/base` | App background, sidebars |
| `--surface-raised` | `#FFFFFF` | `surface/raised` | Panel headers, toolbar |
| `--surface-panel` | `#FFFFFF` | `surface/panel` | Instrument panel body |
| `--surface-inset` | `#F1F4F8` | `surface/inset` | Inputs, readout wells |
| `--surface-hover` | `#E9EEF5` | `surface/hover` | Row hover |
| `--surface-active` | `#DBE4EF` | `surface/active` | Pressed / selected tab |

### 1.2 Borders

| Token | Hex | Figma style name | Use |
| --- | --- | --- | --- |
| `--border-subtle` | `#E6EAF0` | `border/subtle` | Dividers inside a panel |
| `--border-default` | `#D2DAE4` | `border/default` | Panel and control outlines |
| `--border-strong` | `#ADBBCB` | `border/strong` | Hover outline, scrollbar thumb |

### 1.3 Text

A four-step ramp. Never place `text/tertiary` on `surface/inset` below 11px.

| Token | Hex | Figma style name | Contrast on `surface/base` |
| --- | --- | --- | --- |
| `--text-primary` | `#10181F` | `text/primary` | 16.4:1 — AAA |
| `--text-secondary` | `#3A4654` | `text/secondary` | 8.8:1 — AAA |
| `--text-tertiary` | `#5A6877` | `text/tertiary` | 5.2:1 — AA |
| `--text-disabled` | `#708092` | `text/disabled` | 3.7:1 — AA for ≥18px / decorative only |

### 1.4 Accents

| Token | Hex | Figma style name | Use |
| --- | --- | --- | --- |
| `--accent-electric` | `#0D6FD1` | `accent/electric` | Primary buttons |
| `--accent-electric-bright` | `#0A5CB0` | `accent/electric-bright` | Primary hover, hovered hole ring |
| `--accent-cyan` | `#0B7A6D` | `accent/cyan` | Focus rings, live data, selection |
| `--accent-cyan-bright` | `#086257` | `accent/cyan-bright` | Readout glow text |

### 1.5 Signals

Semantic only. Severity colour must always be paired with an icon and text so
colour is never the sole carrier of meaning.

| Token | Hex | Figma style name | Severity |
| --- | --- | --- | --- |
| `--signal-ok` | `#0B7A52` | `signal/ok` | pass |
| `--signal-warn` | `#96580A` | `signal/warn` | warning, wire anchor |
| `--signal-error` | `#CA2B2B` | `signal/error` | error |
| `--signal-info` | `#1A5FCC` | `signal/info` | info, ratsnest |

### 1.6 Physical materials

Used by the 3D scene and by legend swatches, so the UI and the 3D view agree.

| Token | Hex | Figma style name | Object |
| --- | --- | --- | --- |
| `--mat-breadboard` | `#E8E6DF` | `material/breadboard` | Board plastic |
| `--mat-copper` | `#C88B45` | `material/copper` | PCB traces, pads |
| `--mat-led-red` | `#E8352A` | `material/led-red` | LED epoxy |
| `--mat-resistor-body` | `#CDB086` | `material/resistor-body` | Carbon-film body |

**Resistor band palette** (`src/lib/format.ts` → `BAND_COLORS`): black `#0A0A0A`,
brown `#6B3F1D`, red `#D22B2B`, orange `#E07820`, yellow `#E8D44D`, green
`#2F9E44`, blue `#2D6CDF`, violet `#8B5CF6`, grey `#9CA3AF`, white `#F5F5F5`,
gold `#D4AF37`, silver `#C0C0C0`.

---

## 2. Typography

Two families only.

| Role | Family | Fallback |
| --- | --- | --- |
| UI | **Inter** | `ui-sans-serif, system-ui, Segoe UI` |
| Data, code, holes, nets | **JetBrains Mono** | `ui-monospace, SFMono-Regular` |

Any number a student might compare against another number is set in the mono
family with `font-variant-numeric: tabular-nums`.

### Type scale

| Name | Size / line-height | Weight | Tracking | Use |
| --- | --- | --- | --- | --- |
| `display` | 24 / 30 | 500 | −0.01em | Headline readout (branch current) |
| `title` | 15 / 20 | 600 | −0.01em | Modal titles |
| `heading` | 13 / 18 | 600 | −0.01em | Brand mark, experiment name |
| `body` | 12 / 17 | 400 | 0 | Control labels, buttons |
| `body-sm` | 11 / 16 | 400 | 0 | Panel content, diagnostics, chat |
| `caption` | 10 / 14 | 400 | 0 | Hints, metadata, table cells |
| `micro` | 9 / 12 | 600 | 0.10em | Uppercase eyebrow labels |
| `data` | 11 / 16 | 400 mono | 0.02em | Nets, holes, measurements |
| `data-lg` | 15 / 20 | 500 mono | 0.02em | Readout tiles |

**Eyebrow label rule:** `micro`, weight 600, `text-transform: uppercase`,
`letter-spacing: 0.10em`, colour `text/tertiary`. Used for every panel header and
field label.

---

## 3. Spacing

4px base unit. Only these steps are used.

| Token | px | Use |
| --- | --- | --- |
| `space-1` | 4 | Icon-to-label gap |
| `space-2` | 8 | Control inner padding, stack gap |
| `space-3` | 12 | Panel padding, column gap |
| `space-4` | 16 | Section separation |
| `space-5` | 20 | — |
| `space-6` | 24 | Modal padding |
| `space-8` | 32 | Empty-state vertical padding |

**Gutters:** sidebars and the centre column are padded `10px` (`p-2.5`), with a
`10px` gap between stacked panels.

---

## 4. Border radii

| Token | px | Use |
| --- | --- | --- |
| `radius-xs` | 3 | Badges, `<kbd>`, colour bands |
| `radius-sm` | 5 | Segmented tabs, inline chips |
| `radius-md` | 8 | Buttons, inputs, readout tiles |
| `radius-lg` | 12 | Panels |
| `radius-xl` | 16 | Modals |

---

## 5. Elevation

| Token | Value | Use |
| --- | --- | --- |
| `shadow/panel` | `inset 0 1px 0 rgba(255,255,255,.05)`, `0 12px 32px -16px rgba(0,0,0,.9)` | Instrument panels |
| `shadow/glow` | `0 0 0 1px rgba(47,224,207,.4)`, `0 0 20px -4px rgba(47,224,207,.35)` | Armed library item |
| `shadow/inset` | `inset 0 1px 3px rgba(0,0,0,.7)` | Readout wells, inputs |

The **`.instrument`** surface is the signature treatment: a top-edge highlight
gradient (`rgba(255,255,255,.035)` → transparent at 38%) over `surface/panel`,
with a 1px `border/default` outline and `shadow/panel`. In Figma: one frame, two
fills, one inner shadow, one drop shadow.

---

## 6. Motion

| Token | Value |
| --- | --- |
| `ease-lab` | `cubic-bezier(0.22, 1, 0.36, 1)` |
| `dur-fast` | 120ms — hover, colour change |
| `dur-base` | 200ms — panel entry, gauge fill |
| `dur-slow` | 320ms — modal |

Named animations: `lab-fade-up` (6px rise + fade), `lab-pulse` (typing dots),
`lab-sweep` (indeterminate progress), `lab-spin` (loading).

All of it collapses to 0.001ms under `prefers-reduced-motion: reduce`.

---

## 7. Components

### 7.1 Button

Heights: `sm 28`, `md 32`, `lg 40`, `icon 32×32`. Radius `md`. Gap `space-2`.
Icons are 13px at `md`.

| Variant | Rest | Hover | Active | Disabled |
| --- | --- | --- | --- | --- |
| `primary` | `accent/electric` bg, white text | `accent/electric-bright` | `translateY(1px)` | 45% opacity |
| `accent` | `accent/cyan` bg, `#04221F` text, 600 | `accent/cyan-bright` | `translateY(1px)` | 45% opacity |
| `outline` | `surface/raised`, `border/default` | `surface/hover`, `border/strong` | — | 45% opacity |
| `ghost` | transparent, `text/secondary` | `surface/hover`, `text/primary` | — | 45% opacity |
| `subtle` | `surface/hover`, `text/secondary` | `surface/active`, `text/primary` | — | 45% opacity |
| `danger` | `signal/error` @12% bg + 30% border | @20% bg | — | 45% opacity |

**Toggle state** (`active`): `surface/active` fill, 1px `accent/cyan` ring,
`text/primary`. Exposed as `aria-pressed`.

### 7.2 Panel

Radius `lg`, `.instrument` surface. Header: `surface/raised`, 12px horizontal /
8px vertical padding, 1px `border/subtle` bottom, optional 12px cyan icon, an
eyebrow title, an optional subtitle in `caption`/`text/disabled`, and a
right-aligned action slot. Body padding `space-3`, or flush for self-managing
lists.

### 7.3 Badge

Height 16px, radius `xs`, padding `0 6px`, `caption` weight 500. Tones follow a
single formula: **text = the tone colour, background = tone @12%, border = tone
@30%**. Tones: `neutral`, `ok`, `warn`, `error`, `info`, `accent`.

### 7.4 Input / Select / Textarea

Height 32 (textarea min 46), radius `md`, `surface/inset` fill, 1px
`border/default`, `body-sm` text, placeholder `text/disabled`.
Hover → `border/strong`. Focus → `border/accent-cyan` plus the global focus ring.
Select carries an inline SVG chevron in `text/tertiary`.

### 7.5 Readout tile

`surface/inset` well with `shadow/inset`, radius `md`, padding `8px 10px`.
`micro` label over a `data-lg` value. Live values use `accent/cyan-bright` with
`text-shadow: 0 0 12px rgba(47,224,207,.45)`; idle values use `text/disabled`.

### 7.6 Diagnostic row

A severity chip (icon on tone @7% bg, tone @28% border), a `body-sm` title, a
mono `caption` code, and a disclosure chevron. Expanded: detail prose in
`text/secondary`, an **Evidence** key/value block on `surface/inset`, and an
"Ask the tutor" action. Hovering a row highlights the parts it refers to in the
3D scene.

### 7.7 Current gauge

8px track on `surface/active`, radius full. Fill colour is chosen by band:
`text/disabled` below the visibility threshold, `signal/ok` in the safe band,
`signal/warn` above rated current, `signal/error` above absolute maximum. Two 1px
tick marks sit at the rated and absolute-maximum currents. Exposed as
`role="meter"`.

### 7.8 Chat bubble

Student: right-aligned, `accent/electric` @10% fill, 30% border, radius `lg` with
a 5px bottom-right corner. Tutor: left-aligned, `surface/raised`,
`border/subtle`, radius `lg` with a 5px bottom-left corner, 20px circular avatar,
and a provenance footer of badges (hint level, tutor source, evidence count)
above a 1px `border/subtle` rule.

### 7.9 Toast

Fixed bottom-centre, max-width 448px, radius `lg`, tone-tinted translucent fill
with `backdrop-blur`, severity icon, `body-sm` message, dismiss affordance.
Auto-dismiss after 4200ms. `role="status"`.

---

## 8. Screen layouts

### 8.1 Main shell — 1440×900 reference

```
┌──────────────────────────────────────────────────────────────────────────┐
│ TOP TOOLBAR                                                       h=56  │
│ brand │ project │ experiment ▾ │ ↶ ↷ save │ ···· │ workspace tabs │     │
│                                      tutor badge │ Run Sim │ AI Review  │
├────────────┬──────────────────────────────────────────┬──────────────────┤
│ LEFT       │ CENTRE                                   │ RIGHT            │
│ w=268      │ flex-1, min-w-0                          │ w=352            │
│            │                                          │                  │
│ Tools      │ ┌──────────────────────────────────────┐ │ Simulation       │
│  select    │ │ experiment brief            h=auto   │ │  status          │
│  wire      │ ├──────────────────────────────────────┤ │                  │
│  delete    │ │                                      │ │ Circuit issues   │
│            │ │   3D WORKBENCH (R3F canvas)          │ │                  │
│ Component  │ │                                      │ │ Measurements     │
│  library   │ │   HUD ↖ tool + hole                  │ │                  │
│  search    │ │   HUD ↗ live current                 │ │ Properties       │
│  categories│ │   HUD ↙ legend                       │ │                  │
│  parts     │ │   HUD ↘ reset camera                 │ │ AI Teaching      │
│            │ │                                      │ │  Assistant       │
│ Quick start│ └──────────────────────────────────────┘ │                  │
└────────────┴──────────────────────────────────────────┴──────────────────┘
                        toasts, bottom-centre, fixed
```

Both sidebars are fixed-width and independently scrollable (`scroll-lab`); only
the centre column flexes. Target viewport ≥1280px wide; the layout is
desktop-optimised, as a laboratory bench should be.

### 8.2 PCB workspace

The centre column is replaced by: a toolbar row (select / route / import /
ratsnest / rotate / clear), a conditional routing hint bar, the SVG board canvas
(flex-1), and an active-rules footer. The right sidebar swaps the simulation
panels for **PCB checks** and **PCB issues**, keeping Properties and the Tutor.

### 8.3 Compare workspace

A single scrolling column: version pickers (Before → After), two verdict cards
side by side, a "What changed" diff list, an "Effect of the change" summary, and
the full version history.

### 8.4 Modal

Centred over `rgba(0,0,0,.65)` with `backdrop-blur`, max-width 448px, radius
`xl`, `.instrument` surface, `space-6` padding. Dismiss on backdrop click or
close button.

---

## 9. Interactive states

Every interactive element defines all six states.

| State | Treatment |
| --- | --- |
| **Rest** | As specified per component |
| **Hover** | Surface steps up one level; borders step to `border/strong`; 120ms |
| **Focus** | `outline: 2px solid accent/cyan`, `outline-offset: 2px` — one global rule, never removed |
| **Active** | `translateY(1px)` on filled buttons |
| **Selected** | `surface/active` + 1px `accent/cyan` ring; `aria-pressed` / `aria-current` |
| **Disabled** | 45% opacity, `cursor: not-allowed`, hover suppressed |
| **Loading** | Spinner replaces the leading icon; `aria-busy="true"`; pointer events off |

### 3D scene states

| Cue | Colour | Meaning |
| --- | --- | --- |
| Ring on hole | `accent/electric-bright` | Hole under the cursor |
| Filled ring | `signal/warn` | Wire anchor awaiting a second endpoint |
| Disc on holes | `accent/cyan` @22% | Every hole on the same copper strip |
| Ring round part | `accent/cyan` | Selected |
| Ring round part | `signal/warn` | Highlighted from a hovered diagnostic |
| Ghost sphere | `accent/cyan` | Valid placement target |
| Ghost sphere | `signal/error` | Part will not fit here |

Cursor: `grab` over a draggable part, `crosshair` over a supply terminal,
`not-allowed` in delete mode, `pointer` over a jumper.

---

## 10. Accessibility contract

- One global focus ring; `:focus-visible` is never suppressed.
- Severity is always icon + text + colour, never colour alone.
- The current gauge is a `role="meter"` with min/now/max.
- The tutor transcript is `aria-live="polite"` with `aria-busy` while thinking.
- Hint levels are a `radiogroup` with `aria-checked`.
- Toggle buttons expose `aria-pressed`; workspace tabs expose `aria-current`.
- Tables carry real `<th scope>` headers; decorative icons are `aria-hidden`.
- Every form control has a visible `<label>` or an `aria-label`.
- Full keyboard map: `V` `W` `X` tools, `R` rotate, `Del` delete, `Esc` cancel,
  `H` reset camera, `Ctrl+Z` / `Ctrl+Shift+Z`, `Ctrl+S`, `Ctrl+Enter` simulate,
  `?` shortcut help.

---

## 11. Recreating this in Figma Starter

1. **Variables** — one collection, `Design Tokens`, with four groups: `surface`,
   `border`, `text`, `accent`/`signal`/`material`. Paste the hex values from §1.
2. **Text styles** — nine styles from §2, named `display`, `title`, `heading`,
   `body`, `body-sm`, `caption`, `micro`, `data`, `data-lg`.
3. **Effect styles** — the three shadows in §5.
4. **Base components** — Button (variant property: 6 variants × 4 sizes × 6
   states), Badge (6 tones), Input, Select, Panel (boolean `has-subtitle`,
   `flush`), Readout tile (3 tones), Badge row, Diagnostic row (4 severities ×
   expanded/collapsed), Chat bubble (2 roles), Toast (4 tones).
5. **Layout frames** — 1440×900 frames for the three screens in §8, using auto-layout
   with the fixed sidebar widths (268 / flex / 352) and 10px gaps.
6. **States** — build §9 as component variants, not as detached copies.

Everything above uses only local styles, variables, auto-layout and component
variants, all available on the free Figma Starter plan. No team libraries, no
branching, no dev-mode features are required.
