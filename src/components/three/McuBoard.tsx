'use client';

import * as THREE from 'three';

import { PITCH } from '@/lib/circuit/breadboard';
import { boardDef, type BoardId } from '@/lib/mcu/board';
import { SafeText } from './SafeText';
import { Designator } from './Parts';

/**
 * A microcontroller dev board standing on the bench.
 *
 * Every header pin is individually clickable so a student wires from the exact
 * pin their sketch names. A pin the code is driving glows, which makes the link
 * between the editor and the circuit visible in the scene itself.
 */

export interface McuBoardProps {
  boardId: BoardId;
  position: [number, number, number];
  /** Pin states from the last sketch run. */
  pins: Record<string, { mode: 'input' | 'output' | 'input_pullup'; value: number }>;
  selected: boolean;
  highlighted: boolean;
  label: string;
  armedPin: string | null;
  onPinClick: (pinId: string, event: { stopPropagation: () => void }) => void;
  onBodyClick: (event: { stopPropagation: () => void }) => void;
  onBodyPointerDown?: (event: { stopPropagation: () => void }) => void;
}

/** World offset of a header pin relative to the board origin. */
export function mcuPinOffset(boardId: BoardId, pinId: string): [number, number, number] | null {
  const pin = boardDef(boardId).pins.find((p) => p.id === pinId);
  if (!pin) return null;
  return [pin.x * PITCH, 0.085, pin.row * 0.21];
}

