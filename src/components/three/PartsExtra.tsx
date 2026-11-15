'use client';

import * as THREE from 'three';

import { BOARD_TOP } from '@/lib/circuit/breadboard';
import { SafeText } from './SafeText';
import { EmissiveGlow, Lead, PartLabel, SelectionRing, TwoPinBody, type TwoPinProps } from './Parts';

/**
 * Multi-pin and electromechanical parts.
 *
 * Split from Parts.tsx purely to keep each file readable; these follow the same
 * conventions — physical shapes rather than schematic symbols, with the state
 * the solver cares about made visible (a switch's actuator position, a blown
 * fuse element, which RGB dies are lit).
 */

/** SPST slide switch. The actuator visibly sits at one end or the other. */
export function SwitchMesh(props: TwoPinProps & { closed: boolean }) {
  const span = Math.hypot(props.b[0] - props.a[0], props.b[1] - props.a[1]);
  const bodyLen = Math.max(0.16, span * 0.6);
  return (
    <TwoPinBody {...props} legH={0.05} tone={props.closed ? 'ok' : 'idle'}>
      {/* ivory moulded body */}
      <mesh position={[0, 0.035, 0]} castShadow>
        <boxGeometry args={[bodyLen, 0.07, 0.11]} />
        <meshStandardMaterial color="#ddd8cd" roughness={0.52} />
      </mesh>
      {/* the metal frame a real slide switch is clipped into */}
      <mesh position={[0, 0.04, 0]}>
        <boxGeometry args={[bodyLen * 0.5, 0.062, 0.118]} />
        <meshStandardMaterial color="#b4b9c0" metalness={0.85} roughness={0.3} envMapIntensity={1.3} />
      </mesh>
      {/* actuator slot */}
      <mesh position={[0, 0.072, 0]}>
        <boxGeometry args={[bodyLen * 0.48, 0.006, 0.046]} />
        <meshStandardMaterial color="#23262c" roughness={0.65} />
      </mesh>
      {/* the two detent positions, moulded into the body */}
      {[-1, 1].map((sgn) => (
        <mesh key={sgn} position={[sgn * bodyLen * 0.3, 0.071, 0]}>
          <boxGeometry args={[0.008, 0.004, 0.07]} />
          <meshStandardMaterial color="#a8a497" roughness={0.7} />
        </mesh>
      ))}
      {/* the slider: ON sits towards pin 2 */}
      <mesh position={[(props.closed ? 1 : -1) * bodyLen * 0.16, 0.088, 0]} castShadow>
        <boxGeometry args={[bodyLen * 0.24, 0.04, 0.042]} />
        <meshStandardMaterial
          color={props.closed ? '#34d399' : '#8b9099'}
          metalness={0.4}
          roughness={0.35}
        />
      </mesh>
      <SafeText
        position={[-bodyLen * 0.45, 0.075, 0.075]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.026}
        color="#6d7278"
        anchorX="center"
        anchorY="middle"
      >
        OFF
      </SafeText>
    </TwoPinBody>
  );
}

/** 6 mm tactile push button. Real ones have four legs and a steel dome cover. */
export function PushButtonMesh(props: TwoPinProps & { pressed: boolean }) {
  return (
    <TwoPinBody
      {...props}
      legH={0.04}
      labelZ={0.14}
      tone={props.pressed ? 'ok' : 'idle'}
      radius={0.12}
    >
      {/* black moulded base */}
      <mesh position={[0, 0.022, 0]} castShadow>
        <boxGeometry args={[0.12, 0.044, 0.12]} />
        <meshStandardMaterial color="#1f2328" roughness={0.62} />
      </mesh>
      {/* stainless cover plate with its stamped corners */}
      <mesh position={[0, 0.047, 0]}>
        <boxGeometry args={[0.118, 0.008, 0.118]} />
        <meshStandardMaterial color="#aeb3ba" metalness={0.9} roughness={0.26} envMapIntensity={1.4} />
      </mesh>
      {/* the four legs a real tactile switch stands on */}
      {[
        [-0.055, -0.05],
        [0.055, -0.05],
        [-0.055, 0.05],
        [0.055, 0.05],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x ?? 0, 0.012, z ?? 0]}>
          <boxGeometry args={[0.012, 0.03, 0.008]} />
          <meshStandardMaterial color="#b9bcc2" metalness={0.9} roughness={0.25} />
        </mesh>
      ))}
      {/* actuator, visibly depressed while held */}
      <mesh position={[0, props.pressed ? 0.056 : 0.072, 0]} castShadow>
        <cylinderGeometry args={[0.032, 0.035, props.pressed ? 0.02 : 0.05, 24]} />
        <meshStandardMaterial
          color={props.pressed ? '#d64545' : '#2a2e34'}
          roughness={0.45}
          metalness={0.1}
        />
      </mesh>
      <mesh position={[0, props.pressed ? 0.066 : 0.097, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.03, 20]} />
        <meshStandardMaterial color={props.pressed ? '#e8574f' : '#363b43'} roughness={0.4} />
      </mesh>
    </TwoPinBody>
  );
}

