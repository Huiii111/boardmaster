'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import { SafeText } from './SafeText';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';

import {
  BOARD_DEPTH,
  BOARD_HEIGHT,
  BOARD_TOP,
  BOARD_WIDTH,
  COLS,
  PITCH,
  ROWS,
  allHoles,
  holePosition,
  nearestHole,
} from '@/lib/circuit/breadboard';
import type { HoleId, RowId } from '@/lib/circuit/types';

/**
 * Interactive 3D breadboard.
 *
 * Hole picking strategy: a single invisible pick plane covers the board surface
 * and we convert the ray hit point to the nearest hole arithmetically. This is
 * far more reliable (and much cheaper) than giving ~390 hole meshes their own
 * pointer handlers, and it means a click near a hole still lands on it.
 */

export interface BreadboardProps {
  onHoleHover: (hole: { row: RowId; col: number; id: HoleId } | null) => void;
  onHoleClick: (hole: { row: RowId; col: number; id: HoleId }, event: ThreeEvent<MouseEvent>) => void;
  /** Hole currently under the pointer, highlighted with a ring. */
  hoveredHole: HoleId | null;
  /** Holes to emphasise, e.g. the anchor of a wire being drawn. */
  markedHoles?: HoleId[];
  /** Holes belonging to the net under the cursor. */
  netHoles?: HoleId[];
}

const BOARD_COLOR = '#e9e7e0';
const BOARD_EDGE = '#c4c0b5';

/** Half-width of the centre channel in z, matching the A-E / F-J row gap. */
const CHANNEL_HALF = 0.1;
/** Height of the recessed channel floor, i.e. how deep the groove is. */
const CHANNEL_FLOOR = 0.062;

