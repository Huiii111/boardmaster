'use client';

import { useEffect, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { ContactShadows, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

import { padPosition } from '@/lib/pcb/geometry';
import { renderBoardArtwork } from '@/lib/pcb/artwork';
import type { PcbBoard, PcbFootprint } from '@/lib/pcb/types';
import { resistorBands } from '@/lib/format';
import { StudioEnvironment } from '@/components/three/StudioEnvironment';

/**
 * Fabricated-board preview: the student's layout as it would come back from
 * manufacture.
 *
 * The copper layer, ground pour, solder mask and silkscreen are rendered into a
 * texture by `lib/pcb/artwork.ts` and mapped onto the board, which is how real
 * PCB renders are built. Geometry is reserved for things that genuinely have
 * depth: plated through-holes, solder fillets, mounting holes and the parts.
 * Modelling each trace as a 3D box instead — the previous approach — gives the
 * flat, sparse look of a bare slab with a few ridges on it.
 *
 * Every pixel of that artwork comes from this student's `PcbBoard`. It is not a
 * stock model: re-route a net and the pour, clearances and traces all change.
 */

export type MaskColor = 'green' | 'blue' | 'red' | 'black' | 'purple' | 'white';

const MASK: Record<MaskColor, { base: string; pour: string; trace: string; silk: string; edge: string }> = {
  green: { base: '#0a5c36', pour: '#136b42', trace: '#2cc184', silk: '#f2f5f0', edge: '#b9a06a' },
  blue: { base: '#0d3a73', pour: '#164a8c', trace: '#4a9bf0', silk: '#f2f5f0', edge: '#b9a06a' },
  red: { base: '#7d1119', pour: '#9a1b24', trace: '#f06a6a', silk: '#f8f4f2', edge: '#b9a06a' },
  black: { base: '#121418', pour: '#1e2228', trace: '#6a7483', silk: '#e9ecef', edge: '#6b6350' },
  purple: { base: '#3f1860', pour: '#4e1f77', trace: '#a96fd4', silk: '#f4f0f8', edge: '#b9a06a' },
  white: { base: '#dcdcd6', pour: '#e6e6df', trace: '#9a978c', silk: '#2a2d31', edge: '#c5b48a' },
};

const THICKNESS = 1.6;
const GOLD = '#dcb45e';
const SOLDER = '#b8bcc4';

export interface PcbPreview3DProps {
  board: PcbBoard;
  maskColor: MaskColor;
  showMask: boolean;
  showSilkscreen: boolean;
  showComponents: boolean;
  flaggedTraces: Set<string>;
}

export function PcbPreview3D(props: PcbPreview3DProps) {
  const { board } = props;
  const span = Math.max(board.width, board.height);

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      camera={{ position: [span * 0.14, span * 0.92, span * 0.98], fov: 36, near: 1, far: span * 14 }}
      onCreated={({ gl, scene }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.15;
        scene.background = new THREE.Color('#eef2f7');
      }}
    >
      <StudioLighting span={span} />
      <BoardMesh {...props} />
      <ContactShadows
        position={[0, -THICKNESS / 2 - 0.2, 0]}
        opacity={0.6}
        scale={span * 2.2}
        blur={2.6}
        far={span * 0.6}
        color="#000000"
      />
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={span * 0.3}
        maxDistance={span * 3}
        maxPolarAngle={Math.PI / 2.03}
        mouseButtons={{
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN,
        }}
      />
    </Canvas>
  );
}

/**
 * Three-point studio rig plus a procedural environment map.
 *
 * The env map is generated in code rather than downloaded, so there is no CDN
 * dependency. It is what makes the solder mask and gold pads read as glossy:
 * metal with nothing to reflect looks like painted plastic.
 */
function StudioLighting({ span }: { span: number }) {
  return (
    <>
      <StudioEnvironment intensity={1} />
      <ambientLight intensity={0.35} />
      <directionalLight
        position={[span * 0.5, span * 1.1, span * 0.45]}
        intensity={2.1}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-span}
        shadow-camera-right={span}
        shadow-camera-top={span}
        shadow-camera-bottom={-span}
        shadow-bias={-0.0008}
      />
      <directionalLight position={[-span * 0.6, span * 0.5, -span * 0.5]} intensity={0.6} color="#8fc4ff" />
      <directionalLight position={[0, span * 0.3, span * 1.1]} intensity={0.45} color="#ffd9b0" />
    </>
  );
}

