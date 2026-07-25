// The three routing invariants from docs/plans/routing-and-address-model.md,
// checked instead of asserted in a commit message. Each one is a rule about who
// may know what, so the check is a scan over source rather than a behaviour test.
import { expect, test } from "bun:test";
import { Glob } from "bun";
import { join } from "node:path";

const WEB_SRC = join(import.meta.dir, "..", "web", "src");

/** Everything under web/src, with the paths that legitimately break each rule
 *  named at the rule itself rather than in one shared allow-list. */
async function sources(): Promise<Array<{ path: string; text: string }>> {
  const files: Array<{ path: string; text: string }> = [];
  for await (const relative of new Glob("**/*.{ts,tsx}").scan(WEB_SRC)) {
    files.push({ path: relative, text: await Bun.file(join(WEB_SRC, relative)).text() });
  }
  return files;
}

const isStory = (path: string) => path.includes(".stories.");

test("only the routing layer spells a path under BASE", async () => {
  // A component that builds its own "/web/..." string is a second grammar that
  // drifts from the route tree silently.
  // data/daemon.ts is the API client: /web/state and /web/events are daemon
  // ENDPOINTS that happen to share the mount point, not client addresses.
  const allowed = ["routing/address.ts", "routing/router.tsx", "routing/AddressNotFound.tsx", "data/daemon.ts"];
  const offenders = (await sources())
    .filter((file) => !allowed.includes(file.path) && !isStory(file.path))
    .filter((file) => /["'`]\/web\//.test(file.text))
    .map((file) => file.path);
  expect(offenders).toEqual([]);
});

test("no component fetches directly — reads go through the DataSource", async () => {
  const allowed = ["data/daemon.ts", "data/mock.ts", "theme/ThemeTokenEditor.tsx"];
  const offenders = (await sources())
    .filter((file) => !allowed.includes(file.path) && !isStory(file.path))
    .filter((file) => /\bfetch\(/.test(file.text))
    .map((file) => file.path);
  expect(offenders).toEqual([]);
});

test("a navigation that stays on the same address replaces, never pushes", async () => {
  // `to: "."` means "same address, different modifier" — which is only ever
  // ?focus=. Pushing it would make back crawl through scroll positions instead
  // of leaving the room in one step.
  for (const file of await sources()) {
    for (const call of file.text.matchAll(/navigate\(\{[^}]*to: "\."[\s\S]{0,240}?\}\)/g)) {
      expect(call[0].includes("replace: true"), `${file.path}: ${call[0]}`).toBe(true);
    }
  }
});

test("no route-agnostic primitive imports a router hook", async () => {
  // These are reusable presentation, mounted under any address or none. One of
  // them importing a router hook makes it unmountable outside a RouterProvider.
  const primitives = [
    "components/primitives.tsx",
    "components/IconButton.tsx",
    "components/Iconography.tsx",
    "components/ContextMenu.tsx",
    "components/ResizeHandle.tsx",
    "components/Toast.tsx",
    "ui/Sheet.tsx",
    "lib/cn.ts",
  ];
  const files = await sources();
  for (const path of primitives) {
    const file = files.find((candidate) => candidate.path === path);
    expect(file, `${path} is listed as a primitive but does not exist`).toBeDefined();
    expect(/@tanstack\/react-router/.test(file!.text), path).toBe(false);
  }
  for (const file of files.filter((candidate) => candidate.path.startsWith("theme/") || candidate.path.startsWith("styles/"))) {
    expect(/@tanstack\/react-router/.test(file.text), file.path).toBe(false);
  }
});
