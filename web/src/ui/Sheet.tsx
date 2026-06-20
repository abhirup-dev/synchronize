import { Dialog } from "@base-ui-components/react/dialog";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

interface SheetProps {
  open: boolean;
  onClose(): void;
  /** Accessible name for the dialog. */
  ariaLabel: string;
  /** Extra classes for the sheet surface (carries skin hooks, e.g.
   *  `.compact-settings-sheet` for skin-glass.css). */
  className?: string;
  children: ReactNode;
}

/**
 * Modal bottom sheet built on Base UI Dialog. Focus trap, scroll lock, and
 * Escape / backdrop-tap dismissal come for free. Use for transient focused
 * tasks that float over dimmed content (display settings, pickers, confirms).
 *
 * NOT for full-bleed navigation panels (compact Chats/Agents): those are
 * intentionally non-modal so the bottom nav stays live, and Base UI Dialog
 * portals out of `.app-shell` — see sync-imeu.1.18.
 */
export function Sheet({ open, onClose, ariaLabel, className, children }: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[var(--z-modal)] bg-[color-mix(in_srgb,var(--ink)_28%,transparent)]" />
        <Dialog.Popup
          aria-label={ariaLabel}
          className={cn(
            "fixed inset-x-0 bottom-0 z-[calc(var(--z-modal)+1)] w-full max-h-[78vh] overflow-auto bg-paper text-ink [border-top:var(--line)] shadow-lg [padding-bottom:env(safe-area-inset-bottom)]",
            className,
          )}
        >
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