export function McuBoardMesh({
  boardId,
  position,
  pins,
  selected,
  highlighted,
  label,
  armedPin,
  onPinClick,
  onBodyClick,
  onBodyPointerDown,
}: McuBoardProps) {
  const board = boardDef(boardId);
  const isEsp = boardId === 'esp32';
  const w = 1.45;
  const d = 0.56;
  const h = 0.035;
  const pcb = isEsp ? '#1b1f2a' : '#0d7a8c';

  return (
    <group position={position}>
      {/* PCB */}
      <mesh
        position={[0, h / 2 + 0.012, 0]}
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
        <meshStandardMaterial color={pcb} roughness={0.5} metalness={0.15} />
      </mesh>

      {/* standoffs */}
      {[
        [-w / 2 + 0.05, -d / 2 + 0.05],
        [w / 2 - 0.05, -d / 2 + 0.05],
        [-w / 2 + 0.05, d / 2 - 0.05],
        [w / 2 - 0.05, d / 2 - 0.05],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x ?? 0, 0.006, z ?? 0]}>
          <cylinderGeometry args={[0.022, 0.024, 0.012, 10]} />
          <meshStandardMaterial color="#0a0d12" roughness={0.9} />
        </mesh>
      ))}

      {/* the main chip */}
      <mesh position={[0.12, h + 0.025, 0]} castShadow>
        <boxGeometry args={[isEsp ? 0.3 : 0.42, 0.028, 0.14]} />
        <meshStandardMaterial color="#15171c" roughness={0.45} />
      </mesh>
      <SafeText
        position={[0.12, h + 0.041, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.032}
        color="#6f7784"
        anchorX="center"
        anchorY="middle"
      >
        {isEsp ? 'ESP32' : 'ATmega328P'}
      </SafeText>

      {/* USB socket */}
      <mesh position={[-w / 2 + 0.06, h + 0.04, 0]} castShadow>
        <boxGeometry args={[0.16, 0.055, 0.2]} />
        <meshStandardMaterial color="#9aa1ad" metalness={0.8} roughness={0.3} />
      </mesh>

      {/* indicator LEDs: power, plus the TX/RX pair every Uno has */}
      {[
        { x: -0.35, z: -0.17, c: '#39d98a' },
        { x: -0.29, z: -0.17, c: '#f4b942' },
        { x: -0.23, z: -0.17, c: '#f4b942' },
      ].map((led, i) => (
        <mesh key={i} position={[led.x, h + 0.03, led.z]}>
          <boxGeometry args={[0.026, 0.014, 0.02]} />
          <meshStandardMaterial
            color={led.c}
            emissive={new THREE.Color(led.c)}
            emissiveIntensity={i === 0 ? 1.6 : 0.25}
            toneMapped={false}
          />
        </mesh>
      ))}

      {/* 16 MHz crystal can */}
      <mesh position={[-0.12, h + 0.028, 0.06]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <capsuleGeometry args={[0.022, 0.06, 4, 12]} />
        <meshStandardMaterial color="#b8bdc5" metalness={0.88} roughness={0.28} envMapIntensity={1.4} />
      </mesh>

      {/* reset button */}
      <mesh position={[-0.46, h + 0.032, 0.12]} castShadow>
        <boxGeometry args={[0.055, 0.03, 0.055] } />
        <meshStandardMaterial color="#1b1e24" roughness={0.6} />
      </mesh>
      <mesh position={[-0.46, h + 0.052, 0.12]}>
        <cylinderGeometry args={[0.016, 0.016, 0.014, 16]} />
        <meshStandardMaterial color="#c0392b" roughness={0.45} />
      </mesh>

      {/* barrel jack */}
      <mesh position={[-w / 2 + 0.08, h + 0.038, 0.18]} castShadow>
        <boxGeometry args={[0.17, 0.065, 0.13]} />
        <meshStandardMaterial color="#111318" roughness={0.7} />
      </mesh>

      {/* electrolytic caps and a regulator, the bits that make a board look populated */}
      {[
        { x: -0.02, z: 0.14, r: 0.028, hh: 0.05 },
        { x: 0.05, z: 0.14, r: 0.024, hh: 0.045 },
      ].map((cap, i) => (
        <mesh key={i} position={[cap.x, h + cap.hh / 2 + 0.012, cap.z]} castShadow>
          <cylinderGeometry args={[cap.r, cap.r, cap.hh, 16]} />
          <meshStandardMaterial color="#1b3a6b" roughness={0.42} metalness={0.25} />
        </mesh>
      ))}
      <mesh position={[0.32, h + 0.03, 0.16]} castShadow>
        <boxGeometry args={[0.07, 0.04, 0.025]} />
        <meshStandardMaterial color="#1a1c22" roughness={0.55} />
      </mesh>

      {/* a scatter of SMD passives, so the board is not a bare slab */}
      {[
        [-0.2, -0.05], [-0.05, -0.08], [0.3, -0.06], [0.45, 0.05],
        [0.5, -0.12], [-0.4, 0.04], [0.18, 0.15], [-0.3, 0.16],
      ].map(([x, z], i) => (
        <mesh key={`smd-${i}`} position={[x ?? 0, h + 0.016, z ?? 0]}>
          <boxGeometry args={[0.026, 0.008, 0.014]} />
          <meshStandardMaterial color={i % 3 === 0 ? '#2a2d33' : '#b9a06a'} roughness={0.5} />
        </mesh>
      ))}

      {/* header strips */}
      {[-1, 1].map((row) => (
        <mesh key={row} position={[0, h + 0.022, row * 0.21]}>
          <boxGeometry args={[w * 0.92, 0.04, 0.07]} />
          <meshStandardMaterial color="#13161b" roughness={0.75} />
        </mesh>
      ))}

      {/* individual pins */}
      {board.pins.map((pin) => {
        const state = pins[pin.id];
        const driving = state?.mode === 'output' && state.value > 0;
        const isArmed = armedPin === pin.id;
        const x = pin.x * PITCH;
        const z = pin.row * 0.21;
        const tone =
          pin.kind === 'ground'
            ? '#2a2d33'
            : pin.kind === 'power'
              ? '#c0452f'
              : driving
                ? '#34d399'
                : '#b9bcc2';

        return (
          <group key={pin.id} position={[x, h + 0.045, z]}>
            <mesh
              onClick={(e) => {
                e.stopPropagation();
                onPinClick(pin.id, e);
              }}
              onPointerOver={(e) => {
                e.stopPropagation();
                document.body.style.cursor = 'crosshair';
              }}
              onPointerOut={() => {
                document.body.style.cursor = 'auto';
              }}
            >
              {/* A generous invisible hit area: a 2.54 mm pin is tiny on screen. */}
              <cylinderGeometry args={[0.028, 0.028, 0.08, 8]} />
              <meshBasicMaterial visible={false} />
            </mesh>
            <mesh castShadow>
              <boxGeometry args={[0.018, 0.055, 0.018]} />
              <meshStandardMaterial
                color={tone}
                metalness={0.85}
                roughness={0.3}
                emissive={
                  isArmed
                    ? new THREE.Color('#fbbf24')
                    : driving
                      ? new THREE.Color('#34d399')
                      : new THREE.Color('#000000')
                }
                emissiveIntensity={isArmed ? 1.1 : driving ? 0.8 : 0}
              />
            </mesh>
            {isArmed ? (
              <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[0.03, 0.042, 16]} />
                <meshBasicMaterial color="#fbbf24" transparent opacity={0.95} />
              </mesh>
            ) : null}
            {/* silkscreen pin number, every other pin so they stay legible */}
            <SafeText
              position={[0, -0.012, pin.row * 0.055]}
              rotation={[-Math.PI / 2, 0, 0]}
              fontSize={0.027}
              color={driving ? '#34d399' : '#8d94a0'}
              anchorX="center"
              anchorY="middle"
            >
              {pin.label}
            </SafeText>
          </group>
        );
      })}

      {/* The designator, on the same silkscreen plate every part uses. */}
      <Designator
        position={[0, 0.004, d / 2 + 0.17]}
        text={label}
        tone={
          Object.values(pins).some((p) => p.mode === 'output' && p.value > 0) ? 'ok' : 'idle'
        }
      />

      {selected || highlighted ? (
        <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.8, 0.84, 40]} />
          <meshBasicMaterial color={selected ? '#2fe0cf' : '#fbbf24'} transparent opacity={0.85} />
        </mesh>
      ) : null}
    </group>
  );
}
