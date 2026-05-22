import { useCallback, useEffect, useRef, useState } from "react";

interface ResizeHandleProps {
  /** Current width of the right-side pane in px. */
  width: number;
  /** Callback fired with the new width on each pointer-move (already clamped). */
  onChange(next: number): void;
  /** Min/max clamp (DESIGN.md: 320–820 for thread pane). */
  min?: number;
  max?: number;
}

/**
 * Thin vertical bar that the user can grab to drag the thread pane wider or
 * narrower. Uses Pointer Events with `setPointerCapture` so the drag survives
 * the cursor moving outside the bar. The grab is anchored to the right edge
 * of the viewport — i.e. as the user drags left, the pane gets wider.
 */
export function ResizeHandle({ width, onChange, min = 320, max = 820 }: ResizeHandleProps) {
  // Truth: ref. State: only for CSS class. (Reading state inside a pointermove
  // closure is stale on the first move after pointerdown — the ref avoids it.)
  const draggingRef = useRef(false);
  const [draggingCls, setDraggingCls] = useState(false);
  const startRef = useRef({ pointerX: 0, startWidth: 0 });
  const widthRef = useRef(width);
  widthRef.current = width;

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    startRef.current = { pointerX: e.clientX, startWidth: widthRef.current };
    draggingRef.current = true;
    setDraggingCls(true);
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      const dx = e.clientX - startRef.current.pointerX;
      // Dragging left (dx negative) widens the pane; right narrows it.
      const next = Math.max(min, Math.min(max, startRef.current.startWidth - dx));
      onChange(next);
    },
    [min, max, onChange],
  );

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore; pointer was released elsewhere
    }
    draggingRef.current = false;
    setDraggingCls(false);
  }, []);

  // Disable text selection on the whole document while dragging — otherwise the
  // browser keeps trying to select text between the chat and the thread pane.
  useEffect(() => {
    if (!draggingCls) return;
    const prev = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    return () => {
      document.body.style.userSelect = prev;
      document.body.style.cursor = "";
    };
  }, [draggingCls]);

  return (
    <div
      className={`resize-handle${draggingCls ? " is-dragging" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="resize thread pane"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={(e) => {
        // Arrow keys nudge the pane 16px at a time for keyboard users.
        if (e.key === "ArrowLeft")  onChange(Math.min(max, width + 16));
        if (e.key === "ArrowRight") onChange(Math.max(min, width - 16));
      }}
    >
      <span className="resize-handle-grip" aria-hidden />
    </div>
  );
}
