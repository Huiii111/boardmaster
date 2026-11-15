'use client';

import { useSyncExternalStore } from 'react';

import type { ComponentKind } from '@/lib/circuit/types';

/**
 * Coordination for the live part preview.
 *
 * Browsers cap WebGL contexts at about 16 (measured: creating 40 leaves 16
 * alive, the rest silently lost), so one `<canvas>` per library item does not
 * scale — we have 19 parts. The way round it is that **2D canvas contexts are
 * not scarce**: a single shared WebGL renderer draws the part, and the result
 * is blitted with `drawImage` into each tile's own cheap 2D canvas.
 *
 * This module is the seam between the tiles and that renderer, and deliberately
 * imports no three.js so the sidebar does not drag the 3D runtime into the
 * initial bundle.
 */

interface State {
  /** The part currently being hovered, or null. */
  kind: ComponentKind | null;
  /** The tile canvas to blit into. */
  target: HTMLCanvasElement | null;
}

let state: State = { kind: null, target: null };
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/** Called by a tile when the pointer enters it. */
export function beginLivePreview(kind: ComponentKind, target: HTMLCanvasElement): void {
  if (state.kind === kind && state.target === target) return;
  state = { kind, target };
  emit();
}

/** Called by a tile when the pointer leaves it. */
export function endLivePreview(kind: ComponentKind): void {
  if (state.kind !== kind) return;
  state = { kind: null, target: null };
  emit();
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = (): State => state;
const getServerSnapshot = (): State => ({ kind: null, target: null });

export function useLivePreview(): State {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Non-reactive read, for the render loop. */
export function currentLivePreview(): State {
  return state;
}
