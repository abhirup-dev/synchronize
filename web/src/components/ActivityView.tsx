// Global, cross-room Activity feed. Two viewing modes — Grouped (Digest:
// per-room, collapsible) and Timeline (flat, newest-first). Filters: All /
// Awaiting you / Mentions, plus a multi-select room filter. Diving into a thread
// opens the real ThreadPane in a resizable side panel without leaving Activity;
// root messages open as a single-message thread. "jump" leaves for the room.
// Only the densities the user landed on are shipped (Digest + Row + the
// Grouped/Timeline toggle).

import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { CheckCheck, Settings } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useAckActivity,
  useAckAllActivity,
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
import { Avatar, IdentityBadge } from "./primitives.tsx";
import { AgentProfileDialog } from "./AgentPreview.tsx";
import { useAutoScrollbar } from "../hooks/useAutoScrollbar.ts";
import { useActivityPreferences } from "../hooks/useActivityPreferences.ts";
import { useIsCompact, useShellMode } from "../shell-mode.tsx";
import { IconButton } from "./IconButton.tsx";

type Filter = "all" | "awaits" | "mentions";
type TimelineEntry =
  | { kind: "bucket"; id: string; label: string; count: number }
  | { kind: "item"; id: string; item: ActivityItemModel };

interface ActivityViewProps {
  onJumpToRoom(roomId: string, msgId?: string): void;
  threadWidth: number;
  onThreadWidth(width: number): void;
  onOpenSettings?(event: ReactMouseEvent): void;
}

