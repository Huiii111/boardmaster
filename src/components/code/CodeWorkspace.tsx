'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Cpu, Play, Terminal, Waves, XCircle } from 'lucide-react';

import { BOARDS } from '@/lib/mcu/board';
import { isMcu } from '@/lib/circuit/solve';
import { formatAmps } from '@/lib/format';
import { Badge, Button, EmptyState, Panel, cx } from '@/components/ui/primitives';
import { useLabStore } from '@/store/useLabStore';

/**
 * Code workspace: the circuit on the left, the sketch on the right.
 *
 * The split is the point. Pressing Run executes the sketch, writes its pin
 * states back onto the board, and re-solves the circuit — so the student
 * watches their LED light beside the line of code that lit it.
 *
 * Only one workspace is mounted at a time, so this viewport and the one on the
 * 3D Workbench tab never hold two WebGL contexts simultaneously.
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
        <p className="text-[11px] text-[var(--text-tertiary)]">Loading circuit view…</p>
      </div>
    </div>
  ),
});

type OutputTab = 'problems' | 'serial' | 'pins';

export function CodeWorkspace() {
  const sketch = useLabStore((s) => s.sketch);
  const setSketch = useLabStore((s) => s.setSketch);
  const runCode = useLabStore((s) => s.runCode);
  const codeRunning = useLabStore((s) => s.codeRunning);
  const result = useLabStore((s) => s.codeResult);
  const components = useLabStore((s) => s.design.components);
  const report = useLabStore((s) => s.report);
  const setWorkspace = useLabStore((s) => s.setWorkspace);

  const [tab, setTab] = useState<OutputTab>('problems');
  const [splitPct, setSplitPct] = useState(46);
  const [resetToken, setResetToken] = useState(0);
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const mcu = components.find((c) => isMcu(c.kind));
  const board = mcu ? BOARDS[mcu.kind as keyof typeof BOARDS] : null;

  const lines = useMemo(() => sketch.split('\n').length, [sketch]);
  const errorLines = useMemo(() => new Set((result?.errors ?? []).map((e) => e.line)), [result]);

  // Jump to the first problem when a run fails.
  useEffect(() => {
    if (result && result.errors.length > 0) setTab('problems');
    else if (result && result.serial.length > 0) setTab('serial');
  }, [result]);

  /* ------------------------------ split drag ------------------------------ */
  const onDragMove = useCallback((e: PointerEvent) => {
    if (!dragging.current || !containerRef.current) return;
    const box = containerRef.current.getBoundingClientRect();
    const pct = ((e.clientX - box.left) / box.width) * 100;
    setSplitPct(Math.min(72, Math.max(26, pct)));
  }, []);

  useEffect(() => {
    const stop = (): void => {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', stop);
    return () => {
      window.removeEventListener('pointermove', onDragMove);
      window.removeEventListener('pointerup', stop);
    };
  }, [onDragMove]);

  const drivenPins = useMemo(
    () =>
      Object.entries(result?.pinModes ?? {})
        .filter(([, mode]) => mode === 'output')
        .map(([pin]) => ({ pin, value: result?.pinValues[pin] ?? 0 })),
    [result],
  );

  const litLed = report?.analysis.measurements.find((m) => m.lit);

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 gap-0 p-2.5">
      {/* ============================ left: circuit ============================ */}
      <section
        className="instrument relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg"
        style={{ width: `${splitPct}%` }}
        aria-label="Circuit view"
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--surface-raised)] px-3 py-2">
          <Cpu size={12} className="text-[var(--accent-cyan)]" aria-hidden />
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--text-secondary)]">
            Your circuit
          </h2>
          {board ? <Badge tone="accent">{board.name}</Badge> : <Badge tone="warn">No board</Badge>}
          <div className="flex-1" />
          <Button size="sm" variant="ghost" onClick={() => setResetToken((t) => t + 1)}>
            Reset view
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setWorkspace('circuit')}>
            Edit wiring
          </Button>
        </header>

        <div className="relative min-h-0 flex-1">
          {mcu ? (
            <Workbench resetToken={resetToken} />
          ) : (
            <div className="grid h-full place-items-center">
              <EmptyState
                icon={<Cpu size={26} aria-hidden />}
                title="No microcontroller on the bench"
                body="A sketch needs a board to run on, and the pins it drives are what light your circuit."
                action={
                  <Button
                    variant="accent"
                    size="md"
                    onClick={() => useLabStore.getState().placeBenchComponent('arduino_uno', [0, 0, 2.0])}
                  >
                    Add an Arduino Uno
                  </Button>
                }
              />
            </div>
          )}

          {/* live pin readout, so the link from code to hardware is visible */}
          {mcu && drivenPins.length > 0 ? (
            <div className="pointer-events-none absolute left-3 top-3 rounded-md border border-[var(--border-default)] bg-[rgba(11,15,20,0.88)] px-2.5 py-2 backdrop-blur-sm">
              <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--text-disabled)]">
                Driven pins
              </div>
              <div className="mt-1 space-y-0.5">
                {drivenPins.map(({ pin, value }) => (
                  <div key={pin} className="flex items-center gap-2 font-mono text-[10px]">
                    <span className="text-[var(--text-secondary)]">{pin.toUpperCase()}</span>
                    <span className={value > 0 ? 'text-[var(--signal-ok)]' : 'text-[var(--text-disabled)]'}>
                      {value === 1 ? 'HIGH' : value === 0 ? 'LOW' : `${Math.round(value * 100)}%`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {litLed ? (
            <div className="pointer-events-none absolute right-3 top-3 rounded-md border border-[rgba(11,122,82,0.35)] bg-[rgba(11,15,20,0.88)] px-2.5 py-1.5 backdrop-blur-sm">
              <div className="text-[9px] uppercase tracking-[0.1em] text-[var(--text-disabled)]">
                {litLed.label} lit
              </div>
              <div className="readout-live font-mono text-sm tabular-nums">
                {formatAmps(Math.abs(litLed.currentA))}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {/* ============================== splitter ============================== */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the circuit and code panes"
        tabIndex={0}
        onPointerDown={() => {
          dragging.current = true;
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setSplitPct((p) => Math.max(26, p - 2));
          if (e.key === 'ArrowRight') setSplitPct((p) => Math.min(72, p + 2));
        }}
        className="group mx-1 flex w-2 shrink-0 cursor-col-resize items-center justify-center rounded-full transition-colors hover:bg-[var(--surface-hover)]"
      >
        <div className="h-10 w-0.5 rounded-full bg-[var(--border-strong)] transition-colors group-hover:bg-[var(--accent-cyan)]" />
      </div>

      {/* ============================== right: code ============================== */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-2.5" aria-label="Sketch editor">
        <div className="instrument flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg">
          <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--surface-raised)] px-3 py-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--text-secondary)]">
              sketch.ino
            </h2>
            <Button variant="accent" size="sm" onClick={runCode} loading={codeRunning} disabled={!mcu}>
              {!codeRunning ? <Play size={12} aria-hidden /> : null}
              Run sketch
            </Button>
            {result ? (
              result.ok ? (
                <Badge tone="ok">
                  {result.loopsRun} loops · {result.elapsedMs} ms
                </Badge>
              ) : (
                <Badge tone="error">
                  {result.errors.length} error{result.errors.length === 1 ? '' : 's'}
                </Badge>
              )
            ) : null}
            <div className="flex-1" />
            <span className="text-[10px] text-[var(--text-disabled)]">
              {lines} lines · Ctrl+Enter to run
            </span>
          </header>

          <div className="flex min-h-0 flex-1 overflow-auto scroll-lab">
            <div
              aria-hidden
              className="shrink-0 select-none border-r border-[var(--border-subtle)] bg-[var(--surface-inset)] px-2 py-3 text-right font-mono text-[12px] leading-[1.55] text-[var(--text-disabled)]"
            >
              {Array.from({ length: lines }, (_, i) => (
                <div
                  key={i}
                  className={cx(
                    errorLines.has(i + 1) &&
                      'bg-[rgba(202,43,43,0.2)] font-semibold text-[var(--signal-error)]',
                  )}
                >
                  {i + 1}
                </div>
              ))}
            </div>
            <textarea
              value={sketch}
              onChange={(e) => setSketch(e.target.value)}
              spellCheck={false}
              aria-label="Arduino sketch"
              className="min-h-full flex-1 resize-none bg-transparent px-3 py-3 font-mono text-[12px] leading-[1.55] text-[var(--text-primary)] outline-none"
              style={{ tabSize: 2 }}
              onKeyDown={(e) => {
                if (e.key === 'Tab') {
                  e.preventDefault();
                  const el = e.currentTarget;
                  const { selectionStart: a, selectionEnd: b } = el;
                  setSketch(`${sketch.slice(0, a)}  ${sketch.slice(b)}`);
                  requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2));
                }
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault();
                  runCode();
                }
              }}
            />
          </div>
        </div>

        {/* ----------------------------- output ----------------------------- */}
        <Panel flush className="shrink-0">
          <div
            className="flex items-center gap-0.5 border-b border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2 py-1.5"
            role="tablist"
          >
            {(
              [
                { id: 'problems' as const, label: 'Problems', icon: <AlertTriangle size={11} aria-hidden />, count: result?.errors.length ?? 0 },
                { id: 'serial' as const, label: 'Serial', icon: <Terminal size={11} aria-hidden />, count: result?.serial.length ?? 0 },
                { id: 'pins' as const, label: 'Pin trace', icon: <Waves size={11} aria-hidden />, count: result?.events.length ?? 0 },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cx(
                  'inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-[11px] font-medium transition-colors',
                  tab === t.id
                    ? 'bg-[var(--surface-active)] text-[var(--text-primary)]'
                    : 'text-[var(--text-tertiary)] hover:bg-[var(--surface-hover)]',
                )}
              >
                {t.icon}
                {t.label}
                {t.count > 0 ? (
                  <span
                    className={cx(
                      'rounded-sm px-1 font-mono text-[9px]',
                      t.id === 'problems'
                        ? 'bg-[rgba(202,43,43,0.18)] text-[var(--signal-error)]'
                        : 'bg-[var(--surface-inset)] text-[var(--text-disabled)]',
                    )}
                  >
                    {t.count}
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          <div className="h-[168px] overflow-y-auto scroll-lab">
            {tab === 'problems' ? <Problems result={result} /> : null}
            {tab === 'serial' ? <Serial result={result} /> : null}
            {tab === 'pins' ? <PinTrace result={result} /> : null}
          </div>

          <p className="border-t border-[var(--border-subtle)] px-3 py-1.5 text-[9px] leading-snug text-[var(--text-disabled)]">
            <strong className="text-[var(--signal-warn)]">Interpreter, not a compiler.</strong> A documented
            C++ subset, executed directly — no avr-gcc, no cycle-accurate AVR emulation, so instruction
            timing is not modelled. <code>delay()</code> advances a virtual clock.
          </p>
        </Panel>
      </section>
    </div>
  );
}

/* ------------------------------ output panes ------------------------------ */

type Result = ReturnType<typeof useLabStore.getState>['codeResult'];

function Problems({ result }: { result: Result }) {
  if (!result) {
    return (
      <p className="px-3 py-3 text-[10px] text-[var(--text-disabled)]">
        Press Run sketch. Errors appear here with the line they came from.
      </p>
    );
  }
  if (result.errors.length === 0) {
    return (
      <p className="px-3 py-3 text-[10px] text-[var(--signal-ok)]">
        No errors. The sketch ran to completion in {result.elapsedMs} ms of simulated time.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-[var(--border-subtle)]">
      {result.errors.map((err, i) => (
        <li key={i} className="px-3 py-2">
          <div className="flex items-start gap-1.5">
            <XCircle size={12} className="mt-0.5 shrink-0 text-[var(--signal-error)]" aria-hidden />
            <div className="min-w-0">
              <p className="text-[11px] leading-snug text-[var(--text-primary)]">{err.message}</p>
              <p className="mt-0.5 font-mono text-[9px] text-[var(--text-disabled)]">
                {err.stage} · line {err.line}, col {err.column}
              </p>
              {err.hint ? (
                <p className="mt-1 text-[10px] leading-snug text-[var(--signal-warn)]">{err.hint}</p>
              ) : null}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Serial({ result }: { result: Result }) {
  if (!result || result.serial.length === 0) {
    return (
      <p className="px-3 py-3 font-mono text-[10px] text-[var(--text-disabled)]">
        {result ? 'Nothing printed. Did you call Serial.begin(9600)?' : 'Serial output appears here.'}
      </p>
    );
  }
  return (
    <div className="bg-[var(--surface-inset)] px-3 py-2 font-mono text-[10px] leading-relaxed">
      {result.serial.map((line, i) => (
        <div key={i} className="flex gap-2">
          <span className="shrink-0 text-[var(--text-disabled)]">
            {line.t.toString().padStart(5, ' ')}ms
          </span>
          <span className="whitespace-pre-wrap text-[var(--accent-cyan)]">
            {line.text.replace(/\n$/, '')}
          </span>
        </div>
      ))}
    </div>
  );
}

function PinTrace({ result }: { result: Result }) {
  if (!result || result.events.length === 0) {
    return (
      <p className="px-3 py-3 text-[10px] text-[var(--text-disabled)]">
        Pin changes appear here once the sketch runs.
      </p>
    );
  }
  return (
    <table className="w-full font-mono text-[10px]">
      <thead>
        <tr className="bg-[var(--surface-raised)] text-[var(--text-disabled)]">
          <th className="px-2 py-1 text-left font-medium">t</th>
          <th className="px-2 py-1 text-left font-medium">pin</th>
          <th className="px-2 py-1 text-left font-medium">mode</th>
          <th className="px-2 py-1 text-right font-medium">value</th>
        </tr>
      </thead>
      <tbody>
        {result.events.slice(-60).map((e, i) => (
          <tr key={i} className="border-t border-[var(--border-subtle)]">
            <td className="px-2 py-1 text-[var(--text-disabled)]">{e.t}ms</td>
            <td className="px-2 py-1 text-[var(--text-primary)]">{e.pin.toUpperCase()}</td>
            <td className="px-2 py-1 text-[var(--text-tertiary)]">{e.mode}</td>
            <td
              className={cx(
                'px-2 py-1 text-right',
                e.value > 0 ? 'text-[var(--signal-ok)]' : 'text-[var(--text-disabled)]',
              )}
            >
              {e.value === 1 ? 'HIGH' : e.value === 0 ? 'LOW' : `${Math.round(e.value * 100)}%`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
