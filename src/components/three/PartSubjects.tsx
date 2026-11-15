'use client';

import { useMemo } from 'react';

import type { ComponentKind } from '@/lib/circuit/types';
import {
  BuzzerMesh,
  CapacitorMesh,
  DiodeMesh,
  FuseMesh,
  InductorMesh,
  LedMesh,
  PhotoresistorMesh,
  PowerSupplyMesh,
  ResistorMesh,
} from './Parts';
import { BatteryMesh, PotentiometerMesh, PushButtonMesh, RgbLedMesh, SwitchMesh } from './PartsExtra';
import { BatteryPackMesh, MultimeterMesh } from './BenchInstruments';
import { McuBoardMesh } from './McuBoard';

/**
 * How each catalogue part is posed and framed for a preview.
 *
 * Shared by the thumbnail forge (which renders these once to cached PNGs) and
 * the live spotlight (which renders the hovered part every frame), so a part
 * always looks the same whichever path drew it.
 */

/* --------------------------- framing per part --------------------------- */

export interface Framing {
  /** Camera distance in world units, sized so the part fills the frame. */
  distance: number;
  /** Height of the subject's visual centre, in world units. */
  centreY: number;
}

/**
 * Per-part framing.
 *
 * At 48 px every pixel counts, so the part is shot against a transparent
 * background like a catalogue photo rather than sitting on a board slab — a
 * slab large enough to seat the leads swallowed most of the frame and left the
 * component itself unreadable.
 *
 * Visible extent at fov 32 is about 0.573 x distance, so distance is roughly
 * 2 x the part's largest dimension.
 */
export const FRAMING: Partial<Record<ComponentKind, Framing>> = {
  // The boards are 1.45 x 0.56 units; at fov 32 the visible extent is about
  // 0.573 x distance, so anything under ~2.5 puts the camera inside the PCB.
  arduino_uno: { distance: 2.75, centreY: 0.07 },
  esp32: { distance: 2.5, centreY: 0.07 },
  dc_source: { distance: 2.0, centreY: 0.21 },
  battery_pack: { distance: 1.5, centreY: 0.13 },
  multimeter: { distance: 1.25, centreY: 0.17 },
  battery: { distance: 1.25, centreY: 0.25 },
  resistor: { distance: 0.95, centreY: 0.185 },
  potentiometer: { distance: 0.95, centreY: 0.25 },
  photoresistor: { distance: 0.58, centreY: 0.2 },
  capacitor: { distance: 0.66, centreY: 0.255 },
  inductor: { distance: 0.95, centreY: 0.185 },
  led: { distance: 0.72, centreY: 0.29 },
  rgb_led: { distance: 0.76, centreY: 0.29 },
  diode: { distance: 0.78, centreY: 0.178 },
  switch: { distance: 0.78, centreY: 0.185 },
  pushbutton: { distance: 0.56, centreY: 0.19 },
  fuse: { distance: 0.98, centreY: 0.19 },
  buzzer: { distance: 0.66, centreY: 0.22 },
  breadboard: { distance: 2.3, centreY: 0.05 },
};

export const DEFAULT_FRAMING: Framing = { distance: 0.8, centreY: 0.19 };

/* ---------------------------- the subject ---------------------------- */

/** Pin positions in world x/z for a part laid out horizontally about the origin. */
function pinRow(count: number, pitch: number): Array<[number, number]> {
  const span = (count - 1) * pitch;
  return Array.from({ length: count }, (_, i) => [-span / 2 + i * pitch, 0] as [number, number]);
}

