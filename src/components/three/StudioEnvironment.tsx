'use client';

import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * A procedural studio environment map.
 *
 * Metal and glossy plastic look like painted toys when there is nothing for
 * them to reflect — a tinned lead, a gold pad or an epoxy LED dome only reads
 * as that material because of what it mirrors. This bakes a small gradient sky
 * with an overhead soft-box into a cube map and hands it to the scene.
 *
 * Generated in code rather than downloaded: drei's `<Environment preset>`
 * fetches an HDR from a CDN at runtime, which this project deliberately avoids.
 */
export function StudioEnvironment({
  /** Overall brightness of the reflected surroundings. */
  intensity = 1,
}: {
  intensity?: number;
}) {
  const { scene, gl } = useThree();

  useEffect(() => {
    const envScene = new THREE.Scene();
    const geometry = new THREE.SphereGeometry(100, 24, 24);
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { uIntensity: { value: intensity } },
      vertexShader: `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float uIntensity;
        varying vec3 vPos;
        void main() {
          vec3 n = normalize(vPos);
          float h = n.y * 0.5 + 0.5;
          // Cool dark floor rising to a brighter cool sky.
          vec3 sky = mix(vec3(0.03, 0.045, 0.07), vec3(0.42, 0.54, 0.72), pow(h, 0.9));
          // Overhead soft-box: the highlight that makes metal look like metal.
          sky += vec3(1.0) * smoothstep(0.82, 0.98, h) * 1.9;
          // A warm key off to one side, so highlights are not uniformly white.
          float key = smoothstep(0.55, 0.95, dot(n, normalize(vec3(0.55, 0.7, 0.45))));
          sky += vec3(1.0, 0.86, 0.68) * key * 0.85;
          gl_FragColor = vec4(sky * uIntensity, 1.0);
        }`,
    });
    envScene.add(new THREE.Mesh(geometry, material));

    const pmrem = new THREE.PMREMGenerator(gl);
    pmrem.compileEquirectangularShader();
    const target = pmrem.fromScene(envScene);
    const previous = scene.environment;
    scene.environment = target.texture;

    return () => {
      scene.environment = previous;
      target.dispose();
      pmrem.dispose();
      geometry.dispose();
      material.dispose();
    };
  }, [scene, gl, intensity]);

  return null;
}
