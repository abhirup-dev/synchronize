import { createContext, useCallback, useContext, useEffect, useState, type MouseEvent, type ReactNode } from "react";

export interface MenuItem {
  label: string;
  onSelect(): void;
  danger?: boolean;
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

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OpenState | null>(null);

  const open = useCallback((e: MouseEvent, items: MenuEntry[]) => {
    e.preventDefault();
    e.stopPropagation();
    setState({ x: e.clientX, y: e.clientY, items });
  }, []);

  useEffect(() => {
    if (!state) return;
    const close = () => setState(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
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
                onClick={() => {
                  setState(null);
                  it.onSelect();
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
