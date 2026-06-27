import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";
import { AgentPreview, type AgentPreviewDetails } from "./AgentPreview.tsx";
import type { Agent } from "../data/types.ts";
import { AGENTS } from "../data/seed.ts";

const atlas = AGENTS.find((agent) => agent.id === "atlas")!;
const cortex = AGENTS.find((agent) => agent.id === "cortex")!;
const pulse = AGENTS.find((agent) => agent.id === "pulse")!;

const claudeAgent: Agent = {
  ...atlas,
  name: "TesterGLM",
  handle: "testerglm",
  role: "claude",
  status: "busy",
  statusNote: "Testing/observer",
  avatar: "T",
};

const piAgent: Agent = {
  ...cortex,
  name: "pi-tardis",
  handle: "pi-tardis",
  role: "pi",
  status: "idle",
  statusNote: "pi-coding-agent session",
  avatar: "P",
};

const lettaAgent: Agent = {
  ...pulse,
  name: "rocky",
  handle: "rocky",
  role: "letta",
  status: "online",
  statusNote: "Letta Code SDK harness connected to Synchronize",
  avatar: "R",
};

const claudeDetails: AgentPreviewDetails = {
  profileName: "claude-sonnet",
  tool: "claude",
  model: "claude-sonnet-4-6",
  thinking: "medium",
  agentType: "claude session",
  machine: "MTPL-7638",
  cwd: "/Users/dev/work/synchronize",
  gitBranch: "codex/agent-preview",
  gitDirty: true,
  source: "session_start",
  hostSessionId: "72be6e11-67ee-4195-9c2b-14f2c6a8e93d",
  launchState: "running",
};

const piDetails: AgentPreviewDetails = {
  profileName: "pi-tardis",
  tool: "pi",
  model: "gpt-5.5",
  thinking: "high",
  agentType: "coding-agent",
  machine: "MTPL-7638",
  cwd: "/Users/dev/work/tardis",
  gitBranch: "obrep/moj-isduplicate-v2",
  gitDirty: false,
  source: "session_start",
  hostSessionId: "019ecffd-ee3b-7910-9a8d-54e4eb979f06",
  launchState: "running",
};

const lettaDetails: AgentPreviewDetails = {
  profileName: "rocky",
  tool: "letta",
  model: "zai/glm-5",
  agentType: "letta-code-sdk",
  machine: "MTPL-7638",
  cwd: "/Users/dev/work/synchronize-worktrees/letta-harness",
  gitBranch: "codex/letta-harness",
  gitDirty: false,
  source: "letta-code-sdk",
  hostSessionId: "letta-sync:38066",
  launchState: "running",
};

const missingDetails: AgentPreviewDetails = {
  tool: "claude",
  machine: "unknown",
};

const meta = {
  title: "Agent States/AgentPreview",
  component: AgentPreview,
  parameters: { layout: "centered" },
} satisfies Meta<typeof AgentPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ClaudeRichMetadata: Story = {
  args: { agent: claudeAgent, details: claudeDetails },
};

export const PiLaunchProfile: Story = {
  args: { agent: piAgent, details: piDetails },
};

export const LettaPersistentAgent: Story = {
  args: { agent: lettaAgent, details: lettaDetails },
};

export const MissingMetadata: Story = {
  args: { agent: { ...claudeAgent, status: "offline", statusNote: "last seen earlier" }, details: missingDetails },
};

export const WorkStateHistory: Story = {
  args: { agent: cortex, details: claudeDetails },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.textContent).toContain("Current Work"));
    await waitFor(() => expect(canvasElement.textContent).toContain("sync-08gl.6.2"));
  },
};

export const BlockedNoTask: Story = {
  args: { agent: AGENTS.find((agent) => agent.id === "echo")!, details: missingDetails },
};

export const ExpiredState: Story = {
  args: { agent: AGENTS.find((agent) => agent.id === "vega")!, details: missingDetails },
};

export const HiddenSensitiveFields: Story = {
  args: {
    agent: claudeAgent,
    details: {
      ...claudeDetails,
      hostSessionId: "redacted",
      cwd: "hidden",
      gitBranch: "hidden",
    },
  },
};

export const CompactGallery: Story = {
  args: { agent: claudeAgent, details: claudeDetails, density: "compact" },
  render: () => (
    <div className="h-full overflow-y-auto p-[18px]">
      <div className="grid max-w-[1040px] grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-[14px] pb-[28px]">
        <AgentPreview agent={claudeAgent} details={claudeDetails} density="compact" />
        <AgentPreview agent={piAgent} details={piDetails} density="compact" />
        <AgentPreview agent={lettaAgent} details={lettaDetails} density="compact" />
      </div>
    </div>
  ),
  parameters: { layout: "fullscreen" },
};
