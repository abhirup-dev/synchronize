import { expect, test } from "bun:test";
import { parseLaunchArgs } from "../src/cli/commands/launch.ts";

test("parseLaunchArgs supports launch options before target with separator", () => {
  expect(parseLaunchArgs(["--name", "databoy", "--", "claude", "--resume", "5c88"])).toEqual({
    target: "claude",
    name: "databoy",
    rest: ["--resume", "5c88"],
  });
});

test("parseLaunchArgs preserves target-first launch name form", () => {
  expect(parseLaunchArgs(["claude", "--name", "databoy", "--resume", "5c88"])).toEqual({
    target: "claude",
    name: "databoy",
    rest: ["--resume", "5c88"],
  });
});

test("parseLaunchArgs allows raw tool args after second separator", () => {
  expect(parseLaunchArgs(["--name", "databoy", "--", "claude", "--", "--name", "tool-name"])).toEqual({
    target: "claude",
    name: "databoy",
    rest: ["--name", "tool-name"],
  });
});
