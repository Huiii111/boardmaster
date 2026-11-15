'use client';

import { useMemo } from 'react';
import { SafeText } from './SafeText';
import * as THREE from 'three';

import { BOARD_TOP } from '@/lib/circuit/breadboard';
import { resistorBands } from '@/lib/format';

/**
 * Realistic through-hole component geometry.
 *
 * These are physical part shapes, not schematic symbols: a student should be
 * able to recognise the part on a real bench from the same visual cues (LED
 * dome and flat cathode flange, resistor colour bands, electrolytic stripe).
 */

/**
 * A soft radial falloff, used as an additive sprite so a lit LED actually
 * glows.
 *
 * The emissive materials alone did not read as light: ACES tone mapping
 * compresses the highlight, and with no bloom pass the dome simply desaturated
 * towards white. A student who ran their sketch saw the LED go *paler*, which
 * is not what "it lit up" looks like. A camera-facing additive sprite gives the
 * halo that sells it, costs one draw call, and needs no post-processing stack.
 */
let glowTexture: THREE.Texture | null = null;
function getGlowTexture(): THREE.Texture | null {
  if (glowTexture) return glowTexture;
  if (typeof document === 'undefined') return null;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.22, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.14)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  glowTexture = new THREE.CanvasTexture(canvas);
  return glowTexture;
}

/** The halo around an emitting part. `strength` is 0..1. */
export function EmissiveGlow({
  position,
  color,
  strength,
  radius,
}: {
  position: [number, number, number];
  /** Accepts a hex string or a THREE.Color, since RGB LEDs mix theirs. */
  color: THREE.ColorRepresentation;
  strength: number;
  radius: number;
}) {
  const map = useMemo(() => getGlowTexture(), []);
  if (!map || strength <= 0) return null;
  const scale = radius * (2.4 + strength * 2.6);
  return (
    <sprite position={position} scale={[scale, scale, scale]}>
      <spriteMaterial
        map={map}
        color={color}
        transparent
        // Normal blending, not additive. Additive light on a white bench just
        // saturates towards white and vanishes; this keeps the halo coloured
        // against both a light and a dark ground.
        opacity={Math.min(1, 0.25 + strength * 0.7)}
        depthWrite={false}
        toneMapped={false}
      />
    </sprite>
  );
}

const LEAD_COLOR = '#b9bcc2';
const LEAD_RADIUS = 0.009;

const UP = new THREE.Vector3(0, 1, 0);

/**
 * A tinned component lead: one straight run from inside the breadboard hole up
 * to where it enters the component body.
 *
 * Earlier this drew a vertical stub plus a horizontal bar at the top, which
 * read as an ugly square-cornered "U" floating above the board. Real leads are
 * splayed straight from the hole to the body, so a single tilted cylinder is
 * both simpler and far more convincing.
 */
