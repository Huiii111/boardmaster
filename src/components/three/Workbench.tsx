'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { ContactShadows, Grid, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

import { BOARD_TOP, stripOfHole, allHoles } from '@/lib/circuit/breadboard';
import { defOf } from '@/lib/circuit/componentDefs';
import { resolvePins } from '@/lib/circuit/graph';
import { isMcu, readMultimeter } from '@/lib/circuit/solve';
import { McuBoardMesh, mcuPinOffset } from './McuBoard';
import { StudioEnvironment } from './StudioEnvironment';
import type { BoardId } from '@/lib/mcu/board';
import type { Endpoint, HoleId, PlacedComponent, RowId } from '@/lib/circuit/types';
import { useLabStore } from '@/store/useLabStore';
import { Breadboard, holeWorld } from './Breadboard';
import { Jumper, JumperPreview } from './Jumper';
import {
  BuzzerMesh,
  CapacitorMesh,
  DiodeMesh,
  FuseMesh,
  InductorMesh,
  LedMesh,
  PSU_TERMINAL_OFFSET,
  PhotoresistorMesh,
  PowerSupplyMesh,
  ResistorMesh,
} from './Parts';
import {
  BATTERY_TERMINAL_OFFSET,
  BatteryPackMesh,
  DMM_PROBE_OFFSET,
  MultimeterMesh,
} from './BenchInstruments';
import {
  BatteryMesh,
  PotentiometerMesh,
  PushButtonMesh,
  RgbLedMesh,
  SwitchMesh,
} from './PartsExtra';

/**
 * The 3D electronics workbench.
 *
 * Interaction model, chosen for reliability over spectacle:
 *  - Orbit/zoom/pan via OrbitControls, disabled while dragging a part.
 *  - Placement: arm a part in the library, then click a breadboard hole.
 *  - Move: press and drag a seated part; it snaps to the nearest valid hole.
 *  - Wire: in Wire mode click a hole or a supply terminal, then a second one.
 *  - Rotate: R on the selected part. Delete: Delete/Backspace.
 */

export interface WorkbenchHandle {
  resetCamera: () => void;
}

/* ------------------------- camera reset plumbing ------------------------- */

/**
 * Default framing. The bench spans roughly 3.4 x 3.1 units once the supply,
 * battery pack and multimeter stand in front of the 3.2 x 2.2 board, so the
 * camera sits far enough back to hold all of it with margin.
 */
// Pulled in from [0, 3.5, 5.25]: at that distance a 5 mm LED was about ten
// pixels across, so whether it was lit simply could not be seen.
const DEFAULT_CAMERA: [number, number, number] = [0, 2.75, 4.3];
// Biased forward in z so the bench instruments standing in front of the board
// are inside the frame, not just the board itself.
const DEFAULT_TARGET: [number, number, number] = [0, 0.05, 0.45];

function CameraRig({ resetToken }: { resetToken: number }) {
  const controls = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const { camera } = useThree();

  useEffect(() => {
    if (resetToken === 0) return;
    camera.position.set(...DEFAULT_CAMERA);
    const c = controls.current;
    if (c) {
      c.target.set(...DEFAULT_TARGET);
      c.update();
    }
  }, [resetToken, camera]);

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={DEFAULT_TARGET}
      enableDamping
      dampingFactor={0.08}
      minDistance={0.8}
      maxDistance={9}
      maxPolarAngle={Math.PI / 2.08}
      minPolarAngle={0.12}
      mouseButtons={{
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      }}
    />
  );
}

/* ----------------------------- scene contents ----------------------------- */