/* --------------------------------- board --------------------------------- */

function BoardMesh({
  board,
  maskColor,
  showMask,
  showSilkscreen,
  showComponents,
  flaggedTraces,
}: PcbPreview3DProps) {
  const palette = MASK[maskColor];
  const ox = -board.width / 2;
  const oz = -board.height / 2;

  const textures = useMemo(() => {
    if (typeof document === 'undefined') return null;
    const art = renderBoardArtwork(board, {
      showMask,
      showSilkscreen,
      mask: palette,
      flagged: flaggedTraces,
    });
    const map = new THREE.CanvasTexture(art.canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
    const rough = new THREE.CanvasTexture(art.roughness);
    rough.anisotropy = 8;
    return { map, rough };
  }, [board, showMask, showSilkscreen, palette, flaggedTraces]);

  useEffect(
    () => () => {
      textures?.map.dispose();
      textures?.rough.dispose();
    },
    [textures],
  );

  const mountingHoles = useMemo(() => {
    const inset = 3.4;
    return [
      [inset, inset],
      [board.width - inset, inset],
      [inset, board.height - inset],
      [board.width - inset, board.height - inset],
    ] as Array<[number, number]>;
  }, [board.width, board.height]);

  return (
    <group>
      {/* FR4 substrate — the edges show bare laminate, not solder mask. */}
      <mesh castShadow receiveShadow position={[0, -0.02, 0]}>
        <boxGeometry args={[board.width, THICKNESS, board.height]} />
        <meshStandardMaterial color={palette.edge} roughness={0.78} metalness={0.02} />
      </mesh>

      {/* Top artwork: copper, pour, mask and silkscreen in one texture. */}
      {textures ? (
        <mesh position={[0, THICKNESS / 2 - 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[board.width, board.height]} />
          <meshStandardMaterial
            map={textures.map}
            roughnessMap={textures.rough}
            roughness={1}
            metalness={0.5}
            envMapIntensity={1.1}
          />
        </mesh>
      ) : null}

      {/* Bottom face, so the board is not hollow from below. */}
      <mesh position={[0, -THICKNESS / 2 - 0.015, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[board.width, board.height]} />
        <meshStandardMaterial
          color={showMask ? palette.base : palette.edge}
          roughness={0.55}
          metalness={0.1}
        />
      </mesh>

      {/* Plated through-holes with solder fillets. */}
      {board.footprints.map((fp) =>
        fp.pads.map((pad) => {
          const p = padPosition(fp, pad);
          const drill = Math.max(0.6, pad.size - 1.0);
          return (
            <group key={pad.id} position={[p.x + ox, 0, p.y + oz]}>
              <mesh position={[0, THICKNESS / 2 + 0.16, 0]} castShadow>
                <coneGeometry args={[pad.size / 2 + 0.05, 0.44, 20, 1, true]} />
                <meshStandardMaterial
                  color={SOLDER}
                  metalness={0.95}
                  roughness={0.22}
                  side={THREE.DoubleSide}
                  envMapIntensity={1.4}
                />
              </mesh>
              <mesh>
                <cylinderGeometry args={[drill / 2, drill / 2, THICKNESS + 0.3, 18, 1, true]} />
                <meshStandardMaterial
                  color={GOLD}
                  metalness={0.95}
                  roughness={0.25}
                  side={THREE.DoubleSide}
                />
              </mesh>
              <mesh position={[0, -0.02, 0]}>
                <cylinderGeometry args={[drill / 2 - 0.06, drill / 2 - 0.06, THICKNESS + 0.5, 18]} />
                <meshBasicMaterial color="#05080c" />
              </mesh>
            </group>
          );
        }),
      )}

      {/* Mounting holes, as every real board has. */}
      {mountingHoles.map(([mx, my], i) => (
        <group key={i} position={[mx + ox, 0, my + oz]}>
          <mesh position={[0, THICKNESS / 2 - 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[1.6, 2.3, 24]} />
            <meshStandardMaterial
              color={GOLD}
              metalness={0.9}
              roughness={0.3}
              side={THREE.DoubleSide}
            />
          </mesh>
          <mesh>
            <cylinderGeometry args={[1.6, 1.6, THICKNESS + 0.4, 24]} />
            <meshBasicMaterial color="#05080c" />
          </mesh>
        </group>
      ))}

      {showComponents
        ? board.footprints.map((fp) => <MountedPart key={`p-${fp.id}`} fp={fp} ox={ox} oz={oz} />)
        : null}
    </group>
  );
}

/* ------------------------------ mounted parts ------------------------------ */

function MountedPart({ fp, ox, oz }: { fp: PcbFootprint; ox: number; oz: number }) {
  const top = THICKNESS / 2;
  const rot = (fp.rotation * Math.PI) / 180;
  const p0 = fp.pads[0];
  const p1 = fp.pads[1];
  const pitch = p0 && p1 ? Math.abs(p1.dx - p0.dx) : 2.54;

  return (
    <group position={[fp.x + ox, top, fp.y + oz]} rotation={[0, -rot, 0]}>
      {fp.kind === 'led' ? <MountedLed pitch={pitch} /> : null}
      {fp.kind === 'resistor' ? <MountedResistor pitch={pitch} /> : null}
      {fp.kind === 'capacitor' ? <MountedCapacitor pitch={pitch} /> : null}
      {fp.kind === 'dc_source' ? <MountedTerminalBlock pitch={pitch} /> : null}
    </group>
  );
}

function Legs({ pitch, height }: { pitch: number; height: number }) {
  return (
    <>
      {[-pitch / 2, pitch / 2].map((x) => (
        <mesh key={x} position={[x, height / 2, 0]} castShadow>
          <cylinderGeometry args={[0.26, 0.26, height, 8]} />
          <meshStandardMaterial color="#b9bcc2" metalness={0.92} roughness={0.22} />
        </mesh>
      ))}
    </>
  );
}

function MountedLed({ pitch }: { pitch: number }) {
  const r = 2.5;
  const stand = 1.8;
  return (
    <group>
      <Legs pitch={pitch} height={stand} />
      <group position={[0, stand, 0]}>
        <mesh position={[0, 0.45, 0]} castShadow>
          <cylinderGeometry args={[r + 0.55, r + 0.55, 0.9, 28]} />
          <meshPhysicalMaterial color="#d8241a" roughness={0.25} envMapIntensity={1.3} />
        </mesh>
        <mesh position={[0, 3.3, 0]} castShadow>
          <cylinderGeometry args={[r, r, 4.9, 28]} />
          <meshPhysicalMaterial
            color="#e22a1e"
            roughness={0.08}
            transmission={0.4}
            thickness={2}
            ior={1.55}
            envMapIntensity={1.5}
          />
        </mesh>
        <mesh position={[0, 5.75, 0]} castShadow>
          <sphereGeometry args={[r, 28, 18, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshPhysicalMaterial
            color="#ea3426"
            roughness={0.04}
            transmission={0.45}
            thickness={2}
            ior={1.55}
            envMapIntensity={1.8}
          />
        </mesh>
        <mesh position={[0.8, 1.9, 0]}>
          <cylinderGeometry args={[0.95, 0.5, 1.5, 14, 1, true]} />
          <meshStandardMaterial
            color="#8d9099"
            metalness={0.95}
            roughness={0.2}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>
    </group>
  );
}

function MountedResistor({ pitch }: { pitch: number }) {
  const stand = 1.1;
  const bodyLen = Math.max(5.5, pitch * 0.6);
  const bands = useMemo(() => resistorBands(330), []);
  return (
    <group>
      <Legs pitch={pitch} height={stand} />
      <group position={[0, stand + 1.15, 0]}>
        <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[1.15, 1.15, bodyLen, 24]} />
          <meshStandardMaterial color="#cdb086" roughness={0.45} metalness={0.05} envMapIntensity={0.9} />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[(s * bodyLen) / 2, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <sphereGeometry args={[1.15, 18, 12]} />
            <meshStandardMaterial color="#c3a67c" roughness={0.5} />
          </mesh>
        ))}
        {bands.map((c, i) => {
          const offsets = [-0.3, -0.15, 0.0, 0.3];
          return (
            <mesh key={i} position={[(offsets[i] ?? 0) * bodyLen, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[1.19, 1.19, 0.48, 24]} />
              <meshStandardMaterial color={c} roughness={0.35} envMapIntensity={0.8} />
            </mesh>
          );
        })}
        {[-1, 1].map((s) => {
          const run = Math.max(0.2, pitch / 2 - bodyLen / 2);
          return (
            <mesh
              key={`l${s}`}
              position={[s * (bodyLen / 2 + run / 2), 0, 0]}
              rotation={[0, 0, Math.PI / 2]}
            >
              <cylinderGeometry args={[0.26, 0.26, run, 8]} />
              <meshStandardMaterial color="#b9bcc2" metalness={0.92} roughness={0.22} />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}

function MountedCapacitor({ pitch }: { pitch: number }) {
  const stand = 0.7;
  const h = 7.5;
  return (
    <group>
      <Legs pitch={pitch} height={stand} />
      <group position={[0, stand, 0]}>
        <mesh position={[0, h / 2, 0]} castShadow>
          <cylinderGeometry args={[3.15, 3.15, h, 28]} />
          <meshStandardMaterial color="#17386c" roughness={0.3} metalness={0.35} envMapIntensity={1.1} />
        </mesh>
        <mesh position={[0, h + 0.12, 0]}>
          <cylinderGeometry args={[3.15, 3.15, 0.3, 28]} />
          <meshStandardMaterial color="#9aa3b1" metalness={0.85} roughness={0.25} />
        </mesh>
        {[0, Math.PI / 2].map((a) => (
          <mesh key={a} position={[0, h + 0.28, 0]} rotation={[0, a, 0]}>
            <boxGeometry args={[5.4, 0.12, 0.45]} />
            <meshStandardMaterial color="#6f7988" metalness={0.7} roughness={0.4} />
          </mesh>
        ))}
        <mesh position={[1.5, h / 2, 2.8]}>
          <boxGeometry args={[1.6, h * 0.88, 0.55]} />
          <meshStandardMaterial color="#e6e9ee" roughness={0.45} />
        </mesh>
      </group>
    </group>
  );
}

function MountedTerminalBlock({ pitch }: { pitch: number }) {
  const w = pitch + 5.3;
  const h = 9.5;
  const d = 7.8;
  return (
    <group position={[0, h / 2, 0]}>
      <mesh castShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color="#1d7a3a" roughness={0.42} envMapIntensity={0.9} />
      </mesh>
      {[-pitch / 2, pitch / 2].map((x) => (
        <group key={x} position={[x, h / 2 - 0.5, -0.8]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[1.55, 1.55, 1.1, 18]} />
            <meshStandardMaterial
              color="#cfd3d9"
              metalness={0.92}
              roughness={0.25}
              envMapIntensity={1.4}
            />
          </mesh>
          <mesh position={[0, 0.6, 0]}>
            <boxGeometry args={[2.3, 0.3, 0.5]} />
            <meshStandardMaterial color="#5f6670" metalness={0.7} roughness={0.4} />
          </mesh>
        </group>
      ))}
      {[-pitch / 2, pitch / 2].map((x) => (
        <mesh key={`h${x}`} position={[x, -1.8, d / 2 - 0.05]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[1.55, 1.55, 0.7, 16]} />
          <meshBasicMaterial color="#07140a" />
        </mesh>
      ))}
    </group>
  );
}
