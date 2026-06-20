import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { Avatar, StatusDot, IdentityBadge } from "./primitives.tsx";
import { AGENTS } from "../data/seed.ts";
import type { AgentStatus } from "../data/types.ts";

const meta: Meta = { title: "Primitives/Identity" };
export default meta;
type Story = StoryObj;

const Row = ({ children }: { children: ReactNode }) => (
  <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>{children}</div>
);

export const Avatars: Story = {
  render: () => (
    <Row>
      {AGENTS.map((a) => (
        <Avatar key={a.id} agent={a} showStatus />
      ))}
    </Row>
  ),
};

export const StatusDots: Story = {
  render: () => (
    <Row>
      {(["online", "busy", "idle", "offline"] satisfies AgentStatus[]).map((s) => (
        <StatusDot key={s} status={s} pulse />
      ))}
    </Row>
  ),
};

export const Badge: Story = {
  render: () => (
    <Row>
      <IdentityBadge color="#FF5DA2">Atlas</IdentityBadge>
      <IdentityBadge color="#4D7CFE">Vega</IdentityBadge>
      <IdentityBadge color="#111111" self>
        You
      </IdentityBadge>
    </Row>
  ),
};
