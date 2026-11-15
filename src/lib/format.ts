/** Engineering-notation formatters used across the UI, panels and diagnostics. */

const SI_PREFIX: Array<{ exp: number; sym: string }> = [
  { exp: 9, sym: 'G' },
  { exp: 6, sym: 'M' },
  { exp: 3, sym: 'k' },
  { exp: 0, sym: '' },
  { exp: -3, sym: 'm' },
  { exp: -6, sym: 'µ' },
  { exp: -9, sym: 'n' },
  { exp: -12, sym: 'p' },
];

/** Format a value in engineering notation with an SI prefix. */
export function formatSI(value: number, unit: string, sigFigs = 3): string {
  if (!Number.isFinite(value)) return `— ${unit}`;
  if (value === 0) return `0 ${unit}`;
  const abs = Math.abs(value);
  const chosen =
    SI_PREFIX.find((p) => abs >= Math.pow(10, p.exp)) ?? SI_PREFIX[SI_PREFIX.length - 1];
  const exp = chosen?.exp ?? 0;
  const sym = chosen?.sym ?? '';
  const scaled = value / Math.pow(10, exp);
  const digits = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : sigFigs - 1;
  return `${scaled.toFixed(digits)} ${sym}${unit}`;
}

export function formatAmps(a: number): string {
  return formatSI(a, 'A');
}

export function formatVolts(v: number): string {
  return formatSI(v, 'V');
}

export function formatOhms(r: number): string {
  if (r === 0) return '0 Ω';
  return formatSI(r, 'Ω');
}

export function formatFarads(f: number): string {
  return formatSI(f, 'F');
}

export function formatWatts(w: number): string {
  return formatSI(w, 'W');
}

/** Parse a user-entered value such as `4k7`, `10k`, `330`, `2.2M`. */
export function parseEngineering(input: string): number | null {
  const text = input.trim().replace(/\s+/g, '');
  if (text.length === 0) return null;

  const multipliers: Record<string, number> = {
    p: 1e-12,
    n: 1e-9,
    u: 1e-6,
    µ: 1e-6,
    m: 1e-3,
    k: 1e3,
    K: 1e3,
    M: 1e6,
    G: 1e9,
    R: 1,
    r: 1,
  };

  // `4k7` style: digits, prefix, digits.
  const infix = /^(\d+)([pnuµmkKMGRr])(\d+)$/.exec(text);
  if (infix) {
    const whole = infix[1] ?? '0';
    const sym = infix[2] ?? '';
    const frac = infix[3] ?? '0';
    const mult = multipliers[sym];
    if (mult === undefined) return null;
    return Number(`${whole}.${frac}`) * mult;
  }

  // `10k`, `4.7k`, `330` style.
  const suffix = /^(\d*\.?\d+)([pnuµmkKMGRr])?$/.exec(text);
  if (suffix) {
    const num = Number(suffix[1]);
    if (!Number.isFinite(num)) return null;
    const sym = suffix[2];
    const mult = sym ? multipliers[sym] : 1;
    if (mult === undefined) return null;
    return num * mult;
  }

  return null;
}

/* ----------------------- resistor colour bands ----------------------- */

export const BAND_COLORS: readonly string[] = [
  '#0a0a0a', // 0 black
  '#6b3f1d', // 1 brown
  '#d22b2b', // 2 red
  '#e07820', // 3 orange
  '#e8d44d', // 4 yellow
  '#2f9e44', // 5 green
  '#2d6cdf', // 6 blue
  '#8b5cf6', // 7 violet
  '#9ca3af', // 8 grey
  '#f5f5f5', // 9 white
];

export const MULTIPLIER_COLORS: Record<number, string> = {
  [-2]: '#c0c0c0', // silver
  [-1]: '#d4af37', // gold
  0: '#0a0a0a',
  1: '#6b3f1d',
  2: '#d22b2b',
  3: '#e07820',
  4: '#e8d44d',
  5: '#2f9e44',
  6: '#2d6cdf',
  7: '#8b5cf6',
};

/**
 * Four-band resistor colour code: two significant digits, multiplier, tolerance.
 * Returns hex colours for the three value bands plus the gold 5% tolerance band.
 */
export function resistorBands(ohms: number): [string, string, string, string] {
  const gold = '#d4af37';
  if (!Number.isFinite(ohms) || ohms <= 0) return ['#0a0a0a', '#0a0a0a', '#0a0a0a', gold];

  const exponent = Math.floor(Math.log10(ohms));
  const multiplierExp = Math.max(-2, exponent - 1);
  const significand = Math.round(ohms / Math.pow(10, multiplierExp));
  const clamped = Math.min(99, Math.max(10, significand));
  const d1 = Math.floor(clamped / 10);
  const d2 = clamped % 10;

  return [
    BAND_COLORS[d1] ?? '#0a0a0a',
    BAND_COLORS[d2] ?? '#0a0a0a',
    MULTIPLIER_COLORS[multiplierExp] ?? '#0a0a0a',
    gold,
  ];
}

export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * The one-line derivation printed under a branch reading.
 *
 * It must reproduce the number beside it. Earlier this read
 * `(supply.volts - Vf) / rTotalOhm`, which was wrong twice over for a circuit
 * driven by a microcontroller pin: `supply` is null there, so it printed 0 V,
 * and `rTotalOhm` omits the pin's output impedance, so even with the right
 * voltage the quotient missed the stated current by 7%.
 */
export function describeBranchCurrent(b: {
  driverVolts: number;
  vfSumV: number;
  rTotalOhm: number;
  rSourceOhm: number;
  currentA: number;
}): string {
  const r =
    b.rSourceOhm > 0
      ? `(${formatOhms(b.rTotalOhm)} + ${formatOhms(b.rSourceOhm)})`
      : formatOhms(b.rTotalOhm);
  return `I = (${formatVolts(b.driverVolts)} − ${formatVolts(b.vfSumV)}) / ${r} = ${formatAmps(
    b.currentA,
  )}`;
}