export function Subject({ kind }: { kind: ComponentKind }) {
  const common = { selected: false, highlighted: false, label: '' };

  switch (kind) {
    case 'resistor': {
      const [a, b] = pinRow(2, 0.4);
      return <ResistorMesh a={a!} b={b!} ohms={330} current={0} {...common} />;
    }
    case 'led': {
      const [a, b] = pinRow(2, 0.2);
      return (
        <LedMesh
          anode={a!}
          cathode={b!}
          brightness={0.85}
          lit
          reverseBiased={false}
          {...common}
        />
      );
    }
    case 'capacitor': {
      const [a, b] = pinRow(2, 0.2);
      return <CapacitorMesh plus={a!} minus={b!} {...common} />;
    }
    case 'diode': {
      const [a, b] = pinRow(2, 0.3);
      return <DiodeMesh a={a!} b={b!} reverseBiased={false} conducting {...common} />;
    }
    case 'inductor': {
      const [a, b] = pinRow(2, 0.4);
      return <InductorMesh a={a!} b={b!} {...common} />;
    }
    case 'fuse': {
      const [a, b] = pinRow(2, 0.4);
      return <FuseMesh a={a!} b={b!} blown={false} {...common} />;
    }
    case 'photoresistor': {
      const [a, b] = pinRow(2, 0.2);
      return <PhotoresistorMesh a={a!} b={b!} illumination={0.7} {...common} />;
    }
    case 'buzzer': {
      const [a, b] = pinRow(2, 0.2);
      return <BuzzerMesh a={a!} b={b!} sounding={false} {...common} />;
    }
    case 'switch': {
      const [a, b] = pinRow(2, 0.3);
      return <SwitchMesh a={a!} b={b!} closed {...common} />;
    }
    case 'pushbutton': {
      const [a, b] = pinRow(2, 0.2);
      return <PushButtonMesh a={a!} b={b!} pressed={false} {...common} />;
    }
    case 'battery': {
      const [a, b] = pinRow(2, 0.5);
      return <BatteryMesh a={a!} b={b!} {...common} />;
    }
    case 'potentiometer':
      return <PotentiometerMesh pins={pinRow(3, 0.2)} wiper={0.65} {...common} />;
    case 'rgb_led':
      return <RgbLedMesh pins={pinRow(4, 0.1)} channels={['R', 'B']} brightness={0.8} {...common} />;
    case 'dc_source':
      return (
        <PowerSupplyMesh
          position={[0, 0, 0]}
          volts={5}
          current={0.00909}
          selected={false}
          highlighted={false}
          label=""
          armedPin={null}
          onTerminalClick={() => undefined}
          onBodyClick={() => undefined}
        />
      );
    case 'battery_pack':
      return (
        <BatteryPackMesh
          position={[0, 0, 0]}
          volts={9}
          current={0}
          selected={false}
          highlighted={false}
          label=""
          armedPin={null}
          onTerminalClick={() => undefined}
          onBodyClick={() => undefined}
        />
      );
    case 'multimeter':
      return (
        <MultimeterMesh
          position={[0, 0, 0]}
          reading="2.000 V"
          caption="N1 to RAIL_TN"
          mode="voltage"
          live
          selected={false}
          highlighted={false}
          label=""
          armedPin={null}
          onProbeClick={() => undefined}
          onBodyClick={() => undefined}
        />
      );
    case 'arduino_uno':
    case 'esp32':
      return (
        <McuBoardMesh
          boardId={kind === 'esp32' ? 'esp32' : 'arduino_uno'}
          position={[0, 0, 0]}
          // Posed with pin 13 driven HIGH, matching the sketch the lab opens
          // with, so the catalogue photo shows a board that is doing something.
          pins={{ d13: { mode: 'output', value: 1 } }}
          armedPin={null}
          onPinClick={() => undefined}
          onBodyClick={() => undefined}
          {...common}
        />
      );
    case 'breadboard':
      return <BreadboardChip />;
    default:
      return null;
  }
}

/** A small stand-in for the breadboard: a slab with a grid of holes. */
function BreadboardChip() {
  const holes: Array<[number, number]> = [];
  for (let c = 0; c < 9; c++) {
    for (let r = 0; r < 6; r++) {
      holes.push([(c - 4) * 0.1, (r - 2.5) * 0.1 + (r > 2 ? 0.08 : -0.08)]);
    }
  }
  return (
    <group position={[0, 0.05, 0]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[1.05, 0.1, 0.85]} />
        <meshStandardMaterial color="#e9e7e0" roughness={0.72} />
      </mesh>
      {holes.map(([x, z], i) => (
        <mesh key={i} position={[x, 0.052, z]}>
          <boxGeometry args={[0.04, 0.012, 0.04]} />
          <meshStandardMaterial color="#2a2a2c" roughness={0.45} metalness={0.5} />
        </mesh>
      ))}
      {[-0.38, 0.38].map((z) => (
        <mesh key={z} position={[0, 0.053, z]}>
          <boxGeometry args={[0.95, 0.008, 0.012]} />
          <meshBasicMaterial color={z < 0 ? '#d8232a' : '#2b4fd0'} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

