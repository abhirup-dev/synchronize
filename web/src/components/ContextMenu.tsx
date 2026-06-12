import { Menu } from "@base-ui-components/react/menu";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";

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
    window.addEventListener(OVERLAY_CLOSE_EVENT, close);
    return () => {
      window.removeEventListener(OVERLAY_CLOSE_EVENT, close);
    };
  }, []);

  useEffect(() => {
    if (!state) return;
    const close = () => setState(null);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("scroll", close, true);
    };
  }, [state]);

  // Zero-size virtual anchor at the pointer position so the popup's top-left
  // lands exactly where the original fixed-position menu rendered.
  const anchor = useMemo(() => {
    if (!state) return null;
    const { x, y } = state;
    return {
      getBoundingClientRect: () => new DOMRect(x, y, 0, 0),
    };
  }, [state]);

  return (
    <ContextMenuCtx.Provider value={{ open }}>
      {children}
      <Menu.Root
        open={state !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setState(null);
        }}
        modal={false}
      >
        <Menu.Portal>
          <Menu.Positioner
            anchor={anchor}
            side="bottom"
            align="start"
            sideOffset={0}
            style={{ zIndex: "var(--z-context-menu)" }}
          >
            <Menu.Popup className="ctx-menu">
              {(state?.items ?? []).map((it, i) =>
                "divider" in it ? (
                  <Menu.Separator key={i} className="ctx-divider" />
                ) : (
                  <Menu.Item
                    key={i}
                    className={`ctx-item${it.danger ? " ctx-danger" : ""}`}
                    disabled={it.disabled ?? false}
                    nativeButton
                    render={<button type="button" disabled={it.disabled ?? false} />}
                    onClick={() => {
                      if (it.disabled) return;
                      void Promise.resolve(it.onSelect());
                    }}
                  >
                    <span>{it.label}</span>
                    {it.shortcut && <span className="ctx-shortcut">{it.shortcut}</span>}
                  </Menu.Item>
                ),
              )}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </ContextMenuCtx.Provider>
  );
}

export function useContextMenu() {
  const ctx = useContext(ContextMenuCtx);
  if (!ctx) throw new Error("ContextMenuProvider missing");
  return ctx.open;
}
