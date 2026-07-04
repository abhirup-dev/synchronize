import * as React from 'react';
import { useEffect, useRef } from 'react';
import { ScrollControls } from '@ds-stories/web/src/components/ScrollControls';

// Mirrors web/src/components/ScrollControls.stories.tsx. ScrollControls is a
// pure DOM-driven overlay watching a real scrollable element via targetRef; the
// stories supply a self-contained scrollable surface and drive the states.
// JumpToBottom in storybook runs a `play` that clicks the down pill and lands
// the surface at the bottom (button retires). The compiled preview can't replay
// `play`, so JumpToBottom mirrors that END state directly via startAtBottom —
// same end state the play interaction reaches.

interface HarnessProps {
  forceScrolling?: boolean;
  newItemsKey?: number | null;
  startAtBottom?: boolean;
}

function Harness({ forceScrolling = false, newItemsKey = null, startAtBottom = false }: HarnessProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (startAtBottom) el.scrollTop = el.scrollHeight - el.clientHeight;
    el.classList.toggle('is-scrolling', forceScrolling);
  }, [forceScrolling, startAtBottom]);

  return (
    <div style={{ position: 'relative', height: 420, width: 360, margin: '0 auto' }}>
      <div
        ref={ref}
        className="thin-scroll"
        style={{ position: 'absolute', inset: 0, overflowY: 'auto', padding: '12px 16px' }}
      >
        {Array.from({ length: 40 }, (_, i) => (
          <p key={i} style={{ margin: '0 0 14px', fontFamily: 'var(--font-display, monospace)', fontSize: 13, opacity: 0.7 }}>
            line {i + 1} — scrollable surface content
          </p>
        ))}
      </div>
      <ScrollControls targetRef={ref} newItemsKey={newItemsKey} />
    </div>
  );
}

export const Hidden = () => <Harness />;
export const ScrollingDown = () => <Harness forceScrolling />;
export const NewItemsBelow = () => <Harness newItemsKey={1} />;
export const JumpToBottom = () => <Harness newItemsKey={1} startAtBottom />;