/** Three-terminal potentiometer with a knob that turns with the wiper. */
export function PotentiometerMesh({
  pins,
  wiper,
  selected,
  highlighted,
  label,
}: {
  /** World x/z of pins 1, W and 3. */
  pins: Array<[number, number]>;
  wiper: number;
  selected: boolean;
  highlighted: boolean;
  label: string;
}) {
  const p1 = pins[0];
  const p3 = pins[2];
  if (!p1 || !p3) return null;
  const cx = (p1[0] + p3[0]) / 2;
  const cz = (p1[1] + p3[1]) / 2;
  const angle = Math.atan2(p3[1] - p1[1], p3[0] - p1[0]);
  const legH = 0.055;
  // The body sits behind the pin row, as on a real panel pot.
  const bodyZ = cz - 0.07;

  return (
    <group>
      {pins.map((p, i) => (
        <Lead key={i} from={p} to={[p[0], BOARD_TOP + legH, p[1]]} />
      ))}
      <group position={[cx, BOARD_TOP + legH, bodyZ]} rotation={[0, -angle, 0]}>
        <mesh position={[0, 0.045, 0]} castShadow>
          <cylinderGeometry args={[0.1, 0.1, 0.09, 24]} />
          <meshStandardMaterial color="#1f6fb0" roughness={0.45} metalness={0.2} />
        </mesh>
        <mesh position={[0, 0.115, 0]} castShadow>
          <cylinderGeometry args={[0.022, 0.022, 0.06, 16]} />
          <meshStandardMaterial color="#b6bac1" metalness={0.85} roughness={0.3} />
        </mesh>
        {/* knob, rotated to show the wiper position over ~270 degrees */}
        <group position={[0, 0.155, 0]} rotation={[0, -(wiper - 0.5) * (Math.PI * 1.5), 0]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.07, 0.062, 0.05, 24]} />
            <meshStandardMaterial color="#20242b" roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.026, -0.04]}>
            <boxGeometry args={[0.012, 0.004, 0.06]} />
            <meshBasicMaterial color="#2fe0cf" toneMapped={false} />
          </mesh>
        </group>
      </group>
      <PartLabel x={cx} z={cz + 0.1} text={label} tone="idle" />
      <SelectionRing x={cx} z={bodyZ} radius={0.17} selected={selected} highlighted={highlighted} />
    </group>
  );
}

