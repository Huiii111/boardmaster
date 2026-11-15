'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { LIBRARY_ORDER } from '@/lib/circuit/componentDefs';
import { setThumbnail, useThumbnailsReady } from './thumbnailStore';
import { DEFAULT_FRAMING, FRAMING, Subject } from './PartSubjects';
import { StudioEnvironment } from './StudioEnvironment';

/**
 * Component-library thumbnails rendered from the real 3D meshes.
 *
 * The library should show the actual model a student is about to place, not a
 * generic glyph. Giving each of the fifteen entries its own `<Canvas>` would
 * mean fifteen WebGL contexts — browsers cap out around sixteen — so instead a
 * single hidden renderer walks the catalogue, renders each part, captures it
 * with `toDataURL`, and caches the PNG. After the last part the canvas unmounts
 * and the WebGL context is released.
 *
 * Thumbnails are cached in `sessionStorage`, so the forge only runs once per
 * session rather than on every mount.
 */

/* ------------------------------ the forge ------------------------------ */

function Forge({ onDone }: { onDone: () => void }) {
  const { gl, scene, camera } = useThree();
  const [index, setIndex] = useState(0);
  const settle = useRef(0);

  const kind = LIBRARY_ORDER[index];
  const framing = (kind && FRAMING[kind]) ?? DEFAULT_FRAMING;

  useEffect(() => {
    settle.current = 0;
  }, [index]);

  useFrame(() => {
    if (!kind) return;
    settle.current += 1;
    // Give materials, geometry and troika's asynchronously-loaded text time to
    // appear. Four frames captured every part before a single label had
    // rendered, so instruments came out as blank boxes.
    if (settle.current < 24) return;

    gl.render(scene, camera);
    try {
      setThumbnail(kind, gl.domElement.toDataURL('image/png'));
    } catch {
      // A tainted or lost context just means no thumbnail; the icon shows instead.
    }

    if (index + 1 >= LIBRARY_ORDER.length) onDone();
    else setIndex(index + 1);
  });

  if (!kind) return null;

  return (
    <>
      <PerspectiveRig distance={framing.distance} centreY={framing.centreY} />
      <StudioEnvironment intensity={1.1} />
      <ambientLight intensity={0.6} />
      <hemisphereLight args={['#cfe4ff', '#20242b', 0.8]} />
      <directionalLight position={[0.8, 1.4, 0.9]} intensity={2.2} />
      <directionalLight position={[-0.9, 0.6, -0.5]} intensity={0.7} color="#9ec8ff" />
      <Subject kind={kind} />
    </>
  );
}

function PerspectiveRig({ distance, centreY }: { distance: number; centreY: number }) {
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(distance * 0.55, distance * 0.72, distance);
    camera.lookAt(0, centreY, 0);
    camera.updateProjectionMatrix();
  }, [camera, distance, centreY]);
  return null;
}

/**
 * Mount once, near the root. Renders the catalogue to PNGs then unmounts
 * itself, releasing the WebGL context.
 */
export function ThumbnailForge() {
  const ready = useThumbnailsReady();
  const [done, setDone] = useState(false);
  const handleDone = useCallback(() => setDone(true), []);

  if (ready || done) return null;

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        left: -9999,
        top: 0,
        width: 160,
        height: 160,
        pointerEvents: 'none',
      }}
    >
      <Canvas
        frameloop="always"
        dpr={2}
        gl={{
          // Required for toDataURL to return the rendered frame.
          preserveDrawingBuffer: true,
          alpha: true,
          antialias: true,
        }}
        camera={{ fov: 32, near: 0.01, far: 40 }}
        onCreated={({ gl, scene }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.1;
          scene.background = null;
        }}
      >
        <Forge onDone={handleDone} />
      </Canvas>
    </div>
  );
}
