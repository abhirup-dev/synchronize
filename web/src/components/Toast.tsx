import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { Toast } from "@base-ui-components/react/toast";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn.ts";

export type ToastKind = "info" | "warn" | "error" | "success";

// `.toast` keeps its class as a skin-glass backdrop hook (skin-glass.css) and so
// the `.toast-stack .toast { transform: none; animation-fill-mode: both }` reset
// (+ `@keyframes toast-in`) in extra.css still bind. Base visuals migrated inline.
const toast = cva(
  "toast pointer-events-auto max-w-[min(560px,80vw)] px-[16px] py-[8px] bg-paper text-ink font-mono text-[length:var(--text-12-5)] [border:var(--line-sm)] rounded-pill shadow-sm cursor-pointer text-center animate-[toast-in_180ms_ease] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:[box-shadow:var(--shadow)]",
  {
    variants: {
      kind: {
        info: "",
        warn: "[background:color-mix(in_srgb,var(--yellow)_30%,var(--paper))]",
        error: "[background:color-mix(in_srgb,var(--red)_26%,var(--paper))]",
        success: "[background:color-mix(in_srgb,var(--lime)_30%,var(--paper))]",
      },
    },
    defaultVariants: { kind: "info" },
  },
);

interface Ctx {
  show(message: string, opts?: { kind?: ToastKind; duration?: number }): string;
  dismiss(id: string): void;
}

const ToastCtx = createContext<Ctx | null>(null);

const DEFAULT_DURATION_MS = 3000;

/**
 * Toast surface built on Base UI's Toast (provider + manager), wrapped behind
 * the original `useToast().show/dismiss` API so call sites stay unchanged.
 * Toast visuals are inline Tailwind; `.toast-stack` / `.toast` classes stay as
 * hooks (keyframe reset + skin-glass backdrop). Base UI adds screen-reader
 * announcements, F6 viewport focus, and hover timer pausing.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <Toast.Provider timeout={DEFAULT_DURATION_MS} limit={Number.MAX_SAFE_INTEGER}>
      <ToastBridge>{children}</ToastBridge>
    </Toast.Provider>
  );
}

function ToastBridge({ children }: { children: ReactNode }) {
  const manager = Toast.useToastManager();

  const show = useCallback(
    (message: string, opts?: { kind?: ToastKind; duration?: number }) =>
      manager.add({
        title: message,
        type: opts?.kind ?? "info",
        // 0 means sticky (requires manual close) — same contract as before.
        timeout: opts?.duration ?? DEFAULT_DURATION_MS,
      }),
    [manager],
  );

  const dismiss = useCallback((id: string) => manager.close(id), [manager]);

  const value = useMemo<Ctx>(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <Toast.Viewport className="toast-stack absolute top-[14px] left-1/2 -translate-x-1/2 z-[var(--z-toast)] flex flex-col gap-[var(--space-8)] items-center pointer-events-none">
        <ToastItems />
      </Toast.Viewport>
    </ToastCtx.Provider>
  );
}

function ToastItems() {
  const { toasts, close } = Toast.useToastManager();
  // Base UI prepends new toasts; the original stack appended them (newest at
  // the bottom), so reverse to keep the visual order identical.
  return (
    <>
      {[...toasts].reverse().map((t) => (
        <Toast.Root
          key={t.id}
          toast={t}
          className={cn(toast({ kind: (t.type as ToastKind | undefined) ?? "info" }))}
          render={<button type="button" />}
          title="dismiss"
          onClick={() => close(t.id)}
        >
          <Toast.Title render={<span />}>{t.title}</Toast.Title>
        </Toast.Root>
      ))}
    </>
  );
}

export function useToast(): Ctx {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("ToastProvider missing");
  return ctx;
}
