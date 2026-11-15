'use client';

import { useMemo } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  GitCompare,
  History,
  Minus,
  Plus,
  RotateCcw,
  Trash2,
  XCircle,
} from 'lucide-react';

import { defOf } from '@/lib/circuit/componentDefs';
import { validateCircuit } from '@/lib/circuit/validate';
import { experimentById } from '@/lib/circuit/experiments';
import { formatAmps, formatOhms, formatTimestamp } from '@/lib/format';
import type { Version } from '@/store/types';
import { Badge, Button, EmptyState, Panel, Select, cx } from '@/components/ui/primitives';
import { useLabStore } from '@/store/useLabStore';

/**
 * Before/after comparison of two saved versions.
 *
 * Both sides are re-analysed with the deterministic engine at render time, so
 * the comparison always reflects the current engine rather than a stale cached
 * verdict.
 */
export function CompareVersions() {
  const versions = useLabStore((s) => s.versions);
  const leftId = useLabStore((s) => s.compareLeftId);
  const rightId = useLabStore((s) => s.compareRightId);
  const setCompare = useLabStore((s) => s.setCompare);
  const restoreVersion = useLabStore((s) => s.restoreVersion);
  const deleteVersion = useLabStore((s) => s.deleteVersion);
  const saveVersion = useLabStore((s) => s.saveVersion);

  const left = versions.find((v) => v.id === leftId) ?? null;
  const right = versions.find((v) => v.id === rightId) ?? null;

  const leftReport = useMemo(
    () => (left ? validateCircuit(left.design, left.experimentId) : null),
    [left],
  );
  const rightReport = useMemo(
    () => (right ? validateCircuit(right.design, right.experimentId) : null),
    [right],
  );

  const diff = useMemo(() => {
    if (!left || !right) return null;
    return diffDesigns(left, right);
  }, [left, right]);

  if (versions.length === 0) {
    return (
      <div className="grid flex-1 place-items-center p-6">
        <EmptyState
          icon={<History size={32} aria-hidden />}
          title="No saved versions yet"
          body="Versions are captured every time you run a simulation or a PCB check, and whenever you press Save. Come back here to compare your work before and after a fix."
          action={
            <Button variant="accent" onClick={() => saveVersion('Baseline')}>
              Save the current state as a baseline
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-2.5 scroll-lab">
      {/* selector */}
      <Panel title="Compare versions" icon={<GitCompare size={12} aria-hidden />}>
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <label
              htmlFor="cmp-left"
              className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]"
            >
              Before
            </label>
            <Select
              id="cmp-left"
              value={leftId ?? ''}
              onChange={(e) => setCompare('left', e.target.value || null)}
            >
              <option value="">— select a version —</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label} · {formatTimestamp(v.createdAt)}
                </option>
              ))}
            </Select>
          </div>
          <ArrowRight size={16} className="mb-2 shrink-0 text-[var(--text-disabled)]" aria-hidden />
          <div className="min-w-0 flex-1">
            <label
              htmlFor="cmp-right"
              className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]"
            >
              After
            </label>
            <Select
              id="cmp-right"
              value={rightId ?? ''}
              onChange={(e) => setCompare('right', e.target.value || null)}
            >
              <option value="">— select a version —</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label} · {formatTimestamp(v.createdAt)}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Panel>

      {!left || !right ? (
        <Panel>
          <EmptyState
            icon={<GitCompare size={26} aria-hidden />}
            title="Pick two versions"
            body="Choose a before and an after version above to see exactly what changed and what effect it had on the measurements."
          />
        </Panel>
      ) : (
        <>
          {/* verdict cards */}
          <div className="grid grid-cols-2 gap-2.5">
            {([
              { v: left, r: leftReport, side: 'Before' as const },
              { v: right, r: rightReport, side: 'After' as const },
            ] as const).map(({ v, r, side }) => {
              const passes = r?.validation.passes ?? false;
              const errors = r?.validation.diagnostics.filter((d) => d.severity === 'error').length ?? 0;
              const warnings = r?.validation.diagnostics.filter((d) => d.severity === 'warning').length ?? 0;
              const branch = r?.analysis.branches.find((b) => b.conducts);
              return (
                <Panel
                  key={v.id}
                  title={`${side}: ${v.label}`}
                  subtitle={`${experimentById(v.experimentId).name} · ${formatTimestamp(v.createdAt)}`}
                  icon={<Clock size={12} aria-hidden />}
                  actions={
                    <Badge tone={passes ? 'ok' : 'error'}>
                      {passes ? (
                        <>
                          <CheckCircle2 size={9} aria-hidden /> VALID
                        </>
                      ) : (
                        <>
                          <XCircle size={9} aria-hidden /> {errors} error{errors === 1 ? '' : 's'}
                        </>
                      )}
                    </Badge>
                  }
                >
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-1.5">
                      <Stat
                        label="LED current"
                        value={branch ? formatAmps(branch.currentA) : '0 A'}
                        tone={branch ? 'live' : 'idle'}
                      />
                      <Stat
                        label="Series R"
                        value={branch ? formatOhms(branch.rTotalOhm) : '—'}
                        tone="idle"
                      />
                    </div>
                    <dl className="space-y-0.5 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-2 text-[10px]">
                      <MiniRow label="Components" value={String(v.design.components.length)} />
                      <MiniRow label="Jumpers" value={String(v.design.wires.length)} />
                      <MiniRow label="Nets" value={String(r?.analysis.netlist.nets.length ?? 0)} />
                      <MiniRow label="Current paths" value={String(r?.analysis.branches.length ?? 0)} />
                      <MiniRow label="Errors" value={String(errors)} />
                      <MiniRow label="Warnings" value={String(warnings)} />
                      <MiniRow label="PCB traces" value={String(v.board.traces.length)} />
                    </dl>
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => restoreVersion(v.id)}>
                        <RotateCcw size={11} aria-hidden />
                        Restore
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => deleteVersion(v.id)}>
                        <Trash2 size={11} aria-hidden />
                        Delete
                      </Button>
                    </div>
                  </div>
                </Panel>
              );
            })}
          </div>

          {/* what changed */}
          <Panel title="What changed" icon={<GitCompare size={12} aria-hidden />} flush>
            {diff && diff.changes.length === 0 ? (
              <EmptyState
                title="Identical designs"
                body="These two versions contain the same components, values and wiring."
              />
            ) : (
              <ul className="divide-y divide-[var(--border-subtle)]">
                {diff?.changes.map((c, i) => (
                  <li key={i} className="flex items-start gap-2 px-3 py-2">
                    <span
                      className={cx(
                        'mt-px shrink-0 rounded-sm border p-0.5',
                        c.kind === 'added'
                          ? 'border-[rgba(11,122,82,0.3)] bg-[rgba(11,122,82,0.08)] text-[var(--signal-ok)]'
                          : c.kind === 'removed'
                            ? 'border-[rgba(202,43,43,0.3)] bg-[rgba(202,43,43,0.08)] text-[var(--signal-error)]'
                            : 'border-[rgba(26,95,204,0.3)] bg-[rgba(26,95,204,0.08)] text-[var(--signal-info)]',
                      )}
                    >
                      {c.kind === 'added' ? (
                        <Plus size={12} aria-hidden />
                      ) : c.kind === 'removed' ? (
                        <Minus size={12} aria-hidden />
                      ) : (
                        <ArrowRight size={12} aria-hidden />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] leading-snug text-[var(--text-primary)]">{c.summary}</p>
                      {c.detail ? (
                        <p className="mt-0.5 font-mono note">
                          {c.detail}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {/* effect on the outcome */}
          <Panel title="Effect of the change" icon={<CheckCircle2 size={12} aria-hidden />}>
            <OutcomeDelta
              beforeErrors={
                leftReport?.validation.diagnostics.filter((d) => d.severity === 'error').length ?? 0
              }
              afterErrors={
                rightReport?.validation.diagnostics.filter((d) => d.severity === 'error').length ?? 0
              }
              beforeCurrent={leftReport?.analysis.supplyCurrentA ?? 0}
              afterCurrent={rightReport?.analysis.supplyCurrentA ?? 0}
              resolvedCodes={
                leftReport && rightReport
                  ? leftReport.validation.diagnostics
                      .filter(
                        (d) =>
                          d.severity === 'error' &&
                          !rightReport.validation.diagnostics.some((x) => x.code === d.code),
                      )
                      .map((d) => d.code)
                  : []
              }
              introducedCodes={
                leftReport && rightReport
                  ? rightReport.validation.diagnostics
                      .filter(
                        (d) =>
                          d.severity === 'error' &&
                          !leftReport.validation.diagnostics.some((x) => x.code === d.code),
                      )
                      .map((d) => d.code)
                  : []
              }
            />
          </Panel>
        </>
      )}

      {/* history */}
      <Panel
        title="Version history"
        icon={<History size={12} aria-hidden />}
        subtitle={`${versions.length} snapshot${versions.length === 1 ? '' : 's'} (newest first, max 20 kept)`}
        flush
      >
        <ul className="divide-y divide-[var(--border-subtle)]">
          {versions.map((v) => (
            <li key={v.id} className="flex items-center gap-2 px-3 py-2">
              <Badge
                tone={
                  v.reason === 'simulation'
                    ? 'accent'
                    : v.reason === 'pcb-check'
                      ? 'info'
                      : 'neutral'
                }
              >
                {v.reason}
              </Badge>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-medium text-[var(--text-primary)]">{v.label}</p>
                <p className="text-[10px] text-[var(--text-disabled)]">
                  {formatTimestamp(v.createdAt)} · {v.design.components.length} parts ·{' '}
                  {v.design.wires.length} jumpers
                  {v.summary.supplyCurrentA !== null && v.summary.supplyCurrentA > 0
                    ? ` · ${formatAmps(v.summary.supplyCurrentA)}`
                    : ''}
                </p>
              </div>
              {v.summary.simulated ? (
                <Badge tone={v.summary.passes ? 'ok' : 'error'}>
                  {v.summary.passes ? 'pass' : `${v.summary.errors} err`}
                </Badge>
              ) : (
                <Badge tone="neutral">not run</Badge>
              )}
              <Button size="sm" variant="ghost" onClick={() => setCompare('left', v.id)} title="Use as Before">
                Before
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCompare('right', v.id)} title="Use as After">
                After
              </Button>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

/* ------------------------------- diff engine ------------------------------- */

interface Change {
  kind: 'added' | 'removed' | 'changed';
  summary: string;
  detail?: string;
}

function diffDesigns(before: Version, after: Version): { changes: Change[] } {
  const changes: Change[] = [];

  const beforeComponents = new Map(before.design.components.map((c) => [c.label, c]));
  const afterComponents = new Map(after.design.components.map((c) => [c.label, c]));

  for (const [label, c] of afterComponents) {
    if (!beforeComponents.has(label)) {
      changes.push({
        kind: 'added',
        summary: `Added ${label} (${defOf(c.kind).name})`,
        detail: c.seat ? `seated at ${c.seat.row}${String(c.seat.col).padStart(2, '0')}` : 'on the bench',
      });
    }
  }
  for (const [label, c] of beforeComponents) {
    if (!afterComponents.has(label)) {
      changes.push({ kind: 'removed', summary: `Removed ${label} (${defOf(c.kind).name})` });
    }
  }
  for (const [label, b] of beforeComponents) {
    const a = afterComponents.get(label);
    if (!a) continue;
    if (b.value !== a.value) {
      const fmt = (v: number): string => (b.kind === 'resistor' ? formatOhms(v) : String(v));
      changes.push({
        kind: 'changed',
        summary: `${label} value changed`,
        detail: `${fmt(b.value)} → ${fmt(a.value)}`,
      });
    }
    if (b.rotation !== a.rotation) {
      changes.push({
        kind: 'changed',
        summary: `${label} rotated`,
        detail: `${b.rotation}° → ${a.rotation}°`,
      });
    }
    const bSeat = b.seat ? `${b.seat.row}${String(b.seat.col).padStart(2, '0')}` : 'bench';
    const aSeat = a.seat ? `${a.seat.row}${String(a.seat.col).padStart(2, '0')}` : 'bench';
    if (bSeat !== aSeat) {
      changes.push({ kind: 'changed', summary: `${label} moved`, detail: `${bSeat} → ${aSeat}` });
    }
  }

  // Wires compared by their endpoint signature, since ids are regenerated.
  const sig = (w: Version['design']['wires'][number]): string => {
    const key = (e: typeof w.a): string =>
      e.kind === 'hole' ? `hole:${e.hole}` : `pin:${e.pinId}`;
    return [key(w.a), key(w.b)].sort().join(' ↔ ');
  };
  const beforeWires = new Set(before.design.wires.map(sig));
  const afterWires = new Set(after.design.wires.map(sig));
  for (const s of afterWires) {
    if (!beforeWires.has(s)) changes.push({ kind: 'added', summary: 'Added jumper', detail: s });
  }
  for (const s of beforeWires) {
    if (!afterWires.has(s)) changes.push({ kind: 'removed', summary: 'Removed jumper', detail: s });
  }

  const traceDelta = after.board.traces.length - before.board.traces.length;
  if (traceDelta !== 0) {
    changes.push({
      kind: traceDelta > 0 ? 'added' : 'removed',
      summary: `${Math.abs(traceDelta)} PCB trace${Math.abs(traceDelta) === 1 ? '' : 's'} ${
        traceDelta > 0 ? 'routed' : 'removed'
      }`,
      detail: `${before.board.traces.length} → ${after.board.traces.length}`,
    });
  }
  const fpDelta = after.board.footprints.length - before.board.footprints.length;
  if (fpDelta !== 0) {
    changes.push({
      kind: fpDelta > 0 ? 'added' : 'removed',
      summary: `${Math.abs(fpDelta)} footprint${Math.abs(fpDelta) === 1 ? '' : 's'} ${
        fpDelta > 0 ? 'placed' : 'removed'
      }`,
    });
  }

  return { changes };
}

/* ------------------------------- subcomponents ------------------------------- */

function OutcomeDelta({
  beforeErrors,
  afterErrors,
  beforeCurrent,
  afterCurrent,
  resolvedCodes,
  introducedCodes,
}: {
  beforeErrors: number;
  afterErrors: number;
  beforeCurrent: number;
  afterCurrent: number;
  resolvedCodes: string[];
  introducedCodes: string[];
}) {
  const improved = afterErrors < beforeErrors;
  const regressed = afterErrors > beforeErrors;

  return (
    <div className="space-y-2">
      <div
        className={cx(
          'rounded-md border px-2.5 py-2 text-[11px] leading-relaxed',
          improved
            ? 'border-[rgba(11,122,82,0.3)] bg-[rgba(11,122,82,0.07)] text-[var(--signal-ok)]'
            : regressed
              ? 'border-[rgba(202,43,43,0.3)] bg-[rgba(202,43,43,0.07)] text-[var(--signal-error)]'
              : 'border-[var(--border-subtle)] bg-[var(--surface-inset)] text-[var(--text-secondary)]',
        )}
      >
        {improved
          ? `Errors went from ${beforeErrors} to ${afterErrors}. The change moved the design forward.`
          : regressed
            ? `Errors went from ${beforeErrors} to ${afterErrors}. The change introduced new problems.`
            : `Error count unchanged at ${afterErrors}.`}
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <Stat label="Current before" value={formatAmps(beforeCurrent)} tone="idle" />
        <Stat
          label="Current after"
          value={formatAmps(afterCurrent)}
          tone={afterCurrent > 0 ? 'live' : 'idle'}
        />
      </div>

      {resolvedCodes.length > 0 ? (
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--signal-ok)]">
            Resolved
          </div>
          <div className="flex flex-wrap gap-1">
            {[...new Set(resolvedCodes)].map((c) => (
              <Badge key={c} tone="ok" mono>
                {c}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      {introducedCodes.length > 0 ? (
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--signal-error)]">
            Introduced
          </div>
          <div className="flex flex-wrap gap-1">
            {[...new Set(introducedCodes)].map((c) => (
              <Badge key={c} tone="error" mono>
                {c}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: 'live' | 'idle' }) {
  return (
    <div className="readout rounded-md px-2.5 py-2">
      <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--text-disabled)]">
        {label}
      </div>
      <div
        className={cx(
          'mt-0.5 truncate font-mono text-[13px] tabular-nums',
          tone === 'live' ? 'readout-live' : 'text-[var(--text-disabled)]',
        )}
      >
        {value}
      </div>
    </div>
  );
}

function MiniRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-[var(--text-disabled)]">{label}</dt>
      <dd className="font-mono tabular-nums text-[var(--text-secondary)]">{value}</dd>
    </div>
  );
}
