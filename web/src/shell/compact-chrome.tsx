import { Settings, X } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { CHAT_BACKGROUNDS } from "../data/chatBackgrounds.ts";
import { IconButton } from "../components/IconButton.tsx";
import { Sheet } from "../ui/Sheet.tsx";
import { themeFamily, type ThemeName } from "../hooks/usePersistentTheme.ts";

function titleCase(value: string): string {
  return value
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

/** Header for the compact Chats/Agents overlays. */
export function CompactAppBar({
  title,
  detail,
  onSettings,
  onClose,
}: {
  title: string;
  detail?: string;
  onSettings(event: ReactMouseEvent): void;
  onClose(): void;
}) {
  return (
    <div className="compact-appbar flex-none flex items-center justify-between gap-[var(--space-12)] px-[12px] py-[8px] [border-bottom:var(--line)] bg-paper-2">
      <div className="min-w-0 flex items-center gap-[var(--space-8)]">
        <IconButton icon={X} label="close" size={40} iconSize={20} onClick={onClose} />
        <div className="min-w-0 flex flex-col justify-center">
          <div className="compact-appbar-title font-ui text-[length:var(--text-14)] font-semibold leading-[1.2] tracking-normal text-ink truncate">
            {title}
          </div>
          {detail ? (
            <div className="compact-appbar-detail mt-[2px] font-ui text-[length:var(--text-11)] font-normal leading-[1.2] tracking-normal text-ink-soft truncate">
              {detail}
            </div>
          ) : null}
        </div>
      </div>
      <IconButton icon={Settings} label="open display settings" size={40} iconSize={20} onClick={onSettings} />
    </div>
  );
}

/** The compact display-settings bottom sheet (theme / skin / chat background). */
export function CompactSettingsSheet({
  open,
  theme,
  skin,
  chatBg,
  onToggleAppearance,
  onCycleTheme,
  onToggleSkin,
  onChatBg,
  onClose,
}: {
  open: boolean;
  theme: ThemeName;
  skin: "brutal" | "glass";
  chatBg: string;
  onToggleAppearance(): void;
  onCycleTheme(): void;
  onToggleSkin(): void;
  onChatBg(id: string): void;
  onClose(): void;
}) {
  return (
    <Sheet open={open} onClose={onClose} ariaLabel="display settings" className="compact-settings-sheet">
      <div className="compact-settings-head flex items-center justify-between gap-[var(--space-12)] px-[14px] py-[12px] [border-bottom:var(--line)] bg-paper-2">
        <div className="min-w-0">
          <div className="font-display text-[length:var(--text-17)] leading-none tracking-[var(--tracking-sm)]">Display</div>
          <div className="mt-[5px] font-mono text-[length:var(--text-10)] leading-none text-ink-soft">
            {themeFamily(theme)} · {titleCase(theme)} · {skin}
          </div>
        </div>
        <button type="button" className="compact-settings-done" onClick={onClose}>Done</button>
      </div>

      <div className="compact-settings-section">
        <SettingsRow label="Appearance" value={themeFamily(theme) === "light" ? "Light" : "Dark"} onClick={onToggleAppearance} />
        <SettingsRow label="Theme" value={titleCase(theme)} onClick={onCycleTheme} />
        <SettingsRow label="Skin" value={skin === "brutal" ? "Brutal" : "Glass"} onClick={onToggleSkin} />
      </div>

      <div className="compact-settings-section">
        <div className="compact-settings-label">Chat background</div>
        <div className="compact-settings-grid">
          {CHAT_BACKGROUNDS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`compact-settings-choice${preset.id === chatBg ? " active" : ""}`}
              onClick={() => onChatBg(preset.id)}
            >
              {preset.name}
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

export function SettingsRow({ label, value, onClick }: { label: string; value: string; onClick(): void }) {
  return (
    <button type="button" className="compact-settings-row" onClick={onClick}>
      <span>{label}</span>
      <strong>{value}</strong>
    </button>
  );
}

/** Unimplemented-tab stamp. */
export function Placeholder({ label }: { label: string }) {
  return (
    <div className="placeholder">
      <div className="placeholder-stamp">{label}</div>
    </div>
  );
}