export function Lead({
  from,
  to,
}: {
  /** Breadboard hole the lead is plugged into, in world x/z. */
  from: [number, number];
  /** Point on the component body the lead enters, in world x/y/z. */
  to: [number, number, number];
}) {
  const { position, quaternion, length } = useMemo(() => {
    // Start slightly below the surface so the lead visibly enters the hole.
    const start = new THREE.Vector3(from[0], BOARD_TOP - 0.025, from[1]);
    const end = new THREE.Vector3(to[0], to[1], to[2]);
    const dir = new THREE.Vector3().subVectors(end, start);
    const len = Math.max(dir.length(), 1e-4);
    const mid = start.clone().addScaledVector(dir, 0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
    return { position: mid, quaternion: q, length: len };
  }, [from, to]);

  return (
    <mesh position={position} quaternion={quaternion} castShadow>
      <cylinderGeometry args={[LEAD_RADIUS, LEAD_RADIUS, length, 10]} />
      <meshStandardMaterial color={LEAD_COLOR} metalness={0.9} roughness={0.22} />
    </mesh>
  );
}

/* --------------------------------- LED --------------------------------- */

export interface LedMeshProps {
  /** World x/z of the anode and cathode leads. */
  anode: [number, number];
  cathode: [number, number];
  /** 0 = dark, 1 = full rated brightness. */
  brightness: number;
  lit: boolean;
  selected: boolean;
  highlighted: boolean;
  label: string;
  reverseBiased: boolean;
}

export function LedMesh({
  anode,
  cathode,
  brightness,
  lit,
  selected,
  highlighted,
  label,
  reverseBiased,
}: LedMeshProps) {
  const cx = (anode[0] + cathode[0]) / 2;
  const cz = (anode[1] + cathode[1]) / 2;
  const angle = Math.atan2(cathode[1] - anode[1], cathode[0] - anode[0]);

  const R = 0.052; // epoxy barrel radius (a 5 mm LED at this board scale)
  const barrelH = 0.1;
  const legH = 0.125;
  const baseY = BOARD_TOP + legH;
  const flangeH = 0.016;

  /*
   * How hard the part is being driven, 0..1, used for every lit cue at once
   * so that running the sketch is unmistakable and a PWM change is obvious.
   *
   * The previous version only nudged an emissive value, which on a light bench
   * made a lit LED look like a slightly paler unlit one -- the single most
   * important state in the whole lab was the least visible thing on screen.
   */
  const drive = lit ? Math.min(1, Math.max(0.12, brightness)) : 0;
  const emissive = lit ? 0.6 + drive * 5.5 : 0;
  // Off is a dull, dark maroon; on climbs to a vivid scarlet.
  const bodyColor = lit ? (drive > 0.6 ? '#ff6a4a' : '#f4402c') : '#8e201a';
  const axis = { x: Math.cos(angle), z: Math.sin(angle) };

  return (
    <group>
      {/* Leads splay straight from their holes into the base of the body.
          The anode lead is the longer one, as on a real part. */}
      <Lead
        from={anode}
        to={[cx - axis.x * 0.026, baseY - 0.012, cz - axis.z * 0.026]}
      />
      <Lead
        from={cathode}
        to={[cx + axis.x * 0.026, baseY - 0.012, cz + axis.z * 0.026]}
      />

      <group position={[cx, baseY, cz]} rotation={[0, -angle, 0]}>
        {/* base flange, with the moulded flat on the cathode side */}
        <mesh position={[0, flangeH / 2, 0]} castShadow>
          <cylinderGeometry args={[R + 0.011, R + 0.011, flangeH, 28]} />
          <meshStandardMaterial
            color={bodyColor}
            roughness={0.28}
            transparent
            opacity={0.92}
            emissive={new THREE.Color('#ff3b2f')}
            emissiveIntensity={emissive * 0.15}
          />
        </mesh>
        {/* the flat itself: a chord sliced off the cathode side */}
        <mesh position={[0.052, flangeH / 2, 0]}>
          <boxGeometry args={[0.022, flangeH + 0.001, (R + 0.011) * 1.55]} />
          <meshStandardMaterial color={lit ? '#e03a2c' : '#8f1712'} roughness={0.55} />
        </mesh>

        {/* epoxy barrel */}
        <mesh position={[0, flangeH + barrelH / 2, 0]} castShadow>
          <cylinderGeometry args={[R, R, barrelH, 28]} />
          <meshStandardMaterial
            color={bodyColor}
            roughness={0.1}
            metalness={0.02}
            transparent
            opacity={0.72}
            emissive={new THREE.Color('#ff3b2f')}
            emissiveIntensity={emissive * 0.45}
          />
        </mesh>

        {/* dome */}
        <mesh position={[0, flangeH + barrelH, 0]} castShadow>
          <sphereGeometry args={[R, 28, 18, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial
            color={bodyColor}
            roughness={0.06}
            metalness={0.02}
            transparent
            opacity={0.7}
            emissive={new THREE.Color('#ff5042')}
            emissiveIntensity={emissive * 0.55}
          />
        </mesh>

        {/* internals: the reflector cup on the cathode side and the anode post,
            which is what you actually see inside a real 5 mm LED */}
        <mesh position={[0.016, flangeH + 0.03, 0]}>
          <cylinderGeometry args={[0.019, 0.01, 0.034, 14, 1, true]} />
          <meshStandardMaterial
            color="#8d9099"
            metalness={0.95}
            roughness={0.25}
            side={THREE.DoubleSide}
          />
        </mesh>
        <mesh position={[-0.016, flangeH + 0.022, 0]}>
          <boxGeometry args={[0.012, 0.05, 0.012]} />
          <meshStandardMaterial color="#8d9099" metalness={0.95} roughness={0.25} />
        </mesh>

        {/* the die, sitting in the cup */}
        <mesh position={[0.016, flangeH + 0.042, 0]}>
          <boxGeometry args={[0.016, 0.008, 0.016]} />
          <meshStandardMaterial
            color={lit ? '#fff4f0' : '#6d1d18'}
            emissive={new THREE.Color('#ff7a68')}
            emissiveIntensity={emissive}
            toneMapped={false}
          />
        </mesh>

        {/* Three cues, because no single one survives both themes: a halo, a
            real light that pools colour on the white board, and the emissive
            body above. All three scale with `drive`, so dimming is legible. */}
        {lit ? (
          <>
            <EmissiveGlow
              position={[0.016, flangeH + 0.052, 0]}
              color="#ff7a55"
              strength={drive}
              radius={R * (2.2 + drive * 2.4)}
            />
            <pointLight
              position={[0, flangeH + barrelH * 0.7, 0]}
              color="#ff4a2e"
              intensity={1.2 + drive * 9}
              distance={0.9 + drive * 1.5}
              decay={2}
            />
          </>
        ) : null}

        {/* bond wire from the anode post across to the die */}
        <mesh position={[0, flangeH + 0.048, 0]} rotation={[0, 0, Math.PI / 2.6]}>
          <cylinderGeometry args={[0.0022, 0.0022, 0.038, 6]} />
          <meshStandardMaterial color="#d9c37a" metalness={0.95} roughness={0.3} />
        </mesh>

        {/* a warm glow volume inside the epoxy when conducting */}
        {lit ? (
          <mesh position={[0.012, flangeH + 0.05, 0]}>
            <sphereGeometry args={[0.032, 16, 12]} />
            <meshBasicMaterial
              color="#ff6a52"
              transparent
              opacity={0.18 + brightness * 0.4}
              toneMapped={false}
            />
          </mesh>
        ) : null}

        {/* light spill onto the board */}
        {lit ? (
          <pointLight
            position={[0, 0.1, 0]}
            color="#ff5a46"
            intensity={0.35 + brightness * 1.6}
            distance={1.1}
            decay={2}
          />
        ) : null}

        {/* polarity labels, always legible from above */}
        <SafeText
          position={[-0.085, -0.075, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          fontSize={0.038}
          color="#2fe0cf"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.004}
          outlineColor="#11161d"
        >
          A
        </SafeText>
        <SafeText
          position={[0.085, -0.075, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          fontSize={0.038}
          color="#a6b6c8"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.004}
          outlineColor="#11161d"
        >
          K
        </SafeText>
      </group>

      <PartLabel x={cx} z={cz - 0.14} text={label} tone={reverseBiased ? 'error' : lit ? 'ok' : 'idle'} />
      <SelectionRing x={cx} z={cz} radius={0.13} selected={selected} highlighted={highlighted} />
    </group>
  );
}

/* ------------------------------- Resistor ------------------------------- */

export function ResistorMesh({
  a,
  b,
  ohms,
  selected,
  highlighted,
  label,
  current,
}: {
  a: [number, number];
  b: [number, number];
  ohms: number;
  selected: boolean;
  highlighted: boolean;
  label: string;
  current: number;
}) {
  const cx = (a[0] + b[0]) / 2;
  const cz = (a[1] + b[1]) / 2;
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const bodyLen = Math.max(0.16, span * 0.55);
  const legH = 0.085;
  const bands = useMemo(() => resistorBands(ohms), [ohms]);

  return (
    <group>
      <Lead
        from={a}
        to={[cx - (bodyLen / 2) * Math.cos(angle), BOARD_TOP + legH, cz - (bodyLen / 2) * Math.sin(angle)]}
      />
      <Lead
        from={b}
        to={[cx + (bodyLen / 2) * Math.cos(angle), BOARD_TOP + legH, cz + (bodyLen / 2) * Math.sin(angle)]}
      />

      <group position={[cx, BOARD_TOP + legH, cz]} rotation={[0, -angle, 0]}>
        {/* carbon-film body with the classic bulged ends */}
        <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.038, 0.038, bodyLen, 20]} />
          <meshStandardMaterial color="#cdb086" roughness={0.55} metalness={0.05} />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[(s * bodyLen) / 2, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <sphereGeometry args={[0.038, 16, 12]} />
            <meshStandardMaterial color="#c4a67c" roughness={0.6} />
          </mesh>
        ))}

        {/* four-band colour code */}
        {bands.map((color, i) => {
          const offsets = [-0.3, -0.16, -0.02, 0.26];
          const width = i === 3 ? 0.018 : 0.014;
          return (
            <mesh
              key={i}
              position={[(offsets[i] ?? 0) * bodyLen, 0, 0]}
              rotation={[0, 0, Math.PI / 2]}
            >
              <cylinderGeometry args={[0.0395, 0.0395, width, 20]} />
              <meshStandardMaterial color={color} roughness={0.42} />
            </mesh>
          );
        })}
      </group>

      <PartLabel x={cx} z={cz - 0.115} text={label} tone={Math.abs(current) > 0 ? 'ok' : 'idle'} />
      <SelectionRing x={cx} z={cz} radius={span / 2 + 0.06} selected={selected} highlighted={highlighted} />
    </group>
  );
}

/* ------------------------------ Capacitor ------------------------------ */

export function CapacitorMesh({
  plus,
  minus,
  selected,
  highlighted,
  label,
}: {
  plus: [number, number];
  minus: [number, number];
  selected: boolean;
  highlighted: boolean;
  label: string;
}) {
  const cx = (plus[0] + minus[0]) / 2;
  const cz = (plus[1] + minus[1]) / 2;
  const angle = Math.atan2(minus[1] - plus[1], minus[0] - plus[0]);
  const legH = 0.06;
  const h = 0.2;

  return (
    <group>
      <Lead from={plus} to={[cx - 0.022, BOARD_TOP + legH, cz]} />
      <Lead from={minus} to={[cx + 0.022, BOARD_TOP + legH, cz]} />

      <group position={[cx, BOARD_TOP + legH, cz]} rotation={[0, -angle, 0]}>
        {/* aluminium can with a blue sleeve */}
        <mesh position={[0, h / 2, 0]} castShadow>
          <cylinderGeometry args={[0.062, 0.062, h, 24]} />
          <meshStandardMaterial color="#1b3a6b" roughness={0.35} metalness={0.25} />
        </mesh>
        <mesh position={[0, h + 0.002, 0]}>
          <cylinderGeometry args={[0.062, 0.062, 0.006, 28]} />
          <meshStandardMaterial color="#9aa3b1" metalness={0.85} roughness={0.26} envMapIntensity={1.2} />
        </mesh>
        {/* the pressure-relief cross stamped into every electrolytic's top */}
        {[0, Math.PI / 2].map((a) => (
          <mesh key={a} position={[0, h + 0.007, 0]} rotation={[0, a, 0]}>
            <boxGeometry args={[0.108, 0.004, 0.012]} />
            <meshStandardMaterial color="#6f7988" metalness={0.7} roughness={0.42} />
          </mesh>
        ))}
        {/* crimped lip where the sleeve meets the can */}
        <mesh position={[0, h - 0.012, 0]}>
          <torusGeometry args={[0.062, 0.005, 8, 28]} />
          <meshStandardMaterial color="#132d55" roughness={0.45} metalness={0.3} />
        </mesh>
        {/* negative stripe, the polarity marking on a real electrolytic */}
        <mesh position={[0, h / 2, 0.058]}>
          <boxGeometry args={[0.03, h * 0.92, 0.014]} />
          <meshStandardMaterial color="#e6e9ee" roughness={0.5} />
        </mesh>
        <SafeText
          position={[0, h / 2 + 0.03, 0.066]}
          fontSize={0.034}
          color="#1b3a6b"
          anchorX="center"
          anchorY="middle"
        >
          −
        </SafeText>
      </group>

      <PartLabel x={cx} z={cz - 0.13} text={label} tone="idle" />
      <SelectionRing x={cx} z={cz} radius={0.1} selected={selected} highlighted={highlighted} />
    </group>
  );
}

/* ---------------------------- DC power supply ---------------------------- */

export interface PowerSupplyProps {
  position: [number, number, number];
  volts: number;
  current: number;
  selected: boolean;
  highlighted: boolean;
  label: string;
  onTerminalClick: (pinId: 'pos' | 'neg', event: { stopPropagation: () => void }) => void;
  onBodyClick: (event: { stopPropagation: () => void }) => void;
  onBodyPointerDown?: (event: { stopPropagation: () => void }) => void;
  /** Terminal currently armed as a wire anchor. */
  armedPin: string | null;
}

/** World positions of the supply's binding posts, relative to its origin. */
export const PSU_TERMINAL_OFFSET = {
  pos: [-0.17, 0.3, -0.21] as [number, number, number],
  neg: [0.17, 0.3, -0.21] as [number, number, number],
};

export function PowerSupplyMesh({
  position,
  volts,
  current,
  selected,
  highlighted,
  label,
  onTerminalClick,
  onBodyClick,
  onBodyPointerDown,
  armedPin,
}: PowerSupplyProps) {
  const w = 0.92;
  const h = 0.42;
  const d = 0.56;

  return (
    <group position={position}>
      {/* chassis */}
      <mesh
        position={[0, h / 2, 0]}
        castShadow
        receiveShadow
        onClick={(e) => {
          e.stopPropagation();
          onBodyClick(e);
        }}
        onPointerDown={(e) => {
          if (onBodyPointerDown) {
            e.stopPropagation();
            onBodyPointerDown(e);
          }
        }}
      >
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color="#1a212c" roughness={0.42} metalness={0.45} />
      </mesh>

      {/* vented top */}
      <mesh position={[0, h + 0.004, 0]}>
        <boxGeometry args={[w * 0.98, 0.01, d * 0.98]} />
        <meshStandardMaterial color="#232b38" roughness={0.6} metalness={0.4} />
      </mesh>
      {[-0.18, -0.06, 0.06, 0.18].map((z) => (
        <mesh key={z} position={[0, h + 0.009, z]}>
          <boxGeometry args={[w * 0.7, 0.004, 0.018]} />
          <meshStandardMaterial color="#0e131b" roughness={0.9} />
        </mesh>
      ))}

      {/* front bezel + readouts */}
      <mesh position={[0, h / 2, d / 2 + 0.003]}>
        <boxGeometry args={[w * 0.95, h * 0.82, 0.008]} />
        <meshStandardMaterial color="#10161f" roughness={0.5} metalness={0.3} />
      </mesh>
      <mesh position={[-0.2, h / 2 + 0.06, d / 2 + 0.009]}>
        <boxGeometry args={[0.3, 0.12, 0.004]} />
        <meshStandardMaterial color="#05100f" roughness={0.3} />
      </mesh>
      <mesh position={[0.2, h / 2 + 0.06, d / 2 + 0.009]}>
        <boxGeometry args={[0.3, 0.12, 0.004]} />
        <meshStandardMaterial color="#05100f" roughness={0.3} />
      </mesh>
      <SafeText
        position={[-0.2, h / 2 + 0.06, d / 2 + 0.013]}
        fontSize={0.062}
        color="#2fe0cf"
        anchorX="center"
        anchorY="middle"
      >
        {`${volts.toFixed(2)}V`}
      </SafeText>
      <SafeText
        position={[0.2, h / 2 + 0.06, d / 2 + 0.013]}
        fontSize={0.062}
        color={current > 0 ? '#fbbf24' : '#3d4b5c'}
        anchorX="center"
        anchorY="middle"
      >
        {`${(current * 1000).toFixed(1)}mA`}
      </SafeText>
      <SafeText
        position={[0, h / 2 - 0.09, d / 2 + 0.013]}
        fontSize={0.04}
        color="#5b6c81"
        anchorX="center"
        anchorY="middle"
      >
        DC BENCH SUPPLY
      </SafeText>

      {/* binding posts on the back edge, facing the breadboard */}
      {(['pos', 'neg'] as const).map((pin) => {
        const offset = PSU_TERMINAL_OFFSET[pin];
        const isPos = pin === 'pos';
        const armed = armedPin === pin;
        return (
          <group key={pin} position={offset}>
            <mesh
              onClick={(e) => {
                e.stopPropagation();
                onTerminalClick(pin, e);
              }}
              onPointerOver={(e) => {
                e.stopPropagation();
                document.body.style.cursor = 'crosshair';
              }}
              onPointerOut={() => {
                document.body.style.cursor = 'auto';
              }}
              castShadow
            >
              <cylinderGeometry args={[0.044, 0.05, 0.085, 18]} />
              <meshStandardMaterial
                color={isPos ? '#d8232a' : '#15181f'}
                roughness={0.3}
                metalness={0.45}
                emissive={armed ? new THREE.Color('#fbbf24') : new THREE.Color('#000000')}
                emissiveIntensity={armed ? 0.8 : 0}
              />
            </mesh>
            {/* brass stud */}
            <mesh position={[0, 0.058, 0]}>
              <cylinderGeometry args={[0.016, 0.016, 0.04, 12]} />
              <meshStandardMaterial color="#c9a227" metalness={0.9} roughness={0.25} />
            </mesh>
            <SafeText
              position={[0, 0.095, 0]}
              rotation={[-Math.PI / 2, 0, 0]}
              fontSize={0.05}
              color={isPos ? '#ff8a8a' : '#cfdbe8'}
              anchorX="center"
              anchorY="middle"
              outlineWidth={0.005}
              outlineColor="#11161d"
            >
              {isPos ? '+' : '−'}
            </SafeText>
            {armed ? (
              <mesh position={[0, 0.09, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[0.055, 0.075, 20]} />
                <meshBasicMaterial color="#fbbf24" transparent opacity={0.9} />
              </mesh>
            ) : null}
          </group>
        );
      })}

      {/* rubber feet */}
      {[
        [-w / 2 + 0.08, -d / 2 + 0.08],
        [w / 2 - 0.08, -d / 2 + 0.08],
        [-w / 2 + 0.08, d / 2 - 0.08],
        [w / 2 - 0.08, d / 2 - 0.08],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x ?? 0, 0.008, z ?? 0]}>
          <cylinderGeometry args={[0.03, 0.032, 0.016, 10]} />
          <meshStandardMaterial color="#0a0d12" roughness={0.95} />
        </mesh>
      ))}

      <PartLabel x={0} z={d / 2 + 0.14} text={label} tone={current > 0 ? 'ok' : 'idle'} y={0.004} />
      {selected || highlighted ? (
        <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.56, 0.6, 32]} />
          <meshBasicMaterial color={selected ? '#2fe0cf' : '#fbbf24'} transparent opacity={0.85} />
        </mesh>
      ) : null}
    </group>
  );
}

