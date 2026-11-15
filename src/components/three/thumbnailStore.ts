'use client';

import { useSyncExternalStore } from 'react';

import { LIBRARY_ORDER } from '@/lib/circuit/componentDefs';
import type { ComponentKind } from '@/lib/circuit/types';

/**
 * Cache of component-library thumbnails, kept deliberately free of any three.js
 * import.
 *
 * The sidebar only needs to *read* the rendered PNGs. If it imported them from
 * the module that builds them, bundling would pull the whole 3D runtime into
 * the initial page chunk (149 kB -> 448 kB first load) for every student,
 * including those who never open the workbench. The renderer lives in
 * `PartThumbnails.tsx` and is loaded dynamically; this module is the seam.
 */

const CACHE_KEY = 'boardmaster.thumbs.v7';

let thumbs: Partial<Record<ComponentKind, string>> = {};
const listeners = new Set<() => void>();

function loadCache(): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    if (raw) thumbs = JSON.parse(raw) as Partial<Record<ComponentKind, string>>;
  } catch {
    thumbs = {};
  }
}
loadCache();

export function setThumbnail(kind: ComponentKind, dataUrl: string): void {
  thumbs = { ...thumbs, [kind]: dataUrl };
  for (const l of listeners) l();
  try {
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(thumbs));
  } catch {
    // sessionStorage can be unavailable or full; thumbnails are a nicety.
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = (): Partial<Record<ComponentKind, string>> => thumbs;
const getServerSnapshot = (): Partial<Record<ComponentKind, string>> => ({});

/** The rendered PNG for a part, or null while it is still being generated. */
export function usePartThumbnail(kind: ComponentKind): string | null {
  const all = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return all[kind] ?? null;
}

/** True once every part in the catalogue has a thumbnail. */
export function useThumbnailsReady(): boolean {
  const all = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return LIBRARY_ORDER.every((k) => all[k] !== undefined);
}

/** Non-reactive read, for the forge to skip work already done. */
export function thumbnailsComplete(): boolean {
  return LIBRARY_ORDER.every((k) => thumbs[k] !== undefined);
}