export function Breadboard({
  onHoleHover,
  onHoleClick,
  hoveredHole,
  markedHoles = [],
  netHoles = [],
}: BreadboardProps) {
  const holes = useMemo(() => allHoles(), []);
  const lastHover = useRef<HoleId | null>(null);

  /* ---------- hole sockets, drawn as one instanced mesh ---------- */
  const socketMatrices = useMemo(() => {
    const m = new THREE.Object3D();
    const list: THREE.Matrix4[] = [];
    for (const h of holes) {
      const [x, , z] = holePosition(h.row, h.col);
      m.position.set(x, BOARD_TOP - 0.004, z);
      m.rotation.set(0, 0, 0);
      m.scale.set(1, 1, 1);
      m.updateMatrix();
      list.push(m.matrix.clone());
    }
    return list;
  }, [holes]);

  const socketRef = useRef<THREE.InstancedMesh>(null);
  // Must run after the ref is attached: during render `socketRef.current` is
  // still null, which would leave every hole stacked at the origin.
  useLayoutEffect(() => {
    const mesh = socketRef.current;
    if (!mesh) return;
    socketMatrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
    mesh.count = socketMatrices.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [socketMatrices]);

  /* ---------- pointer handling on the pick plane ---------- */
  const handleMove = (event: ThreeEvent<PointerEvent>): void => {
    // `event.point` is in world space; the board sits at the origin unrotated.
    const hit = nearestHole(event.point.x, event.point.z);
    const id = hit ? hit.id : null;
    if (id !== lastHover.current) {
      lastHover.current = id;
      onHoleHover(hit);
    }
  };

  const handleLeave = (): void => {
    lastHover.current = null;
    onHoleHover(null);
  };

  const handleClick = (event: ThreeEvent<MouseEvent>): void => {
    const hit = nearestHole(event.point.x, event.point.z);
    if (!hit) return;
    event.stopPropagation();
    onHoleClick(hit, event);
  };

  const hoveredPos = hoveredHole ? holeWorld(hoveredHole) : null;

  return (
    <group>
      {/* --- board body ---
          Built as a recessed base plate plus two raised bank blocks, rather
          than one solid slab. That gives the DIP channel real geometry, so the
          electrical isolation between the A-E and F-J banks (which the netlist
          enforces) is something the student can actually see. */}
      <mesh position={[0, CHANNEL_FLOOR / 2, 0]} receiveShadow castShadow>
        <boxGeometry args={[BOARD_WIDTH, CHANNEL_FLOOR, BOARD_DEPTH]} />
        <meshStandardMaterial color={BOARD_EDGE} roughness={0.85} metalness={0.02} />
      </mesh>

      {[
        { z: (-BOARD_DEPTH / 2 + -CHANNEL_HALF) / 2, depth: BOARD_DEPTH / 2 - CHANNEL_HALF },
        { z: (BOARD_DEPTH / 2 + CHANNEL_HALF) / 2, depth: BOARD_DEPTH / 2 - CHANNEL_HALF },
      ].map((bank) => (
        <mesh key={bank.z} position={[0, BOARD_HEIGHT / 2, bank.z]} receiveShadow castShadow>
          <boxGeometry args={[BOARD_WIDTH, BOARD_HEIGHT, bank.depth]} />
          <meshStandardMaterial color={BOARD_COLOR} roughness={0.72} metalness={0.04} />
        </mesh>
      ))}

      {/* --- grooves separating the rails from the main banks --- */}
      {[-0.72, 0.72].map((z) => (
        <mesh key={z} position={[0, BOARD_TOP + 0.0008, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[BOARD_WIDTH - 0.02, 0.014]} />
          <meshBasicMaterial color="#b8b3a7" toneMapped={false} />
        </mesh>
      ))}

      {/* --- rail polarity stripes ---
          Nothing may sit above BOARD_TOP across the board footprint or it will
          hide these; an earlier full-footprint "bevel" box did exactly that. */}
      {ROWS.filter((r) => r.kind === 'rail').map((rail) => (
        <mesh
          key={rail.id}
          position={[0, BOARD_TOP + 0.0008, rail.stripeZ ?? rail.z]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[BOARD_WIDTH - 0.08, 0.016]} />
          <meshBasicMaterial color={rail.polarity === '+' ? '#d8232a' : '#2b4fd0'} toneMapped={false} />
        </mesh>
      ))}

      {/* --- holes --- */}
      <instancedMesh
        ref={socketRef}
        args={[undefined, undefined, holes.length]}
        frustumCulled={false}
      >
        <cylinderGeometry args={[0.019, 0.021, 0.03, 8]} />
        <meshStandardMaterial color="#2a2a2c" roughness={0.45} metalness={0.5} />
      </instancedMesh>

      {/* --- column numbers, every 5 columns --- */}
      {Array.from({ length: COLS }, (_, i) => i + 1)
        .filter((c) => c % 5 === 0 || c === 1)
        .map((col) => {
          const [x] = holePosition('A', col);
          return (
            <group key={`cn-${col}`}>
              <SafeText
                position={[x, BOARD_TOP + 0.002, -0.72]}
                rotation={[-Math.PI / 2, 0, 0]}
                fontSize={0.045}
                color="#8d8a82"
                anchorX="center"
                anchorY="middle"
              >
                {String(col)}
              </SafeText>
              <SafeText
                position={[x, BOARD_TOP + 0.002, 0.72]}
                rotation={[-Math.PI / 2, 0, 0]}
                fontSize={0.045}
                color="#8d8a82"
                anchorX="center"
                anchorY="middle"
              >
                {String(col)}
              </SafeText>
            </group>
          );
        })}

      {/* --- row letters, both sides --- */}
      {ROWS.filter((r) => r.kind === 'main').map((row) => (
        <group key={`rl-${row.id}`}>
          <SafeText
            position={[-BOARD_WIDTH / 2 + 0.045, BOARD_TOP + 0.002, row.z]}
            rotation={[-Math.PI / 2, 0, 0]}
            fontSize={0.042}
            color="#8d8a82"
            anchorX="center"
            anchorY="middle"
          >
            {row.id}
          </SafeText>
          <SafeText
            position={[BOARD_WIDTH / 2 - 0.045, BOARD_TOP + 0.002, row.z]}
            rotation={[-Math.PI / 2, 0, 0]}
            fontSize={0.042}
            color="#8d8a82"
            anchorX="center"
            anchorY="middle"
          >
            {row.id}
          </SafeText>
        </group>
      ))}

      {/* --- net highlight: holes on the same strip as the hover --- */}
      {netHoles.map((id) => {
        const p = holeWorld(id);
        if (!p) return null;
        return (
          <mesh key={`net-${id}`} position={[p[0], BOARD_TOP + 0.001, p[2]]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.032, 16]} />
            <meshBasicMaterial color="#2fe0cf" transparent opacity={0.22} />
          </mesh>
        );
      })}

      {/* --- marked holes (wire anchor) --- */}
      {markedHoles.map((id) => {
        const p = holeWorld(id);
        if (!p) return null;
        return (
          <mesh key={`mark-${id}`} position={[p[0], BOARD_TOP + 0.002, p[2]]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.028, 0.044, 20]} />
            <meshBasicMaterial color="#fbbf24" transparent opacity={0.95} />
          </mesh>
        );
      })}

      {/* --- hover ring --- */}
      {hoveredPos ? (
        <mesh
          position={[hoveredPos[0], BOARD_TOP + 0.003, hoveredPos[2]]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[0.026, 0.04, 20]} />
          <meshBasicMaterial color="#43b9ff" transparent opacity={0.95} />
        </mesh>
      ) : null}

      {/* --- invisible pick plane: the single source of pointer truth --- */}
      <mesh
        position={[0, BOARD_TOP + 0.0005, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerMove={handleMove}
        onPointerOut={handleLeave}
        onClick={handleClick}
      >
        <planeGeometry args={[BOARD_WIDTH, BOARD_DEPTH]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    </group>
  );
}

/** World position of a hole id, or null when the id is not a valid hole. */
export function holeWorld(id: HoleId): [number, number, number] | null {
  const m = /^([A-Z]{1,2})(\d{1,2})$/.exec(id);
  if (!m) return null;
  const row = m[1] as RowId;
  const col = Number(m[2]);
  const spec = ROWS.find((r) => r.id === row);
  if (!spec) return null;
  return [(col - (COLS + 1) / 2) * PITCH, BOARD_TOP, spec.z];
}