/* ------------------------------- shared bits ------------------------------- */

/**
 * A component designator, drawn as a silkscreen plaque rather than loose text.
 *
 * It used to be bare 3D text lying on the ground plane. On the dark bench a
 * stray grey "U1" floating under the Arduino read as a rendering mistake, not
 * as a label -- it had no edge, no baseline and no relationship to the part.
 *
 * The designators are not decoration: the Measurements table, the diagnostics
 * and the tutor's evidence all refer to parts as U1, R1, D1, so removing them
 * would cut the link between the panels and the bench. Instead each one now
 * sits on a small rounded plate the way a reference designator is screened
 * onto a real board, tinted by the part's state so a lit part reads at a
 * glance.
 */
export function PartLabel({
  x,
  z,
  text,
  tone,
  y = BOARD_TOP + 0.004,
}: {
  x: number;
  z: number;
  text: string;
  tone: 'ok' | 'idle' | 'error';
  y?: number;
}) {
  if (!text) return null;
  return (
    <Designator position={[x, y, z]} text={text} tone={tone} />
  );
}

const DESIGNATOR_TONES: Record<'ok' | 'idle' | 'error', { text: string; edge: string }> = {
  ok: { text: '#5eead4', edge: '#2fe0cf' },
  idle: { text: '#9fb0c4', edge: '#3d4c60' },
  error: { text: '#fca5a5', edge: '#f87171' },
};

