import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { Avatar, StatusDot, IdentityBadge } from "./primitives.tsx";
import { AGENTS } from "../data/seed.ts";
import type { AgentStatus } from "../data/types.ts";
import type { IdentityColorRef } from "../theme/identity.ts";

const meta: Meta = { title: "Primitives/Identity" };
export default meta;
type Story = StoryObj;

const Row = ({ children }: { children: ReactNode }) => (
  <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>{children}</div>
);

const slot = (slotId: number) => ({ kind: "slot", slot: slotId } as IdentityColorRef);

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
      <IdentityBadge colorRef={slot(1)}>Atlas</IdentityBadge>
      <IdentityBadge colorRef={slot(2)}>Vega</IdentityBadge>
      <IdentityBadge colorRef={{ kind: "token", token: "--ink" }} self>
        You
      </IdentityBadge>
    </Row>
  ),
};
