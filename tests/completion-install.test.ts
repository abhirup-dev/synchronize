import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { carapaceSpecDir, installCarapaceCompletion } from "../src/cli/completion/install.ts";

describe("completion install", () => {
  test("resolves the macOS Carapace spec directory", () => {
    expect(carapaceSpecDir({ HOME: "/tmp/home" }, "darwin")).toBe("/tmp/home/Library/Application Support/carapace/specs");
  });

  test("resolves the XDG Carapace spec directory on non-macOS platforms", () => {
    expect(carapaceSpecDir({ XDG_CONFIG_HOME: "/tmp/config", HOME: "/tmp/home" }, "linux")).toBe("/tmp/config/carapace/specs");
  });

  test("writes the generated synchronize spec non-interactively", async () => {
    const home = await mkdtemp(join(tmpdir(), "synchronize-completion-install-"));
    try {
      const result = await installCarapaceCompletion({ env: { HOME: home }, platform: "darwin" });
      expect(result.path).toBe(join(home, "Library", "Application Support", "carapace", "specs", "synchronize.yaml"));
      const raw = await readFile(result.path, "utf8");
      const spec = JSON.parse(raw) as { name: string };
      expect(spec.name).toBe("synchronize");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