const CHAR_W = 0.026;
const PLATE_H = 0.052;
const PAD_X = 0.022;

/** A rounded plate, built once per size and shared by every label that size. */
function plateGeometry(w: number, h: number): THREE.ShapeGeometry {
  const r = h / 2;
  const shape = new THREE.Shape();
  const hw = w / 2 - r;
  shape.absarc(hw, 0, r, -Math.PI / 2, Math.PI / 2, false);
  shape.absarc(-hw, 0, r, Math.PI / 2, (3 * Math.PI) / 2, false);
  shape.closePath();
  return new THREE.ShapeGeometry(shape, 12);
}

export function Designator({
  position,
  text,
  tone,
}: {
  position: [number, number, number];
  text: string;
  tone: 'ok' | 'idle' | 'error';
}) {
  const { text: fg, edge } = DESIGNATOR_TONES[tone];
  const w = Math.max(0.1, text.length * CHAR_W + PAD_X * 2);

  const geom = useMemo(() => plateGeometry(w, PLATE_H), [w]);
  const edgeGeom = useMemo(() => plateGeometry(w + 0.012, PLATE_H + 0.012), [w]);

  return (
    // Laid flat on the bench plane, like silkscreen on a board.
    <group position={position} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh geometry={edgeGeom} position={[0, 0, -0.0002]}>
        <meshBasicMaterial color={edge} transparent opacity={tone === 'idle' ? 0.3 : 0.55} />
      </mesh>
      <mesh geometry={geom}>
        <meshBasicMaterial color="#0a0f16" transparent opacity={0.92} />
      </mesh>
      <SafeText
        position={[0, -0.002, 0.0012]}
        fontSize={0.036}
        letterSpacing={0.06}
        color={fg}
        anchorX="center"
        anchorY="middle"
      >
        {text.toUpperCase()}
      </SafeText>
    </group>
  );
}

