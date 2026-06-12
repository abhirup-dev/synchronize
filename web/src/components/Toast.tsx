import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { Toast } from "@base-ui-components/react/toast";

export type ToastKind = "info" | "warn" | "error" | "success";

interface Ctx {
  show(message: string, opts?: { kind?: ToastKind; duration?: number }): string;
  dismiss(id: string): void;
}

const ToastCtx = createContext<Ctx | null>(null);

const DEFAULT_DURATION_MS = 3000;

/**
 * Toast surface built on Base UI's Toast (provider + manager), wrapped behind
 * the original `useToast().show/dismiss` API so call sites stay unchanged.
 * Reuses the existing `.toast-stack` / `.toast` CSS; Base UI adds
 * screen-reader announcements, F6 viewport focus, and hover timer pausing.
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
      <Toast.Viewport className="toast-stack">
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
          className={`toast toast-${t.type ?? "info"}`}
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
