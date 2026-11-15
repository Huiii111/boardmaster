'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Code2,
  Crosshair,
  Info,
  Keyboard,
  Play,
  ShieldCheck,
  Target,
  X,
  XCircle,
} from 'lucide-react';

import { experimentById } from '@/lib/circuit/experiments';
import { formatAmps } from '@/lib/format';
import { Badge, Button, Kbd, Panel, Spinner, cx } from '@/components/ui/primitives';
import { useLabStore } from '@/store/useLabStore';
import { TopToolbar } from './TopToolbar';
import { LeftSidebar } from './LeftSidebar';
import { PcbSidebar } from '@/components/pcb/PcbSidebar';
import { PropertiesPanel } from './PropertiesPanel';
import { DiagnosticsPanel, MeasurementsPanel, SimulationStatusPanel } from './MeasurementsPanel';
import { TutorPanel } from '@/components/tutor/TutorPanel';
import { CompareVersions } from '@/components/versions/CompareVersions';
import { PcbWorkspace } from '@/components/pcb/PcbWorkspace';
import { CodeWorkspace } from '@/components/code/CodeWorkspace';

/**
 * Renders the component library's 3D thumbnails once, then unmounts itself.
 * Kept out of the main bundle: it pulls in the same three.js runtime the
 * workbench uses.
 */
/**
 * The single shared renderer behind every live library preview. Dynamic for the
 * same reason as the forge: it pulls in three.js.
 */
const PartSpotlight = dynamic(
  () => import('@/components/three/PartSpotlight').then((m) => m.PartSpotlight),
  { ssr: false },
);

const ThumbnailForge = dynamic(
  () => import('@/components/three/PartThumbnails').then((m) => m.ThumbnailForge),
  { ssr: false },
);

/**
 * The 3D canvas must not be server-rendered: WebGL needs a browser context.
 * A labelled loading state stands in while the bundle streams.
 */
const Workbench = dynamic(() => import('@/components/three/Workbench').then((m) => m.Workbench), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center bg-[var(--surface-void)]">
      <div className="flex flex-col items-center gap-3">
        <div className="relative h-10 w-10">
          <div className="absolute inset-0 rounded-full border-2 border-[var(--border-default)]" />
          <div className="absolute inset-0 animate-lab-spin rounded-full border-2 border-transparent border-t-[var(--accent-cyan)]" />
        </div>
        <p className="text-[11px] text-[var(--text-tertiary)]">Loading 3D workbench…</p>
      </div>
    </div>
  ),
});