export function SelectionRing({
  x,
  z,
  radius,
  selected,
  highlighted,
}: {
  x: number;
  z: number;
  radius: number;
  selected: boolean;
  highlighted: boolean;
}) {
  if (!selected && !highlighted) return null;
  return (
    <mesh position={[x, BOARD_TOP + 0.002, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[radius, radius + 0.014, 32]} />
      <meshBasicMaterial
        color={selected ? '#2fe0cf' : '#fbbf24'}
        transparent
        opacity={selected ? 0.95 : 0.8}
      />
    </mesh>
  );
}

/* ------------------------- additional through-hole parts ------------------------- */

export interface TwoPinProps {
  a: [number, number];
  b: [number, number];
  selected: boolean;
  highlighted: boolean;
  label: string;
}

/** Shared frame: leads from both holes up to a body of the given height. */
export function TwoPinBody({
  a,
  b,
  legH,
  children,
  labelZ = 0.13,
  tone = 'idle',
  label,
  selected,
  highlighted,
  radius = 0.1,
}: TwoPinProps & {
  legH: number;
  children: React.ReactNode;
  labelZ?: number;
  tone?: 'ok' | 'idle' | 'error';
  radius?: number;
}) {
  const cx = (a[0] + b[0]) / 2;
  const cz = (a[1] + b[1]) / 2;
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const inset = Math.min(0.03, span / 3);

  return (
    <group>
      <Lead from={a} to={[cx - Math.cos(angle) * (span / 2 - inset), BOARD_TOP + legH, cz - Math.sin(angle) * (span / 2 - inset)]} />
      <Lead from={b} to={[cx + Math.cos(angle) * (span / 2 - inset), BOARD_TOP + legH, cz + Math.sin(angle) * (span / 2 - inset)]} />
      <group position={[cx, BOARD_TOP + legH, cz]} rotation={[0, -angle, 0]}>
        {children}
      </group>
      <PartLabel x={cx} z={cz - labelZ} text={label} tone={tone} />
      <SelectionRing x={cx} z={cz} radius={span / 2 + radius} selected={selected} highlighted={highlighted} />
    </group>
  );
}

/** Silicon signal diode: DO-35 glass body with the die visible inside. */
export function DiodeMesh(props: TwoPinProps & { reverseBiased: boolean; conducting: boolean }) {
  const span = Math.hypot(props.b[0] - props.a[0], props.b[1] - props.a[1]);
  const bodyLen = Math.max(0.12, span * 0.45);
  return (
    <TwoPinBody
      {...props}
      legH={0.075}
      tone={props.reverseBiased ? 'error' : props.conducting ? 'ok' : 'idle'}
    >
      {/* glass envelope — a real 1N4148 is clear glass, not black plastic */}
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.031, 0.031, bodyLen, 24]} />
        <meshPhysicalMaterial
          color="#d9c9a8"
          roughness={0.08}
          transmission={0.55}
          thickness={0.4}
          ior={1.5}
          envMapIntensity={1.6}
        />
      </mesh>
      {/* rounded glass ends */}
      {[-1, 1].map((sgn) => (
        <mesh key={sgn} position={[(sgn * bodyLen) / 2, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <sphereGeometry args={[0.031, 16, 12]} />
          <meshPhysicalMaterial color="#d9c9a8" roughness={0.08} transmission={0.5} thickness={0.3} />
        </mesh>
      ))}
      {/* the silicon die and its internal slug, seen through the glass */}
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.014, 0.014, bodyLen * 0.42, 12]} />
        <meshStandardMaterial color="#2a2d33" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[-bodyLen * 0.1, 0, 0]}>
        <boxGeometry args={[0.012, 0.018, 0.018]} />
        <meshStandardMaterial color="#4a4038" roughness={0.5} />
      </mesh>
      {/* cathode band at the K end */}
      <mesh position={[bodyLen * 0.34, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.0325, 0.0325, bodyLen * 0.16, 24]} />
        <meshStandardMaterial color="#1b1d22" roughness={0.45} />
      </mesh>
    </TwoPinBody>
  );
}