/** Common-cathode RGB LED: three dies that light independently. */
export function RgbLedMesh({
  pins,
  channels,
  brightness,
  selected,
  highlighted,
  label,
}: {
  /** World x/z of pins R, K, G, B. */
  pins: Array<[number, number]>;
  /** Which dies are lit, e.g. ['R','B']. */
  channels: string[];
  brightness: number;
  selected: boolean;
  highlighted: boolean;
  label: string;
}) {
  const xs = pins.map((p) => p[0]);
  const zs = pins.map((p) => p[1]);
  const cx = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const cz = zs.reduce((a, b) => a + b, 0) / Math.max(1, zs.length);
  const legH = 0.115;

  const mix = new THREE.Color(
    channels.includes('R') ? 1 : 0.06,
    channels.includes('G') ? 1 : 0.06,
    channels.includes('B') ? 1 : 0.06,
  );
  const lit = channels.length > 0;
  const emissive = lit ? 0.5 + brightness * 2.4 : 0;
  const idle = new THREE.Color('#cfd4da');

  return (
    <group>
      {pins.map((p, i) => (
        <Lead key={i} from={p} to={[cx + (p[0] - cx) * 0.25, BOARD_TOP + legH - 0.015, cz]} />
      ))}
      <group position={[cx, BOARD_TOP + legH, cz]}>
        <mesh position={[0, 0.008, 0]} castShadow>
          <cylinderGeometry args={[0.062, 0.062, 0.016, 28]} />
          <meshStandardMaterial color="#d9dde3" roughness={0.35} transparent opacity={0.85} />
        </mesh>
        <mesh position={[0, 0.066, 0]} castShadow>
          <cylinderGeometry args={[0.052, 0.052, 0.1, 28]} />
          <meshStandardMaterial
            color={lit ? mix : idle}
            roughness={0.1}
            transparent
            opacity={0.72}
            emissive={mix}
            emissiveIntensity={emissive * 0.45}
          />
        </mesh>
        <mesh position={[0, 0.116, 0]} castShadow>
          <sphereGeometry args={[0.052, 28, 18, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial
            color={lit ? mix : idle}
            roughness={0.05}
            transparent
            opacity={0.7}
            emissive={mix}
            emissiveIntensity={emissive * 0.55}
          />
        </mesh>
        {(['R', 'G', 'B'] as const).map((ch, i) => (
          <mesh key={ch} position={[(i - 1) * 0.022, 0.05, 0]}>
            <boxGeometry args={[0.014, 0.008, 0.014]} />
            <meshStandardMaterial
              color={channels.includes(ch) ? '#ffffff' : '#4a4f56'}
              emissive={new THREE.Color(ch === 'R' ? '#ff4030' : ch === 'G' ? '#40ff70' : '#4080ff')}
              emissiveIntensity={channels.includes(ch) ? emissive : 0}
              toneMapped={false}
            />
          </mesh>
        ))}
        {lit ? (
          <>
            <EmissiveGlow
              position={[0, 0.062, 0]}
              color={mix}
              strength={Math.min(1, 0.35 + brightness * 0.65)}
              radius={0.05}
            />
            <pointLight
              position={[0, 0.12, 0]}
              color={mix}
              intensity={0.4 + brightness * 1.6}
              distance={1.1}
              decay={2}
            />
          </>
        ) : null}
      </group>
      <PartLabel x={cx} z={cz - 0.15} text={label} tone={lit ? 'ok' : 'idle'} />
      <SelectionRing x={cx} z={cz} radius={0.15} selected={selected} highlighted={highlighted} />
    </group>
  );
}

/** Two-AA battery holder that seats on the board. */
export function BatteryMesh(props: TwoPinProps) {
  const span = Math.hypot(props.b[0] - props.a[0], props.b[1] - props.a[1]);
  return (
    <TwoPinBody {...props} legH={0.04} labelZ={0.22} radius={0.16}>
      <mesh position={[0, 0.055, 0]} castShadow>
        <boxGeometry args={[span * 0.95, 0.11, 0.3]} />
        <meshStandardMaterial color="#15181d" roughness={0.65} />
      </mesh>
      {[-0.075, 0.075].map((z) => (
        <mesh key={z} position={[0, 0.125, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.055, 0.055, span * 0.8, 20]} />
          <meshStandardMaterial color="#9aa1ad" metalness={0.55} roughness={0.42} />
        </mesh>
      ))}
      <SafeText
        position={[-span * 0.38, 0.115, 0.17]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.045}
        color="#ff8a8a"
        anchorX="center"
        anchorY="middle"
      >
        +
      </SafeText>
      <SafeText
        position={[span * 0.38, 0.115, 0.17]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.045}
        color="#cfdbe8"
        anchorX="center"
        anchorY="middle"
      >
        {'−'}
      </SafeText>
    </TwoPinBody>
  );
}
