'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Battery,
  BatteryCharging,
  BatteryFull,
  Cable,
  CircleDot,
  CircuitBoard,
  Cpu,
  Gauge,
  Cylinder,
  Lightbulb,
  MousePointer2,
  Package,
  Palette,
  RotateCw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Sun,
  ToggleLeft,
  Trash2,
  Triangle,
  Volume2,
  Waves,
  Wifi,
  Zap,
} from 'lucide-react';

import { COMPONENT_DEFS, LIBRARY_ORDER, type ComponentDef } from '@/lib/circuit/componentDefs';
import { WIRE_COLORS, WIRE_KINDS, type ComponentKind } from '@/lib/circuit/types';
import { formatAmps, formatFarads, formatOhms, formatSI, formatVolts } from '@/lib/format';
import { Badge, Button, EmptyState, Input, Kbd, Panel, cx } from '@/components/ui/primitives';
import { useLabStore } from '@/store/useLabStore';
import { usePartThumbnail } from '@/components/three/thumbnailStore';
import { beginLivePreview, endLivePreview } from '@/components/three/livePreview';

const ICONS: Record<ComponentKind, React.ReactNode> = {
  arduino_uno: <Cpu size={16} aria-hidden />,
  esp32: <Wifi size={16} aria-hidden />,
  dc_source: <Zap size={16} aria-hidden />,
  battery: <BatteryCharging size={16} aria-hidden />,
  battery_pack: <BatteryFull size={16} aria-hidden />,
  multimeter: <Gauge size={16} aria-hidden />,
  resistor: <Cylinder size={16} aria-hidden />,
  potentiometer: <SlidersHorizontal size={16} aria-hidden />,
  photoresistor: <Sun size={16} aria-hidden />,
  capacitor: <Battery size={16} aria-hidden />,
  inductor: <Waves size={16} aria-hidden />,
  led: <Lightbulb size={16} aria-hidden />,
  rgb_led: <Palette size={16} aria-hidden />,
  diode: <Triangle size={16} aria-hidden />,
  switch: <ToggleLeft size={16} aria-hidden />,
  pushbutton: <CircleDot size={16} aria-hidden />,
  fuse: <ShieldAlert size={16} aria-hidden />,
  buzzer: <Volume2 size={16} aria-hidden />,
  breadboard: <CircuitBoard size={16} aria-hidden />,
};

const CATEGORY_ORDER: Array<ComponentDef['category']> = [
  'Controller',
  'Source',
  'Instrument',
  'Passive',
  'Semiconductor',
  'Switch',
  'Output',
  'Protection',
  'Infrastructure',
];

function defaultValueText(def: ComponentDef): string {
  if (def.unit === 'Ω') return formatOhms(def.defaultValue);
  if (def.unit === 'F') return formatFarads(def.defaultValue);
  if (def.unit === 'V') return formatVolts(def.defaultValue);
  if (def.unit === 'H') return formatSI(def.defaultValue, 'H');
  if (def.unit === 'A') return formatAmps(def.defaultValue);
  return '—';
}

/**
 * The catalogue entry's picture: the actual 3D model, rendered once by
 * `ThumbnailForge`. Falls back to a glyph while the render is still in flight,
 * or if WebGL is unavailable.
 */