/** Axial inductor: a ferrite core with visible copper winding. */
export function InductorMesh(props: TwoPinProps) {
  const span = Math.hypot(props.b[0] - props.a[0], props.b[1] - props.a[1]);
  const bodyLen = Math.max(0.16, span * 0.5);
  const turns = 9;
  return (
    <TwoPinBody {...props} legH={0.085}>
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.036, 0.036, bodyLen, 20]} />
        <meshStandardMaterial color="#2b2520" roughness={0.6} />
      </mesh>
      {Array.from({ length: turns }, (_, i) => (
        <mesh
          key={i}
          position={[(-bodyLen / 2) + (bodyLen * (i + 0.5)) / turns, 0, 0]}
          rotation={[0, 0, Math.PI / 2]}
        >
          <torusGeometry args={[0.038, 0.007, 8, 18]} />
          <meshStandardMaterial color="#b9742f" metalness={0.85} roughness={0.3} />
        </mesh>
      ))}
    </TwoPinBody>
  );
}

/** Glass cartridge fuse in a holder; the element visibly breaks when blown. */
export function FuseMesh(props: TwoPinProps & { blown: boolean }) {
  const span = Math.hypot(props.b[0] - props.a[0], props.b[1] - props.a[1]);
  const bodyLen = Math.max(0.2, span * 0.62);
  return (
    <TwoPinBody {...props} legH={0.09} tone={props.blown ? 'error' : 'idle'}>
      {/* glass tube */}
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.042, 0.042, bodyLen, 22]} />
        <meshPhysicalMaterial color="#cfe3ee" roughness={0.08} transmission={0.75} thickness={0.3} />
      </mesh>
      {/* end caps */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[(s * bodyLen) / 2, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.045, 0.045, bodyLen * 0.22, 22]} />
          <meshStandardMaterial color="#b6bac1" metalness={0.9} roughness={0.25} />
        </mesh>
      ))}
      {/* the element: continuous when intact, broken with a gap when blown */}
      {props.blown ? (
        [-1, 1].map((s) => (
          <mesh key={s} position={[s * bodyLen * 0.2, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.005, 0.005, bodyLen * 0.3, 6]} />
            <meshStandardMaterial color="#51402f" metalness={0.5} roughness={0.6} />
          </mesh>
        ))
      ) : (
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.005, 0.005, bodyLen * 0.85, 6]} />
          <meshStandardMaterial color="#c9b07a" metalness={0.8} roughness={0.35} />
        </mesh>
      )}
    </TwoPinBody>
  );
}

