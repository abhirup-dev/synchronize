import { expect, test } from "bun:test";
import { computeThreadSummaryLayout, normalizeWheelDelta } from "../web/src/components/threadSummaryLayout.ts";

test("thread summary placements stay in content coordinates instead of sticking to viewport", () => {
  const laidOut = computeThreadSummaryLayout([
    { id: "early", desiredTop: 120, rowHalf: 32 },
    { id: "later", desiredTop: 360, rowHalf: 32 },
  ]);

  expect(laidOut.map((item) => ({ id: item.id, top: item.top }))).toEqual([
    { id: "early", top: 120 },
    { id: "later", top: 360 },
  ]);
});

test("thread summary collision layout distributes dense rows around their anchors", () => {
  const laidOut = computeThreadSummaryLayout([
    { id: "one", desiredTop: 100, rowHalf: 30 },
    { id: "two", desiredTop: 120, rowHalf: 30 },
    { id: "three", desiredTop: 140, rowHalf: 30 },
  ]);

  expect(laidOut.map((item) => item.id)).toEqual(["one", "two", "three"]);
  expect(laidOut[1]!.top - laidOut[0]!.top).toBeGreaterThanOrEqual(68);
  expect(laidOut[2]!.top - laidOut[1]!.top).toBeGreaterThanOrEqual(68);
  expect(laidOut[0]!.top).toBeLessThan(100);
  expect(laidOut[2]!.top).toBeGreaterThan(140);
});

test("thread summary wheel deltas normalize to chat scroll pixels", () => {
  expect(normalizeWheelDelta(24, 0, 900)).toBe(24);
  expect(normalizeWheelDelta(3, 1, 900)).toBe(48);
  expect(normalizeWheelDelta(1, 2, 900)).toBe(900);
});