export function ActivityView({ onJumpToRoom, threadWidth, onThreadWidth, onOpenSettings }: ActivityViewProps) {
  const items = useActivity();
  const awaitingCount = useActivityAwaitingCount();
  const agents = useAgents();
  const rooms = useRooms();
  const reactToMessage = useReactToMessage();
  const ackActivity = useAckActivity();
  const ackAll = useAckAllActivity();
  const loadMore = useLoadMoreActivity();

  const { cluster, setCluster, aliveOnly, setAliveOnly } = useActivityPreferences();
  const [filter, setFilter] = useState<Filter>("all");
  const [roomSel, setRoomSel] = useState<Set<string>>(() => new Set());
  const [reacted, setReacted] = useState<Set<number>>(() => new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [open, setOpen] = useState<{ roomId: string; parentId: string; focusMessageId: string } | null>(null);
  const [profileAgent, setProfileAgent] = useState<Agent | null>(null);

  const agentsById = useMemo(() => new Map(agents.map((a) => [a.id, a] as const)), [agents]);
  const roomsById = useMemo(() => new Map(rooms.map((r) => [r.id, r] as const)), [rooms]);
  const busyCount = useMemo(() => agents.filter((a) => a.status === "busy").length, [agents]);
  const compact = useIsCompact();
  const shellMode = useShellMode();
  const roomFilterMenuOnly = compact || shellMode === "medium";


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

  const counts = useMemo(
    () => ({
      all: baseItems.length,
      awaits: aliveOnly ? baseItems.filter((it) => it.awaiting).length : awaitingCount,
      mentions: baseItems.filter((it) => it.isMention).length,
    }),
    [baseItems, awaitingCount, aliveOnly],
  );

  const allRoomIds = useMemo(() => {
    const seen: string[] = [];
    for (const it of baseItems) if (!seen.includes(it.roomId)) seen.push(it.roomId);
    return seen;
  }, [baseItems]);

  const grouped = useMemo(() => {
    const byRoom = new Map<string, ActivityItemModel[]>();
    for (const it of visible) {
      const list = byRoom.get(it.roomId) ?? [];
      list.push(it);
      byRoom.set(it.roomId, list);
    }
    return [...byRoom.entries()]
      .map(([roomId, list]) => ({
        roomId,
        room: roomsById.get(roomId),
        items: list,
        maxEventId: Math.max(...list.map((i) => i.eventId)),
        awaiting: list.filter((i) => i.awaiting).length,
      }))
      .filter((g): g is typeof g & { room: Room } => Boolean(g.room))
      .sort((a, b) => b.maxEventId - a.maxEventId);
  }, [visible, roomsById]);

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
              <span className="act-title-mark" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 13 8 13 10.5 19 14 6 16 13 21 13" />
                </svg>
              </span>
              <div>
                <div className="act-title">ACTIVITY</div>
                <div className="act-title-sub">
                  {!compact && (
                    <>
                      {cluster ? "cross-room feed" : "timeline"}
                      <span className="dot-sep">·</span>
                    </>
                  )}
                  {counts.awaits > 0 ? <span className="act-await-inline">{counts.awaits} awaiting you</span> : <span>all caught up ✓</span>}
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
                  <button
                    className="act-view-switch"
                    onClick={() => setCluster((value) => !value)}
                    type="button"
                    title={cluster ? "Switch to timeline" : "Switch to grouped"}
                    aria-label={cluster ? "Switch to timeline" : "Switch to grouped"}
                  >
                    {cluster ? (
                      <>
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" />
                        </svg>
                        TIMELINE
                      </>
                    ) : (
                      <>
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <rect x="3.5" y="3.5" width="7" height="7" /><rect x="13.5" y="3.5" width="7" height="7" />
                          <rect x="3.5" y="13.5" width="7" height="7" /><rect x="13.5" y="13.5" width="7" height="7" />
                        </svg>
                        GROUPED
                      </>
                    )}
                  </button>
                  <button
                    className={`act-live${aliveOnly ? " active" : ""}`}
                    onClick={() => setAliveOnly((value) => !value)}
                    type="button"
                    title="Show only activity from working agents"
                    aria-pressed={aliveOnly}
                  >
                    <span className="act-live-dot" />
                    LIVE
                    <span className="act-live-sep">·</span>
                    <span className="act-live-working">▸ {busyCount} working</span>
                  </button>
                  <button
                    className="act-markall"
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
                  className={`act-filter${filter === f.id ? " active" : ""}${f.hot && f.n > 0 ? " hot" : ""}`}
                  onClick={() => setFilter(f.id)}
                  type="button"
                >
                  {f.label}
                  <span className="act-filter-n">{f.n}</span>
                </button>
              ))}
              {compact && (
                <>
                  <button
                    className="act-filter"
                    onClick={() => setCluster((value) => !value)}
                    type="button"
                    title={cluster ? "Switch to timeline view" : "Switch to grouped view"}
                  >
                    {cluster ? "GROUPED" : "TIMELINE"}
                  </button>
                  <button
                    className={`act-filter act-filter-live${aliveOnly ? " active" : ""}`}
                    onClick={() => setAliveOnly((value) => !value)}
                    type="button"
                    aria-pressed={aliveOnly}
                    title={`Show only activity from working agents (${busyCount} working)`}
                  >
                    LIVE
                    <span className="act-filter-n">{busyCount}</span>
                  </button>
                </>
              )}
            </div>
            {roomFilterMenuOnly ? (
              <RoomFilterBar
                roomIds={allRoomIds}
                roomsById={roomsById}
                selected={roomSel}
                onToggle={toggleRoom}
                onClear={() => setRoomSel(new Set())}
                compact={compact}
                menuOnly
              />
            ) : (
              <RoomFilterBar
                roomIds={allRoomIds}
                roomsById={roomsById}
                selected={roomSel}
                onToggle={toggleRoom}
                onClear={() => setRoomSel(new Set())}
              />
            )}
          </div>
        </header>

        {visible.length === 0 ? (
          <div className="act-scroll">
            <div className="act-empty">
              <p>No activity matches this filter. Try <b>ALL</b> or clear the room filter.</p>
            </div>
          </div>
        ) : cluster ? (
          <div className="act-scroll layout-digest">
            <div className="act-digest">
              {grouped.map((g) => (
                <RoomDigest
                  key={g.roomId}
                  group={g}
                  collapsed={collapsed.has(g.roomId)}
                  onToggle={() => toggleCollapse(g.roomId)}
                  itemProps={itemProps}
                  onJumpToRoom={onJumpToRoom}
                  agentsById={agentsById}
                  compact={compact}
                />
              ))}
              <LoadMore onLoad={loadMore} />
            </div>
          </div>
        ) : (
          <TimelineFlat items={visible} itemProps={itemProps} agentsById={agentsById} roomsById={roomsById} onJumpToRoom={onJumpToRoom} onLoad={loadMore} compact={compact} />
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

function LoadMore({ onLoad }: { onLoad(): Promise<void> }) {
  return (
    <button className="act-loadmore" type="button" onClick={() => void onLoad()}>
      load older ↓
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
  onJumpToRoom,
  agentsById,
  compact,
}: {
  group: RoomGroup;
  collapsed: boolean;
  onToggle(): void;
  itemProps: ItemPropsFn;
  onJumpToRoom(roomId: string, msgId?: string): void;
  agentsById: Map<string, Agent>;
  compact: boolean;
}) {
  const { room, roomId, items, awaiting } = group;
  const isDm = room.kind === "dm";
  const label = isDm ? room.name : `#${room.name}`;
  const expanded = !collapsed;
  const last = items[0];
  return (
    <div className={`act-digest-room${expanded ? " open" : ""}`}>
      <div className="act-digest-head">
        <button className="act-digest-toggle" onClick={onToggle} type="button">
          <span className="act-digest-chevron">{expanded ? "▾" : "▸"}</span>
          <IdentityBadge className="act-room-icon sm" color={room.color}>
            {room.emoji ?? label[0]}
          </IdentityBadge>
          <span className="act-room-name">{label}</span>
          <span className="act-room-count">{items.length}</span>
          {awaiting > 0 && <span className="act-room-await">{awaiting} awaiting</span>}
          {!expanded && last && (
            <span className="act-digest-preview">
              {agentsById.get(last.actorId)?.name}: {stripMd(last.text).slice(0, 60)}…
            </span>
          )}
        </button>
        {!compact && (
          <button className="act-digest-headgo" onClick={() => onJumpToRoom(roomId)} type="button" title={`Open ${label}`}>
            open →
          </button>
        )}
      </div>
      {expanded && (
        <div className="act-digest-items">
          {items.map((it) => (
            <ActivityItem key={it.id} {...itemProps(it, false)} />
          ))}
          {!compact && (
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
  itemProps,
  agentsById,
  roomsById,
  onJumpToRoom,
  onLoad,
  compact,
}: {
  items: ActivityItemModel[];
  itemProps: ItemPropsFn;
  agentsById: Map<string, Agent>;
  roomsById: Map<string, Room>;
  onJumpToRoom(roomId: string, msgId?: string): void;
  onLoad(): Promise<void>;
  compact: boolean;
}) {
  const scrollRef = useAutoScrollbar<HTMLDivElement>();
  const latest = items[0];
  const entries = useMemo(() => bucketTimeline(items), [items]);
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
                    <span>{entry.label}</span>
                    <span>{entry.count}</span>
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
      {room && <span className="act-latest-room">{room.kind === "dm" ? room.name : `#${room.name}`}</span>}
      <span className="act-spacer" />
      <button className="act-act-btn jump" onClick={() => onJumpToRoom(item.roomId, item.msgId)} type="button">
        jump ↳
      </button>
    </div>
  );
}

function bucketTimeline(items: ActivityItemModel[]): TimelineEntry[] {
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
  for (const bucket of byBucket) {
    if (bucket.items.length === 0) continue;
    entries.push({ kind: "bucket", id: `bucket:${bucket.id}`, label: bucket.label, count: bucket.items.length });
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
  menuOnly = false,
}: {
  roomIds: string[];
  roomsById: Map<string, Room>;
  selected: Set<string>;
  onToggle(id: string): void;
  onClear(): void;
  compact?: boolean;
  menuOnly?: boolean;
}) {
  // In the compact shell the rail is a plain horizontally-scrollable row of ALL
  // room chips — NOT the desktop measure-and-fit layout. That measure-and-fit
  // path is a ResizeObserver feedback loop on a narrow screen: rail width →
  // pills that fit → whether the "›" overflow button renders → rail width …
  // which thrashes endlessly. Skipping the observer (railW stays 0 → visN =
  // all → every pill rendered → CSS scrolls them) removes the loop entirely.
  const isCompactShell = useIsCompact();
  const railRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const [railW, setRailW] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    if (isCompactShell) return undefined;
    if (!railRef.current) return undefined;
    const ro = new ResizeObserver((entries) => setRailW(entries[0]?.contentRect.width ?? 0));
    ro.observe(railRef.current);
    return () => ro.disconnect();
  }, [isCompactShell]);

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

  const estWidth = (room: Room) => {
    const name = room.kind === "dm" ? room.name : `#${room.name}`;
    return 40 + name.length * 7.4;
  };
  let visN = ordered.length;
  if (!isCompactShell && railW > 0) {
    let avail = railW;
    visN = 0;
    for (const r of ordered) {
      const w = estWidth(r.room) + 6;
      if (avail - w < 0) break;
      avail -= w;
      visN += 1;
    }
  }
  const visiblePills = ordered.slice(0, visN);
  const hiddenCount = ordered.length - visN;
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
              <IdentityBadge className="act-room-icon sm" color={room.color}>{room.emoji ?? (room.kind === "dm" ? room.name[0] : "#")}</IdentityBadge>
              <span className="act-roomlist-name">{room.kind === "dm" ? room.name : `#${room.name}`}</span>
              {room.unread > 0 && <span className="act-roomlist-unread">{room.unread}</span>}
            </button>
          );
        })}
      </div>
    </div>
  ) : null;

  if (menuOnly) {
    return (
      <div className={`act-roombar act-roombar-inline act-roombar-menuonly${compact ? " act-roombar-compact" : ""}`}>
        <div className="act-rf-more-wrap" ref={moreRef}>
          <button
            className={`act-filter act-room-filter-trigger${selected.size > 0 ? " active" : ""}${panelOpen ? " open" : ""}`}
            onClick={() => setPanelOpen((o) => !o)}
            type="button"
            title="Filter rooms"
            aria-label="Filter rooms"
            aria-pressed={selected.size > 0}
          >
            ROOMS
            <span className="act-filter-n">{selected.size || ordered.length}</span>
          </button>
          {roomList}
        </div>
      </div>
    );
  }

  return (
    <div className={`act-roombar${compact ? " act-roombar-inline" : ""}`}>
      {!compact && <span className="act-roombar-label">ROOM</span>}
      {(!compact || selected.size > 0) && (
        <button className={`act-rf-chip${selected.size === 0 ? " active" : ""}`} onClick={onClear} type="button">
          all
        </button>
      )}
      <div className="act-roombar-rail" ref={railRef}>
        {visiblePills.map(({ id, room }) => (
          <button key={id} className={`act-rf-chip${selected.has(id) ? " active" : ""}`} onClick={() => onToggle(id)} type="button">
            <IdentityBadge className="act-rf-dot" color={room.color} />
            {room.kind === "dm" ? room.name : `#${room.name}`}
          </button>
        ))}
      </div>
      {(!compact || hiddenCount > 0) && <div className="act-rf-more-wrap" ref={moreRef}>
        <button
          className={`act-rf-more${compact ? " act-rf-more-arrow" : ""}${panelOpen ? " open" : ""}`}
          onClick={() => setPanelOpen((o) => !o)}
          type="button"
          title={hiddenCount > 0 ? `${hiddenCount} more rooms` : "All rooms"}
          aria-label={hiddenCount > 0 ? `${hiddenCount} more rooms` : "All rooms"}
        >
          {compact ? "›" : `${hiddenCount > 0 ? `+${hiddenCount} more` : "all rooms"} ▾`}
        </button>
        {roomList}
      </div>}
    </div>
  );
}

function stripMd(s: string): string {
  return String(s).replace(/\*\*/g, "").replace(/`/g, "");
}