/** Light-dependent resistor: ceramic disc with the classic serpentine CdS track. */
export function PhotoresistorMesh(props: TwoPinProps & { illumination: number }) {
  const lit = Math.min(1, Math.max(0, props.illumination));

  // The zigzag is what makes an LDR recognisable: one long cadmium-sulphide
  // track folded back and forth to pack resistance into a small disc.
  const track = useMemo(() => {
    const segments: Array<{ pos: [number, number, number]; size: [number, number, number] }> = [];
    const fingers = 5;
    const halfW = 0.042;
    for (let i = 0; i < fingers; i++) {
      const z = -0.03 + (i * 0.06) / (fingers - 1);
      segments.push({ pos: [0, 0.01, z], size: [halfW * 2, 0.005, 0.008] });
      // the fold joining this finger to the next, alternating sides
      if (i < fingers - 1) {
        const x = i % 2 === 0 ? halfW : -halfW;
        segments.push({ pos: [x, 0.01, z + 0.03 / (fingers - 1)], size: [0.008, 0.005, 0.06 / (fingers - 1)] });
      }
    }
    return segments;
  }, []);

  return (
    <TwoPinBody {...props} legH={0.1} tone={lit > 0.05 ? 'ok' : 'idle'}>
      {/* ceramic substrate */}
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.055, 0.055, 0.016, 28]} />
        <meshStandardMaterial color="#efe9da" roughness={0.75} />
      </mesh>
      {/* clear epoxy coating over the track */}
      <mesh position={[0, 0.013, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.006, 28]} />
        <meshPhysicalMaterial
          color="#ffffff"
          roughness={0.06}
          transmission={0.7}
          thickness={0.1}
          envMapIntensity={1.4}
        />
      </mesh>
      {track.map((seg, i) => (
        <mesh key={i} position={seg.pos}>
          <boxGeometry args={seg.size} />
          <meshStandardMaterial color="#8a6a3a" roughness={0.45} metalness={0.3} />
        </mesh>
      ))}
      {/* the two electrodes the track runs between */}
      {[-0.046, 0.046].map((x) => (
        <mesh key={x} position={[x, 0.011, 0]}>
          <boxGeometry args={[0.014, 0.006, 0.075]} />
          <meshStandardMaterial color="#c9ccd2" metalness={0.85} roughness={0.3} />
        </mesh>
      ))}
      {lit > 0.05 ? (
        <pointLight position={[0, 0.12, 0]} color="#fff6d8" intensity={lit * 0.9} distance={0.5} decay={2} />
      ) : null}
    </TwoPinBody>
  );
}

