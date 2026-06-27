// Global, cross-room Activity feed. Two viewing modes — Grouped (Digest:
// per-room, collapsible) and Timeline (flat, newest-first). Filters: All /
// Awaiting you / Mentions, plus a multi-select room filter. Diving into a thread
// opens the real ThreadPane in a resizable side panel without leaving Activity;
// root messages open as a single-message thread. "jump" leaves for the room.
// Only the densities the user landed on are shipped (Digest + Row + the
// Grouped/Timeline toggle).

import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, CheckCheck, LayoutList, Rows3, Settings } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useAckActivity,
  useAckAllActivity,
  useAckActivityEvents,
  useActivity,
  useActivityAwaitingCount,
  useAgents,
  useLoadMoreActivity,
  useReactToMessage,
  useRooms,
} from "../data/context.tsx";
import type { ActivityItem as ActivityItemModel, Agent, Room } from "../data/types.ts";
import { ActivityItem } from "./ActivityItem.tsx";
import { ThreadPane } from "./ThreadPane.tsx";
import { ResizeHandle } from "./ResizeHandle.tsx";
import { Avatar, IdentityBadge, IdentityLogoTile, RoomNameInline, roomNameText } from "./primitives.tsx";
import { AgentProfileDialog } from "./AgentPreview.tsx";
import { useAutoScrollbar } from "../hooks/useAutoScrollbar.ts";
import { useActivityPreferences, type ActivityViewMode } from "../hooks/useActivityPreferences.ts";
import { useIsCompact } from "../shell-mode.tsx";
import { IconButton } from "./IconButton.tsx";
import { phaseLabel } from "../workState.ts";

type Filter = "all" | "awaits" | "mentions";
type SortDirection = "desc" | "asc";
type TimelineEntry =
  | { kind: "bucket"; id: string; label: string; count: number; awaitingEventIds: number[] }
  | { kind: "item"; id: string; item: ActivityItemModel };

interface ActivityViewProps {
  onJumpToRoom(roomId: string, msgId?: string): void;
  onOpenDm?(agentId: string): void;
  threadWidth: number;
  onThreadWidth(width: number): void;
  onOpenSettings?(event: ReactMouseEvent): void;
}

