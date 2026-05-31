import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export type ToastKind = "info" | "warn" | "error" | "success";

interface ToastItem {
  id: string;
  message: string;
  kind: ToastKind;
  /** ms before auto-dismiss; 0 means sticky (requires manual close). */
  duration: number;
}

interface Ctx {
  show(message: string, opts?: { kind?: ToastKind; duration?: number }): string;
  dismiss(id: string): void;
}

const ToastCtx = createContext<Ctx | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<string, number>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const t = timersRef.current.get(id);
    if (t !== undefined) {
      window.clearTimeout(t);
      timersRef.current.delete(id);
    }
  }, []);

  const show = useCallback(
    (message: string, opts?: { kind?: ToastKind; duration?: number }) => {
      const id = `t_${Math.random().toString(36).slice(2)}`;
      const duration = opts?.duration ?? 3000;
      setToasts((prev) => [...prev, { id, message, kind: opts?.kind ?? "info", duration }]);
      if (duration > 0) {
        const timer = window.setTimeout(() => dismiss(id), duration);
        timersRef.current.set(id, timer);
      }
      return id;
    },
    [dismiss],
  );

  useEffect(
    () => () => {
      timersRef.current.forEach((t) => window.clearTimeout(t));
      timersRef.current.clear();
    },
    [],
  );

  return (
    <ToastCtx.Provider value={{ show, dismiss }}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`toast toast-${t.kind}`}
            onClick={() => dismiss(t.id)}
            title="dismiss"
          >
            {t.message}
          </button>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): Ctx {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("ToastProvider missing");
  return ctx;
}
