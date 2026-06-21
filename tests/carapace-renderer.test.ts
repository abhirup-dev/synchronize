import { describe, expect, test } from "bun:test";
import { renderCarapaceSpec } from "../src/cli/completion/render-carapace.ts";

describe("Carapace renderer", () => {
  test("renders a parseable static spec from the CLI schema", () => {
    const spec = JSON.parse(renderCarapaceSpec()) as {
      name: string;
      commands: Array<{
        name: string;
        flags?: Record<string, string>;
        completion?: { flag?: Record<string, string[]>; positional?: string[][]; dashany?: string[] };
        commands?: Array<{
          name: string;
          flags?: Record<string, string>;
          completion?: { flag?: Record<string, string[]>; positional?: string[][] };
        }>;
      }>;
    };

    expect(spec.name).toBe("synchronize");
    expect(spec.commands.map((command) => command.name)).toContain("completion");

    const group = spec.commands.find((command) => command.name === "group");
    expect(group?.commands?.map((command) => command.name)).toEqual(["create", "describe", "join", "leave", "rename", "send", "history"]);

    const threadsSummary = spec.commands
      .find((command) => command.name === "threads")
      ?.commands?.find((command) => command.name === "summary");
    expect(threadsSummary?.flags?.["--format="]).toBe("Output format");
    expect(threadsSummary?.completion?.flag?.format).toEqual(["text", "json"]);
    expect(threadsSummary?.completion?.flag?.strategy).toEqual(["all", "first_k", "last_k", "first_last"]);

    const mediaShare = spec.commands
      .find((command) => command.name === "media")
      ?.commands?.find((command) => command.name === "share");
    expect(mediaShare?.completion?.positional?.[0]).toEqual(["$(synchronize completion complete group-names --format carapace)"]);
    expect(mediaShare?.completion?.positional?.[1]).toEqual(["$files"]);

    const spawn = spec.commands.find((command) => command.name === "spawn");
    expect(spawn?.flags?.["--repo="]).toBe("Repository path; required unless NAME resolves to a configured remote agent");
    expect(spawn?.completion?.flag?.repo).toEqual(["$directories"]);
    expect(spawn?.completion?.flag?.group).toEqual(["$(synchronize completion complete group-names --format carapace)"]);
    expect(spawn?.completion?.dashany).toEqual(["$files"]);
  });
});