export function ActivityView({ onJumpToRoom, onOpenDm, threadWidth, onThreadWidth, onOpenSettings }: ActivityViewProps) {
  const items = useActivity();
  const awaitingCount = useActivityAwaitingCount();
  const agents = useAgents();
  const rooms = useRooms();
  const reactToMessage = useReactToMessage();
  const ackActivity = useAckActivity();
  const ackAll = useAckAllActivity();
  const ackActivityEvents = useAckActivityEvents();
  const loadMore = useLoadMoreActivity();

  const { viewMode, setViewMode, aliveOnly, setAliveOnly } = useActivityPreferences();
  const groupedView = viewMode === "grouped";
  const [filter, setFilter] = useState<Filter>("all");
  const [roomSel, setRoomSel] = useState<Set<string>>(() => new Set());
  const [reacted, setReacted] = useState<Set<number>>(() => new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [open, setOpen] = useState<{ roomId: string; parentId: string; focusMessageId: string } | null>(null);
  const [profileAgent, setProfileAgent] = useState<Agent | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>("desc");

  const agentsById = useMemo(() => new Map(agents.map((a) => [a.id, a] as const)), [agents]);
  const roomsById = useMemo(() => new Map(rooms.map((r) => [r.id, r] as const)), [rooms]);
  const busyCount = useMemo(() => agents.filter((a) => a.status === "busy").length, [agents]);
  const phaseCounts = useMemo(() => workPhaseCounts(agents), [agents]);
  const compact = useIsCompact();


  const onReact = (item: ActivityItemModel) => {
    setReacted((prev) => {
      const next = new Set(prev);
      next.has(item.eventId) ? next.delete(item.eventId) : next.add(item.eventId);
      return next;
    });
    void reactToMessage({ messageId: item.msgId, roomId: item.roomId, emoji: "👍", op: "toggle" });
    void ackActivity(item.eventId);
  };

  const onOpenThread = (item: ActivityItemModel) => {
    // Every Activity row opens the side thread pane. Replies use their thread
    // root, while root/no-reply messages use themselves as a single-message
    // thread; focusMessageId preserves the exact row the user clicked so the
    // pane can scroll to it instead of always showing the root first.
    setOpen({ roomId: item.roomId, parentId: item.threadParentId ?? item.msgId, focusMessageId: item.msgId });
  };

  const toggleRoom = (id: string) =>
    setRoomSel((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const toggleCollapse = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const baseItems = useMemo(() => {
    // "Live only" follows the header indicator: show rows from agents that are
    // currently working/initializing, which map to the UI's busy status.
    if (!aliveOnly) return items;
    return items.filter((it) => {
      const status = agentsById.get(it.actorId)?.status;
      return status === "busy";
    });
  }, [items, agentsById, aliveOnly]);

  const visible = useMemo(() => {
    let xs = baseItems;
    if (filter === "awaits") xs = xs.filter((it) => it.awaiting);
    else if (filter === "mentions") xs = xs.filter((it) => it.isMention);
    if (roomSel.size) xs = xs.filter((it) => roomSel.has(it.roomId));
    return xs;
  }, [baseItems, filter, roomSel]);

  const sortedVisible = useMemo(
    () => [...visible].sort((a, b) => sortDir === "desc" ? b.eventId - a.eventId : a.eventId - b.eventId),
    [visible, sortDir],
  );

  const counts = useMemo(
    () => ({
      all: baseItems.length,
      awaits: aliveOnly ? baseItems.filter((it) => it.awaiting).length : awaitingCount,
      mentions: baseItems.filter((it) => it.isMention).length,
    }),
    [baseItems, awaitingCount, aliveOnly],
  );

  const allRoomIds = useMemo(() => {
    return [...new Set(baseItems.map((it) => it.roomId))];
  }, [baseItems]);

  const grouped = useMemo(() => {
    const byRoom = new Map<
      string,
      {
        roomId: string;
        room: Room;
        items: ActivityItemModel[];
        maxEventId: number;
        minEventId: number;
        awaiting: number;
      }
    >();
    for (const it of sortedVisible) {
      const room = roomsById.get(it.roomId);
      if (!room) continue;
      const group = byRoom.get(it.roomId) ?? {
        roomId: it.roomId,
        room,
        items: [],
        maxEventId: it.eventId,
        minEventId: it.eventId,
        awaiting: 0,
      };
      group.items.push(it);
      group.maxEventId = Math.max(group.maxEventId, it.eventId);
      group.minEventId = Math.min(group.minEventId, it.eventId);
      if (it.awaiting) group.awaiting += 1;
      byRoom.set(it.roomId, group);
    }
    return [...byRoom.values()]
      .sort((a, b) => sortDir === "desc" ? b.maxEventId - a.maxEventId : a.minEventId - b.minEventId);
  }, [sortedVisible, roomsById, sortDir]);

  const itemProps = (it: ActivityItemModel, showRoom: boolean) => ({
    item: it,
    actor: agentsById.get(it.actorId),
    room: roomsById.get(it.roomId),
    reacted: reacted.has(it.eventId),
    showRoom: showRoom && !(compact && allRoomIds.length <= 1),
    onReact,
    onOpenThread,
    onJumpToRoom,
    onViewProfile: setProfileAgent,
    ...(onOpenDm ? { onOpenDm } : {}),
  });

  const FILTERS: Array<{ id: Filter; label: string; n: number; hot?: boolean }> = [
    { id: "all", label: "ALL", n: counts.all },
    { id: "awaits", label: "AWAITING YOU", n: counts.awaits, hot: true },
    { id: "mentions", label: "MENTIONS", n: counts.mentions },
  ];

  const openRoom = open ? roomsById.get(open.roomId) : undefined;

  return (
    <div
      className={`activity-view${open ? " split" : ""}`}
      style={open && !compact ? ({
        gridTemplateColumns: `minmax(0, 1fr) ${threadWidth}px`,
        "--thread-pane-width": `${threadWidth}px`,
      } as CSSProperties) : undefined}
    >
      <div className="activity-main">
        <header className="act-header">
          <div className="act-header-top">
            <div className="act-title-block">
              <IdentityLogoTile className="act-title-mark" ariaHidden>
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 13 8 13 10.5 19 14 6 16 13 21 13" />
                </svg>
              </IdentityLogoTile>
              <div>
                <div className="act-title">ACTIVITY</div>
                <div className="act-title-sub">
                  {!compact && (
                    <>
                      {groupedView ? "cross-room feed" : "timeline"}
                      <span className="dot-sep">·</span>
                    </>
                  )}
                  {counts.awaits > 0 ? <span className="act-await-inline">{counts.awaits} awaiting you</span> : <span>all caught up ✓</span>}
                  {!compact && phaseCounts.length > 0 ? (
                    <>
                      <span className="dot-sep">·</span>
                      <span>{phaseCounts.map(({ phase, count }) => `${count} ${phaseLabel(phase).toLowerCase()}`).join(", ")}</span>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="act-header-actions">
              {compact ? (
                <>
                  {onOpenSettings ? (
                    <IconButton
                      icon={Settings}
                      label="open display settings"
                      size={40}
                      iconSize={20}
                      onClick={onOpenSettings}
                      className="act-settings-btn"
                    />
                  ) : null}
                  {counts.awaits > 0 ? (
                    <IconButton
                      icon={CheckCheck}
                      label="mark all handled"
                      size={40}
                      iconSize={20}
                      onClick={() => void ackAll()}
                      className="act-settings-btn"
                    />
                  ) : null}
                </>
              ) : (
                <>
                  <ActivityViewControls viewMode={viewMode} sortDir={sortDir} onViewMode={setViewMode} onSortDir={setSortDir} />
                  <ActivityLiveToggle aliveOnly={aliveOnly} busyCount={busyCount} onToggle={() => setAliveOnly((value) => !value)} />
                  <button
                    className="act-markall topbar-control"
                    onClick={() => void ackAll()}
                    disabled={counts.awaits === 0}
                    type="button"
                    title="Mark all handled"
                    aria-label="Mark all handled"
                  >
                    ✓
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="act-filterbar">
            <div className="act-filters">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  className={`act-filter topbar-control${filter === f.id ? " active" : ""}${f.hot && f.n > 0 ? " hot" : ""}`}
                  onClick={() => setFilter(f.id)}
                  type="button"
                >
                  {f.label}
                  <span className="act-filter-n">{f.n}</span>
                </button>
              ))}
              {compact && (
                <>
                  <ActivityViewControls viewMode={viewMode} sortDir={sortDir} onViewMode={setViewMode} onSortDir={setSortDir} />
                  <ActivityLiveToggle aliveOnly={aliveOnly} busyCount={busyCount} onToggle={() => setAliveOnly((value) => !value)} />
                </>
              )}
            </div>
            <RoomFilterBar
              roomIds={allRoomIds}
              roomsById={roomsById}
              selected={roomSel}
              onToggle={toggleRoom}
              onClear={() => setRoomSel(new Set())}
              compact={compact}
            />
          </div>
        </header>

        {visible.length === 0 ? (
          <div className="act-scroll">
            <div className="act-empty">
              <p>No activity matches this filter. Try <b>ALL</b> or clear the room filter.</p>
            </div>
          </div>
        ) : groupedView ? (
          <div className="act-scroll layout-digest">
            <div className="act-digest">
              {grouped.map((g) => (
                <RoomDigest
                  key={g.roomId}
                  group={g}
                  collapsed={collapsed.has(g.roomId)}
                  onToggle={() => toggleCollapse(g.roomId)}
                  itemProps={itemProps}
                  onAckItems={(items) => void ackActivityEvents(awaitingEventIds(items))}
                  onJumpToRoom={onJumpToRoom}
                  agentsById={agentsById}
                  compact={compact}
                />
              ))}
              <LoadMore onLoad={loadMore} />
            </div>
          </div>
        ) : (
          <TimelineFlat
            items={sortedVisible}
            sortDir={sortDir}
            itemProps={itemProps}
            agentsById={agentsById}
            roomsById={roomsById}
            onJumpToRoom={onJumpToRoom}
            onAckEvents={(eventIds) => void ackActivityEvents(eventIds)}
            onLoad={loadMore}
            compact={compact}
          />
        )}
      </div>

      {open && openRoom && (
        <>
          {!compact && <ResizeHandle width={threadWidth} onChange={onThreadWidth} />}
          <ThreadPane room={openRoom} parentId={open.parentId} focusMessageId={open.focusMessageId} onClose={() => setOpen(null)} />
        </>
      )}
      <AgentProfileDialog agent={profileAgent} onClose={() => setProfileAgent(null)} />
    </div>
  );
}

function workPhaseCounts(agents: Agent[]): Array<{ phase: NonNullable<Agent["workState"]>["phase"]; count: number }> {
  const counts = new Map<NonNullable<Agent["workState"]>["phase"], number>();
  for (const agent of agents) {
    if (!agent.workState) continue;
    counts.set(agent.workState.phase, (counts.get(agent.workState.phase) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([phase, count]) => ({ phase, count }));
}

function LoadMore({ onLoad }: { onLoad(): Promise<void> }) {
  return (
    <button className="act-loadmore" type="button" onClick={() => void onLoad()}>
      load older ↓
    </button>
  );
}

function awaitingEventIds(items: ActivityItemModel[]): number[] {
  return items.filter((item) => item.awaiting).map((item) => item.eventId);
}

function ActivityViewControls({
  viewMode,
  sortDir,
  onViewMode,
  onSortDir,
}: {
  viewMode: ActivityViewMode;
  sortDir: SortDirection;
  onViewMode(value: ActivityViewMode): void;
  onSortDir(updater: (value: SortDirection) => SortDirection): void;
}) {
  const timelineActive = viewMode === "timeline";
  const groupedActive = viewMode === "grouped";
  return (
    <div className="act-view-controls" aria-label="Activity view controls">
      <button
        className="act-sort-toggle"
        onClick={() => onSortDir((value) => value === "desc" ? "asc" : "desc")}
        type="button"
        title={sortDir === "desc" ? "Newest first" : "Oldest first"}
        aria-label={sortDir === "desc" ? "Sorted newest first" : "Sorted oldest first"}
        aria-pressed={sortDir === "desc"}
      >
        {sortDir === "desc" ? <ArrowDownWideNarrow size={17} strokeWidth={2.1} aria-hidden /> : <ArrowUpNarrowWide size={17} strokeWidth={2.1} aria-hidden />}
      </button>
      <div className="act-view-segment" role="group" aria-label="Activity layout">
        <button
          className={`act-view-icon${timelineActive ? " active" : ""}`}
          onClick={() => onViewMode("timeline")}
          type="button"
          title="Timeline view"
          aria-label="Timeline view"
          aria-pressed={timelineActive}
        >
          <Rows3 size={18} strokeWidth={2.1} aria-hidden />
        </button>
        <button
          className={`act-view-icon${groupedActive ? " active" : ""}`}
          onClick={() => onViewMode("grouped")}
          type="button"
          title="Grouped view"
          aria-label="Grouped view"
          aria-pressed={groupedActive}
        >
          <LayoutList size={18} strokeWidth={2.1} aria-hidden />
        </button>
      </div>
    </div>
  );
}

function ActivityLiveToggle({
  aliveOnly,
  busyCount,
  onToggle,
}: {
  aliveOnly: boolean;
  busyCount: number;
  onToggle(): void;
}) {
  return (
    <button
      className={`act-live${aliveOnly ? " active" : ""}`}
      onClick={onToggle}
      type="button"
      title="Show only activity from working agents"
      aria-pressed={aliveOnly}
    >
      <span className="act-live-dot" />
      <span className="act-live-working">{busyCount} working</span>
    </button>
  );
}

interface RoomGroup {
  roomId: string;
  room: Room;
  items: ActivityItemModel[];
  awaiting: number;
}

type ItemPropsFn = (it: ActivityItemModel, showRoom: boolean) => React.ComponentProps<typeof ActivityItem>;

function RoomDigest({
  group,
  collapsed,
  onToggle,
  itemProps,
  onAckItems,
  onJumpToRoom,
  agentsById,
  compact,
}: {
  group: RoomGroup;
  collapsed: boolean;
  onToggle(): void;
  itemProps: ItemPropsFn;
  onAckItems(items: ActivityItemModel[]): void;
  onJumpToRoom(roomId: string, msgId?: string): void;
  agentsById: Map<string, Agent>;
  compact: boolean;
}) {
  const { room, roomId, items, awaiting } = group;
  const isDm = room.kind === "dm";
  const label = roomNameText(room.kind, room.name);
  const expanded = !collapsed;
  const last = items[0];
  const showFooterOpen = !compact && items.length >= 15;
  const canAck = awaiting > 0;
  return (
    <div className={`act-digest-room${expanded ? " open" : ""}`}>
      <div className="act-digest-head">
        <button className="act-digest-toggle" onClick={onToggle} type="button">
          <span className="act-digest-chevron">{expanded ? "▾" : "▸"}</span>
          {isDm ? (
            <IdentityBadge className="act-room-icon sm" color={room.color}>
              {room.emoji ?? label[0]}
            </IdentityBadge>
          ) : null}
          <RoomNameInline kind={room.kind} name={room.name} className="act-room-name" />
          <span className="act-room-count">{items.length}</span>
          {awaiting > 0 && <span className="act-room-await">{awaiting} awaiting</span>}
          {!expanded && last && (
            <span className="act-digest-preview">
              {agentsById.get(last.actorId)?.name}: {stripMd(last.text).slice(0, 60)}…
            </span>
          )}
        </button>
        {!compact && (
          <>
            {canAck && (
              <button
                className="act-scope-ack"
                onClick={() => onAckItems(items)}
                type="button"
                title={`Mark ${label} handled`}
                aria-label={`Mark ${label} handled`}
              >
                ✓
              </button>
            )}
            <button className="act-digest-headgo" onClick={() => onJumpToRoom(roomId)} type="button" title={`Open ${label}`}>
              open →
            </button>
          </>
        )}
      </div>
      {expanded && (
        <div className="act-digest-items">
          {items.map((it) => (
            <ActivityItem key={it.id} {...itemProps(it, false)} />
          ))}
          {showFooterOpen && (
            <button className="act-digest-go" onClick={() => onJumpToRoom(roomId)} type="button">
              open {label} →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function TimelineFlat({
  items,
  sortDir,
  itemProps,
  agentsById,
  roomsById,
  onJumpToRoom,
  onAckEvents,
  onLoad,
  compact,
}: {
  items: ActivityItemModel[];
  sortDir: SortDirection;
  itemProps: ItemPropsFn;
  agentsById: Map<string, Agent>;
  roomsById: Map<string, Room>;
  onJumpToRoom(roomId: string, msgId?: string): void;
  onAckEvents(eventIds: number[]): void;
  onLoad(): Promise<void>;
  compact: boolean;
}) {
  const scrollRef = useAutoScrollbar<HTMLDivElement>();
  const latest = useMemo(
    () => items.reduce<ActivityItemModel | undefined>((best, item) => !best || item.eventId > best.eventId ? item : best, undefined),
    [items],
  );
  const entries = useMemo(() => bucketTimeline(items, sortDir), [items, sortDir]);
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 56,
    overscan: 10,
  });
  return (
    <div className="act-scroll layout-flat autoscroll" ref={scrollRef}>
      <div className="act-flat">
        {!compact && latest && (
          <LatestStrip item={latest} actor={agentsById.get(latest.actorId)} room={roomsById.get(latest.roomId)} onJumpToRoom={onJumpToRoom} />
        )}
        <div className="act-flat-list virtualized-spacer" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((row) => {
            const entry = entries[row.index];
            if (!entry) return null;
            return (
              <div
                key={entry.id}
                className="virtualized-row activity-virtual-row"
                data-index={row.index}
                ref={virtualizer.measureElement}
                style={{ transform: `translateY(${row.start}px)` }}
              >
                {entry.kind === "bucket" ? (
                  <div className="act-timeline-bucket">
                    <span className="act-timeline-bucket-label">{entry.label}</span>
                    <span>{entry.count}</span>
                    {entry.awaitingEventIds.length > 0 && (
                      <button
                        className="act-scope-ack"
                        onClick={() => onAckEvents(entry.awaitingEventIds)}
                        type="button"
                        title={`Mark ${entry.label} handled`}
                        aria-label={`Mark ${entry.label} handled`}
                      >
                        ✓
                      </button>
                    )}
                  </div>
                ) : (
                  <ActivityItem {...itemProps(entry.item, true)} />
                )}
              </div>
            );
          })}
        </div>
        <LoadMore onLoad={onLoad} />
      </div>
    </div>
  );
}

function LatestStrip({
  item,
  actor,
  room,
  onJumpToRoom,
}: {
  item: ActivityItemModel;
  actor: Agent | undefined;
  room: Room | undefined;
  onJumpToRoom(roomId: string, msgId?: string): void;
}) {
  if (!actor) return null;
  return (
    <div className="act-latest">
      <span className="act-latest-tag">▸ MOST RECENT</span>
      <Avatar agent={actor} size={26} />
      <IdentityBadge className="act-latest-actor" color={actor.color}>{actor.name}</IdentityBadge>
      <span className="act-latest-text">{stripMd(item.text).slice(0, 90)}</span>
      {room && <RoomNameInline kind={room.kind} name={room.name} className="act-latest-room" />}
      <span className="act-spacer" />
      <button className="act-act-btn jump" onClick={() => onJumpToRoom(item.roomId, item.msgId)} type="button">
        jump ↳
      </button>
    </div>
  );
}

function bucketTimeline(items: ActivityItemModel[], sortDir: SortDirection): TimelineEntry[] {
  // Cascading age buckets: each item belongs to the first matching window, so
  // "Today" excludes the last 5h, "Last 3 days" excludes today, and so on.
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  const now = Date.now();
  const buckets = [
    { id: "5h", label: "Last 5h", maxAgeMs: 5 * hour },
    { id: "1d", label: "Today", maxAgeMs: day },
    { id: "3d", label: "Last 3 days", maxAgeMs: 3 * day },
    { id: "7d", label: "Last 7 days", maxAgeMs: 7 * day },
    { id: "30d", label: "Last 1 month", maxAgeMs: 30 * day },
    { id: "older", label: "Older", maxAgeMs: Number.POSITIVE_INFINITY },
  ];
  const byBucket = buckets.map((bucket) => ({ ...bucket, items: [] as ActivityItemModel[] }));

  for (const item of items) {
    const age = now - Date.parse(item.createdAt);
    const bucket = byBucket.find((candidate) => age <= candidate.maxAgeMs) ?? byBucket.at(-1)!;
    bucket.items.push(item);
  }

  const entries: TimelineEntry[] = [];
  const orderedBuckets = sortDir === "desc" ? byBucket : [...byBucket].reverse();
  for (const bucket of orderedBuckets) {
    if (bucket.items.length === 0) continue;
    entries.push({
      kind: "bucket",
      id: `bucket:${bucket.id}`,
      label: bucket.label,
      count: bucket.items.length,
      awaitingEventIds: awaitingEventIds(bucket.items),
    });
    entries.push(...bucket.items.map((item) => ({ kind: "item" as const, id: item.id, item })));
  }
  return entries;
}

// ─── multi-select room filter: fit as many pills as the bar allows + a panel ──
function RoomFilterBar({
  roomIds,
  roomsById,
  selected,
  onToggle,
  onClear,
  compact = false,
}: {
  roomIds: string[];
  roomsById: Map<string, Room>;
  selected: Set<string>;
  onToggle(id: string): void;
  onClear(): void;
  compact?: boolean;
}) {
  const moreRef = useRef<HTMLDivElement>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    if (!panelOpen) return undefined;
    const onDown = (e: MouseEvent) => {
      if (moreRef.current && moreRef.current.contains(e.target as Node)) return;
      setPanelOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [panelOpen]);

  const ordered = useMemo(() => {
    const arr = roomIds.map((id) => ({ id, room: roomsById.get(id) })).filter((r): r is { id: string; room: Room } => Boolean(r.room));
    arr.sort((a, b) => (selected.has(b.id) ? 1 : 0) - (selected.has(a.id) ? 1 : 0));
    return arr;
  }, [roomIds, roomsById, selected]);

  const roomList = panelOpen ? (
    <div className="act-roomlist">
      <div className="act-roomlist-head">
        <span>FILTER ROOMS</span>
        <span className="act-roomlist-sel">{selected.size ? `${selected.size} selected` : "all"}</span>
        {selected.size > 0 && <button className="act-roomlist-clear" onClick={onClear} type="button">clear</button>}
      </div>
      <div className="act-roomlist-scroll">
        {ordered.map(({ id, room }) => {
          const on = selected.has(id);
          return (
            <button key={id} className={`act-roomlist-row${on ? " on" : ""}`} onClick={() => onToggle(id)} type="button">
              <span className={`act-roomlist-check${on ? " on" : ""}`}>{on ? "✓" : ""}</span>
              {room.kind === "group" ? (
                <IdentityLogoTile className="act-room-icon sm room-glyph-icon" color={room.color}>{room.emoji ?? "#"}</IdentityLogoTile>
              ) : (
                <IdentityBadge className="act-room-icon sm" color={room.color}>{room.emoji ?? room.name[0]}</IdentityBadge>
              )}
              <RoomNameInline kind={room.kind} name={room.name} className="act-roomlist-name" />
              {room.unread > 0 && <span className="act-roomlist-unread">{room.unread}</span>}
            </button>
          );
        })}
      </div>
    </div>
  ) : null;

  const roomFilterLabel = selected.size === 0 ? "all" : String(selected.size);
  const roomFilterAria = selected.size === 0 ? "Filter rooms, all rooms" : `Filter rooms, ${selected.size} selected`;
  return (
    <div className={`act-roombar act-roombar-inline act-roombar-menuonly${compact ? " act-roombar-compact" : ""}`}>
        <div className="act-room-filter-wrap" ref={moreRef}>
        <button
          className={`act-filter act-room-filter-trigger topbar-control${selected.size > 0 ? " active" : ""}${panelOpen ? " open" : ""}`}
          onClick={() => setPanelOpen((o) => !o)}
          type="button"
          title="Filter rooms"
          aria-label={roomFilterAria}
          aria-pressed={selected.size > 0}
        >
          ROOM
          <span className="act-filter-n">{roomFilterLabel}</span>
          <span className="act-room-filter-caret">▾</span>
        </button>
        {roomList}
      </div>
    </div>
  );
}

function stripMd(s: string): string {
  return String(s).replace(/\*\*/g, "").replace(/`/g, "");
}
