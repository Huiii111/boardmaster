'use client';

import * as THREE from 'three';

import { SafeText } from './SafeText';
import { Designator } from './Parts';

/**
 * Bench instruments that stand beside the breadboard rather than plugging into
 * it, in the manner of a real teaching lab: a battery pack and a digital
 * multimeter.
 *
 * Both are wired to the board with jumpers from their terminals, exactly like
 * the bench supply, so the netlist treats them uniformly.
 */

const SHELL = '#1a212c';
const BEZEL = '#10161f';

/** Terminal offsets, relative to each instrument's origin. */
export const BATTERY_TERMINAL_OFFSET = {
  pos: [-0.12, 0.17, -0.13] as [number, number, number],
  neg: [0.12, 0.17, -0.13] as [number, number, number],
};

export const DMM_PROBE_OFFSET = {
  red: [-0.11, 0.1, -0.16] as [number, number, number],
  black: [0.11, 0.1, -0.16] as [number, number, number],
};

/* ------------------------------ battery pack ------------------------------ */

export interface BatteryPackProps {
  position: [number, number, number];
  volts: number;
  /** Current drawn, amps — shown on the little fuel gauge. */
  current: number;
  selected: boolean;
  highlighted: boolean;
  label: string;
  armedPin: string | null;
  onTerminalClick: (pinId: 'pos' | 'neg', event: { stopPropagation: () => void }) => void;
  onBodyClick: (event: { stopPropagation: () => void }) => void;
  onBodyPointerDown?: (event: { stopPropagation: () => void }) => void;
}

/** A 6×AA battery holder with snap terminals. */
export function BatteryPackMesh({
  position,
  volts,
  current,
  selected,
  highlighted,
  label,
  armedPin,
  onTerminalClick,
  onBodyClick,
  onBodyPointerDown,
}: BatteryPackProps) {
  const w = 0.62;
  const h = 0.16;
  const d = 0.42;

  return (
    <group position={position}>
      {/* holder shell */}
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
        <meshStandardMaterial color="#14171c" roughness={0.68} />
      </mesh>

      {/* the cells, sitting in their bays */}
      {[-0.1, 0.1].map((z) =>
        [-0.17, 0, 0.17].map((x) => (
          <group key={`${x}-${z}`}>
            <mesh position={[x, h + 0.028, z]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.028, 0.028, 0.15, 18]} />
              <meshStandardMaterial color="#9aa1ad" metalness={0.6} roughness={0.38} />
            </mesh>
            {/* the wrapper label band */}
            <mesh position={[x, h + 0.028, z]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.0285, 0.0285, 0.09, 18]} />
              <meshStandardMaterial color="#1f6fb0" roughness={0.5} />
            </mesh>
          </group>
        )),
      )}

      {/* label plate */}
      <mesh position={[0, h / 2, d / 2 + 0.002]}>
        <boxGeometry args={[w * 0.9, h * 0.6, 0.004]} />
        <meshStandardMaterial color={BEZEL} roughness={0.5} />
      </mesh>
      <SafeText
        position={[0, h / 2 + 0.018, d / 2 + 0.006]}
        fontSize={0.045}
        color="#2fe0cf"
        anchorX="center"
        anchorY="middle"
      >
        {`${volts.toFixed(1)}V`}
      </SafeText>
      <SafeText
        position={[0, h / 2 - 0.03, d / 2 + 0.006]}
        fontSize={0.026}
        color="#5b6c81"
        anchorX="center"
        anchorY="middle"
      >
        {current > 0 ? `${(current * 1000).toFixed(1)} mA DRAW` : 'BATTERY PACK'}
      </SafeText>

      {/* snap terminals */}
      {(['pos', 'neg'] as const).map((pin) => {
        const offset = BATTERY_TERMINAL_OFFSET[pin];
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
              <cylinderGeometry args={[0.03, 0.034, 0.06, 16]} />
              <meshStandardMaterial
                color={isPos ? '#d8232a' : '#15181f'}
                roughness={0.35}
                metalness={0.4}
                emissive={armed ? new THREE.Color('#fbbf24') : new THREE.Color('#000000')}
                emissiveIntensity={armed ? 0.8 : 0}
              />
            </mesh>
            <SafeText
              position={[0, 0.05, 0]}
              rotation={[-Math.PI / 2, 0, 0]}
              fontSize={0.04}
              color={isPos ? '#ff8a8a' : '#cfdbe8'}
              anchorX="center"
              anchorY="middle"
              outlineWidth={0.004}
              outlineColor="#11161d"
            >
              {isPos ? '+' : '−'}
            </SafeText>
            {armed ? (
              <mesh position={[0, 0.045, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[0.038, 0.052, 20]} />
                <meshBasicMaterial color="#fbbf24" transparent opacity={0.9} />
              </mesh>
            ) : null}
          </group>
        );
      })}

      <Designator
        position={[0, 0.004, d / 2 + 0.12]}
        text={label}
        tone={current > 0 ? 'ok' : 'idle'}
      />

      {selected || highlighted ? (
        <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.4, 0.43, 32]} />
          <meshBasicMaterial color={selected ? '#2fe0cf' : '#fbbf24'} transparent opacity={0.85} />
        </mesh>
      ) : null}
    </group>
  );
}

/* ------------------------------- multimeter ------------------------------- */

export interface MultimeterProps {
  position: [number, number, number];
  /** Formatted reading for the display, e.g. "2.000 V". */
  reading: string;
  /** Secondary line: what is being measured, or why there is no reading. */
  caption: string;
  mode: 'voltage' | 'current';
  live: boolean;
  selected: boolean;
  highlighted: boolean;
  label: string;
  armedPin: string | null;
  onProbeClick: (pinId: 'red' | 'black', event: { stopPropagation: () => void }) => void;
  onBodyClick: (event: { stopPropagation: () => void }) => void;
  onBodyPointerDown?: (event: { stopPropagation: () => void }) => void;
}

