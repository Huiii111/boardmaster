'use client';

import { useMemo } from 'react';
import { CircuitBoard, Cpu, Network, Ruler, Trash2, Upload } from 'lucide-react';

import { ratsnest } from '@/lib/pcb/footprints';
import { BOARD_GRID_MM, DEFAULT_RULES } from '@/lib/pcb/types';
import { Badge, Button, EmptyState, Panel, cx } from '@/components/ui/primitives';
import { useLabStore } from '@/store/useLabStore';

/**
 * The left rail for the PCB workspace.
 *
 * The breadboard sidebar used to stay mounted here, which meant the PCB page
 * offered a Select/Wire/Delete tool group that does nothing to copper and a
 * catalogue of through-hole parts that cannot be dropped onto a board. Three
 * panels of controls for a different workspace is worse than no rail at all:
 * it invites clicks that quietly do nothing.
 *
 * What a layout actually needs to hand is the board outline, the parts that
 * have been imported, and the nets still waiting on copper — so that is what
 * this shows, and every row is a selection shortcut into the canvas.
 */
export function PcbSidebar() {
  const board = useLabStore((s) => s.board);
  const selection = useLabStore((s) => s.selection);
  const select = useLabStore((s) => s.select);
  const importFootprints = useLabStore((s) => s.importFootprints);
  const clearTraces = useLabStore((s) => s.clearTraces);

  /**
   * Which nets have copper on them.
   *
   * A trace records the pads its ends snapped to, not a net, so this maps pads
   * back to nets rather than asking a trace what net it is on. That also keeps
   * the claim weak on purpose: a net shown green has *some* copper touching
   * it, which is not the same as being fully connected. Only the DRC decides
   * that, and the note under the list says so.
   */
  const nets = useMemo(() => {
    const netOfPad = new Map<string, string>();
    for (const fp of board.footprints) {
      for (const pad of fp.pads) if (pad.net) netOfPad.set(pad.id, pad.net);
    }
    const touched = new Set<string>();
    for (const t of board.traces) {
      for (const padId of [t.startPadId, t.endPadId]) {
        const net = padId ? netOfPad.get(padId) : undefined;
        if (net) touched.add(net);
      }
    }
    return ratsnest(board).map((n) => ({
      net: n.net,
      pads: n.padIds.length,
      routed: touched.has(n.net),
    }));
  }, [board]);

  const unrouted = nets.filter((n) => !n.routed).length;
  const padCount = board.footprints.reduce((sum, f) => sum + f.pads.length, 0);

  return (
    <aside className="flex w-[268px] shrink-0 flex-col gap-2.5 overflow-y-auto border-r border-[var(--border-default)] bg-[var(--surface-base)] p-2.5 scroll-lab">
      {/* -------------------------------- board -------------------------------- */}
      <Panel title="Board" icon={<CircuitBoard size={12} aria-hidden />}>
        <dl className="space-y-1 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-2 text-[10px]">
          <Stat label="Outline" value={`${board.width.toFixed(2)} × ${board.height.toFixed(2)} mm`} />
          <Stat label="Copper layers" value="2 (top, bottom)" />
          <Stat label="Routing grid" value={`${BOARD_GRID_MM} mm`} />
          <Stat label="Footprints" value={`${board.footprints.length}`} />
          <Stat label="Pads" value={`${padCount}`} />
          <Stat label="Traces" value={`${board.traces.length}`} />
        </dl>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <Button size="sm" variant="outline" onClick={importFootprints} title="Re-import footprints and nets from the breadboard circuit">
            <Upload size={12} aria-hidden />
            Import
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={clearTraces}
            disabled={board.traces.length === 0}
            title="Remove every routed trace"
          >
            <Trash2 size={12} aria-hidden />
            Rip up
          </Button>
        </div>
      </Panel>

      {/* ----------------------------- footprints ----------------------------- */}
      <Panel
        title="Footprints"
        icon={<Cpu size={12} aria-hidden />}
        subtitle={`${board.footprints.length} imported from the circuit`}
      >
        {board.footprints.length === 0 ? (
          <EmptyState
            icon={<Cpu size={20} aria-hidden />}
            title="Nothing imported"
            body="Press Import to bring this circuit's parts across as footprints, with their nets already assigned."
          />
        ) : (
          <ul className="space-y-1">
            {board.footprints.map((fp) => {
              const active = selection.kind === 'footprint' && selection.id === fp.id;
              return (
                <li key={fp.id}>
                  <button
                    type="button"
                    onClick={() => select({ kind: 'footprint', id: fp.id })}
                    aria-pressed={active}
                    className={cx(
                      'flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors',
                      active
                        ? 'border-[var(--accent-cyan)] bg-[rgba(11,122,109,0.1)]'
                        : 'border-[var(--border-subtle)] bg-[var(--surface-raised)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]',
                    )}
                  >
                    <span
                      className={cx(
                        'shrink-0 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] font-semibold',
                        active
                          ? 'border-[rgba(11,122,109,0.45)] text-[var(--accent-cyan)]'
                          : 'border-[var(--border-default)] text-[var(--text-secondary)]',
                      )}
                    >
                      {fp.ref}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-primary)]">
                      {fp.name}
                    </span>
                    <Badge tone="neutral" mono title={`${fp.pads.length} pads`}>
                      {fp.pads.length}
                    </Badge>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {/* -------------------------------- nets -------------------------------- */}
      <Panel
        title="Nets"
        icon={<Network size={12} aria-hidden />}
        subtitle={
          nets.length === 0
            ? 'No nets to route'
            : unrouted === 0
              ? 'All nets have copper'
              : `${unrouted} of ${nets.length} still unrouted`
        }
      >
        {nets.length === 0 ? (
          <p className="note">
            Nets arrive with the footprints. Import the circuit first — the net names here are the same
            ones the circuit analyser extracted from the breadboard.
          </p>
        ) : (
          <ul className="space-y-1">
            {nets.map((n) => (
              <li
                key={n.net}
                className="flex items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2 py-1.5"
              >
                <span
                  aria-hidden
                  className={cx(
                    'h-1.5 w-1.5 shrink-0 rounded-full',
                    n.routed ? 'bg-[var(--signal-ok)]' : 'bg-[var(--signal-warn)]',
                  )}
                />
                <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-[var(--text-secondary)]">
                  {n.net}
                </span>
                <span className="shrink-0 text-[9px] uppercase tracking-[0.08em] text-[var(--text-disabled)]">
                  {n.pads} pads
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="note mt-2">
          A green dot only means copper exists on that net. Whether it actually connects every pad is
          decided by <strong>Run PCB Checks</strong>, not by this list.
        </p>
      </Panel>

      {/* ----------------------------- design rules ----------------------------- */}
      <Panel title="Design rules" icon={<Ruler size={12} aria-hidden />}>
        <dl className="space-y-1 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-2 text-[10px]">
          <Stat label="Clearance" value={`${DEFAULT_RULES.clearance} mm`} />
          <Stat label="Min trace width" value={`${DEFAULT_RULES.minTraceWidth} mm`} />
          <Stat label="Courtyard gap" value={`${DEFAULT_RULES.courtyardGap} mm`} />
          <Stat label="Pad snap" value={`${DEFAULT_RULES.padSnap} mm`} />
        </dl>
        <p className="note mt-2">
          <strong>Educational checker, not a KiCad DRC.</strong> It verifies connectivity, shorts,
          clearance and courtyard overlap geometrically. It does not check drills, annular rings, vias,
          solder mask or any manufacturer capability.
        </p>
      </Panel>
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="shrink-0 text-[var(--text-disabled)]">{label}</dt>
      <dd className="min-w-0 truncate text-right font-mono tabular-nums text-[var(--text-secondary)]">
        {value}
      </dd>
    </div>
  );
}
