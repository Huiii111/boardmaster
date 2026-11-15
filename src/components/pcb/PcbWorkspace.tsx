'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Cpu,
  Download,
  Eraser,
  MousePointer2,
  RotateCw,
  Layers3,
  Route,
  ScanLine,
  Trash2,
  Upload,
} from 'lucide-react';

import { findPadAt, padPosition, snapToGrid, type Point } from '@/lib/pcb/geometry';
import { ratsnest } from '@/lib/pcb/footprints';
import { copperLengthMm } from '@/lib/pcb/artwork';
import { BOARD_GRID_MM, DEFAULT_RULES, type PcbFootprint } from '@/lib/pcb/types';
import { Badge, Button, EmptyState, Kbd, cx } from '@/components/ui/primitives';
import dynamic from 'next/dynamic';

import type { MaskColor } from './PcbPreview3D';

/**
 * Lazy: this pulls in three.js and R3F. Importing it statically put the whole
 * 3D runtime into the initial page bundle (149 kB -> 441 kB first load) even
 * for students who never open the PCB view.
 */
const PcbPreview3D = dynamic(() => import('./PcbPreview3D').then((m) => m.PcbPreview3D), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center bg-[var(--surface-void)]">
      <div className="flex flex-col items-center gap-3">
        <div className="relative h-10 w-10">
          <div className="absolute inset-0 rounded-full border-2 border-[var(--border-default)]" />
          <div className="absolute inset-0 animate-lab-spin rounded-full border-2 border-transparent border-t-[var(--accent-cyan)]" />
        </div>
        <p className="text-[11px] text-[var(--text-tertiary)]">Rendering fabricated board…</p>
      </div>
    </div>
  ),
});
import { useLabStore } from '@/store/useLabStore';

/**
 * Simplified PCB layout editor.
 *
 * Rendered as SVG in board millimetres, so geometry in the DRC and geometry on
 * screen are the same numbers. The student does all the work: footprints are
 * imported with their nets but must be arranged, and every trace is routed by
 * hand with explicit waypoints.
 */

type PcbTool = 'select' | 'route';

const PAD_COLOR = '#d9a441';
/** Toolbar swatches, matching the mask colours in PcbPreview3D. */
const MASK_SWATCH: Record<MaskColor, string> = {
  green: '#0d6b3f',
  blue: '#11417e',
  red: '#8c1420',
  black: '#15181c',
  purple: '#4a1d6b',
  white: '#e8e9e4',
};
const PAD_SQUARE_COLOR = '#e8be63';