/** A bench digital multimeter with two probe jacks. */
export function MultimeterMesh({
  position,
  reading,
  caption,
  mode,
  live,
  selected,
  highlighted,
  label,
  armedPin,
  onProbeClick,
  onBodyClick,
  onBodyPointerDown,
}: MultimeterProps) {
  const w = 0.56;
  const h = 0.3;
  const d = 0.36;
  // Everything on the front panel lives inside the tilted group and sits just
  // proud of the case face. Positioning face details in the parent's space put
  // them *inside* the solid case, which rendered the meter as a blank box.
  const face = d / 2 + 0.004;

  return (
    <group position={position}>
      <group position={[0, h / 2, 0]} rotation={[-0.18, 0, 0]}>
        <mesh
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
          <meshStandardMaterial color={SHELL} roughness={0.45} metalness={0.35} />
        </mesh>

        {/* rubber bumper, as every bench meter has */}
        <mesh position={[0, -h / 2 + 0.022, 0]}>
          <boxGeometry args={[w + 0.016, 0.055, d + 0.016]} />
          <meshStandardMaterial color="#c2552b" roughness={0.78} />
        </mesh>

        {/* LCD bezel and glass */}
        <mesh position={[0, h * 0.26, face]}>
          <boxGeometry args={[w * 0.82, h * 0.34, 0.008]} />
          <meshStandardMaterial color={BEZEL} roughness={0.4} />
        </mesh>
        <mesh position={[0, h * 0.26, face + 0.005]}>
          <boxGeometry args={[w * 0.75, h * 0.28, 0.004]} />
          <meshStandardMaterial
            color="#0d2a20"
            roughness={0.2}
            emissive={new THREE.Color(live ? '#0b3a2c' : '#000000')}
            emissiveIntensity={live ? 0.9 : 0}
          />
        </mesh>
        <SafeText
          position={[0, h * 0.29, face + 0.012]}
          fontSize={0.058}
          color={live ? '#2fe0cf' : '#44566b'}
          anchorX="center"
          anchorY="middle"
        >
          {reading}
        </SafeText>
        <SafeText
          position={[0, h * 0.17, face + 0.012]}
          fontSize={0.024}
          color="#5b6c81"
          anchorX="center"
          anchorY="middle"
        >
          {caption}
        </SafeText>

        {/* rotary mode dial */}
        <group position={[0, -h * 0.06, face + 0.002]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.058, 0.058, 0.012, 24]} />
            <meshStandardMaterial color="#0d1218" roughness={0.6} />
          </mesh>
          <mesh
            position={[0, 0, 0.008]}
            rotation={[0, 0, mode === 'voltage' ? Math.PI / 5 : -Math.PI / 5]}
          >
            <boxGeometry args={[0.01, 0.075, 0.004]} />
            <meshBasicMaterial color="#fbbf24" toneMapped={false} />
          </mesh>
        </group>
        <SafeText
          position={[-0.108, -h * 0.03, face + 0.006]}
          fontSize={0.034}
          color={mode === 'voltage' ? '#2fe0cf' : '#49556a'}
          anchorX="center"
          anchorY="middle"
        >
          V
        </SafeText>
        <SafeText
          position={[0.108, -h * 0.03, face + 0.006]}
          fontSize={0.034}
          color={mode === 'current' ? '#2fe0cf' : '#49556a'}
          anchorX="center"
          anchorY="middle"
        >
          A
        </SafeText>
      </group>

      {/* probe jacks, on the top face facing the board */}
      {(['red', 'black'] as const).map((pin) => {
        const offset = DMM_PROBE_OFFSET[pin];
        const isRed = pin === 'red';
        const armed = armedPin === pin;
        return (
          <group key={pin} position={offset}>
            <mesh
              onClick={(e) => {
                e.stopPropagation();
                onProbeClick(pin, e);
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
              <cylinderGeometry args={[0.03, 0.034, 0.055, 16]} />
              <meshStandardMaterial
                color={isRed ? '#d8232a' : '#15181f'}
                roughness={0.3}
                metalness={0.45}
                emissive={armed ? new THREE.Color('#fbbf24') : new THREE.Color('#000000')}
                emissiveIntensity={armed ? 0.8 : 0}
              />
            </mesh>
            <mesh position={[0, 0.034, 0]}>
              <cylinderGeometry args={[0.013, 0.013, 0.022, 12]} />
              <meshStandardMaterial color="#c9a227" metalness={0.9} roughness={0.25} />
            </mesh>
            <SafeText
              position={[0, 0.054, 0]}
              rotation={[-Math.PI / 2, 0, 0]}
              fontSize={0.032}
              color={isRed ? '#ff8a8a' : '#cfdbe8'}
              anchorX="center"
              anchorY="middle"
              outlineWidth={0.004}
              outlineColor="#11161d"
            >
              {isRed ? 'VΩ' : 'COM'}
            </SafeText>
            {armed ? (
              <mesh position={[0, 0.046, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[0.038, 0.052, 20]} />
                <meshBasicMaterial color="#fbbf24" transparent opacity={0.9} />
              </mesh>
            ) : null}
          </group>
        );
      })}

      <Designator position={[0, 0.004, d / 2 + 0.14]} text={label} tone={live ? 'ok' : 'idle'} />

      {selected || highlighted ? (
        <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.36, 0.39, 32]} />
          <meshBasicMaterial color={selected ? '#2fe0cf' : '#fbbf24'} transparent opacity={0.85} />
        </mesh>
      ) : null}
    </group>
  );
}
