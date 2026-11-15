'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  FlaskConical,
  Gauge,
  Info,
  ListTree,
  XCircle,
} from 'lucide-react';

import { countBySeverity, type Diagnostic, type Severity } from '@/lib/circuit/diagnostics';
import { experimentById } from '@/lib/circuit/experiments';
import { RED_LED } from '@/lib/circuit/componentDefs';
import {
  describeBranchCurrent,
  formatAmps,
  formatOhms,
  formatTimestamp,
  formatVolts,
  formatWatts,
} from '@/lib/format';
import { Badge, Button, EmptyState, Panel, Readout, cx } from '@/components/ui/primitives';
import { useLabStore } from '@/store/useLabStore';

/* ------------------------- simulation status panel ------------------------- */

export function SimulationStatusPanel() {
  const report = useLabStore((s) => s.report);
  const engine = useLabStore((s) => s.engine);
  const simulating = useLabStore((s) => s.simulating);
  const simulationError = useLabStore((s) => s.simulationError);
  const server = useLabStore((s) => s.server);
  const runSimulation = useLabStore((s) => s.runSimulation);

  const ngspice = server.engines?.ngspice;

  return (
    <Panel
      title="Simulation status"
      icon={<FlaskConical size={12} aria-hidden />}
      actions={
        report ? (
          <Badge tone={report.validation.passes ? 'ok' : 'error'}>
            {report.validation.passes ? 'VALID' : 'FAULTS'}
          </Badge>
        ) : null
      }
    >
      {simulating ? (
        <div className="flex items-center gap-2 py-1">
          <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-[var(--surface-active)] animate-sweep" />
          <span className="text-[10px] text-[var(--text-tertiary)]">Solving…</span>
        </div>
      ) : simulationError ? (
        <div className="rounded-md border border-[rgba(202,43,43,0.3)] bg-[rgba(202,43,43,0.08)] p-2.5">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--signal-error)]">
            <XCircle size={13} aria-hidden />
            Analyser error
          </div>
          <p className="mt-1 font-mono text-[10px] leading-snug text-[var(--text-secondary)]">
            {simulationError}
          </p>
          <Button size="sm" variant="outline" className="mt-2" onClick={runSimulation}>
            Try again
          </Button>
        </div>
      ) : !report ? (
        <EmptyState
          icon={<FlaskConical size={22} aria-hidden />}
          title="Not analysed yet"
          body="Build your circuit, then press Run Simulation. Every number shown in this lab comes from that analysis — nothing is assumed."
        />
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-1.5">
            <Readout
              label="Supply current"
              value={formatAmps(report.analysis.supplyCurrentA)}
              tone={report.analysis.supplyCurrentA > 0 ? 'live' : 'idle'}
              hint="Total current delivered by the DC source"
            />
            <Readout
              label="Supply power"
              value={formatWatts(report.analysis.supplyPowerW)}
              tone={report.analysis.supplyPowerW > 0 ? 'live' : 'idle'}
              hint="Sum over every conducting branch of its driver's voltage times its current"
            />
          </div>
          <dl className="space-y-1 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-2 text-[10px]">
            <Row label="Engine" value={engine.label} mono={false} />
            <Row label="Nets found" value={String(report.analysis.netlist.nets.length)} />
            <Row
              label="Drivers"
              value={
                report.analysis.drivers.length === 0
                  ? 'none'
                  : report.analysis.drivers.map((d) => d.label).join(', ')
              }
              mono={false}
            />
            <Row label="Current paths" value={String(report.analysis.branches.length)} />
            <Row label="Analysed at" value={formatTimestamp(report.validation.checkedAt)} />
          </dl>
          <details className="group rounded-md border border-[var(--border-subtle)] bg-[var(--surface-raised)] open:bg-[var(--surface-inset)]">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1.5 text-[10px] font-medium text-[var(--signal-warn)] marker:content-none hover:text-[var(--text-primary)]">
              <Info size={11} className="shrink-0" aria-hidden />
              <span className="flex-1">DC operating point only — not SPICE</span>
              <ChevronDown
                size={12}
                className="shrink-0 transition-transform group-open:rotate-180"
                aria-hidden
              />
            </summary>
            <div className="note border-t border-[var(--border-subtle)] px-2 py-1.5">
              <p>{engine.fidelity}</p>
              {ngspice && !ngspice.available ? (
                <p className="mt-1.5">
                  <strong>SPICE adapter:</strong> {ngspice.unavailableReason}
                </p>
              ) : null}
            </div>
          </details>
        </div>
      )}
    </Panel>
  );
}