export function PcbWorkspace() {
  const board = useLabStore((s) => s.board);
  const pcbResult = useLabStore((s) => s.pcbResult);
  const importFootprints = useLabStore((s) => s.importFootprints);
  const moveFootprint = useLabStore((s) => s.moveFootprint);
  const rotateFootprint = useLabStore((s) => s.rotateFootprint);
  const addTrace = useLabStore((s) => s.addTrace);
  const deleteTrace = useLabStore((s) => s.deleteTrace);
  const clearTraces = useLabStore((s) => s.clearTraces);
  const selection = useLabStore((s) => s.selection);
  const select = useLabStore((s) => s.select);
  const highlighted = useLabStore((s) => s.highlighted);
  const pushToast = useLabStore((s) => s.pushToast);
  const circuitComponents = useLabStore((s) => s.design.components);
  const loadStarterCircuit = useLabStore((s) => s.loadStarterCircuit);
  const setWorkspace = useLabStore((s) => s.setWorkspace);

  const [tool, setTool] = useState<PcbTool>('select');
  const [routeStart, setRouteStart] = useState<{ padId: string; point: Point } | null>(null);
  const [waypoints, setWaypoints] = useState<Point[]>([]);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [dragging, setDragging] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [showRatsnest, setShowRatsnest] = useState(true);
  const [view, setView] = useState<'layout' | 'fabricated'>('layout');
  const [maskColor, setMaskColor] = useState<MaskColor>('green');
  const [showMask, setShowMask] = useState(true);
  const [showSilk, setShowSilk] = useState(true);
  const [showParts, setShowParts] = useState(true);

  const svgRef = useRef<SVGSVGElement>(null);

  const MARGIN = 3;
  const viewBox = `${-MARGIN} ${-MARGIN} ${board.width + MARGIN * 2} ${board.height + MARGIN * 2}`;

  /** Convert a pointer event to board millimetres. */
  const toBoard = useCallback((event: React.PointerEvent | React.MouseEvent): Point | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  }, []);

  const padLookup = useMemo(() => {
    const map = new Map<string, { pad: (typeof board.footprints)[number]['pads'][number]; fp: PcbFootprint; pos: Point }>();
    for (const fp of board.footprints) {
      for (const pad of fp.pads) map.set(pad.id, { pad, fp, pos: padPosition(fp, pad) });
    }
    return map;
  }, [board.footprints]);

  const nets = useMemo(() => ratsnest(board), [board]);
  const hasCircuit = circuitComponents.some((c) => c.kind !== 'breadboard');

  /** Which nets still need routing, so the ratsnest only shows real work. */
  const unroutedNets = useMemo(() => {
    const routed = new Set<string>();
    if (pcbResult) {
      for (const d of pcbResult.diagnostics) {
        for (const n of d.target?.netNames ?? []) routed.add(n);
      }
    }
    return nets;
  }, [nets, pcbResult]);

  const highlightSet = useMemo(() => new Set(highlighted), [highlighted]);
  const flaggedTraces = useMemo(() => {
    const s = new Set<string>();
    if (!pcbResult) return s;
    for (const d of pcbResult.diagnostics) {
      if (d.severity !== 'error' && d.severity !== 'warning') continue;
      for (const t of d.target?.traceIds ?? []) s.add(t);
    }
    return s;
  }, [pcbResult]);

  const flaggedPads = useMemo(() => {
    const s = new Set<string>();
    if (!pcbResult) return s;
    for (const d of pcbResult.diagnostics) {
      if (d.severity !== 'error' && d.severity !== 'warning') continue;
      for (const p of d.target?.padIds ?? []) s.add(p);
    }
    return s;
  }, [pcbResult]);

  /* --------------------------- routing interaction --------------------------- */

  const handleCanvasClick = (event: React.MouseEvent): void => {
    const point = toBoard(event);
    if (!point) return;

    if (tool !== 'route') {
      select({ kind: null, id: null });
      return;
    }

    const hit = findPadAt(board.footprints, point, DEFAULT_RULES.padSnap);

    if (!routeStart) {
      if (!hit) {
        pushToast('warning', 'A trace has to start on a pad. Click a pad to begin routing.');
        return;
      }
      setRouteStart({ padId: hit.pad.id, point: hit.position });
      setWaypoints([]);
      return;
    }

    if (hit && hit.pad.id !== routeStart.padId) {
      addTrace([routeStart.point, ...waypoints, hit.position], routeStart.padId, hit.pad.id);
      setRouteStart(null);
      setWaypoints([]);
      return;
    }

    // Otherwise drop a waypoint on the routing grid.
    setWaypoints((w) => [
      ...w,
      { x: snapToGrid(point.x, BOARD_GRID_MM / 2), y: snapToGrid(point.y, BOARD_GRID_MM / 2) },
    ]);
  };

  const cancelRoute = (): void => {
    setRouteStart(null);
    setWaypoints([]);
  };

  /* ----------------------------- footprint drag ----------------------------- */

  const handlePointerMove = (event: React.PointerEvent): void => {
    const point = toBoard(event);
    if (!point) return;
    setCursor(point);
    if (dragging) {
      moveFootprint(
        dragging.id,
        snapToGrid(point.x - dragging.dx, BOARD_GRID_MM / 2),
        snapToGrid(point.y - dragging.dy, BOARD_GRID_MM / 2),
      );
    }
  };

  const selectedFootprint =
    selection.kind === 'footprint' ? board.footprints.find((f) => f.id === selection.id) : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 p-2.5">
      {/* ------------------------------ toolbar ------------------------------ */}
      <div className="instrument flex shrink-0 items-center gap-2 overflow-x-auto rounded-lg px-3 py-2 scroll-lab">
        <div className="flex shrink-0 items-center gap-1.5">
          <Cpu size={14} className="text-[var(--accent-cyan)]" aria-hidden />
          <span className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]">
            PCB Layout
          </span>
          <Badge tone="warn" title="This is not a manufacturer DRC">
            Simplified checker
          </Badge>
        </div>

        <div className="h-5 w-px shrink-0 bg-[var(--border-default)]" />

        {/* Layout vs fabricated-board preview */}
        <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-inset)] p-0.5">
          <button
            type="button"
            onClick={() => setView('layout')}
            aria-current={view === 'layout' ? 'true' : undefined}
            className={cx(
              'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm px-2 py-1 text-[11px] font-medium transition-all',
              view === 'layout'
                ? 'bg-[var(--surface-active)] text-[var(--text-primary)]'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
            )}
          >
            <Route size={12} aria-hidden />
            2D Layout
          </button>
          <button
            type="button"
            onClick={() => setView('fabricated')}
            aria-current={view === 'fabricated' ? 'true' : undefined}
            className={cx(
              'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm px-2 py-1 text-[11px] font-medium transition-all',
              view === 'fabricated'
                ? 'bg-[var(--surface-active)] text-[var(--text-primary)]'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
            )}
            title="See your layout as a manufactured board"
          >
            <Layers3 size={12} aria-hidden />
            3D Fabricated
          </button>
        </div>

        <div className="h-5 w-px shrink-0 bg-[var(--border-default)]" />

        {view === 'layout' ? (
          <>
            <Button
              size="sm"
              variant="subtle"
              active={tool === 'select'}
              onClick={() => {
                setTool('select');
                cancelRoute();
              }}
            >
              <MousePointer2 size={12} aria-hidden />
              Select
            </Button>
            <Button size="sm" variant="subtle" active={tool === 'route'} onClick={() => setTool('route')}>
              <Route size={12} aria-hidden />
              Route
            </Button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-1" role="group" aria-label="Solder mask colour">
              {(['green', 'blue', 'red', 'black', 'purple', 'white'] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setMaskColor(c)}
                  aria-label={`${c} solder mask`}
                  aria-pressed={maskColor === c}
                  title={`${c} solder mask`}
                  className={cx(
                    'h-5 w-5 rounded-sm border transition-all',
                    maskColor === c
                      ? 'border-[var(--accent-cyan)] ring-1 ring-[var(--accent-cyan)]'
                      : 'border-[var(--border-strong)] hover:border-[var(--text-tertiary)]',
                  )}
                  style={{ backgroundColor: MASK_SWATCH[c] }}
                />
              ))}
            </div>
            <Button size="sm" variant="ghost" active={showMask} onClick={() => setShowMask((v) => !v)}>
              Solder mask
            </Button>
            <Button size="sm" variant="ghost" active={showSilk} onClick={() => setShowSilk((v) => !v)}>
              Silkscreen
            </Button>
            <Button size="sm" variant="ghost" active={showParts} onClick={() => setShowParts((v) => !v)}>
              Components
            </Button>
          </>
        )}

        <div className="h-5 w-px shrink-0 bg-[var(--border-default)]" />

        {/* Import lives in the Board panel on the left, and on the canvas's own
            empty state. A third copy here only pushed Ratsnest off the row. */}
        <Button
          size="sm"
          variant="ghost"
          active={showRatsnest}
          onClick={() => setShowRatsnest((v) => !v)}
          title="Toggle the dashed net guides"
        >
          <ScanLine size={12} aria-hidden />
          Ratsnest
        </Button>
        {selectedFootprint ? (
          <Button size="sm" variant="ghost" onClick={() => rotateFootprint(selectedFootprint.id)}>
            <RotateCw size={12} aria-hidden />
            Rotate {selectedFootprint.ref}
          </Button>
        ) : null}
        {board.traces.length > 0 ? (
          <Button size="sm" variant="ghost" onClick={clearTraces}>
            <Eraser size={12} aria-hidden />
            Clear traces
          </Button>
        ) : null}
        {selection.kind === 'trace' && selection.id ? (
          <Button size="sm" variant="danger" onClick={() => deleteTrace(selection.id as string)}>
            <Trash2 size={12} aria-hidden />
            Delete trace
          </Button>
        ) : null}

        <div className="flex-1" />

        {/* Outline, part and trace counts all live in the Board panel now. The
            only thing here that the sidebar cannot show is where the pointer
            is, which matters while routing. */}
        {cursor ? (
          <span className="shrink-0 whitespace-nowrap font-mono text-[10px] tabular-nums text-[var(--text-disabled)]">
            {cursor.x.toFixed(1)}, {cursor.y.toFixed(1)} mm
          </span>
        ) : null}
      </div>

      {/* routing hint bar */}
      {view === 'layout' && tool === 'route' ? (
        <div className="shrink-0 rounded-md border border-[rgba(150,88,10,0.25)] bg-[rgba(150,88,10,0.07)] px-3 py-1.5 text-[10px] text-[var(--signal-warn)]">
          {routeStart ? (
            <>
              Routing from a pad — click empty board to add a corner, click a destination pad to finish.{' '}
              <Kbd>Esc</Kbd> to cancel. {waypoints.length} waypoint{waypoints.length === 1 ? '' : 's'}.
            </>
          ) : (
            <>Route mode: click the first pad of a net to start a trace.</>
          )}
        </div>
      ) : null}

      {/* ------------------------------ canvas ------------------------------ */}
      <div className="instrument relative min-h-0 flex-1 overflow-hidden rounded-lg">
        {board.footprints.length === 0 ? (
          <div className="grid h-full place-items-center">
            {hasCircuit ? (
              <EmptyState
                icon={<Cpu size={30} aria-hidden />}
                title="Nothing imported yet"
                body="Footprints are derived from the components in your circuit, carrying their net assignments across."
                action={
                  <Button variant="accent" size="md" onClick={importFootprints}>
                    <Upload size={13} aria-hidden />
                    Import from circuit
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={<Cpu size={30} aria-hidden />}
                title="No circuit to lay out yet"
                body="A PCB is derived from a circuit — its footprints inherit your components and their net assignments. Build one on the 3D workbench, or start from the reference circuit to see the whole flow."
                action={
                  <div className="flex flex-col items-center gap-2">
                    <Button
                      variant="accent"
                      size="md"
                      onClick={() => {
                        loadStarterCircuit();
                        importFootprints();
                      }}
                    >
                      <Cpu size={13} aria-hidden />
                      Load reference circuit &amp; lay it out
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setWorkspace('circuit')}>
                      Build my own on the workbench
                    </Button>
                  </div>
                }
              />
            )}
          </div>
        ) : view === 'fabricated' ? (
          <>
            <PcbPreview3D
              board={board}
              maskColor={maskColor}
              showMask={showMask}
              showSilkscreen={showSilk}
              showComponents={showParts}
              flaggedTraces={flaggedTraces}
            />
            <div className="pointer-events-none absolute left-3 top-3 max-w-[300px] rounded-md border border-[var(--border-default)] bg-[rgba(11,15,20,0.86)] px-2.5 py-2 backdrop-blur-sm">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--accent-cyan)]">
                Fabricated preview
              </p>
              <p className="mt-0.5 text-[10px] leading-snug text-[var(--text-secondary)]">
                Generated from <strong>your</strong> layout — {board.footprints.length} footprints,{' '}
                {board.traces.length} routed traces, {copperLengthMm(board).toFixed(1)} mm of copper
                over a ground pour. Re-route a net and this board changes with it.
              </p>
              {flaggedTraces.size > 0 ? (
                <p className="mt-1 text-[10px] text-[var(--signal-error)]">
                  {flaggedTraces.size} trace{flaggedTraces.size === 1 ? '' : 's'} flagged by the checker
                  are highlighted in red.
                </p>
              ) : null}
            </div>
            <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-[var(--border-default)] bg-[rgba(11,15,20,0.86)] px-2.5 py-1.5 text-[9px] text-[var(--text-disabled)] backdrop-blur-sm">
              Drag to orbit · scroll to zoom · right-drag to pan · 1.6 mm FR4, 35 µm copper, HASL finish
            </div>
          </>
        ) : (
          <svg
            ref={svgRef}
            viewBox={viewBox}
            className={cx('h-full w-full', tool === 'route' ? 'cursor-crosshair' : 'cursor-default')}
            onClick={handleCanvasClick}
            onPointerMove={handlePointerMove}
            onPointerUp={() => setDragging(null)}
            onPointerLeave={() => {
              setDragging(null);
              setCursor(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') cancelRoute();
            }}
            role="application"
            aria-label="PCB layout editor"
            tabIndex={0}
          >
            <defs>
              <pattern id="pcb-grid" width={BOARD_GRID_MM} height={BOARD_GRID_MM} patternUnits="userSpaceOnUse">
                <path
                  d={`M ${BOARD_GRID_MM} 0 L 0 0 0 ${BOARD_GRID_MM}`}
                  fill="none"
                  stroke="rgba(11,122,109,0.10)"
                  strokeWidth={0.06}
                />
              </pattern>
              <linearGradient id="pcb-substrate" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#0f4035" />
                <stop offset="100%" stopColor="#0a2b25" />
              </linearGradient>
            </defs>

            {/* board substrate */}
            <rect
              x={0}
              y={0}
              width={board.width}
              height={board.height}
              fill="url(#pcb-substrate)"
              stroke="#1d6b58"
              strokeWidth={0.3}
              rx={1}
            />
            <rect x={0} y={0} width={board.width} height={board.height} fill="url(#pcb-grid)" />

            {/* board outline dimension marks */}
            <text x={board.width / 2} y={-1} fill="#4b6a62" fontSize={2} textAnchor="middle" fontFamily="monospace">
              {board.width.toFixed(2)} mm
            </text>
            {/* The height, read bottom-to-top the way a drawing dimensions it. */}
            <text
              x={-1}
              y={board.height / 2}
              fill="#4b6a62"
              fontSize={2}
              textAnchor="middle"
              fontFamily="monospace"
              transform={`rotate(-90 ${-1} ${board.height / 2})`}
            >
              {board.height.toFixed(2)} mm
            </text>

            {/* ratsnest */}
            {showRatsnest
              ? unroutedNets.map((net) => {
                  const pads = net.padIds
                    .map((id) => padLookup.get(id))
                    .filter((p): p is NonNullable<typeof p> => p !== undefined);
                  const lines: React.ReactNode[] = [];
                  for (let i = 0; i + 1 < pads.length; i++) {
                    const a = pads[i];
                    const b = pads[i + 1];
                    if (!a || !b) continue;
                    lines.push(
                      <line
                        key={`${net.net}-${i}`}
                        x1={a.pos.x}
                        y1={a.pos.y}
                        x2={b.pos.x}
                        y2={b.pos.y}
                        stroke="#43b9ff"
                        strokeWidth={0.12}
                        strokeDasharray="0.6 0.5"
                        opacity={0.55}
                      />,
                    );
                  }
                  return <g key={net.net}>{lines}</g>;
                })
              : null}

            {/* traces */}
            {board.traces.map((trace) => {
              const d = trace.points
                .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(3)} ${p.y.toFixed(3)}`)
                .join(' ');
              const isSelected = selection.kind === 'trace' && selection.id === trace.id;
              const isFlagged = flaggedTraces.has(trace.id);
              return (
                <g key={trace.id}>
                  {/* fat invisible hit area */}
                  <path
                    d={d}
                    stroke="transparent"
                    strokeWidth={Math.max(trace.width * 3, 1.2)}
                    fill="none"
                    strokeLinecap="round"
                    style={{ cursor: 'pointer' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (tool === 'route') return;
                      select({ kind: 'trace', id: trace.id });
                    }}
                  />
                  <path
                    d={d}
                    stroke={
                      isFlagged ? '#f87171' : isSelected ? '#2fe0cf' : trace.layer === 'top' ? '#c88b45' : '#7a6ad1'
                    }
                    strokeWidth={trace.width}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={trace.layer === 'top' ? 1 : 0.72}
                  />
                  {isSelected ? (
                    <path
                      d={d}
                      stroke="#2fe0cf"
                      strokeWidth={trace.width + 0.4}
                      fill="none"
                      opacity={0.3}
                      strokeLinecap="round"
                    />
                  ) : null}
                </g>
              );
            })}

            {/* route preview */}
            {routeStart ? (
              <g>
                <path
                  d={[routeStart.point, ...waypoints, cursor ?? routeStart.point]
                    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(3)} ${p.y.toFixed(3)}`)
                    .join(' ')}
                  stroke="#fbbf24"
                  strokeWidth={0.4}
                  fill="none"
                  strokeDasharray="0.8 0.4"
                  strokeLinecap="round"
                />
                {waypoints.map((w, i) => (
                  <circle key={i} cx={w.x} cy={w.y} r={0.3} fill="#fbbf24" />
                ))}
                <circle cx={routeStart.point.x} cy={routeStart.point.y} r={0.7} fill="none" stroke="#fbbf24" strokeWidth={0.15} />
              </g>
            ) : null}

            {/* footprints */}
            {board.footprints.map((fp) => {
              const isSelected = selection.kind === 'footprint' && selection.id === fp.id;
              const isHighlighted = highlightSet.has(fp.componentId);
              const swap = fp.rotation === 90 || fp.rotation === 270;
              const w = swap ? fp.courtyard.h : fp.courtyard.w;
              const h = swap ? fp.courtyard.w : fp.courtyard.h;
              return (
                <g key={fp.id}>
                  {/* courtyard */}
                  <rect
                    x={fp.x - w / 2}
                    y={fp.y - h / 2}
                    width={w}
                    height={h}
                    fill={isSelected ? 'rgba(11,122,109,0.1)' : 'rgba(233,231,224,0.045)'}
                    stroke={isHighlighted ? '#fbbf24' : isSelected ? '#2fe0cf' : 'rgba(233,231,224,0.35)'}
                    strokeWidth={0.12}
                    strokeDasharray={isSelected || isHighlighted ? undefined : '0.5 0.4'}
                    rx={0.4}
                    style={{ cursor: tool === 'route' ? 'crosshair' : 'move' }}
                    onPointerDown={(e) => {
                      if (tool === 'route') return;
                      e.stopPropagation();
                      const point = toBoard(e);
                      if (!point) return;
                      setDragging({ id: fp.id, dx: point.x - fp.x, dy: point.y - fp.y });
                      select({ kind: 'footprint', id: fp.id });
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (tool !== 'route') select({ kind: 'footprint', id: fp.id });
                    }}
                  />

                  {/* silkscreen reference */}
                  <text
                    x={fp.x}
                    y={fp.y - h / 2 - 0.6}
                    fill={isHighlighted ? '#fbbf24' : '#cfdbe8'}
                    fontSize={1.6}
                    textAnchor="middle"
                    fontFamily="monospace"
                    style={{ pointerEvents: 'none' }}
                  >
                    {fp.ref}
                  </text>

                  {/* pads */}
                  {fp.pads.map((pad) => {
                    const pos = padPosition(fp, pad);
                    const flagged = flaggedPads.has(pad.id);
                    const common = {
                      style: { cursor: tool === 'route' ? 'crosshair' : 'pointer' },
                      onClick: (e: React.MouseEvent) => {
                        if (tool !== 'route') {
                          e.stopPropagation();
                          select({ kind: 'footprint', id: fp.id });
                        }
                        // In route mode the click falls through to the canvas
                        // handler, which does the pad hit test.
                      },
                    };
                    return (
                      <g key={pad.id}>
                        {pad.shape === 'square' ? (
                          <rect
                            x={pos.x - pad.size / 2}
                            y={pos.y - pad.size / 2}
                            width={pad.size}
                            height={pad.size}
                            fill={flagged ? '#f87171' : PAD_SQUARE_COLOR}
                            stroke="#8a6a2a"
                            strokeWidth={0.08}
                            rx={0.15}
                            {...common}
                          />
                        ) : (
                          <circle
                            cx={pos.x}
                            cy={pos.y}
                            r={pad.size / 2}
                            fill={flagged ? '#f87171' : PAD_COLOR}
                            stroke="#8a6a2a"
                            strokeWidth={0.08}
                            {...common}
                          />
                        )}
                        {/* drill hole */}
                        <circle
                          cx={pos.x}
                          cy={pos.y}
                          r={pad.size / 2 - 0.45}
                          fill="#0a2b25"
                          style={{ pointerEvents: 'none' }}
                        />
                        {/* net label */}
                        <text
                          x={pos.x}
                          y={pos.y + pad.size / 2 + 1.3}
                          fill="#6f8f86"
                          fontSize={1.05}
                          textAnchor="middle"
                          fontFamily="monospace"
                          style={{ pointerEvents: 'none' }}
                        >
                          {pad.net ?? '?'}
                        </text>
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </svg>
        )}
      </div>

    </div>
  );
}

export function PcbDownloadButton() {
  const board = useLabStore((s) => s.board);
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => {
        const blob = new Blob([JSON.stringify(board, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'boardmaster-board.json';
        a.click();
        URL.revokeObjectURL(url);
      }}
    >
      <Download size={12} aria-hidden />
      Export board
    </Button>
  );
}
