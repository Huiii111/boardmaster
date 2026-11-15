import { isValidHole, offsetSeat, rotateOffset, stripOfHole, stripOf, holeId } from './breadboard';
import { defOf } from './componentDefs';
import type { CircuitDesign, HoleId, Netlist, Net, NodeKey, PlacedComponent } from './types';

/* ----------------------------- union-find ----------------------------- */

class DisjointSet {
  private parent = new Map<string, string>();

  add(key: string): void {
    if (!this.parent.has(key)) this.parent.set(key, key);
  }

  find(key: string): string {
    this.add(key);
    let root = key;
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root) as string;
    }
    // Path compression.
    let cur = key;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur) as string;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }

  keys(): string[] {
    return [...this.parent.keys()];
  }
}

/* ------------------------- pin -> hole resolution ------------------------- */

export interface ResolvedPin {
  componentId: string;
  pinId: string;
  label: string;
  role: string;
  /** Breadboard hole the pin is inserted into, when seated. */
  hole: HoleId | null;
  /** True when the pin's computed seat falls off the board. */
  offBoard: boolean;
}

/** Key used in the union-find graph for a component pin. */
export function pinKey(componentId: string, pinId: string): NodeKey {
  return `PIN:${componentId}.${pinId}`;
}

export function holeKey(hole: HoleId): NodeKey {
  return `HOLE:${hole}`;
}

/** Resolve every pin of a component to a breadboard hole (or null when free). */
export function resolvePins(component: PlacedComponent): ResolvedPin[] {
  const def = defOf(component.kind);
  return def.pins.map((pin) => {
    if (!component.seat) {
      return {
        componentId: component.id,
        pinId: pin.id,
        label: pin.label,
        role: pin.role,
        hole: null,
        offBoard: false,
      };
    }
    const r = rotateOffset(pin.dCol, pin.dRow, component.rotation);
    const seat = offsetSeat(component.seat.row, component.seat.col, r.dCol, r.dRow);
    return {
      componentId: component.id,
      pinId: pin.id,
      label: pin.label,
      role: pin.role,
      hole: seat ? holeId(seat.row, seat.col) : null,
      offBoard: seat === null,
    };
  });
}

/** True when the component can be legally seated at its current seat/rotation. */
export function seatIsValid(component: PlacedComponent): boolean {
  if (!component.seat) return !defOf(component.kind).seatable;
  if (!isValidHole(component.seat.row, component.seat.col)) return false;
  return resolvePins(component).every((p) => !p.offBoard);
}

/** Can a component of `kind` be placed at `row`/`col` with `rotation`? */
export function canSeat(
  kind: PlacedComponent['kind'],
  row: PlacedComponent['seat'] extends null ? never : NonNullable<PlacedComponent['seat']>['row'],
  col: number,
  rotation: PlacedComponent['rotation'],
): boolean {
  const def = defOf(kind);
  if (!def.seatable) return false;
  if (!isValidHole(row, col)) return false;
  return def.pins.every((pin) => {
    const r = rotateOffset(pin.dCol, pin.dRow, rotation);
    return offsetSeat(row, col, r.dCol, r.dRow) !== null;
  });
}

/* ----------------------------- netlist build ----------------------------- */

/**
 * Build the electrical netlist from the student's design.
 *
 * Three sources of connectivity are merged:
 *  1. Breadboard internal strips (A–E / F–J columns, four rails).
 *  2. Jumper wires between holes and/or free component terminals.
 *  3. Component pins inserted into holes.
 *
 * Nets are named `N1..Nn`, except nets containing a power rail which keep the
 * rail name so feedback can say "the + rail" rather than "net N3".
 */
export function buildNetlist(design: CircuitDesign): Netlist {
  const ds = new DisjointSet();

  // 1. Breadboard strips: every hole joins its strip node.
  //    Only holes actually referenced by the design are materialised, keeping
  //    the netlist small, but strips are shared so connectivity is exact.
  const touchedHoles = new Set<HoleId>();
  const touchHole = (hole: HoleId): void => {
    if (touchedHoles.has(hole)) return;
    touchedHoles.add(hole);
    const strip = stripOfHole(hole);
    if (strip) {
      ds.add(holeKey(hole));
      ds.union(holeKey(hole), `STRIP:${strip}`);
    }
  };

  // 3. Component pins.
  const pinsByComponent = new Map<string, ResolvedPin[]>();
  for (const c of design.components) {
    const pins = resolvePins(c);
    pinsByComponent.set(c.id, pins);
    for (const p of pins) {
      ds.add(pinKey(p.componentId, p.pinId));
      if (p.hole) {
        touchHole(p.hole);
        ds.union(pinKey(p.componentId, p.pinId), holeKey(p.hole));
      }
    }
  }

  // 2. Jumper wires.
  const endpointKey = (e: CircuitDesign['wires'][number]['a']): NodeKey => {
    if (e.kind === 'hole') {
      touchHole(e.hole);
      return holeKey(e.hole);
    }
    return pinKey(e.componentId, e.pinId);
  };
  for (const w of design.wires) {
    const ka = endpointKey(w.a);
    const kb = endpointKey(w.b);
    ds.add(ka);
    ds.add(kb);
    ds.union(ka, kb);
  }

  // Collapse into nets.
  const groups = new Map<string, NodeKey[]>();
  for (const key of ds.keys()) {
    const root = ds.find(key);
    const arr = groups.get(root);
    if (arr) arr.push(key);
    else groups.set(root, [key]);
  }

  const nets: Net[] = [];
  const netOf: Record<NodeKey, string> = {};
  const pinNet: Record<string, string> = {};

  // Deterministic ordering so net names are stable across runs.
  const roots = [...groups.keys()].sort();
  let counter = 1;
  for (const root of roots) {
    const members = (groups.get(root) ?? []).slice().sort();
    const holes = members
      .filter((m) => m.startsWith('HOLE:'))
      .map((m) => m.slice('HOLE:'.length));
    const pins = members
      .filter((m) => m.startsWith('PIN:'))
      .map((m) => {
        const body = m.slice('PIN:'.length);
        const dot = body.lastIndexOf('.');
        return { componentId: body.slice(0, dot), pinId: body.slice(dot + 1) };
      });

    // A net with nothing on it (an untouched strip) is not interesting.
    if (holes.length === 0 && pins.length === 0) continue;

    const railMember = members.find((m) => m.startsWith('STRIP:RAIL_'));
    const name = railMember ? railMember.slice('STRIP:'.length) : `N${counter++}`;
    const id = `net:${root}`;

    nets.push({ id, name, members, holes, pins });
    for (const m of members) netOf[m] = id;
    for (const p of pins) pinNet[`${p.componentId}.${p.pinId}`] = id;
  }

  return { nets, netOf, pinNet };
}

export function netById(netlist: Netlist, id: string | undefined): Net | undefined {
  if (!id) return undefined;
  return netlist.nets.find((n) => n.id === id);
}

export function netOfPin(netlist: Netlist, componentId: string, pinId: string): Net | undefined {
  return netById(netlist, netlist.pinNet[`${componentId}.${pinId}`]);
}

/** Human-readable net name for a pin, for use in feedback text. */
export function netNameOfPin(netlist: Netlist, componentId: string, pinId: string): string {
  return netOfPin(netlist, componentId, pinId)?.name ?? 'unconnected';
}

export { stripOf };
