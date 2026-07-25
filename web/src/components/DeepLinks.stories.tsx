import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";
import { Shell } from "../App.tsx";

// Composed-flow coverage for URL deep links — the sibling of Flows.stories.tsx,
// built on the SAME template (real exported Shell, MockDataSource via the global
// StorybookProviders decorator, step()-labelled play functions, a real test story
// plus a `!test` demo). It does NOT invent a new harness.
//
// HOW THESE TESTS DRIVE THE APP
// The "navigation glue" for a deep link is the URL, not a click — so instead of
// userEvent we set window.location through the History API and let the REAL Shell
// bootstrap react to it:
//   • Paste / refresh case → `beforeEach` runs before the Shell mounts and sets
//     the URL. On mount the Shell parses it (routing/address.ts), resolves it
//     against MockDataSource, hydrates, switches rooms, and focuses the target.
//   • Back/forward case → `pushState` + a dispatched `popstate`, then `history.back()`.
//     This exercises the Shell's real popstate handler, the same path a browser
//     back button hits. No private state is poked.
// We then assert on the real DOM, exactly as Flows.stories.tsx does: thread-pane
// presence/absence, the target row existing (`#msg-<id>`), and the deep-link
// highlight class landing on it. The target row existing also proves the correct
// room is active, because only the active room's ChatView is mounted.
//
// Seed ids used (web/src/data/seed.ts):
//   dc1         DM message in dm-cortex
//   ml-deepdive group root in ml-ranking (has THREAD_REPLIES)
//   mld-r14     last reply under ml-deepdive (off-screen until focused)
//
// Boundary: MockDataSource in a real browser (Playwright Chromium via the Vitest
// addon). Daemon routing/auth/SSE and real /web/state hydration are proven by the
// Bun tests (tests/web-deeplinks.test.ts) and the live /web probe, not here.
const meta = {
  title: "Flows/URL Deep Links",
  component: Shell,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Shell>;

export default meta;
type Story = StoryObj<typeof meta>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
type PlayCtx = Parameters<NonNullable<Story["play"]>>[0];

// Set the address bar before the Shell mounts; restore it afterwards so stories
// don't leak URL state into each other.
function openAt(path: string): () => void {
  window.history.replaceState(null, "", path);
  return () => window.history.replaceState(null, "", "/");
}

// Wait for the target row to render, then for the deep-link highlight to land on
// it. Flash is transient (removed after 2400ms) but the poll catches it well
// inside that window.
async function expectFocused(id: string): Promise<HTMLElement> {
  const el = await waitFor(() => {
    const found = document.getElementById(`msg-${id}`);
    if (!found) throw new Error(`#msg-${id} not rendered yet`);
    return found;
  });
  await waitFor(() => expect(el.classList.contains("flash-highlight")).toBe(true));
  return el;
}

// Seed addresses (web/src/data/seed.ts) — fixed values, safe to assert on.
const ML_RANKING = "g_8b2f05d16ea4";

async function expectAddressBar(path: string): Promise<void> {
  await waitFor(() => expect(window.location.pathname + window.location.search).toBe(path));
}

// A DM link opens the DM room and focuses the message; no thread pane.
export const DmMessageLink: Story = {
  beforeEach: () => openAt("/web/e/dc1"),
  play: async ({ step }: PlayCtx) => {
    await step("DM link lands on the message with no thread pane", async () => {
      await expectFocused("dc1");
      expect(document.querySelector(".thread-pane")).toBeNull();
    });
    await step("The resolver is rewritten to the canonical DM address", async () => {
      await expectAddressBar("/web/d/cortex?focus=dc1");
    });
  },
};

// A canonical group address mounts the group directly — no resolution step.
export const CanonicalGroupAddress: Story = {
  beforeEach: () => openAt(`/web/g/${ML_RANKING}`),
  play: async ({ step }: PlayCtx) => {
    await step("The group's messages render and the address bar is untouched", async () => {
      await waitFor(() => {
        if (!document.getElementById("msg-ml-deepdive")) throw new Error("ml-ranking did not mount");
      });
      expect(window.location.pathname).toBe(`/web/g/${ML_RANKING}`);
    });
  },
};

// A canonical DM address addresses by peer_id.
export const CanonicalDmAddress: Story = {
  beforeEach: () => openAt("/web/d/cortex"),
  play: async ({ step }: PlayCtx) => {
    await step("The DM mounts and the address bar is untouched", async () => {
      await waitFor(() => {
        if (!document.getElementById("msg-dc1")) throw new Error("dm-cortex did not mount");
      });
      expect(window.location.pathname).toBe("/web/d/cortex");
    });
  },
};

// The by-name resolver — the form an agent can build, since bridge_send_group
// addresses groups by name — lands on the opaque address.
export const GroupByNameResolver: Story = {
  beforeEach: () => openAt("/web/g/by-name/ml-ranking"),
  play: async ({ step }: PlayCtx) => {
    await step("The named group mounts and the address bar becomes canonical", async () => {
      await waitFor(() => {
        if (!document.getElementById("msg-ml-deepdive")) throw new Error("ml-ranking did not mount");
      });
      await expectAddressBar(`/web/g/${ML_RANKING}`);
    });
  },
};

// The legacy room id, demoted from address to resolver: old links keep working.
export const LegacyRoomResolver: Story = {
  beforeEach: () => openAt("/web/r/ml-ranking"),
  play: async ({ step }: PlayCtx) => {
    await step("The legacy room id resolves to the canonical address", async () => {
      await waitFor(() => {
        if (!document.getElementById("msg-ml-deepdive")) throw new Error("ml-ranking did not mount");
      });
      await expectAddressBar(`/web/g/${ML_RANKING}`);
    });
  },
};

// An address minted against another runtime. The whole point of opaque ids: this
// must report not-found, never open whichever room sits at the same position.
export const UnknownAddressReportsNotFound: Story = {
  beforeEach: () => openAt("/web/g/g_from_another_runtime"),
  play: async ({ step }: PlayCtx) => {
    await step("A foreign address surfaces an error rather than a wrong room", async () => {
      await waitFor(() => {
        const toast = document.body.textContent ?? "";
        if (!toast.includes("g_from_another_runtime")) throw new Error("no not-found message shown");
      });
    });
  },
};

// A group root link opens the group chat and focuses the main-list message.
export const GroupRootLink: Story = {
  beforeEach: () => openAt("/web/e/ml-deepdive"),
  play: async ({ step }: PlayCtx) => {
    await step("Group root link focuses the main-list message, pane stays closed", async () => {
      await expectFocused("ml-deepdive");
      expect(document.querySelector(".thread-pane")).toBeNull();
    });
  },
};

// A reply link opens the group chat, opens the thread pane, and scrolls the
// virtualized reply list to the (off-screen) reply, then flashes it.
export const GroupReplyLink: Story = {
  beforeEach: () => openAt("/web/e/mld-r14"),
  play: async ({ step }: PlayCtx) => {
    await step("Reply link opens the thread pane", async () => {
      await waitFor(() => {
        if (!document.querySelector(".thread-pane")) throw new Error("thread pane did not open");
      });
    });
    await step("Off-screen reply is scrolled into view and flashed", async () => {
      const el = await expectFocused("mld-r14");
      expect(el.closest(".thread-pane")).toBeTruthy();
    });
  },
};

// Back/forward restores a prior deep-link target through the real popstate path.
export const BackForwardRestoresTarget: Story = {
  beforeEach: () => openAt("/web/e/dc1"),
  play: async ({ step }: PlayCtx) => {
    await step("Initial link lands on the DM target", async () => {
      await expectFocused("dc1");
    });
    await step("Navigate forward to a group target (pushState + popstate)", async () => {
      window.history.pushState(null, "", "/web/e/ml-deepdive");
      window.dispatchEvent(new PopStateEvent("popstate"));
      await expectFocused("ml-deepdive");
      expect(document.getElementById("msg-dc1")).toBeNull(); // DM room unmounted
    });
    await step("Back restores the original DM target", async () => {
      window.history.back();
      await expectFocused("dc1");
    });
  },
};

// Demo: same reply flow, paced so it is watchable in the Interactions panel.
// Tagged `!test` so it is excluded from the CI test run (no slowdown, no flake).
export const GroupReplyLinkDemo: Story = {
  tags: ["!test"],
  beforeEach: () => openAt("/web/e/mld-r14"),
  play: async ({ step }: PlayCtx) => {
    await step("Reply deep link opens the thread and focuses the reply", async () => {
      await sleep(900);
      await waitFor(() => {
        if (!document.querySelector(".thread-pane")) throw new Error("thread pane did not open");
      });
      await sleep(900);
      await expectFocused("mld-r14");
    });
  },
};
