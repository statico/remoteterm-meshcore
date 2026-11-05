import { useSyncExternalStore, type SetStateAction } from 'react';

import type { HealthStatus } from '../types';

/**
 * Radio health arrives as a WS broadcast (every 60s plus on connection and
 * fanout changes). Held in App state, each pulse re-rendered the whole tree,
 * message list included, while only the status bar, settings and the security
 * warning read it. It lives here so only those views re-render.
 */

let health: HealthStatus | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getHealth(): HealthStatus | null {
  return health;
}

/** Same contract as a useState setter, so it can stand in for one. */
export function setHealth(next: SetStateAction<HealthStatus | null>): void {
  const value = typeof next === 'function' ? next(health) : next;
  if (value === health) return;
  health = value;
  for (const listener of listeners) listener();
}

export function useHealth(): HealthStatus | null {
  return useSyncExternalStore(subscribe, getHealth);
}

/** Only re-renders when the radio connects or disconnects. */
export function useRadioConnected(): boolean {
  return useSyncExternalStore(subscribe, () => health?.radio_connected ?? false);
}
