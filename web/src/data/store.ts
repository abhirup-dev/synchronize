// Tiny snapshot store. Each `createSnapshot(initial)` returns a Snapshot<T>
// compatible with React.useSyncExternalStore — components subscribe, the store
// notifies on `set`, components re-render. Mutating helpers (push, replace)
// fan out a single notify per call.

import type { Snapshot } from "./types.ts";

export interface MutableSnapshot<T> extends Snapshot<T> {
  set(next: T): void;
  update(fn: (prev: T) => T): void;
}

export function createSnapshot<T>(initial: T): MutableSnapshot<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((fn) => fn());
  return {
    get: () => value,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    set: (next) => {
      if (next === value) return;
      value = next;
      notify();
    },
    update: (fn) => {
      const next = fn(value);
      if (next === value) return;
      value = next;
      notify();
    },
  };
}
