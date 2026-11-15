'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

import { BOARD_TOP } from '@/lib/circuit/breadboard';
import { WIRE_KINDS, type WireKind } from '@/lib/circuit/types';

/**
 * Patch leads.
 *
 * Four physical styles, matching what is on a real bench. They differ only in
 * how they look and route — electrically all four are ideal conductors, and the
 * UI says so, so a student never thinks the cable choice changed their result.
 *
 *  - **Dupont**: stranded flexible lead, arcs over the board.
 *  - **Solid core**: stiff wire bent into right angles, lying flat.
 *  - **Alligator**: flexible lead with crocodile clips on each end.
 *  - **Banana**: thick silicone lead with 4 mm plugs, for the bench supply.
 */

const kindDef = (kind: WireKind | undefined) =>
  WIRE_KINDS.find((k) => k.kind === (kind ?? 'dupont')) ?? WIRE_KINDS[0]!;

export function Jumper({
  from,
  to,
  color,
  kind,
  selected,
  highlighted,
  onClick,
  onPointerOver,
  onPointerOut,
}: {
  from: [number, number, number];
  to: [number, number, number];
  color: string;
  kind?: WireKind;
  selected: boolean;
  highlighted: boolean;
  onClick?: (event: { stopPropagation: () => void }) => void;
  onPointerOver?: () => void;
  onPointerOut?: () => void;
}) {
  const spec = kindDef(kind);

  const { curve, endA, endB } = useMemo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const span = a.distanceTo(b);

    // Solid-core wire is bent, not draped: it rises just clear of the board,
    // runs a flat right-angled path, then drops into the far hole.
    if (spec.arc === 0) {
      const ride = BOARD_TOP + 0.055;
      const points = [
        a,
        new THREE.Vector3(a.x, ride, a.z),
        new THREE.Vector3(b.x, ride, a.z),
        new THREE.Vector3(b.x, ride, b.z),
        b,
      ];
      return {
        curve: new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.02),
        endA: a,
        endB: b,
      };
    }

    const lift = Math.min(0.42, 0.075 + span * 0.2) * spec.arc;
    const mid1 = a.clone().lerp(b, 0.28);
    const mid2 = a.clone().lerp(b, 0.72);
    mid1.y += lift;
    mid2.y += lift;
    const lift0 = a.clone();
    lift0.y += 0.035;
    const lift3 = b.clone();
    lift3.y += 0.035;

    return {
      curve: new THREE.CatmullRomCurve3([a, lift0, mid1, mid2, lift3, b], false, 'catmullrom', 0.4),
      endA: a,
      endB: b,
    };
  }, [from, to, spec.arc]);

  const radius = spec.radius * (selected ? 1.25 : 1);
  const emissive = selected ? '#2fe0cf' : highlighted ? '#fbbf24' : '#000000';

  return (
    <group>
      <mesh
        onClick={
          onClick
            ? (e) => {
                e.stopPropagation();
                onClick(e);
              }
            : undefined
        }
        onPointerOver={
          onPointerOver
            ? (e) => {
                e.stopPropagation();
                onPointerOver();
              }
            : undefined
        }
        onPointerOut={onPointerOut}
        castShadow
      >
        <tubeGeometry args={[curve, spec.arc === 0 ? 64 : 48, radius, 10, false]} />
        <meshStandardMaterial
          color={color}
          roughness={spec.kind === 'banana' ? 0.6 : 0.42}
          metalness={0.08}
          emissive={new THREE.Color(emissive)}
          emissiveIntensity={selected || highlighted ? 0.55 : 0}
        />
      </mesh>

      {[endA, endB].map((p, i) => (
        <CableEnd key={i} at={p} kind={spec.kind} color={color} />
      ))}
    </group>
  );
}

/** The terminated end of a lead: pin, clip or plug depending on the style. */
function CableEnd({
  at,
  kind,
  color,
}: {
  at: THREE.Vector3;
  kind: WireKind;
  color: string;
}) {
  if (kind === 'alligator') {
    return (
      <group position={[at.x, at.y + 0.03, at.z]}>
        {/* two sprung jaws */}
        {[-1, 1].map((s) => (
          <mesh key={s} position={[0, 0.02, s * 0.012]} rotation={[s * 0.25, 0, 0]}>
            <boxGeometry args={[0.022, 0.07, 0.01]} />
            <meshStandardMaterial color="#aeb3ba" metalness={0.9} roughness={0.3} />
          </mesh>
        ))}
        <mesh position={[0, 0.062, 0]}>
          <cylinderGeometry args={[0.019, 0.019, 0.035, 12]} />
          <meshStandardMaterial color={color} roughness={0.5} />
        </mesh>
      </group>
    );
  }

  if (kind === 'banana') {
    return (
      <group position={[at.x, at.y + 0.02, at.z]}>
        <mesh>
          <cylinderGeometry args={[0.013, 0.013, 0.07, 12]} />
          <meshStandardMaterial color="#d6b24a" metalness={0.92} roughness={0.25} />
        </mesh>
        <mesh position={[0, 0.062, 0]}>
          <cylinderGeometry args={[0.026, 0.026, 0.06, 14]} />
          <meshStandardMaterial color={color} roughness={0.55} />
        </mesh>
      </group>
    );
  }

  if (kind === 'solid') {
    // Bare tinned wire going straight into the hole — no housing.
    return (
      <mesh position={[at.x, at.y + 0.012, at.z]}>
        <cylinderGeometry args={[0.009, 0.009, 0.034, 8]} />
        <meshStandardMaterial color="#b9bcc2" metalness={0.88} roughness={0.28} />
      </mesh>
    );
  }

  // Dupont: a moulded plastic housing over a tinned pin.
  return (
    <group position={[at.x, at.y, at.z]}>
      <mesh position={[0, 0.012, 0]}>
        <cylinderGeometry args={[0.011, 0.011, 0.03, 8]} />
        <meshStandardMaterial color="#b9bcc2" metalness={0.85} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.048, 0]}>
        <boxGeometry args={[0.034, 0.05, 0.034]} />
        <meshStandardMaterial color={color} roughness={0.52} />
      </mesh>
    </group>
  );
}

/** A dashed preview line shown while the student is drawing a wire. */
export function JumperPreview({
  from,
  to,
}: {
  from: [number, number, number];
  to: [number, number, number];
}) {
  // Built once per endpoint change and disposed on unmount, rather than
  // allocating a new Line object on every frame the pointer moves.
  const line = useMemo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const mid = a.clone().lerp(b, 0.5);
    mid.y += Math.min(0.4, 0.08 + a.distanceTo(b) * 0.2);
    const points = new THREE.QuadraticBezierCurve3(a, mid, b).getPoints(24);
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineDashedMaterial({
      color: '#fbbf24',
      dashSize: 0.045,
      gapSize: 0.03,
    });
    const l = new THREE.Line(geometry, material);
    l.computeLineDistances();
    return l;
  }, [from, to]);

  useEffect(
    () => () => {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    },
    [line],
  );

  return <primitive object={line} />;
}
