'use client';

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';

import { FRAMING, Subject } from './PartSubjects';
import { StudioEnvironment } from './StudioEnvironment';
import { currentLivePreview, useLivePreview } from './livePreview';

/**
 * The single shared renderer behind every live part preview.
 *
 * One WebGL context serves all nineteen library tiles. Each frame it renders
 * whichever part is hovered, then copies the result into that tile's own 2D
 * canvas with `drawImage`. 2D contexts are not rationed the way WebGL contexts
 * are, so this scales to any number of tiles — the cost is one blit per frame,
 * not one GPU context per tile.
 *
 * `preserveDrawingBuffer` is required: without it the drawing buffer is cleared
 * at composite time and the copy comes out blank.
 */
export function PartSpotlight() {
  const { kind } = useLivePreview();

  // Nothing hovered: no context at all. The tiles fall back to their cached PNG.
  if (!kind) return null;

  return (
    <div
      aria-hidden
      style={{ position: 'fixed', left: -9999, top: 0, width: 192, height: 192, pointerEvents: 'none' }}
    >
      <Canvas
        dpr={2}
        gl={{ preserveDrawingBuffer: true, alpha: true, antialias: true }}
        camera={{ fov: 32, near: 0.01, far: 40 }}
        onCreated={({ gl, scene }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.1;
          scene.background = null;
        }}
      >
        <SpotlightScene />
      </Canvas>
    </div>
  );
}

function SpotlightScene() {
  const { gl, scene, camera } = useThree();
  const spin = useRef(0);
  const { kind } = useLivePreview();
  const framing = (kind && FRAMING[kind]) ?? { distance: 0.8, centreY: 0.19 };

  useFrame((_, delta) => {
    const live = currentLivePreview();
    if (!live.kind || !live.target) return;

    spin.current += delta * 0.7;
    const d = framing.distance;
    camera.position.set(
      Math.sin(spin.current) * d * 0.78,
      d * 0.66,
      Math.cos(spin.current) * d * 0.78,
    );
    camera.lookAt(0, framing.centreY, 0);
    camera.updateProjectionMatrix();

    gl.render(scene, camera);

    // Blit into the tile's own 2D canvas. This is the step that sidesteps the
    // context cap: the tile never owns a WebGL context of its own.
    const ctx = live.target.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, live.target.width, live.target.height);
    ctx.drawImage(gl.domElement, 0, 0, live.target.width, live.target.height);
  });

  if (!kind) return null;

  return (
    <>
      <StudioEnvironment intensity={1.1} />
      <ambientLight intensity={0.6} />
      <hemisphereLight args={['#cfe4ff', '#20242b', 0.8]} />
      <directionalLight position={[0.8, 1.4, 0.9]} intensity={2.2} />
      <directionalLight position={[-0.9, 0.6, -0.5]} intensity={0.7} color="#9ec8ff" />
      <Subject kind={kind} />
    </>
  );
}
