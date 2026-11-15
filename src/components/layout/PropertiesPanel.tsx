'use client';

import { useEffect, useState } from 'react';
import { RotateCw, Settings2, Trash2 } from 'lucide-react';

import { defOf } from '@/lib/circuit/componentDefs';
import { resolvePins } from '@/lib/circuit/graph';
import { netNameOfPin } from '@/lib/circuit/graph';
import {
  formatAmps,
  formatFarads,
  formatOhms,
  formatVolts,
  formatWatts,
  parseEngineering,
  resistorBands,
} from '@/lib/format';
import { Badge, Button, EmptyState, Field, Input, Panel, cx } from '@/components/ui/primitives';
import { useLabStore, useSelectedComponent } from '@/store/useLabStore';

export function PropertiesPanel() {
  const component = useSelectedComponent();
  const workspace = useLabStore((s) => s.workspace);
  const selection = useLabStore((s) => s.selection);
  const wires = useLabStore((s) => s.design.wires);
  const report = useLabStore((s) => s.report);
  const rotateComponent = useLabStore((s) => s.rotateComponent);
  const deleteComponent = useLabStore((s) => s.deleteComponent);
  const deleteWire = useLabStore((s) => s.deleteWire);
  const setComponentValue = useLabStore((s) => s.setComponentValue);
  const setComponentLabel = useLabStore((s) => s.setComponentLabel);
  const setComponentClosed = useLabStore((s) => s.setComponentClosed);
  const setComponentWiper = useLabStore((s) => s.setComponentWiper);
  const setComponentIllumination = useLabStore((s) => s.setComponentIllumination);
  const replaceFuse = useLabStore((s) => s.replaceFuse);

  const [valueDraft, setValueDraft] = useState('');
  const [valueError, setValueError] = useState<string | null>(null);

  useEffect(() => {
    if (!component) return;
    const def = defOf(component.kind);
    setValueDraft(
      def.unit === 'Ω'
        ? String(component.value)
        : def.unit === 'F'
          ? String(component.value)
          : String(component.value),
    );
    setValueError(null);
  }, [component?.id, component?.value, component?.kind, component]);

  /* ------------------------------ wire selected ------------------------------ */
  if (selection.kind === 'wire' && selection.id) {
    const wire = wires.find((w) => w.id === selection.id);
    if (!wire) {
      return (
        <Panel title="Properties" icon={<Settings2 size={12} aria-hidden />}>
          <EmptyState title="Nothing selected" body="That jumper no longer exists." />
        </Panel>
      );
    }
    const describe = (e: typeof wire.a): string =>
      e.kind === 'hole' ? `hole ${e.hole}` : `${e.componentId.split('-')[0]} pin ${e.pinId}`;
    return (
      <Panel
        title="Jumper wire"
        icon={<Settings2 size={12} aria-hidden />}
        actions={
          <Button size="icon" variant="danger" onClick={() => deleteWire(wire.id)} title="Delete jumper (Del)">
            <Trash2 size={13} aria-hidden />
          </Button>
        }
      >
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span
              className="h-3 w-3 shrink-0 rounded-full border border-[var(--border-strong)]"
              style={{ backgroundColor: wire.color }}
              aria-hidden
            />
            <span className="font-mono text-[11px] text-[var(--text-secondary)]">{wire.id}</span>
          </div>
          <dl className="space-y-1 text-[11px]">
            <div className="flex justify-between gap-2">
              <dt className="text-[var(--text-disabled)]">From</dt>
              <dd className="font-mono text-[var(--text-secondary)]">{describe(wire.a)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-[var(--text-disabled)]">To</dt>
              <dd className="font-mono text-[var(--text-secondary)]">{describe(wire.b)}</dd>
            </div>
          </dl>
          <p className="note">
            A jumper joins two nets into one. Deleting it splits them again.
          </p>
        </div>
      </Panel>
    );
  }

  /* ------------------------------ nothing selected ------------------------------ */
  if (!component) {
    return (
      <Panel title="Properties" icon={<Settings2 size={12} aria-hidden />}>
        <EmptyState
          icon={<Settings2 size={22} aria-hidden />}
          title="Nothing selected"
          // The panel is shared by both workspaces, and telling a student
          // looking at a PCB to "click on the bench" sends them to the wrong
          // screen.
          body={
            workspace === 'pcb'
              ? 'Click a footprint or a trace on the board — or a row in the Footprints list — to inspect its pads and nets.'
              : 'Click a component or jumper on the bench to inspect its value, pins and net assignments.'
          }
        />
      </Panel>
    );
  }

  /* ------------------------------ component selected ------------------------------ */
  const def = defOf(component.kind);
  const pins = resolvePins(component);
  const measurement = report?.analysis.measurements.find((m) => m.componentId === component.id);
  const netlist = report?.analysis.netlist ?? null;
  const bands = component.kind === 'resistor' ? resistorBands(component.value) : null;

  const commitValue = (): void => {
    const parsed = parseEngineering(valueDraft);
    if (parsed === null || parsed <= 0) {
      setValueError('Enter a positive value, e.g. 330, 4k7 or 10k.');
      return;
    }
    setValueError(null);
    setComponentValue(component.id, parsed);
  };

  return (
    <Panel
      title={`${component.label} — ${def.name}`}
      icon={<Settings2 size={12} aria-hidden />}
      actions={
        <>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => rotateComponent(component.id)}
            title="Rotate 90° (R)"
            aria-label="Rotate component"
          >
            <RotateCw size={13} aria-hidden />
          </Button>
          <Button
            size="icon"
            variant="danger"
            onClick={() => deleteComponent(component.id)}
            title="Delete component (Del)"
            aria-label="Delete component"
          >
            <Trash2 size={13} aria-hidden />
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {/* reference designator */}
        <Field label="Reference" htmlFor="prop-ref">
          <Input
            id="prop-ref"
            value={component.label}
            onChange={(e) => setComponentLabel(component.id, e.target.value)}
            maxLength={8}
          />
        </Field>

        {/* value */}
        {def.editableValue ? (
          <Field
            label={def.unit === 'Ω' ? 'Resistance' : def.unit === 'F' ? 'Capacitance' : 'Voltage'}
            htmlFor="prop-value"
            error={valueError ?? undefined}
            hint={
              def.unit === 'Ω'
                ? 'Accepts engineering notation: 330, 4k7, 10k, 2.2M.'
                : def.unit === 'F'
                  ? 'Accepts 10u, 100n, 4.7m.'
                  : 'Volts, e.g. 5 or 3.3.'
            }
          >
            <div className="flex gap-1.5">
              <Input
                id="prop-value"
                value={valueDraft}
                onChange={(e) => setValueDraft(e.target.value)}
                onBlur={commitValue}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitValue();
                }}
                className="font-mono"
              />
              <Button size="md" variant="subtle" onClick={commitValue}>
                Set
              </Button>
            </div>
          </Field>
        ) : (
          <div className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-2.5 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
              {component.kind === 'led' ? 'Forward voltage' : 'Value'}
            </span>
            <span className="font-mono text-xs text-[var(--text-primary)]">
              {def.unit === 'V' ? formatVolts(component.value) : '—'}
            </span>
          </div>
        )}

        {/* presets */}
        {def.presets && def.presets.length > 0 ? (
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
              Standard values
            </div>
            <div className="flex flex-wrap gap-1">
              {def.presets.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setComponentValue(component.id, p)}
                  className={cx(
                    'rounded-sm border px-1.5 py-0.5 font-mono text-[10px] transition-colors duration-150',
                    Math.abs(component.value - p) < 1e-12
                      ? 'border-[var(--accent-cyan)] bg-[rgba(11,122,109,0.14)] text-[var(--accent-cyan)]'
                      : 'border-[var(--border-default)] text-[var(--text-tertiary)] hover:border-[var(--border-strong)] hover:text-[var(--text-secondary)]',
                  )}
                >
                  {def.unit === 'Ω' ? formatOhms(p) : def.unit === 'F' ? formatFarads(p) : formatVolts(p)}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* colour bands */}
        {bands ? (
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
              Colour code
            </div>
            <div className="flex items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--mat-resistor-body)] px-2.5 py-2">
              {bands.map((c, i) => (
                <span
                  key={i}
                  className="h-5 w-2.5 rounded-[1px] shadow-[0_0_0_1px_rgba(0,0,0,0.25)]"
                  style={{ backgroundColor: c }}
                  title={i === 3 ? 'Tolerance: gold, ±5%' : `Band ${i + 1}`}
                  aria-hidden
                />
              ))}
              <span className="ml-auto font-mono text-[11px] text-[#3a3226]">
                {formatOhms(component.value)} ±5%
              </span>
            </div>
          </div>
        ) : null}

        {/* ---- live device controls ---- */}
        {component.kind === 'switch' || component.kind === 'pushbutton' ? (
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
              {component.kind === 'switch' ? 'Switch position' : 'Contacts'}
            </div>
            {component.kind === 'switch' ? (
              <div className="grid grid-cols-2 gap-1.5">
                {([false, true] as const).map((on) => (
                  <Button
                    key={String(on)}
                    size="sm"
                    variant={component.closed === on ? 'accent' : 'outline'}
                    onClick={() => setComponentClosed(component.id, on)}
                  >
                    {on ? 'Closed (ON)' : 'Open (OFF)'}
                  </Button>
                ))}
              </div>
            ) : (
              <Button
                size="md"
                variant={component.closed ? 'accent' : 'outline'}
                className="w-full justify-center"
                onPointerDown={() => setComponentClosed(component.id, true)}
                onPointerUp={() => setComponentClosed(component.id, false)}
                onPointerLeave={() => {
                  if (component.closed) setComponentClosed(component.id, false);
                }}
              >
                {component.closed ? 'Held down — conducting' : 'Press and hold'}
              </Button>
            )}
            <p className="mt-1 note">
              {component.closed
                ? 'Contacts closed: modelled as 0 Ω.'
                : 'Contacts open: no current can pass. Re-run the simulation after changing this.'}
            </p>
          </div>
        ) : null}

        {component.kind === 'potentiometer' ? (
          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                Wiper position
              </span>
              <span className="font-mono text-[10px] text-[var(--accent-cyan)]">
                {Math.round((component.wiper ?? 0.5) * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={component.wiper ?? 0.5}
              onChange={(e) => setComponentWiper(component.id, Number(e.target.value))}
              aria-label="Potentiometer wiper position"
              className="w-full"
            />
            <div className="mt-1 grid grid-cols-2 gap-1.5 text-[10px]">
              <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-2 py-1">
                <div className="text-[9px] uppercase tracking-[0.1em] text-[var(--text-disabled)]">1 → W</div>
                <div className="font-mono text-[var(--text-secondary)]">
                  {formatOhms(component.value * (component.wiper ?? 0.5))}
                </div>
              </div>
              <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-2 py-1">
                <div className="text-[9px] uppercase tracking-[0.1em] text-[var(--text-disabled)]">W → 3</div>
                <div className="font-mono text-[var(--text-secondary)]">
                  {formatOhms(component.value * (1 - (component.wiper ?? 0.5)))}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {component.kind === 'photoresistor' ? (
          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                Illumination
              </span>
              <span className="font-mono text-[10px] text-[var(--accent-cyan)]">
                {Math.round((component.illumination ?? 0) * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={component.illumination ?? 0}
              onChange={(e) => setComponentIllumination(component.id, Number(e.target.value))}
              aria-label="Photoresistor illumination"
              className="w-full"
            />
            <p className="mt-1 note">
              Now {formatOhms(Math.max(50, component.value * (1 - 0.98 * (component.illumination ?? 0))))}.
              This slider stands in for a light source — it is not a physical illumination model.
            </p>
          </div>
        ) : null}

        {component.kind === 'fuse' && component.blown ? (
          <div className="rounded-md border border-[rgba(202,43,43,0.3)] bg-[rgba(202,43,43,0.08)] p-2.5">
            <p className="text-[11px] font-semibold text-[var(--signal-error)]">This fuse has blown</p>
            <p className="mt-1 text-[10px] leading-snug text-[var(--text-secondary)]">
              It is now a permanent open circuit. Fix the overcurrent first, or the replacement will blow too.
            </p>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => replaceFuse(component.id)}>
              Replace fuse
            </Button>
          </div>
        ) : null}

        {/* placement */}
        <div className="grid grid-cols-2 gap-1.5">
          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-[0.1em] text-[var(--text-disabled)]">Seat</div>
            <div className="font-mono text-[11px] text-[var(--text-secondary)]">
              {component.seat
                ? `${component.seat.row}${String(component.seat.col).padStart(2, '0')}`
                : 'on bench'}
            </div>
          </div>
          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-[0.1em] text-[var(--text-disabled)]">Rotation</div>
            <div className="font-mono text-[11px] text-[var(--text-secondary)]">{component.rotation}°</div>
          </div>
        </div>

        {/* pins and nets */}
        {pins.length > 0 ? (
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
              Pins &amp; nets
            </div>
            <div className="overflow-hidden rounded-md border border-[var(--border-subtle)]">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="bg-[var(--surface-raised)] text-[var(--text-disabled)]">
                    <th className="px-2 py-1 text-left font-medium">Pin</th>
                    <th className="px-2 py-1 text-left font-medium">Role</th>
                    <th className="px-2 py-1 text-left font-medium">Hole</th>
                    <th className="px-2 py-1 text-left font-medium">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {pins.map((p) => {
                    const net = netlist ? netNameOfPin(netlist, component.id, p.pinId) : '—';
                    return (
                      <tr key={p.pinId} className="border-t border-[var(--border-subtle)]">
                        <td className="px-2 py-1 font-mono text-[var(--text-primary)]">{p.label}</td>
                        <td className="px-2 py-1 text-[var(--text-tertiary)]">{p.role}</td>
                        <td className="px-2 py-1 font-mono text-[var(--text-secondary)]">
                          {p.offBoard ? (
                            <span className="text-[var(--signal-error)]">off board</span>
                          ) : (
                            (p.hole ?? '—')
                          )}
                        </td>
                        <td className="px-2 py-1 font-mono">
                          {net === 'unconnected' ? (
                            <span className="text-[var(--signal-error)]">{net}</span>
                          ) : (
                            <span className="text-[var(--accent-cyan)]">{net}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!netlist ? (
              <p className="mt-1 text-[10px] text-[var(--text-disabled)]">
                Net names appear after you run the simulation.
              </p>
            ) : null}
          </div>
        ) : null}

        {/* measurements for this part */}
        {measurement ? (
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
              Measured
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <MiniStat label="I" value={formatAmps(Math.abs(measurement.currentA))} />
              <MiniStat label="V" value={formatVolts(measurement.voltageV)} />
              <MiniStat label="P" value={formatWatts(measurement.powerW)} />
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {measurement.shorted ? <Badge tone="error">Shorted out</Badge> : null}
              {measurement.reverseBiased ? <Badge tone="error">Reverse biased</Badge> : null}
              {measurement.lit === true ? <Badge tone="ok">Lit</Badge> : null}
              {measurement.lit === false && !measurement.reverseBiased ? (
                <Badge tone="neutral">Dark</Badge>
              ) : null}
            </div>
          </div>
        ) : null}

        <p className="note">{def.blurb}</p>
      </div>
    </Panel>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="readout rounded-md px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-[0.1em] text-[var(--text-disabled)]">{label}</div>
      <div className="readout-live truncate font-mono text-[11px]">{value}</div>
    </div>
  );
}
