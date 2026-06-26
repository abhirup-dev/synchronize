import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installTabCompletion, tabCompletionPath } from "../src/cli/completion/install.ts";

describe("completion install", () => {
  test("resolves the default zsh Tab completion path", () => {
    expect(tabCompletionPath("zsh", { HOME: "/tmp/home" }, "darwin")).toBe("/tmp/home/.config/synchronize/completions/synchronize.zsh");
  });

  test("resolves the fish completion autoload path", () => {
    expect(tabCompletionPath("fish", { XDG_CONFIG_HOME: "/tmp/config", HOME: "/tmp/home" }, "linux")).toBe("/tmp/config/fish/completions/synchronize.fish");
  });

  test("writes the generated synchronize shell script non-interactively", async () => {
    const home = await mkdtemp(join(tmpdir(), "synchronize-completion-install-"));
    try {
      const result = await installTabCompletion("zsh", { env: { HOME: home }, platform: "darwin" });
      expect(result.path).toBe(join(home, ".config", "synchronize", "completions", "synchronize.zsh"));
      const raw = await readFile(result.path, "utf8");
      expect(raw).toContain("#compdef synchronize");
      expect(raw).toContain("synchronize completion tab complete --");
      expect(result.sourceHint).toBe(`source ${result.path}`);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
