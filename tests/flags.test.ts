import { describe, expect, test } from "bun:test";
import { parseFlags } from "../src/cli/flags.ts";

describe("CLI flag parser", () => {
  test("parses value flags in space-separated and equals forms", () => {
    const parsed = parseFlags(["--peer-id", "peer-1", "--session-id=session-1", "rest", "--force"]);

    expect(parsed.flags).toEqual({ "peer-id": "peer-1", "session-id": "session-1" });
    expect(parsed.boolFlags.has("force")).toBe(true);
    expect(parsed.rest).toEqual(["rest"]);
  });
});
