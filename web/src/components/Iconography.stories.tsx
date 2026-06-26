import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { Activity } from "lucide-react";
import { MessageKindIcon } from "./MessageKindIcon.tsx";
import { IdentityLogoTile } from "./primitives.tsx";

const meta: Meta = {
  title: "Design/Iconography",
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ display: "grid", gap: 12 }}>
      <h3
        style={{
          margin: 0,
          fontFamily: "var(--font-display)",
          fontSize: "var(--text-13)",
          letterSpacing: "var(--tracking-md)",
          color: "var(--ink-soft)",
          textTransform: "uppercase",
        }}
      >
        {title}
      </h3>
      <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>{children}</div>
    </section>
  );
}

function TileLabel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "grid", gap: 8, justifyItems: "center" }}>
      {children}
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-10)", color: "var(--ink-soft)" }}>
        {label}
      </span>
    </div>
  );
}

function IconographySurface() {
  return (
    <div
      style={{
        display: "grid",
        gap: 26,
        minWidth: 480,
        maxWidth: 760,
        padding: 28,
        background: "var(--paper)",
        color: "var(--ink)",
      }}
    >
      <Section title="identity tiles">
        <TileLabel label="brand">
          <IdentityLogoTile as="div" className="brand-mark w-[42px] h-[42px] bg-yellow [border:var(--line)] grid place-items-center font-display text-[length:var(--text-22)] shadow-sm">
            S
          </IdentityLogoTile>
        </TileLabel>
        <TileLabel label="activity">
          <IdentityLogoTile className="act-title-mark" ariaHidden>
            <Activity size={21} />
          </IdentityLogoTile>
        </TileLabel>
        <TileLabel label="group">
          <IdentityLogoTile
            as="div"
            className="room-id-icon room-glyph-icon w-[46px] h-[46px] min-w-[46px] [border:var(--line)] grid place-items-center font-display text-[length:var(--text-22)] shadow-sm"
            color="#7AA89F"
          >
            #
          </IdentityLogoTile>
        </TileLabel>
      </Section>

      <Section title="activity message kinds">
        <TileLabel label="dm">
          <span className="act-message-marker">
            <MessageKindIcon kind="dm" size={22} />
          </span>
        </TileLabel>
        <TileLabel label="thread reply">
          <span className="act-message-marker">
            <MessageKindIcon kind="thread-reply" size={22} />
          </span>
        </TileLabel>
        <TileLabel label="top-level">
          <span className="act-message-marker">
            <MessageKindIcon kind="thread-root" size={22} />
          </span>
        </TileLabel>
        <TileLabel label="dm mention">
          <span className="act-message-marker">
            <MessageKindIcon kind="dm" mentioned size={22} />
          </span>
        </TileLabel>
        <TileLabel label="top-level mention">
          <span className="act-message-marker">
            <MessageKindIcon kind="thread-root" mentioned size={22} />
          </span>
        </TileLabel>
      </Section>
    </div>
  );
}

export const Light: Story = {
  globals: { theme: "light", skin: "brutal" },
  render: () => <IconographySurface />,
};

export const KanagawaWave: Story = {
  globals: { theme: "kanagawa-wave", skin: "brutal" },
  render: () => <IconographySurface />,
};