function SceneContents({ resetToken }: { resetToken: number }) {
  const design = useLabStore((s) => s.design);
  const report = useLabStore((s) => s.report);
  const tool = useLabStore((s) => s.tool);
  const placingKind = useLabStore((s) => s.placingKind);
  const placingRotation = useLabStore((s) => s.placingRotation);
  const selection = useLabStore((s) => s.selection);
  const hoveredHole = useLabStore((s) => s.hoveredHole);
  const wireAnchor = useLabStore((s) => s.wireAnchor);
  const highlighted = useLabStore((s) => s.highlighted);

  const placeComponent = useLabStore((s) => s.placeComponent);
  const moveComponent = useLabStore((s) => s.moveComponent);
  const select = useLabStore((s) => s.select);
  const setHoveredHole = useLabStore((s) => s.setHoveredHole);
  const beginWire = useLabStore((s) => s.beginWire);
  const completeWire = useLabStore((s) => s.completeWire);
  const deleteWire = useLabStore((s) => s.deleteWire);
  const deleteComponent = useLabStore((s) => s.deleteComponent);
  const moveBenchComponent = useLabStore((s) => s.moveBenchComponent);

  const { controls } = useThree() as unknown as { controls: { enabled: boolean } | null };

  /** Component currently being dragged, with its grab offset. */
  const [dragging, setDragging] = useState<{ id: string; kind: 'seat' | 'bench' } | null>(null);
  const [pointerWorld, setPointerWorld] = useState<[number, number, number] | null>(null);

  // Disable orbiting while a drag is in progress so the camera does not fight
  // the pointer.
  useEffect(() => {
    if (!controls) return;
    controls.enabled = dragging === null;
    return () => {
      controls.enabled = true;
    };
  }, [controls, dragging]);

  useEffect(() => {
    const end = (): void => setDragging(null);
    window.addEventListener('pointerup', end);
    return () => window.removeEventListener('pointerup', end);
  }, []);

  const measurementOf = useCallback(
    (id: string) => report?.analysis.measurements.find((m) => m.componentId === id) ?? null,
    [report],
  );

  /* ---------- hole interactions ---------- */
  const handleHoleHover = useCallback(
    (hole: { row: RowId; col: number; id: HoleId } | null) => {
      setHoveredHole(hole ? hole.id : null);
      if (hole && dragging?.kind === 'seat') {
        // Live-preview the drag target.
        setPointerWorld(holeWorld(hole.id));
      }
    },
    [setHoveredHole, dragging],
  );

  const handleHoleClick = useCallback(
    (hole: { row: RowId; col: number; id: HoleId }) => {
      if (tool === 'place' && placingKind) {
        placeComponent(placingKind, hole.row, hole.col);
        return;
      }
      if (tool === 'wire') {
        const endpoint: Endpoint = { kind: 'hole', hole: hole.id };
        if (wireAnchor) completeWire(endpoint);
        else beginWire(endpoint);
        return;
      }
      if (dragging?.kind === 'seat') {
        moveComponent(dragging.id, hole.row, hole.col);
        setDragging(null);
        return;
      }
      select({ kind: null, id: null });
    },
    [tool, placingKind, placeComponent, wireAnchor, completeWire, beginWire, dragging, moveComponent, select],
  );

  /* ---------- drag commit on pointer-up over a hole ---------- */
  useEffect(() => {
    if (!dragging || dragging.kind !== 'seat') return;
    const commit = (): void => {
      const hole = useLabStore.getState().hoveredHole;
      if (hole) {
        const parsed = /^([A-Z]{1,2})(\d{1,2})$/.exec(hole);
        if (parsed) {
          moveComponent(dragging.id, parsed[1] as RowId, Number(parsed[2]));
        }
      }
      setDragging(null);
      setPointerWorld(null);
    };
    window.addEventListener('pointerup', commit, { once: true });
    return () => window.removeEventListener('pointerup', commit);
  }, [dragging, moveComponent]);

  /* ---------- endpoint resolution for wires ---------- */
  const endpointWorld = useCallback(
    (e: Endpoint): [number, number, number] | null => {
      if (e.kind === 'hole') return holeWorld(e.hole);
      const comp = design.components.find((c) => c.id === e.componentId);
      if (!comp) return null;
      if (comp.kind === 'dc_source') {
        const base = comp.benchPos ?? [0, 0, 1.75];
        const offset = e.pinId === 'pos' ? PSU_TERMINAL_OFFSET.pos : PSU_TERMINAL_OFFSET.neg;
        return [base[0] + offset[0], base[1] + offset[1] + 0.05, base[2] + offset[2]];
      }
      if (comp.kind === 'battery_pack') {
        const base = comp.benchPos ?? [-1.32, 0, 1.62];
        const offset =
          e.pinId === 'pos' ? BATTERY_TERMINAL_OFFSET.pos : BATTERY_TERMINAL_OFFSET.neg;
        return [base[0] + offset[0], base[1] + offset[1], base[2] + offset[2]];
      }
      if (isMcu(comp.kind)) {
        const base = comp.benchPos ?? [0, 0, 2.0];
        const offset = mcuPinOffset(comp.kind as BoardId, e.pinId);
        if (!offset) return null;
        return [base[0] + offset[0], base[1] + offset[1], base[2] + offset[2]];
      }
      if (comp.kind === 'multimeter') {
        const base = comp.benchPos ?? [1.42, 0, 1.55];
        const offset = e.pinId === 'red' ? DMM_PROBE_OFFSET.red : DMM_PROBE_OFFSET.black;
        return [base[0] + offset[0], base[1] + offset[1], base[2] + offset[2]];
      }
      const pin = resolvePins(comp).find((p) => p.pinId === e.pinId);
      return pin?.hole ? holeWorld(pin.hole) : null;
    },
    [design.components],
  );

  /* ---------- net highlight under the cursor ---------- */
  const netHoles = useMemo(() => {
    if (!hoveredHole) return [];
    const strip = stripOfHole(hoveredHole);
    if (!strip) return [];
    return allHoles()
      .filter((h) => stripOfHole(h.id) === strip)
      .map((h) => h.id);
  }, [hoveredHole]);

  /* ---------- ghost preview of the part being placed ---------- */
  const ghost = useMemo(() => {
    if (tool !== 'place' || !placingKind || !hoveredHole) return null;
    const def = defOf(placingKind);
    if (!def.seatable) return null;
    const parsed = /^([A-Z]{1,2})(\d{1,2})$/.exec(hoveredHole);
    if (!parsed) return null;
    const probe: PlacedComponent = {
      id: '__ghost',
      kind: placingKind,
      label: '',
      rotation: placingRotation,
      value: def.defaultValue,
      seat: { row: parsed[1] as RowId, col: Number(parsed[2]) },
    };
    const pins = resolvePins(probe);
    if (pins.some((p) => p.offBoard)) return { valid: false, positions: [] };
    return {
      valid: true,
      positions: pins.map((p) => (p.hole ? holeWorld(p.hole) : null)).filter((p): p is [number, number, number] => p !== null),
    };
  }, [tool, placingKind, hoveredHole, placingRotation]);

  const highlightSet = useMemo(() => new Set(highlighted), [highlighted]);

  return (
    <>
      {/* ---------------- lighting ---------------- */}
      <ambientLight intensity={0.55} />
      <directionalLight
        position={[3.2, 5.4, 2.6]}
        intensity={1.45}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-3}
        shadow-camera-right={3}
        shadow-camera-top={3}
        shadow-camera-bottom={-3}
      />
      <directionalLight position={[-3, 2.4, -2.2]} intensity={0.42} color="#7ab8ff" />
      {/* A procedural studio environment: what makes tinned leads, gold pins
          and epoxy LED domes read as those materials rather than as plastic.
          Generated in code, so no HDR is downloaded at runtime. */}
      <StudioEnvironment intensity={0.9} />
      <hemisphereLight args={['#dceaff', '#d7dee7', 0.5]} />
      <directionalLight position={[0, 1.6, 4]} intensity={0.3} color="#ffffff" />

      {/* ---------------- bench surface ---------------- */}
      <Grid
        position={[0, -0.002, 0]}
        args={[26, 26]}
        cellSize={0.25}
        cellThickness={0.5}
        cellColor="#b9c6d4"
        sectionSize={1}
        sectionThickness={1}
        sectionColor="#8aa7b5"
        fadeDistance={16}
        fadeStrength={1.4}
        infiniteGrid
        followCamera={false}
      />
      {/* Tightened and softened for the light bench: at scale 10 and 50%
          black this painted a grey slab a third of the viewport wide, which
          was invisible against charcoal but obvious against white. */}
      <ContactShadows
        position={[0, 0.001, 0]}
        opacity={0.16}
        scale={13}
        blur={3.6}
        far={1.5}
        resolution={1024}
        color="#223344"
      />

      {/* click-away target to clear the selection */}
      <mesh
        position={[0, -0.004, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        onClick={() => {
          if (useLabStore.getState().wireAnchor) useLabStore.getState().cancelWire();
          else select({ kind: null, id: null });
        }}
      >
        <planeGeometry args={[40, 40]} />
        <meshBasicMaterial visible={false} />
      </mesh>

      {/* ---------------- breadboard ---------------- */}
      <Breadboard
        onHoleHover={handleHoleHover}
        onHoleClick={handleHoleClick}
        hoveredHole={hoveredHole}
        markedHoles={wireAnchor?.kind === 'hole' ? [wireAnchor.hole] : []}
        netHoles={netHoles}
      />

      {/* ---------------- placement ghost ---------------- */}
      {ghost
        ? ghost.valid
          ? ghost.positions.map((p, i) => (
              <mesh key={i} position={[p[0], BOARD_TOP + 0.05, p[2]]}>
                <sphereGeometry args={[0.03, 12, 10]} />
                <meshBasicMaterial color="#2fe0cf" transparent opacity={0.55} />
              </mesh>
            ))
          : hoveredHole
            ? (() => {
                const p = holeWorld(hoveredHole);
                return p ? (
                  <mesh position={[p[0], BOARD_TOP + 0.05, p[2]]}>
                    <sphereGeometry args={[0.035, 12, 10]} />
                    <meshBasicMaterial color="#f87171" transparent opacity={0.7} />
                  </mesh>
                ) : null;
              })()
            : null
        : null}

      {/* ---------------- jumper wires ---------------- */}
      {design.wires.map((wire) => {
        const a = endpointWorld(wire.a);
        const b = endpointWorld(wire.b);
        if (!a || !b) return null;
        return (
          <Jumper
            key={wire.id}
            from={a}
            to={b}
            color={wire.color}
            kind={wire.kind}
            selected={selection.kind === 'wire' && selection.id === wire.id}
            highlighted={highlightSet.has(wire.id)}
            onClick={() => {
              if (tool === 'delete') deleteWire(wire.id);
              else select({ kind: 'wire', id: wire.id });
            }}
            onPointerOver={() => {
              document.body.style.cursor = tool === 'delete' ? 'not-allowed' : 'pointer';
            }}
            onPointerOut={() => {
              document.body.style.cursor = 'auto';
            }}
          />
        );
      })}

      {/* ---------------- wire being drawn ---------------- */}
      {wireAnchor
        ? (() => {
            const a = endpointWorld(wireAnchor);
            const b = pointerWorld ?? (hoveredHole ? holeWorld(hoveredHole) : null);
            if (!a || !b) return null;
            return <JumperPreview from={a} to={b} />;
          })()
        : null}

      {/* ---------------- components ---------------- */}
      {design.components.map((comp) => {
        const isSelected = selection.kind === 'component' && selection.id === comp.id;
        const isHighlighted = highlightSet.has(comp.id);
        const m = measurementOf(comp.id);

        const onPick = (e: ThreeEvent<MouseEvent>): void => {
          e.stopPropagation();
          if (tool === 'delete') {
            deleteComponent(comp.id);
            return;
          }
          select({ kind: 'component', id: comp.id });
        };

        if (isMcu(comp.kind)) {
          const pos = comp.benchPos ?? [0, 0, 2.0];
          return (
            <McuBoardMesh
              key={comp.id}
              boardId={comp.kind as BoardId}
              position={pos}
              pins={comp.mcuPins ?? {}}
              selected={isSelected}
              highlighted={isHighlighted}
              label={comp.label}
              armedPin={
                wireAnchor?.kind === 'pin' && wireAnchor.componentId === comp.id
                  ? wireAnchor.pinId
                  : null
              }
              onPinClick={(pinId, e) => {
                e.stopPropagation();
                if (tool === 'delete') return;
                const endpoint: Endpoint = { kind: 'pin', componentId: comp.id, pinId };
                if (wireAnchor) completeWire(endpoint);
                else beginWire(endpoint);
              }}
              onBodyClick={(e) => {
                e.stopPropagation();
                if (tool === 'delete') deleteComponent(comp.id);
                else select({ kind: 'component', id: comp.id });
              }}
              onBodyPointerDown={() => {
                if (tool === 'select') {
                  setDragging({ id: comp.id, kind: 'bench' });
                  select({ kind: 'component', id: comp.id });
                }
              }}
            />
          );
        }

        if (comp.kind === 'battery_pack') {
          const pos = comp.benchPos ?? [-1.32, 0, 1.62];
          return (
            <BatteryPackMesh
              key={comp.id}
              position={pos}
              volts={comp.value}
              current={report?.analysis.supplyCurrentA ?? 0}
              selected={isSelected}
              highlighted={isHighlighted}
              label={comp.label}
              armedPin={
                wireAnchor?.kind === 'pin' && wireAnchor.componentId === comp.id
                  ? wireAnchor.pinId
                  : null
              }
              onTerminalClick={(pinId, e) => {
                e.stopPropagation();
                if (tool === 'delete') return;
                const endpoint: Endpoint = { kind: 'pin', componentId: comp.id, pinId };
                if (wireAnchor) completeWire(endpoint);
                else beginWire(endpoint);
              }}
              onBodyClick={(e) => {
                e.stopPropagation();
                if (tool === 'delete') deleteComponent(comp.id);
                else select({ kind: 'component', id: comp.id });
              }}
              onBodyPointerDown={() => {
                if (tool === 'select') {
                  setDragging({ id: comp.id, kind: 'bench' });
                  select({ kind: 'component', id: comp.id });
                }
              }}
            />
          );
        }

      if (comp.kind === 'multimeter') {
          const pos = comp.benchPos ?? [1.42, 0, 1.55];
          const meter = report
            ? readMultimeter(report.analysis, comp.id)
            : { display: '- - -', caption: 'NOT ANALYSED', volts: null, live: false };
          return (
            <MultimeterMesh
              key={comp.id}
              position={pos}
              reading={meter.display}
              caption={meter.caption}
              mode="voltage"
              live={meter.live}
              selected={isSelected}
              highlighted={isHighlighted}
              label={comp.label}
              armedPin={
                wireAnchor?.kind === 'pin' && wireAnchor.componentId === comp.id
                  ? wireAnchor.pinId
                  : null
              }
              onProbeClick={(pinId, e) => {
                e.stopPropagation();
                if (tool === 'delete') return;
                const endpoint: Endpoint = { kind: 'pin', componentId: comp.id, pinId };
                if (wireAnchor) completeWire(endpoint);
                else beginWire(endpoint);
              }}
              onBodyClick={(e) => {
                e.stopPropagation();
                if (tool === 'delete') deleteComponent(comp.id);
                else select({ kind: 'component', id: comp.id });
              }}
              onBodyPointerDown={() => {
                if (tool === 'select') {
                  setDragging({ id: comp.id, kind: 'bench' });
                  select({ kind: 'component', id: comp.id });
                }
              }}
            />
          );
        }

        if (comp.kind === 'dc_source') {
          const pos = comp.benchPos ?? [0, 0, 1.75];
          return (
            <PowerSupplyMesh
              key={comp.id}
              position={pos}
              volts={comp.value}
              current={report?.analysis.supplyCurrentA ?? 0}
              selected={isSelected}
              highlighted={isHighlighted}
              label={comp.label}
              armedPin={
                wireAnchor?.kind === 'pin' && wireAnchor.componentId === comp.id ? wireAnchor.pinId : null
              }
              onTerminalClick={(pinId, e) => {
                e.stopPropagation();
                if (tool === 'delete') return;
                const endpoint: Endpoint = { kind: 'pin', componentId: comp.id, pinId };
                if (wireAnchor) completeWire(endpoint);
                else beginWire(endpoint);
              }}
              onBodyClick={(e) => {
                e.stopPropagation();
                if (tool === 'delete') deleteComponent(comp.id);
                else select({ kind: 'component', id: comp.id });
              }}
              onBodyPointerDown={() => {
                if (tool === 'select') {
                  setDragging({ id: comp.id, kind: 'bench' });
                  select({ kind: 'component', id: comp.id });
                }
              }}
            />
          );
        }

        const pins = resolvePins(comp);
        const positions = pins.map((p) => (p.hole ? holeWorld(p.hole) : null));
        const p0 = positions[0];
        const p1 = positions[1];
        if (!p0 || !p1) return null;
        const xz0: [number, number] = [p0[0], p0[2]];
        const xz1: [number, number] = [p1[0], p1[2]];

        const wrap = (node: React.ReactNode) => (
          <group
            key={comp.id}
            onClick={onPick}
            onPointerDown={(e) => {
              if (tool !== 'select') return;
              e.stopPropagation();
              setDragging({ id: comp.id, kind: 'seat' });
              select({ kind: 'component', id: comp.id });
            }}
            onPointerOver={(e) => {
              e.stopPropagation();
              document.body.style.cursor = tool === 'delete' ? 'not-allowed' : 'grab';
            }}
            onPointerOut={() => {
              document.body.style.cursor = 'auto';
            }}
          >
            {node}
          </group>
        );

        if (comp.kind === 'led') {
          return wrap(
            <LedMesh
              anode={xz0}
              cathode={xz1}
              brightness={m?.brightness ?? 0}
              lit={m?.lit ?? false}
              selected={isSelected}
              highlighted={isHighlighted}
              label={comp.label}
              reverseBiased={m?.reverseBiased ?? false}
            />,
          );
        }
        if (comp.kind === 'resistor') {
          return wrap(
            <ResistorMesh
              a={xz0}
              b={xz1}
              ohms={comp.value}
              selected={isSelected}
              highlighted={isHighlighted}
              label={comp.label}
              current={m?.currentA ?? 0}
            />,
          );
        }
        if (comp.kind === 'capacitor') {
          return wrap(
            <CapacitorMesh
              plus={xz0}
              minus={xz1}
              selected={isSelected}
              highlighted={isHighlighted}
              label={comp.label}
            />,
          );
        }

        const common = {
          a: xz0,
          b: xz1,
          selected: isSelected,
          highlighted: isHighlighted,
          label: comp.label,
        };

        if (comp.kind === 'diode') {
          return wrap(
            <DiodeMesh
              {...common}
              reverseBiased={m?.reverseBiased ?? false}
              conducting={Math.abs(m?.currentA ?? 0) > 0}
            />,
          );
        }
        if (comp.kind === 'inductor') return wrap(<InductorMesh {...common} />);
        if (comp.kind === 'fuse') return wrap(<FuseMesh {...common} blown={comp.blown === true} />);
        if (comp.kind === 'photoresistor') {
          return wrap(<PhotoresistorMesh {...common} illumination={comp.illumination ?? 0} />);
        }
        if (comp.kind === 'buzzer') {
          return wrap(<BuzzerMesh {...common} sounding={(m?.currentA ?? 0) > 0.001} />);
        }
        if (comp.kind === 'switch') {
          return wrap(<SwitchMesh {...common} closed={comp.closed === true} />);
        }
        if (comp.kind === 'pushbutton') {
          return wrap(<PushButtonMesh {...common} pressed={comp.closed === true} />);
        }
        if (comp.kind === 'battery') return wrap(<BatteryMesh {...common} />);

        if (comp.kind === 'potentiometer') {
          const all = positions.filter((q): q is [number, number, number] => q !== null);
          if (all.length < 3) return null;
          return wrap(
            <PotentiometerMesh
              pins={all.map((q) => [q[0], q[2]] as [number, number])}
              wiper={comp.wiper ?? 0.5}
              selected={isSelected}
              highlighted={isHighlighted}
              label={comp.label}
            />,
          );
        }

        if (comp.kind === 'rgb_led') {
          const all = positions.filter((q): q is [number, number, number] => q !== null);
          if (all.length < 4) return null;
          return wrap(
            <RgbLedMesh
              pins={all.map((q) => [q[0], q[2]] as [number, number])}
              channels={m?.litChannels ?? []}
              brightness={m?.brightness ?? 0}
              selected={isSelected}
              highlighted={isHighlighted}
              label={comp.label}
            />,
          );
        }

        return null;
      })}

      {/* bench drag plane for free-standing instruments */}
      {dragging?.kind === 'bench' ? (
        <mesh
          position={[0, 0.0005, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          onPointerMove={(e) => {
            e.stopPropagation();
            moveBenchComponent(dragging.id, [e.point.x, 0, e.point.z]);
          }}
        >
          <planeGeometry args={[40, 40]} />
          <meshBasicMaterial visible={false} />
        </mesh>
      ) : null}

      <CameraRig resetToken={resetToken} />
    </>
  );
}

/* --------------------------------- canvas --------------------------------- */

export function Workbench({ resetToken }: { resetToken: number }) {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      camera={{ position: DEFAULT_CAMERA, fov: 38, near: 0.05, far: 60 }}
      onCreated={({ gl, scene }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.08;
        // A light bench, kept a few steps darker than the white breadboard so
        // the board still reads as an object rather than merging with the
        // floor. ACES compresses the top end, so this is authored brighter
        // than the intended result. Fog matches, so the horizon has no band.
        scene.background = new THREE.Color('#eef2f7');
        scene.fog = new THREE.Fog('#eef2f7', 11, 26);
      }}
      onPointerMissed={() => {
        const state = useLabStore.getState();
        if (state.wireAnchor) state.cancelWire();
        else state.select({ kind: null, id: null });
      }}
    >
      <SceneContents resetToken={resetToken} />
    </Canvas>
  );
}