export function LabShell() {
  const workspace = useLabStore((s) => s.workspace);
  const hydrate = useLabStore((s) => s.hydrate);
  const fetchServerStatus = useLabStore((s) => s.fetchServerStatus);
  const hydrated = useLabStore((s) => s.hydrated);
  const report = useLabStore((s) => s.report);
  const pcbResult = useLabStore((s) => s.pcbResult);
  const pcbChecking = useLabStore((s) => s.pcbChecking);
  const runPcbChecks = useLabStore((s) => s.runPcbChecks);
  const toasts = useLabStore((s) => s.toasts);
  const dismissToast = useLabStore((s) => s.dismissToast);
  const server = useLabStore((s) => s.server);

  const [resetToken, setResetToken] = useState(0);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showBrief, setShowBrief] = useState(true);

  useEffect(() => {
    hydrate();
    void fetchServerStatus();
  }, [hydrate, fetchServerStatus]);

  /* ----------------------------- keyboard map ----------------------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const typing =
        target !== null &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      const s = useLabStore.getState();

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        s.saveVersion();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        s.runSimulation();
        return;
      }
      if (typing) return;

      switch (e.key) {
        case 'Escape':
          if (s.wireAnchor) s.cancelWire();
          else if (s.placingKind) s.armPlacement(null);
          else s.select({ kind: null, id: null });
          break;
        case 'v':
        case 'V':
          s.setTool('select');
          break;
        case 'w':
        case 'W':
          s.setTool('wire');
          break;
        case 'x':
        case 'X':
          s.setTool('delete');
          break;
        case 'r':
        case 'R':
          if (s.tool === 'place') s.rotatePlacement();
          else if (s.selection.kind === 'component' && s.selection.id) s.rotateComponent(s.selection.id);
          break;
        case 'Delete':
        case 'Backspace':
          if (s.selection.kind === 'component' && s.selection.id) s.deleteComponent(s.selection.id);
          else if (s.selection.kind === 'wire' && s.selection.id) s.deleteWire(s.selection.id);
          else if (s.selection.kind === 'trace' && s.selection.id) s.deleteTrace(s.selection.id);
          break;
        case 'h':
        case 'H':
          setResetToken((t) => t + 1);
          break;
        case '?':
          setShowShortcuts((v) => !v);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const resetCamera = useCallback(() => setResetToken((t) => t + 1), []);

  if (!hydrated) {
    return (
      <div className="grid h-dvh place-items-center lab-grid">
        <Spinner label="Starting BoardMaster…" />
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden lab-grid">
      <ThumbnailForge />
      <PartSpotlight />
      <TopToolbar />

      {/* server warnings banner */}
      {server.warnings.length > 0 ? (
        <div className="flex items-start gap-2 border-b border-[rgba(150,88,10,0.25)] bg-[rgba(150,88,10,0.07)] px-3 py-1.5">
          <AlertTriangle size={13} className="mt-px shrink-0 text-[var(--signal-warn)]" aria-hidden />
          <p className="text-[10px] leading-snug text-[var(--signal-warn)]">
            {server.warnings.join(' ')}
          </p>
        </div>
      ) : null}
      {server.error ? (
        <div className="flex items-start gap-2 border-b border-[rgba(202,43,43,0.25)] bg-[rgba(202,43,43,0.07)] px-3 py-1.5">
          <XCircle size={13} className="mt-px shrink-0 text-[var(--signal-error)]" aria-hidden />
          <p className="text-[10px] leading-snug text-[var(--signal-error)]">
            Could not reach the server capability probe ({server.error}). The circuit analyser still works —
            it runs locally in your browser.
          </p>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {/* The breadboard rail offers tools and a through-hole catalogue that do
            nothing to copper, so the PCB workspace gets its own. */}
        {workspace === 'pcb' ? <PcbSidebar /> : <LeftSidebar />}

        {/* ------------------------------ centre ------------------------------ */}
        <main className="flex min-w-0 flex-1 flex-col">
          {workspace === 'circuit' ? (
            <CircuitWorkspace
              resetToken={resetToken}
              resetCamera={resetCamera}
              showBrief={showBrief}
              setShowBrief={setShowBrief}
            />
          ) : workspace === 'code' ? (
            <CodeWorkspace />
          ) : workspace === 'pcb' ? (
            <PcbWorkspace />
          ) : (
            <CompareVersions />
          )}
        </main>

        {/* --------------------------- right sidebar --------------------------- */}
        <aside className="flex w-[352px] shrink-0 flex-col gap-2.5 overflow-y-auto border-l border-[var(--border-default)] bg-[var(--surface-base)] p-2.5 scroll-lab">
          {workspace === 'pcb' ? (
            <>
              <Panel
                title="PCB checks"
                icon={<ShieldCheck size={12} aria-hidden />}
                actions={
                  <Button
                    variant="accent"
                    size="sm"
                    onClick={runPcbChecks}
                    loading={pcbChecking}
                    title="Run the educational geometric checks over the board"
                  >
                    {!pcbChecking ? <ShieldCheck size={12} aria-hidden /> : null}
                    Run checks
                  </Button>
                }
              >
                {pcbResult ? (
                  <dl className="space-y-0.5 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-2 text-[10px]">
                    <StatRow label="Footprints" value={String(pcbResult.stats.footprints)} />
                    <StatRow label="Pads" value={String(pcbResult.stats.pads)} />
                    <StatRow label="Traces" value={String(pcbResult.stats.traces)} />
                    <StatRow
                      label="Nets routed"
                      value={`${pcbResult.stats.netsFullyRouted} / ${pcbResult.stats.nets}`}
                    />
                  </dl>
                ) : (
                  <p className="note">
                    Nothing has been checked yet. Results below are produced by measuring the board
                    geometry — placing parts or drawing traces never marks the layout as passing.
                  </p>
                )}
              </Panel>
              <DiagnosticsPanel
                diagnostics={pcbResult?.diagnostics ?? null}
                title="PCB issues"
                emptyBody="Route your nets, then press Run PCB Checks. Connectivity, shorts, clearance and placement are all verified geometrically."
                footer="Checks connectivity, net correctness, copper clearance and courtyard overlap. Does not check drills, annular rings, vias, solder mask or manufacturer capabilities."
              />
              <PropertiesPanel />
              <TutorPanel />
            </>
          ) : (
            <>
              <SimulationStatusPanel />
              <DiagnosticsPanel
                diagnostics={report?.validation.diagnostics ?? null}
                title="Circuit issues"
                emptyBody="Press Run Simulation to analyse your circuit. Every finding is derived from the circuit graph — nothing is guessed."
                footer="Each issue is produced by a deterministic rule over your netlist and the solved operating point. Hover an issue to highlight the parts it refers to."
              />
              <MeasurementsPanel />
              <PropertiesPanel />
              <TutorPanel />
            </>
          )}
        </aside>
      </div>

      {/* ------------------------------ toasts ------------------------------ */}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex w-full max-w-md -translate-x-1/2 flex-col gap-1.5 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cx(
              'pointer-events-auto flex animate-fade-up items-start gap-2 rounded-lg border px-3 py-2 shadow-panel backdrop-blur-sm',
              t.kind === 'success'
                ? 'border-[rgba(11,122,82,0.35)] bg-[rgba(10,40,32,0.94)] text-[var(--signal-ok)]'
                : t.kind === 'error'
                  ? 'border-[rgba(202,43,43,0.35)] bg-[rgba(42,14,16,0.94)] text-[var(--signal-error)]'
                  : t.kind === 'warning'
                    ? 'border-[rgba(150,88,10,0.35)] bg-[rgba(42,32,10,0.94)] text-[var(--signal-warn)]'
                    : 'border-[var(--border-strong)] bg-[rgba(16,22,32,0.94)] text-[var(--text-secondary)]',
            )}
          >
            {t.kind === 'success' ? (
              <CheckCircle2 size={14} className="mt-px shrink-0" aria-hidden />
            ) : t.kind === 'error' ? (
              <XCircle size={14} className="mt-px shrink-0" aria-hidden />
            ) : t.kind === 'warning' ? (
              <AlertTriangle size={14} className="mt-px shrink-0" aria-hidden />
            ) : (
              <Info size={14} className="mt-px shrink-0" aria-hidden />
            )}
            <p className="flex-1 text-[11px] leading-snug">{t.message}</p>
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              className="shrink-0 opacity-60 transition-opacity hover:opacity-100"
              aria-label="Dismiss"
            >
              <X size={12} aria-hidden />
            </button>
          </div>
        ))}
      </div>

      {/* ---------------------------- shortcuts ---------------------------- */}
      {showShortcuts ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Keyboard shortcuts"
          onClick={() => setShowShortcuts(false)}
        >
          <div
            className="instrument w-full max-w-md animate-fade-up rounded-xl p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2">
              <Keyboard size={15} className="text-[var(--accent-cyan)]" aria-hidden />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Keyboard shortcuts</h2>
              <div className="flex-1" />
              <Button size="icon" variant="ghost" onClick={() => setShowShortcuts(false)} aria-label="Close">
                <X size={14} aria-hidden />
              </Button>
            </div>
            <dl className="grid grid-cols-2 gap-x-5 gap-y-1.5 text-[11px]">
              {[
                ['V', 'Select tool'],
                ['W', 'Wire tool'],
                ['X', 'Delete tool'],
                ['R', 'Rotate selection'],
                ['Del', 'Delete selection'],
                ['Esc', 'Cancel / deselect'],
                ['H', 'Reset camera'],
                ['Ctrl+Z', 'Undo'],
                ['Ctrl+Shift+Z', 'Redo'],
                ['Ctrl+S', 'Save version'],
                ['Ctrl+Enter', 'Run simulation'],
                ['?', 'This dialog'],
              ].map(([key, desc]) => (
                <div key={key} className="flex items-center justify-between gap-2">
                  <dt className="text-[var(--text-tertiary)]">{desc}</dt>
                  <dd>
                    <Kbd>{key}</Kbd>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 border-t border-[var(--border-subtle)] pt-2.5 note">
              Mouse: left-drag orbits, scroll zooms, right-drag pans. In Select mode, press and drag a part to
              re-seat it on the board.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------- circuit workspace --------------------------- */

function CircuitWorkspace({
  resetToken,
  resetCamera,
  showBrief,
  setShowBrief,
}: {
  resetToken: number;
  resetCamera: () => void;
  showBrief: boolean;
  setShowBrief: (v: boolean) => void;
}) {
  const experimentId = useLabStore((s) => s.experimentId);
  const experiment = experimentById(experimentId);
  const tool = useLabStore((s) => s.tool);
  const hoveredHole = useLabStore((s) => s.hoveredHole);
  const report = useLabStore((s) => s.report);
  const design = useLabStore((s) => s.design);
  const wireAnchor = useLabStore((s) => s.wireAnchor);

  const litBranch = report?.analysis.branches.find((b) => b.conducts);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <SketchLink />
      {/* experiment brief */}
      {showBrief ? (
        <div className="shrink-0 border-b border-[var(--border-default)] bg-[var(--surface-raised)] px-3 py-2">
          <div className="flex items-start gap-2.5">
            <BookOpen size={14} className="mt-0.5 shrink-0 text-[var(--accent-cyan)]" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-[12px] font-semibold text-[var(--text-primary)]">
                  {experiment.name}
                </h2>
                <Badge tone={experiment.supported ? 'ok' : 'warn'}>
                  {experiment.supported ? 'Fully checkable' : 'Partial support'}
                </Badge>
              </div>
              <p className="mt-0.5 text-[11px] leading-snug text-[var(--text-secondary)]">
                {experiment.summary}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-[var(--text-disabled)]">
                <span className="flex items-center gap-1">
                  <Target size={10} aria-hidden />
                  Target {formatAmps(experiment.targetCurrent.min)}–
                  {formatAmps(experiment.targetCurrent.max)}
                </span>
                <span className="font-mono">{experiment.workedExample}</span>
              </div>
            </div>
            <Button size="icon" variant="ghost" onClick={() => setShowBrief(false)} aria-label="Hide brief">
              <X size={13} aria-hidden />
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowBrief(true)}
          className="shrink-0 border-b border-[var(--border-default)] bg-[var(--surface-raised)] px-3 py-1 text-left text-[10px] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
        >
          <BookOpen size={10} className="mr-1 inline" aria-hidden />
          Show experiment brief
        </button>
      )}

      {/* canvas */}
      <div className="relative min-h-0 flex-1">
        <Workbench resetToken={resetToken} />

        {/* HUD: top-left status */}
        <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1.5">
          <div className="pointer-events-auto flex items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[rgba(255,255,255,0.88)] shadow-[0_1px_3px_rgba(16,24,31,0.12)] px-2 py-1 backdrop-blur-sm">
            <Crosshair size={11} className="text-[var(--accent-cyan)]" aria-hidden />
            <span className="text-[10px] font-medium text-[var(--text-secondary)]">
              {tool === 'select'
                ? 'Select'
                : tool === 'wire'
                  ? wireAnchor
                    ? 'Wire — click the second end'
                    : 'Wire — click the first end'
                  : tool === 'delete'
                    ? 'Delete'
                    : 'Place'}
            </span>
            {hoveredHole ? (
              <span className="font-mono text-[10px] text-[var(--accent-cyan)]">{hoveredHole}</span>
            ) : null}
          </div>

          {design.components.length === 0 ? (
            <div className="pointer-events-auto max-w-[260px] rounded-md border border-[rgba(11,122,109,0.3)] bg-[rgba(255,255,255,0.92)] shadow-[0_1px_3px_rgba(16,24,31,0.12)] px-2.5 py-2 backdrop-blur-sm">
              <p className="text-[10px] leading-snug text-[var(--text-secondary)]">
                Start by clicking <strong className="text-[var(--accent-cyan)]">DC Power Supply</strong> in the
                library, then <strong className="text-[var(--accent-cyan)]">Resistor</strong> and{' '}
                <strong className="text-[var(--accent-cyan)]">LED</strong> — click a breadboard hole to seat
                each one. Then switch to the Wire tool.
              </p>
            </div>
          ) : null}
        </div>

        {/* HUD: live readout */}
        {litBranch ? (
          <div className="pointer-events-none absolute right-3 top-3 rounded-md border border-[var(--border-default)] bg-[rgba(255,255,255,0.88)] shadow-[0_1px_3px_rgba(16,24,31,0.12)] px-2.5 py-1.5 backdrop-blur-sm">
            <div className="text-[9px] uppercase tracking-[0.1em] text-[var(--text-disabled)]">
              Branch {litBranch.id}
            </div>
            <div className="readout-live font-mono text-sm tabular-nums">
              {formatAmps(litBranch.currentA)}
            </div>
          </div>
        ) : null}

        {/* HUD: camera + help */}
        <div className="absolute bottom-3 right-3 flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={resetCamera}
            title="Reset the camera (H)"
            className="bg-[rgba(255,255,255,0.88)] shadow-[0_1px_3px_rgba(16,24,31,0.12)] backdrop-blur-sm"
          >
            Reset camera
          </Button>
        </div>

        {/* HUD: legend */}
        <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-[var(--border-default)] bg-[rgba(255,255,255,0.88)] shadow-[0_1px_3px_rgba(16,24,31,0.12)] px-2.5 py-1.5 text-[9px] text-[var(--text-disabled)] backdrop-blur-sm">
          <LegendDot color="#43b9ff" label="hovered hole" />
          <LegendDot color="#fbbf24" label="wire anchor" />
          <LegendDot color="#2fe0cf" label="selected / same strip" />
          <span className="text-[var(--text-disabled)]">
            Press <Kbd>?</Kbd> for shortcuts
          </span>
        </div>
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      {label}
    </span>
  );
}

/**
 * The link between the sketch and the bench, stated on the bench.
 *
 * The lab ships a board-driven circuit, and pressing Run here really does
 * execute the student's sketch and solve the circuit it produces -- but
 * nothing on this screen said so. A student saw a breadboard, a Run button
 * labelled for circuit analysis, and an LED that changed for no visible
 * reason. This strip names the cause, shows which pins the last run left
 * driven, and gives a one-click route to the code that decides it.
 *
 * It only appears when a board is actually on the bench; a circuit fed from a
 * DC supply has no sketch to attribute anything to.
 */
function SketchLink() {
  const design = useLabStore((s) => s.design);
  const codeResult = useLabStore((s) => s.codeResult);
  const codeRunning = useLabStore((s) => s.codeRunning);
  const runSimulation = useLabStore((s) => s.runSimulation);
  const setWorkspace = useLabStore((s) => s.setWorkspace);

  const mcu = design.components.find((c) => c.kind === 'arduino_uno' || c.kind === 'esp32');
  if (!mcu) return null;

  const driven = Object.entries(mcu.mcuPins ?? {}).filter(([, p]) => p.mode === 'output');
  const failed = codeResult !== null && !codeResult.ok;

  return (
    <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-[var(--border-default)] bg-[var(--surface-inset)] px-3 py-1.5 scroll-lab">
      <Code2 size={12} className="shrink-0 text-[var(--accent-cyan)]" aria-hidden />
      <span className="shrink-0 whitespace-nowrap text-[10px] text-[var(--text-tertiary)]">
        <strong className="font-semibold text-[var(--text-secondary)]">sketch.ino</strong> drives{' '}
        {mcu.label} — the bench shows the circuit your code produces.
      </span>

      <div className="flex shrink-0 items-center gap-1">
        {failed ? (
          <Badge tone="error" title={codeResult.errors[0]?.message}>
            Line {codeResult.errors[0]?.line}: sketch failed
          </Badge>
        ) : driven.length === 0 ? (
          <Badge tone="warn">No pin driven yet</Badge>
        ) : (
          driven.map(([pin, p]) => (
            <Badge key={pin} tone={p.value > 0 ? 'ok' : 'neutral'} mono>
              {pin.toUpperCase()} {p.value > 0 ? (p.value < 1 ? `${Math.round(p.value * 100)}%` : 'HIGH') : 'LOW'}
            </Badge>
          ))
        )}
      </div>

      <div className="flex-1" />

      <Button
        size="sm"
        variant="outline"
        className="shrink-0"
        onClick={runSimulation}
        loading={codeRunning}
        title="Run the sketch, then solve the circuit it produces"
      >
        {!codeRunning ? <Play size={11} aria-hidden /> : null}
        Run sketch
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="shrink-0"
        onClick={() => setWorkspace('code')}
        title="Open the sketch that drives this bench"
      >
        <Code2 size={11} aria-hidden />
        Edit code
      </Button>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-[var(--text-disabled)]">{label}</dt>
      <dd className="font-mono tabular-nums text-[var(--text-secondary)]">{value}</dd>
    </div>
  );
}