/* --------------------------- measurements panel --------------------------- */

export function MeasurementsPanel() {
  const report = useLabStore((s) => s.report);
  const experimentId = useLabStore((s) => s.experimentId);
  const experiment = experimentById(experimentId);
  const [showNets, setShowNets] = useState(false);

  if (!report) {
    return (
      <Panel title="Measurements" icon={<Gauge size={12} aria-hidden />}>
        <EmptyState
          icon={<Gauge size={22} aria-hidden />}
          title="No readings"
          body="Instrument readings appear here once the analysis has run."
        />
      </Panel>
    );
  }

  const { analysis } = report;
  const litBranch = analysis.branches.find((b) => b.conducts);

  return (
    <Panel
      title="Measurements"
      icon={<Gauge size={12} aria-hidden />}
      subtitle={`Target band ${formatAmps(experiment.targetCurrent.min)}–${formatAmps(experiment.targetCurrent.max)}`}
    >
      <div className="space-y-2.5">
        {/* headline current with a target gauge */}
        {litBranch ? (
          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-2.5">
            <div className="flex items-baseline justify-between">
              <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--text-disabled)]">
                Branch {litBranch.id} current
              </span>
              <span className="font-mono text-[9px] text-[var(--text-disabled)]">
                {formatOhms(litBranch.rTotalOhm)} series
              </span>
            </div>
            <div className="readout-live mt-0.5 font-mono text-2xl font-medium tabular-nums">
              {formatAmps(litBranch.currentA)}
            </div>
            <CurrentGauge current={litBranch.currentA} />
            <p className="mt-1.5 font-mono text-[10px] leading-snug text-[var(--text-tertiary)]">
              {describeBranchCurrent(litBranch)}
            </p>
            {litBranch.rSourceOhm > 0 ? (
              <p className="note mt-1">
                The second term is {litBranch.driverLabel}&apos;s output impedance — a real pin is not
                an ideal source.
              </p>
            ) : null}
          </div>
        ) : null}

        {/* per component table */}
        {analysis.measurements.length > 0 ? (
          <div className="overflow-hidden rounded-md border border-[var(--border-subtle)]">
            <table className="w-full text-[10px]">
              <caption className="sr-only">Per-component measurements</caption>
              <thead>
                <tr className="bg-[var(--surface-raised)] text-[var(--text-disabled)]">
                  <th className="px-2 py-1 text-left font-medium">Ref</th>
                  <th className="px-2 py-1 text-right font-medium">I</th>
                  <th className="px-2 py-1 text-right font-medium">V</th>
                  <th className="px-2 py-1 text-right font-medium">P</th>
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {analysis.measurements.map((m) => (
                  <tr
                    key={m.componentId}
                    className="border-t border-[var(--border-subtle)] transition-colors hover:bg-[var(--surface-hover)]"
                  >
                    <td className="px-2 py-1">
                      <span className="text-[var(--text-primary)]">{m.label}</span>
                      {m.shorted ? (
                        <span className="ml-1 text-[var(--signal-error)]" title="Shorted out">
                          ⚠
                        </span>
                      ) : null}
                      {m.reverseBiased ? (
                        <span className="ml-1 text-[var(--signal-error)]" title="Reverse biased">
                          ⟲
                        </span>
                      ) : null}
                      {m.lit ? (
                        <span className="ml-1 text-[var(--signal-ok)]" title="Lit">
                          ●
                        </span>
                      ) : null}
                    </td>
                    <td
                      className={cx(
                        'px-2 py-1 text-right',
                        Math.abs(m.currentA) > 0 ? 'text-[var(--accent-cyan)]' : 'text-[var(--text-disabled)]',
                      )}
                    >
                      {formatAmps(Math.abs(m.currentA))}
                    </td>
                    <td className="px-2 py-1 text-right text-[var(--text-secondary)]">
                      {formatVolts(m.voltageV)}
                    </td>
                    <td className="px-2 py-1 text-right text-[var(--text-tertiary)]">
                      {formatWatts(m.powerW)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[10px] text-[var(--text-disabled)]">
            No two-terminal components placed yet.
          </p>
        )}

        {/* LED model reference */}
        <details className="group rounded-md border border-[var(--border-subtle)] bg-[var(--surface-raised)]">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1.5 text-[10px] font-medium text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
            <ChevronDown size={11} className="transition-transform group-open:rotate-180" aria-hidden />
            LED model used ({RED_LED.name})
          </summary>
          <dl className="space-y-1 border-t border-[var(--border-subtle)] px-2 py-1.5 text-[10px]">
            <Row label="V_f nominal" value={formatVolts(RED_LED.vfNominal)} />
            <Row label="I rated" value={formatAmps(RED_LED.iRated)} />
            <Row label="I abs max" value={formatAmps(RED_LED.iAbsMax)} />
            <Row label="Bulk R" value={formatOhms(RED_LED.rSeries)} />
          </dl>
        </details>

        {/* netlist inspector */}
        <div>
          <Button
            size="sm"
            variant="ghost"
            className="w-full justify-start"
            onClick={() => setShowNets((v) => !v)}
            aria-expanded={showNets}
          >
            <ListTree size={12} aria-hidden />
            {showNets ? 'Hide' : 'Show'} netlist ({analysis.netlist.nets.length} nets)
          </Button>
          {showNets ? (
            <ul className="mt-1.5 space-y-1">
              {analysis.netlist.nets.map((net) => (
                <li
                  key={net.id}
                  className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-2 py-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] text-[var(--accent-cyan)]">{net.name}</span>
                    <span className="text-[9px] text-[var(--text-disabled)]">
                      {net.pins.length} pin{net.pins.length === 1 ? '' : 's'} · {net.holes.length} hole
                      {net.holes.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  {net.holes.length > 0 ? (
                    <p className="mt-0.5 break-all font-mono text-[9px] leading-snug text-[var(--text-disabled)]">
                      {net.holes.slice(0, 14).join(' · ')}
                      {net.holes.length > 14 ? ` … +${net.holes.length - 14}` : ''}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

/** Visual gauge of current against the LED's safe operating bands. */
function CurrentGauge({ current }: { current: number }) {
  const max = RED_LED.iAbsMax * 1.35;
  const pct = Math.min(100, (current / max) * 100);
  const ratedPct = (RED_LED.iRated / max) * 100;
  const absPct = (RED_LED.iAbsMax / max) * 100;
  const tone =
    current > RED_LED.iAbsMax
      ? 'var(--signal-error)'
      : current > RED_LED.iRated
        ? 'var(--signal-warn)'
        : current >= RED_LED.iVisible
          ? 'var(--signal-ok)'
          : 'var(--text-disabled)';

  return (
    <div className="mt-2">
      <div
        className="relative h-2 overflow-hidden rounded-full bg-[var(--surface-active)]"
        role="meter"
        aria-valuenow={Number((current * 1000).toFixed(2))}
        aria-valuemin={0}
        aria-valuemax={Number((max * 1000).toFixed(2))}
        aria-label="LED forward current against safe operating bands"
      >
        <div
          className="h-full rounded-full transition-all duration-300 ease-[var(--ease-lab)]"
          style={{ width: `${pct}%`, backgroundColor: tone }}
        />
        <div
          className="absolute top-0 h-full w-px bg-[var(--signal-warn)] opacity-80"
          style={{ left: `${ratedPct}%` }}
          title={`Rated ${formatAmps(RED_LED.iRated)}`}
        />
        <div
          className="absolute top-0 h-full w-px bg-[var(--signal-error)] opacity-90"
          style={{ left: `${absPct}%` }}
          title={`Absolute max ${formatAmps(RED_LED.iAbsMax)}`}
        />
      </div>
      <div className="mt-0.5 flex justify-between text-[9px] text-[var(--text-disabled)]">
        <span>0</span>
        <span>rated {formatAmps(RED_LED.iRated)}</span>
        <span>max {formatAmps(RED_LED.iAbsMax)}</span>
      </div>
    </div>
  );
}

/* ----------------------------- diagnostics panel ----------------------------- */

const SEVERITY_ICON: Record<Severity, React.ReactNode> = {
  error: <XCircle size={13} aria-hidden />,
  warning: <AlertTriangle size={13} aria-hidden />,
  info: <Info size={13} aria-hidden />,
  pass: <CheckCircle2 size={13} aria-hidden />,
};

const SEVERITY_CLASS: Record<Severity, string> = {
  error: 'border-[rgba(202,43,43,0.28)] bg-[rgba(202,43,43,0.07)] text-[var(--signal-error)]',
  warning: 'border-[rgba(150,88,10,0.28)] bg-[rgba(150,88,10,0.07)] text-[var(--signal-warn)]',
  info: 'border-[rgba(26,95,204,0.25)] bg-[rgba(26,95,204,0.06)] text-[var(--signal-info)]',
  pass: 'border-[rgba(11,122,82,0.28)] bg-[rgba(11,122,82,0.07)] text-[var(--signal-ok)]',
};

export function DiagnosticsPanel({
  diagnostics,
  title,
  emptyBody,
  footer,
}: {
  diagnostics: Diagnostic[] | null;
  title: string;
  emptyBody: string;
  footer?: React.ReactNode;
}) {
  const setHighlighted = useLabStore((s) => s.setHighlighted);
  const askTutor = useLabStore((s) => s.askTutor);
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!diagnostics) {
    return (
      <Panel title={title} icon={<CircleDot size={12} aria-hidden />}>
        <EmptyState icon={<CircleDot size={22} aria-hidden />} title="No results yet" body={emptyBody} />
      </Panel>
    );
  }

  const counts = countBySeverity(diagnostics);

  return (
    <Panel
      title={title}
      icon={<CircleDot size={12} aria-hidden />}
      flush
      actions={
        <div className="flex items-center gap-1">
          {counts.error > 0 ? <Badge tone="error" mono>{counts.error}</Badge> : null}
          {counts.warning > 0 ? <Badge tone="warn" mono>{counts.warning}</Badge> : null}
          {counts.info > 0 ? <Badge tone="info" mono>{counts.info}</Badge> : null}
          {counts.error === 0 && counts.warning === 0 ? <Badge tone="ok">clean</Badge> : null}
        </div>
      }
    >
      {diagnostics.length === 0 ? (
        <EmptyState title="Nothing reported" body={emptyBody} />
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {diagnostics.map((d, i) => {
            const key = `${d.code}-${i}`;
            const isOpen = expanded === key;
            return (
              <li
                key={key}
                className="transition-colors hover:bg-[var(--surface-hover)]"
                onMouseEnter={() => setHighlighted(d.target?.componentIds ?? [])}
                onMouseLeave={() => setHighlighted([])}
              >
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : key)}
                  aria-expanded={isOpen}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left"
                >
                  <span className={cx('mt-px shrink-0 rounded-sm border p-0.5', SEVERITY_CLASS[d.severity])}>
                    {SEVERITY_ICON[d.severity]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] font-medium leading-snug text-[var(--text-primary)]">
                      {d.title}
                    </span>
                    <span className="mt-0.5 block font-mono text-[9px] text-[var(--text-disabled)]">
                      {d.code}
                    </span>
                  </span>
                  <ChevronDown
                    size={12}
                    className={cx(
                      'mt-0.5 shrink-0 text-[var(--text-disabled)] transition-transform',
                      isOpen && 'rotate-180',
                    )}
                    aria-hidden
                  />
                </button>

                {isOpen ? (
                  <div className="animate-fade-up px-3 pb-2.5 pl-[34px]">
                    <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">{d.detail}</p>

                    {d.evidence && Object.keys(d.evidence).length > 0 ? (
                      <dl className="mt-2 space-y-0.5 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-2 text-[10px]">
                        <div className="mb-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--text-disabled)]">
                          Evidence
                        </div>
                        {Object.entries(d.evidence).map(([k, v]) => (
                          <Row key={k} label={k} value={String(v)} />
                        ))}
                      </dl>
                    ) : null}

                    <div className="mt-2 flex gap-1.5">
                      <Button
                        size="sm"
                        variant="subtle"
                        onClick={() => askTutor(`Explain this issue: ${d.title} (${d.code})`, 2)}
                      >
                        Ask the tutor
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {footer ? (
        <div className="border-t border-[var(--border-subtle)] px-3 py-2 note">
          {footer}
        </div>
      ) : null}
    </Panel>
  );
}

function Row({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="shrink-0 text-[var(--text-disabled)]">{label}</dt>
      <dd
        className={cx(
          'min-w-0 truncate text-right text-[var(--text-secondary)]',
          mono && 'font-mono tabular-nums',
        )}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}