function PartPreview({ kind, armed }: { kind: ComponentKind; armed: boolean }) {
  const thumb = usePartThumbnail(kind);
  const liveRef = useRef<HTMLCanvasElement>(null);
  const [live, setLive] = useState(false);

  // On hover the tile shows a live, rotating render of the real 3D model.
  // It does not own a WebGL context: a single shared renderer draws the part
  // and blits the result into this plain 2D canvas, so all nineteen tiles cost
  // one context between them rather than nineteen.
  const enter = useCallback(() => {
    const canvas = liveRef.current;
    if (!canvas) return;
    beginLivePreview(kind, canvas);
    setLive(true);
  }, [kind]);

  const leave = useCallback(() => {
    endLivePreview(kind);
    setLive(false);
    const ctx = liveRef.current?.getContext('2d');
    if (ctx && liveRef.current) ctx.clearRect(0, 0, liveRef.current.width, liveRef.current.height);
  }, [kind]);

  useEffect(() => leave, [leave]);

  return (
    <div
      onPointerEnter={enter}
      onPointerLeave={leave}
      className={cx(
        'relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-md border transition-colors',
        armed
          ? 'border-[var(--accent-cyan)] text-[var(--accent-cyan)]'
          : 'border-[var(--border-default)] text-[var(--text-tertiary)] group-hover:border-[var(--border-strong)] group-hover:text-[var(--accent-cyan)]',
      )}
      style={{
        // A soft overhead pool of light, the way parts are shot for a catalogue.
        // On the light theme this is a white-to-inset wash; the old version was
        // a near-black vignette tuned to make pale parts pop against charcoal.
        background: armed
          ? 'radial-gradient(circle at 50% 32%, rgba(11,122,109,0.18), rgba(11,122,109,0.06) 70%)'
          : 'radial-gradient(circle at 50% 30%, #ffffff, var(--surface-inset) 74%)',
      }}
    >
      {thumb ? (
        <img
          src={thumb}
          alt=""
          width={48}
          height={48}
          className={cx('h-11 w-11 object-contain transition-opacity', live && 'opacity-0')}
          draggable={false}
        />
      ) : (
        ICONS[kind]
      )}
      <canvas
        ref={liveRef}
        width={96}
        height={96}
        aria-hidden
        className={cx(
          'pointer-events-none absolute inset-0 h-11 w-11 transition-opacity',
          live ? 'opacity-100' : 'opacity-0',
        )}
      />
    </div>
  );
}

