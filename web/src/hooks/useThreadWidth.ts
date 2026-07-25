import { useEffect, useState } from "react";

const KEY = "synchronize.threadWidth";
const MIN = 320;
const MAX = 820;
const DEFAULT = 420;

/** Persisted width of the desktop thread split. Owned by the layout, since the
 *  surface that renders the split changes with the route. */
export function useThreadWidth(): [number, (width: number) => void] {
  const [width, setWidth] = useState<number>(() => {
    const stored = Number(localStorage.getItem(KEY));
    return Number.isFinite(stored) && stored >= MIN && stored <= MAX ? stored : DEFAULT;
  });
  useEffect(() => {
    localStorage.setItem(KEY, String(width));
  }, [width]);
  return [width, setWidth];
}
