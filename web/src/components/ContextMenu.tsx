import { Menu } from "@base-ui-components/react/menu";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn";

/**
 * Context-menu styling migrated off styles.css/extra.css into Tailwind
 * utilities. The active look came from extra.css (it imports after styles.css,
 * so its `.ctx-menu`/`.ctx-item`/`.ctx-shortcut` rules won at equal
 * specificity); those exact values are reproduced here. `.ctx-menu` is KEPT on
 * the popup element because skin-glass.css hooks it for the backdrop-filter
 * glass surface. Positioning + z-index are owned by Base UI's Positioner, so
 * the legacy `position: fixed` / `z-index` are intentionally dropped.
 */
const ctxItem = cva(
  [
    "flex w-full items-center justify-between gap-[var(--space-16)] px-[10px] py-[7px]",
    "bg-transparent [border:var(--line-none)] text-left text-[length:var(--text-13)] text-ink",
    "rounded-xs cursor-pointer",
    "hover:enabled:bg-paper-2 enabled:data-[highlighted]:bg-paper-2",
    "disabled:opacity-[0.46] disabled:cursor-default",
  ],
  {
    variants: {
      danger: {
        true: [
          "text-pink",
          "hover:enabled:bg-[color-mix(in_srgb,var(--pink)_18%,transparent)]",
          "enabled:data-[highlighted]:bg-[color-mix(in_srgb,var(--pink)_18%,transparent)]",
        ],
        false: null,
      },
    },
    defaultVariants: { danger: false },
  },
);

export interface MenuItem {
  label: string;
  onSelect?: () => void | Promise<void>;
  submenu?: MenuEntry[];
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
  stack: MenuEntry[][];
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
    setState({ x: e.clientX, y: e.clientY, items, stack: [] });
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
            <Menu.Popup
              className={cn(
                "ctx-menu",
                "flex min-w-[220px] flex-col gap-[var(--space-1)] p-[var(--space-4)]",
                "bg-paper [border:var(--line-md)] rounded-lg font-mono shadow-overlay",
              )}
            >
              {state && state.stack.length > 0 ? (
                <>
                  <button
                    type="button"
                    className={cn(ctxItem({ danger: false }))}
                    onClick={() => setState((prev) => {
                      if (!prev) return prev;
                      const nextStack = prev.stack.slice(0, -1);
                      const parentItems = prev.stack[prev.stack.length - 1] ?? prev.items;
                      return { ...prev, items: parentItems, stack: nextStack };
                    })}
                  >
                    <span>← Back</span>
                  </button>
                  <Menu.Separator className="my-[3px] mx-[4px] h-[1.5px] bg-ink-faint" />
                </>
              ) : null}
              {(state?.items ?? []).map((it, i) => {
                if ("divider" in it) {
                  return (
                  <Menu.Separator
                    key={i}
                    className="my-[3px] mx-[4px] h-[1.5px] bg-ink-faint"
                  />
                  );
                }

                const runItem = () => {
                  if (it.disabled) return;
                  if (it.submenu) {
                    setState((prev) => prev ? { ...prev, items: it.submenu!, stack: [...prev.stack, prev.items] } : prev);
                    return;
                  }
                  if (!it.onSelect) return;
                  setState(null);
                  void Promise.resolve(it.onSelect());
                };

                return (
                  <button
                    key={i}
                    type="button"
                    className={cn(ctxItem({ danger: it.danger ?? false }))}
                    disabled={it.disabled ?? false}
                    onClick={runItem}
                  >
                    <span>{it.label}</span>
                    {it.submenu ? (
                      <span className="text-[length:var(--text-11)] text-ink-soft">›</span>
                    ) : it.shortcut ? (
                      <span className="text-[length:var(--text-11)] text-ink-soft">
                        {it.shortcut}
                      </span>
                    ) : null}
                  </button>
                );
              })}
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