export function LeftSidebar() {
  const search = useLabStore((s) => s.librarySearch);
  const setSearch = useLabStore((s) => s.setLibrarySearch);
  const tool = useLabStore((s) => s.tool);
  const setTool = useLabStore((s) => s.setTool);
  const placingKind = useLabStore((s) => s.placingKind);
  const armPlacement = useLabStore((s) => s.armPlacement);
  const placingRotation = useLabStore((s) => s.placingRotation);
  const rotatePlacement = useLabStore((s) => s.rotatePlacement);
  const placeBenchComponent = useLabStore((s) => s.placeBenchComponent);
  const design = useLabStore((s) => s.design);
  const loadStarterCircuit = useLabStore((s) => s.loadStarterCircuit);
  const loadFaultyCircuit = useLabStore((s) => s.loadFaultyCircuit);
  const resetBench = useLabStore((s) => s.resetBench);
  const wireKind = useLabStore((s) => s.wireKind);
  const setWireKind = useLabStore((s) => s.setWireKind);
  const wireColor = useLabStore((s) => s.wireColor);
  const setWireColor = useLabStore((s) => s.setWireColor);

  const [activeCategory, setActiveCategory] = useState<ComponentDef['category'] | 'All'>('All');

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    return LIBRARY_ORDER.map((k) => COMPONENT_DEFS[k]).filter((def) => {
      if (activeCategory !== 'All' && def.category !== activeCategory) return false;
      if (q.length === 0) return true;
      return (
        def.name.toLowerCase().includes(q) ||
        def.searchTerms.some((t) => t.includes(q)) ||
        def.category.toLowerCase().includes(q)
      );
    });
  }, [search, activeCategory]);

  const counts = useMemo(() => {
    const map = new Map<ComponentKind, number>();
    for (const c of design.components) map.set(c.kind, (map.get(c.kind) ?? 0) + 1);
    return map;
  }, [design.components]);

  const handlePick = (def: ComponentDef): void => {
    if (def.kind === 'breadboard') {
      useLabStore.getState().pushToast('info', 'The half-size breadboard is already on the bench.');
      return;
    }
    if (!def.seatable) {
      // Bench instruments drop straight onto the bench in front of the board.
      placeBenchComponent(def.kind, [0, 0, 1.75]);
      return;
    }
    armPlacement(placingKind === def.kind ? null : def.kind);
  };

  return (
    <aside className="flex w-[268px] shrink-0 flex-col gap-2.5 overflow-y-auto border-r border-[var(--border-default)] bg-[var(--surface-base)] p-2.5 scroll-lab">
      {/* ------------------------------ tools ------------------------------ */}
      <Panel title="Tools" icon={<MousePointer2 size={12} aria-hidden />}>
        <div className="grid grid-cols-3 gap-1.5">
          <Button
            size="sm"
            variant="subtle"
            active={tool === 'select'}
            onClick={() => setTool('select')}
            title="Select and drag parts (V)"
          >
            <MousePointer2 size={12} aria-hidden />
            Select
          </Button>
          <Button
            size="sm"
            variant="subtle"
            active={tool === 'wire'}
            onClick={() => setTool('wire')}
            title="Draw jumper wires: click one hole or terminal, then another (W)"
          >
            <Cable size={12} aria-hidden />
            Wire
          </Button>
          <Button
            size="sm"
            variant="subtle"
            active={tool === 'delete'}
            onClick={() => setTool('delete')}
            title="Click a part or wire to delete it (X)"
          >
            <Trash2 size={12} aria-hidden />
            Delete
          </Button>
        </div>

        {tool === 'wire' ? (
          <p className="mt-2 rounded-sm border border-[rgba(150,88,10,0.25)] bg-[rgba(150,88,10,0.08)] px-2 py-1.5 text-[10px] leading-snug text-[var(--signal-warn)]">
            Wire mode: click a breadboard hole or a supply terminal to start, then click the other end.
            Press <Kbd>Esc</Kbd> to cancel.
          </p>
        ) : null}
        {tool === 'delete' ? (
          <p className="mt-2 rounded-sm border border-[rgba(202,43,43,0.25)] bg-[rgba(202,43,43,0.08)] px-2 py-1.5 text-[10px] leading-snug text-[var(--signal-error)]">
            Delete mode: clicking a component or jumper removes it. Switch back to Select when done.
          </p>
        ) : null}
        {tool === 'place' && placingKind ? (
          <div className="mt-2 flex items-center justify-between gap-2 rounded-sm border border-[rgba(11,122,109,0.25)] bg-[rgba(11,122,109,0.08)] px-2 py-1.5">
            <p className="text-[10px] leading-snug text-[var(--accent-cyan)]">
              Placing <strong>{COMPONENT_DEFS[placingKind].name}</strong> — click a hole.
            </p>
            <Button size="sm" variant="ghost" onClick={rotatePlacement} title="Rotate before placing (R)">
              <RotateCw size={11} aria-hidden />
              {placingRotation}°
            </Button>
          </div>
        ) : null}
      </Panel>

      {/* ---------------------------- component library ---------------------------- */}
      <Panel
        title="Component Library"
        icon={<Package size={12} aria-hidden />}
        subtitle={`${results.length} of ${LIBRARY_ORDER.length} parts`}
      >
        <div className="relative">
          <Search
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-disabled)]"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search parts…"
            aria-label="Search component library"
            className="pl-8"
          />
        </div>

        {/* categories */}
        {/* Ten filters do not fit 240px. One scrolling row keeps the parts
            list above the fold; the right-edge fade is the only cue that
            there is more, so it is not decorative. */}
        <div
          className="-mx-0.5 mt-2 flex gap-1 overflow-x-auto px-0.5 pb-1.5 scroll-lab [mask-image:linear-gradient(to_right,#000_0,#000_calc(100%-20px),transparent_100%)]"
          role="group"
          aria-label="Filter parts by category"
        >
          {(['All', ...CATEGORY_ORDER] as const).map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCategory(cat)}
              aria-pressed={activeCategory === cat}
              className={cx(
                'shrink-0 whitespace-nowrap rounded-full border px-2 py-[3px] text-[10px] font-medium transition-colors duration-150',
                activeCategory === cat
                  ? 'border-[rgba(11,122,109,0.4)] bg-[rgba(11,122,109,0.12)] text-[var(--accent-cyan)]'
                  : 'border-[var(--border-default)] text-[var(--text-tertiary)] hover:border-[var(--border-strong)] hover:text-[var(--text-secondary)]',
              )}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* parts */}
        <div className="-mx-0.5 mt-1.5 max-h-[clamp(260px,46vh,560px)] space-y-1 overflow-y-auto px-0.5 scroll-lab">
          {results.length === 0 ? (
            <EmptyState
              icon={<Search size={22} aria-hidden />}
              title="No matching parts"
              body={`Nothing in the library matches "${search}". Try "led", "resistor" or "power".`}
              action={
                <Button size="sm" variant="ghost" onClick={() => setSearch('')}>
                  Clear search
                </Button>
              }
            />
          ) : (
            results.map((def) => {
              const armed = placingKind === def.kind;
              const count = counts.get(def.kind) ?? 0;
              return (
                <button
                  key={def.kind}
                  type="button"
                  onClick={() => handlePick(def)}
                  aria-pressed={armed}
                  className={cx(
                    'group w-full rounded-md border p-1.5 text-left transition-all duration-150 ease-[var(--ease-lab)]',
                    armed
                      ? 'border-[var(--accent-cyan)] bg-[rgba(11,122,109,0.1)] shadow-glow'
                      : 'border-[var(--border-subtle)] bg-[var(--surface-raised)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]',
                  )}
                >
                  <div className="flex items-start gap-2">
                    <PartPreview kind={def.kind} armed={armed} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-medium text-[var(--text-primary)]">
                          {def.name}
                        </span>
                        {count > 0 ? (
                          <Badge tone="neutral" mono title={`${count} placed`}>
                            ×{count}
                          </Badge>
                        ) : null}
                      </div>
                      {/* One line with the full text on hover: two clamped
                          lines broke mid-word across most of the catalogue and
                          still said less than the badges underneath. */}
                      <p className="note mt-px truncate" title={def.blurb}>
                        {def.blurb}
                      </p>
                      <div className="mt-1 flex items-center gap-1.5">
                        <Badge tone="neutral">{def.category}</Badge>
                        {def.unit !== '' ? (
                          <Badge tone="accent" mono>
                            {defaultValueText(def)}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </Panel>

      {/* ------------------------------- cables ------------------------------- */}
      <Panel
        title="Cables"
        icon={<Cable size={12} aria-hidden />}
        subtitle="Style and colour of the next lead"
      >
        <div className="space-y-1.5">
          {WIRE_KINDS.map((k) => (
            <button
              key={k.kind}
              type="button"
              onClick={() => {
                setWireKind(k.kind);
                setTool('wire');
              }}
              aria-pressed={wireKind === k.kind}
              className={cx(
                'w-full rounded-md border p-2 text-left transition-all duration-150',
                wireKind === k.kind
                  ? 'border-[var(--accent-cyan)] bg-[rgba(11,122,109,0.1)]'
                  : 'border-[var(--border-subtle)] bg-[var(--surface-raised)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]',
              )}
            >
              <div className="flex items-center gap-2">
                {/* a little profile sketch of how this lead routes */}
                <svg width="30" height="14" viewBox="0 0 30 14" aria-hidden className="shrink-0">
                  <path
                    d={
                      k.arc === 0
                        ? 'M3 12 L3 4 L27 4 L27 12'
                        : `M3 12 Q15 ${12 - 9 * k.arc} 27 12`
                    }
                    fill="none"
                    stroke={wireColor}
                    strokeWidth={k.radius * 110}
                    strokeLinecap="round"
                  />
                </svg>
                <span
                  className={cx(
                    'text-[11px] font-medium',
                    wireKind === k.kind ? 'text-[var(--accent-cyan)]' : 'text-[var(--text-primary)]',
                  )}
                >
                  {k.name}
                </span>
              </div>
              <p className="note mt-0.5">{k.blurb}</p>
            </button>
          ))}
        </div>

        <div className="mt-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
            Colour
          </div>
          <div className="flex flex-wrap gap-1.5">
            {WIRE_COLORS.map((c) => (
              <button
                key={c.hex}
                type="button"
                onClick={() => setWireColor(c.hex)}
                title={c.name}
                aria-label={c.name}
                aria-pressed={wireColor === c.hex}
                className={cx(
                  'h-6 w-6 rounded-full border-2 transition-all',
                  wireColor === c.hex
                    ? 'border-[var(--accent-cyan)] scale-110'
                    : 'border-[var(--border-strong)] hover:border-[var(--text-tertiary)]',
                )}
                style={{ backgroundColor: c.hex }}
              />
            ))}
          </div>
        </div>

        <p className="note mt-2">
          All four styles are <strong>ideal conductors</strong> in the analyser, so the choice is
          cosmetic. Red for supply and black for ground is still worth the habit.
        </p>
      </Panel>

      {/* ---------------------------- demo shortcuts ---------------------------- */}
      <Panel title="Quick start" icon={<Sparkles size={12} aria-hidden />}>
        <div className="space-y-1.5">
          <Button size="sm" variant="outline" className="w-full justify-start" onClick={loadStarterCircuit}>
            <CircuitBoard size={12} aria-hidden />
            Load reference circuit
          </Button>
          <Button size="sm" variant="outline" className="w-full justify-start" onClick={loadFaultyCircuit}>
            <Lightbulb size={12} aria-hidden />
            Load circuit with a fault
          </Button>
          <Button size="sm" variant="ghost" className="w-full justify-start" onClick={resetBench}>
            <Trash2 size={12} aria-hidden />
            Clear the bench
          </Button>
        </div>
        <p className="note mt-2">
          Loading a circuit does not validate it — run the simulation to find out whether it works.
        </p>
      </Panel>
    </aside>
  );
}
