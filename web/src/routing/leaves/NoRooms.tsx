/** Empty state for a runtime with nothing to show yet. */
export function NoRooms() {
  return (
    <div className="min-h-0 h-full grid place-items-center bg-paper text-ink [border-left:var(--line-2)]">
      <div className="max-w-[520px] [border:var(--line-bold)] shadow-lg bg-paper-2 p-[var(--space-24)]">
        {/* `.brand-mark` kept: shared Sidebar hook (skin-glass + [data-theme] override). */}
        <div className="brand-mark">S</div>
        <h1 className="mt-[16px] mb-[8px] font-display text-[length:var(--text-24)]">No rooms yet</h1>
        <p className="mt-[8px] font-ui leading-[1.45]">
          Registered sessions will appear as direct messages. Create or join a group to start a room.
        </p>
      </div>
    </div>
  );
}