/** Piezo buzzer: a black can with a sound hole and a polarity label. */
export function BuzzerMesh(props: TwoPinProps & { sounding: boolean }) {
  return (
    <TwoPinBody {...props} legH={0.06} labelZ={0.17} tone={props.sounding ? 'ok' : 'idle'} radius={0.14}>
      {/* moulded case */}
      <mesh position={[0, 0.06, 0]} castShadow>
        <cylinderGeometry args={[0.11, 0.112, 0.12, 32]} />
        <meshStandardMaterial color="#17191d" roughness={0.52} envMapIntensity={0.8} />
      </mesh>
      {/* the slight lip around the top, as on a real sounder */}
      <mesh position={[0, 0.119, 0]}>
        <torusGeometry args={[0.105, 0.007, 10, 32]} />
        <meshStandardMaterial color="#202329" roughness={0.6} />
      </mesh>
      {/* white label disc with the + marking */}
      <mesh position={[0, 0.122, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.092, 32]} />
        <meshStandardMaterial color="#e8e9ec" roughness={0.65} />
      </mesh>
      {/* sound hole, punched through the label */}
      <mesh position={[0, 0.123, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.019, 20]} />
        <meshBasicMaterial color="#05070a" />
      </mesh>
      <SafeText
        position={[0.055, 0.124, -0.03]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.034}
        color="#1b1d22"
        anchorX="center"
        anchorY="middle"
      >
        +
      </SafeText>
    </TwoPinBody>
  );
}
