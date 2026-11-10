"use client";

/**
 * Tiny shared store for the real loading state of the 3D pilot.
 * The pilot stage (lazy chunk) writes it, the loading screen (main chunk) reads it.
 */
type LoadState = { progress: number; ready: boolean };

let state: LoadState = { progress: 0, ready: false };
const listeners = new Set<() => void>();

export const loadSignal = {
  get: () => state,
  set(next: Partial<LoadState>) {
    state = { ...state, ...next };
    listeners.forEach((fn) => fn());
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};
