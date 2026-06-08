import { createContext, useCallback, useContext, useEffect, useState, type MouseEvent, type ReactNode } from "react";

export interface MenuItem {
  label: string;
  onSelect(): void | Promise<void>;
  danger?: boolean;
  disabled?: boolean;
  shortcut?: string;
  divider?: false;
}
export interface MenuDivider {
  divider: true;
}
export type MenuEntry = MenuItem | MenuDivider;

interface OpenState {
  x: number;
  y: number;
  items: MenuEntry[];
}

interface Ctx {
  open(e: MouseEvent, items: MenuEntry[]): void;
}

const ContextMenuCtx = createContext<Ctx | null>(null);
const OVERLAY_CLOSE_EVENT = "synchronize:overlay-close";

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OpenState | null>(null);

  const open = useCallback((e: MouseEvent, items: MenuEntry[]) => {
    e.preventDefault();
    e.stopPropagation();
    window.dispatchEvent(new CustomEvent(OVERLAY_CLOSE_EVENT));
    setState({ x: e.clientX, y: e.clientY, items });
  }, []);

  useEffect(() => {
    const close = () => setState(null);
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    };
    window.addEventListener(OVERLAY_CLOSE_EVENT, close);
    document.addEventListener("keydown", onEscape, true);
    document.addEventListener("keyup", onEscape, true);
    return () => {
      window.removeEventListener(OVERLAY_CLOSE_EVENT, close);
      document.removeEventListener("keydown", onEscape, true);
      document.removeEventListener("keyup", onEscape, true);
    };
  }, []);

  useEffect(() => {
    if (!state) return;
    const close = () => setState(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [state]);

  return (
    <ContextMenuCtx.Provider value={{ open }}>
      {children}
      {state && (
        <div
          className="ctx-menu"
          style={{ left: state.x, top: state.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {state.items.map((it, i) =>
            "divider" in it ? (
              <div key={i} className="ctx-divider" />
            ) : (
              <button
                key={i}
                className={`ctx-item${it.danger ? " ctx-danger" : ""}`}
                disabled={it.disabled}
                onClick={() => {
                  if (it.disabled) return;
                  void Promise.resolve(it.onSelect()).finally(() => setState(null));
                }}
              >
                <span>{it.label}</span>
                {it.shortcut && <span className="ctx-shortcut">{it.shortcut}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </ContextMenuCtx.Provider>
  );
}

export function useContextMenu() {
  const ctx = useContext(ContextMenuCtx);
  if (!ctx) throw new Error("ContextMenuProvider missing");
  return ctx.open;
}
