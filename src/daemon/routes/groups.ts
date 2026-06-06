import { MAX_MESSAGE_CHARS } from "../../constants.ts";
import { HttpError, jsonResponse } from "../../http.ts";
import { mapSqliteConstraint } from "../errors.ts";
import { parseSelectorsFromUrl } from "../selectors.ts";
import {
  ackInboxEvents,
  attachReactions,
  buildReplyDestination,
  computeThreadParticipants,
  defaultGroupPath,
  emitWebStateChanged,
  ensureActiveMember,
  ensurePeer,
  fanoutRosterEventToInbox,
  formatGroup,
  getEvent,
  getGroup,
  getGroupById,
  getGroupMember,
  getGroupMembers,
  getGroupPaths,
  getPeer,
  getVisibleEvent,
  insertGroupPath,
  joinGroupCore,
  listGroupHistoryFlat,
  listGroupHistoryThreads,
  log,
  notifySubscribers,
  resolveMentions,
  resolveThreadParent,
  type DaemonContext,
  type GroupRow,
} from "../server.ts";
import {
  optionalInteger,
  optionalString,
  optionalStringArray,
  parseCursor,
  parseEventIdsParam,
  parseGroupHistoryView,
  readBody,
  requireGroupName,
  requireLaunchPath,
  requireString,
} from "../validation.ts";

export async function tryHandleGroupsRoute(request: Request, ctx: DaemonContext, url: URL): Promise<Response | null> {
  if (request.method === "POST" && url.pathname === "/groups") {
    const body = await readBody(request);
    const name = requireGroupName(requireString(body, "name"));
    const creatorPeerId = optionalString(body, "creator_peer_id");
    const description = optionalString(body, "description") ?? null;
    const durable = body.ephemeral === true ? 0 : 1;
    if (creatorPeerId) ensurePeer(ctx.db, creatorPeerId);
    // media_dir is always lowercased so case-only differences cannot collide
    // on case-insensitive filesystems (macOS APFS, Windows). Display name keeps
    // original case via groups.name.
    const mediaDir = `${ctx.paths.mediaPath}/${name.toLowerCase()}`;

    const groupId = ctx.db.transaction(() => {
      // Case-insensitive collision check. SQLite's UNIQUE constraint is
      // case-sensitive, so 'Foo' and 'foo' would otherwise both insert but
      // share the same lowercased media_dir on disk.
      const caseConflict = ctx.db
        .query<{ name: string }, [string]>(
          "SELECT name FROM groups WHERE LOWER(name) = LOWER(?)",
        )
        .get(name);
      if (caseConflict) {
        throw new HttpError(
          409,
          "group_exists",
          `Group already exists (case-insensitive match): ${caseConflict.name}`,
        );
      }
      try {
        ctx.db
          .query("INSERT INTO groups (name, durable, media_dir, creator_peer_id, description) VALUES (?, ?, ?, ?, ?)")
          .run(name, durable, mediaDir, creatorPeerId ?? null, description);
      } catch (error) {
        throw mapSqliteConstraint(error, "group_exists", `Group already exists: ${name}`);
      }
      const id = Number(ctx.db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()?.id);
      insertGroupPath(ctx.db, id, defaultGroupPath(ctx));
      ctx.db
        .query("INSERT INTO events (type, sender_peer_id, group_id, body) VALUES ('group_created', ?, ?, ?)")
        .run(creatorPeerId ?? null, id, JSON.stringify({ name, durable: Boolean(durable) }));
      return id;
    })();

    emitWebStateChanged(ctx, { domains: ["groups", "events"], groupId });
    return jsonResponse({ group: formatGroup(getGroupById(ctx.db, groupId)) }, { status: 201 });
  }

  const groupPaths = url.pathname.match(/^\/groups\/([^/]+)\/paths$/);
  if (groupPaths && request.method === "GET") {
    const group = getGroup(ctx.db, decodeURIComponent(groupPaths[1] ?? ""));
    return jsonResponse({ paths: getGroupPaths(ctx.db, group.group_id) });
  }

  if (groupPaths && request.method === "POST") {
    const group = getGroup(ctx.db, decodeURIComponent(groupPaths[1] ?? ""));
    const body = await readBody(request);
    const path = requireLaunchPath(requireString(body, "path"));
    const label = optionalString(body, "label") ?? null;
    insertGroupPath(ctx.db, group.group_id, path, label);
    emitWebStateChanged(ctx, { domains: ["groups"], groupId: group.group_id });
    return jsonResponse({ paths: getGroupPaths(ctx.db, group.group_id) }, { status: 201 });
  }

  if (request.method === "GET" && url.pathname === "/groups") {
    const member = url.searchParams.get("member");
    if (member) {
      // Scoped listing: groups this peer is an ACTIVE member of, with the
      // peer's own alias + join time. Powers bridge_list_groups({ mine: true }).
      const rows = ctx.db
        .query<GroupRow & { alias: string; joined_at: string }, [string]>(
          `SELECT g.*, gm.alias AS alias, gm.joined_at AS joined_at
           FROM groups g
           JOIN group_members gm ON gm.group_id = g.group_id
           WHERE gm.peer_id = ? AND gm.active = 1
           ORDER BY g.name ASC`,
        )
        .all(member);
      return jsonResponse({
        groups: rows.map((row) => ({ ...formatGroup(row), alias: row.alias, joined_at: row.joined_at })),
      });
    }
    const rows = ctx.db.query<GroupRow, []>("SELECT * FROM groups ORDER BY name ASC").all();
    return jsonResponse({ groups: rows.map(formatGroup) });
  }

  const groupMatch = url.pathname.match(/^\/groups\/([^/]+)$/);
  if (request.method === "GET" && groupMatch) {
    const group = getGroup(ctx.db, decodeURIComponent(groupMatch[1] ?? ""));
    return jsonResponse({ group: formatGroup(group), members: getGroupMembers(ctx.db, group.group_id), paths: getGroupPaths(ctx.db, group.group_id) });
  }

  const groupJoin = url.pathname.match(/^\/groups\/([^/]+)\/join$/);
  if (request.method === "POST" && groupJoin) {
    const group = getGroup(ctx.db, decodeURIComponent(groupJoin[1] ?? ""));
    const body = await readBody(request);
    const peerId = requireString(body, "peer_id");
    const peer = getPeer(ctx.db, peerId);
    const alias = optionalString(body, "alias") ?? peer.session_name;
    const fresh = body.fresh === true;

    // Idempotent short-circuit: if this peer is already an active member of
    // the group with the exact same alias, return current state without
    // emitting a phantom group_joined event. A naive re-join (e.g. "join
    // just to be safe") would otherwise pollute the event stream and the
    // inboxes of every other active member.
    const existing = ctx.db
      .query<{ alias: string; active: number }, [number, string]>(
        "SELECT alias, active FROM group_members WHERE group_id = ? AND peer_id = ?",
      )
      .get(group.group_id, peerId);
    if (existing && existing.active === 1 && existing.alias === alias) {
      return jsonResponse({
        member: getGroupMember(ctx.db, group.group_id, peerId),
        event: null,
        already_member: true,
      });
    }

    const { eventId: joinEventId, reclaimed } = joinGroupCore(ctx, group, peer, alias, fresh);

    emitWebStateChanged(ctx, { domains: ["groups", "events", "inbox"], eventId: joinEventId, groupId: group.group_id, peerId });
    return jsonResponse({
      member: getGroupMember(ctx.db, group.group_id, peerId),
      event: getEvent(ctx.db, joinEventId),
      ...(reclaimed ? { reclaimed_from: reclaimed } : {}),
    });
  }

  const groupRename = url.pathname.match(/^\/groups\/([^/]+)\/rename$/);
  if (request.method === "POST" && groupRename) {
    const group = getGroup(ctx.db, decodeURIComponent(groupRename[1] ?? ""));
    const body = await readBody(request);
    const peerId = requireString(body, "peer_id");
    const newAlias = requireString(body, "new_alias");
    ensureActiveMember(ctx.db, group.group_id, peerId);

    const renameEventId = ctx.db.transaction(() => {
      const current = ctx.db
        .query<{ alias: string }, [number, string]>(
          "SELECT alias FROM group_members WHERE group_id = ? AND peer_id = ?",
        )
        .get(group.group_id, peerId);
      const oldAlias = current?.alias ?? "";
      if (oldAlias === newAlias) {
        throw new HttpError(400, "no_op_rename", `Alias is already '${newAlias}'`);
      }
      try {
        ctx.db
          .query("UPDATE group_members SET alias = ? WHERE group_id = ? AND peer_id = ?")
          .run(newAlias, group.group_id, peerId);
      } catch (error) {
        throw mapSqliteConstraint(
          error,
          "alias_collision",
          `Alias '${newAlias}' is already active in group '${group.name}'.`,
        );
      }
      ctx.db
        .query(
          `INSERT INTO events (type, sender_peer_id, group_id, body)
           VALUES ('group_member_renamed', ?, ?, ?)`,
        )
        .run(peerId, group.group_id, JSON.stringify({ old_alias: oldAlias, new_alias: newAlias }));
      const id = Number(ctx.db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()?.id);
      fanoutRosterEventToInbox(ctx.db, group.group_id, id, peerId);
      return id;
    })();

    emitWebStateChanged(ctx, { domains: ["groups", "events", "inbox"], eventId: renameEventId, groupId: group.group_id, peerId });
    return jsonResponse({
      member: getGroupMember(ctx.db, group.group_id, peerId),
      event: getEvent(ctx.db, renameEventId),
    });
  }

  const groupPatch = url.pathname.match(/^\/groups\/([^/]+)$/);
  if (request.method === "PATCH" && groupPatch) {
    const group = getGroup(ctx.db, decodeURIComponent(groupPatch[1] ?? ""));
    const body = await readBody(request);
    if (!("description" in body)) {
      throw new HttpError(400, "invalid_request", "PATCH /groups/:name expects a body with at least one updatable field (description)");
    }
    const raw = body.description;
    let description: string | null;
    if (raw === null) {
      description = null;
    } else if (typeof raw === "string") {
      const trimmed = raw.trim();
      description = trimmed === "" ? null : trimmed;
    } else {
      throw new HttpError(400, "invalid_request", "description must be a string or null");
    }
    ctx.db
      .query("UPDATE groups SET description = ? WHERE group_id = ?")
      .run(description, group.group_id);
    emitWebStateChanged(ctx, { domains: ["groups"], groupId: group.group_id });
    return jsonResponse({ group: formatGroup(getGroup(ctx.db, group.name)) });
  }

  const groupLeave = url.pathname.match(/^\/groups\/([^/]+)\/leave$/);
  if (request.method === "POST" && groupLeave) {
    const group = getGroup(ctx.db, decodeURIComponent(groupLeave[1] ?? ""));
    const body = await readBody(request);
    const peerId = requireString(body, "peer_id");
    // Idempotent: if the peer is not an active member, return ok without
    // emitting a phantom group_left event. Mirrors bridge_join_group's
    // already_member: true shape so the API stays consistent.
    const currentMember = ctx.db
      .query<{ active: number }, [number, string]>(
        "SELECT active FROM group_members WHERE group_id = ? AND peer_id = ?",
      )
      .get(group.group_id, peerId);
    if (!currentMember || currentMember.active === 0) {
      return jsonResponse({ ok: true, event: null, already_left: true });
    }
    const eventId = ctx.db.transaction(() => {
      ctx.db
        .query(
          `UPDATE group_members
           SET active = 0, left_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
           WHERE group_id = ? AND peer_id = ?`,
        )
        .run(group.group_id, peerId);
      ctx.db.query("INSERT INTO events (type, sender_peer_id, group_id) VALUES ('group_left', ?, ?)").run(peerId, group.group_id);
      const id = Number(ctx.db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()?.id);
      fanoutRosterEventToInbox(ctx.db, group.group_id, id, peerId);
      return id;
    })();
    emitWebStateChanged(ctx, { domains: ["groups", "events", "inbox"], eventId, groupId: group.group_id, peerId });
    return jsonResponse({ ok: true, event: getEvent(ctx.db, eventId) });
  }

  const groupMessages = url.pathname.match(/^\/groups\/([^/]+)\/messages$/);
  if (request.method === "POST" && groupMessages) {
    const group = getGroup(ctx.db, decodeURIComponent(groupMessages[1] ?? ""));
    const body = await readBody(request);
    const senderPeerId = requireString(body, "sender_peer_id");
    const message = requireString(body, "message");
    const inReplyTo = optionalInteger(body, "in_reply_to");
    if (message.length > MAX_MESSAGE_CHARS) {
      throw new HttpError(413, "message_too_large", `Message exceeds ${MAX_MESSAGE_CHARS} characters`);
    }
    ensureActiveMember(ctx.db, group.group_id, senderPeerId);
    const parentEventId = inReplyTo !== undefined ? resolveThreadParent(ctx.db, group.group_id, inReplyTo) : null;
    const directReplyTarget = inReplyTo !== undefined ? getEvent(ctx.db, inReplyTo) : null;
    const { peerIds: rawMentionedPeerIds, warnings } = resolveMentions(ctx.db, group.group_id, message);
    const skillDirectives = optionalStringArray(body, "skill_directives") ?? [];
    const skillDirectivesJson = skillDirectives.length > 0 ? JSON.stringify(skillDirectives) : null;
    // Self-mentions are filtered out: `mentions_json` should reflect peers
    // actually targeted by the mention semantics. Since the sender is always
    // excluded from both push and inbox fanout, advertising a self-mention
    // would mislead observers about who got notified.
    const mentionedPeerIds = rawMentionedPeerIds.filter((peerId) => peerId !== senderPeerId);
    const mentionsJson = mentionedPeerIds.length > 0 ? JSON.stringify(mentionedPeerIds) : null;

    let pushTargets: string[] = [];
    let allRecipients: string[] = [];
    const eventId = ctx.db.transaction(() => {
      ctx.db
        .query(
          "INSERT INTO events (type, sender_peer_id, group_id, body, parent_event_id, reply_to_event_id, mentions_json, skill_directives_json) VALUES ('group_message', ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(senderPeerId, group.group_id, message, parentEventId, directReplyTarget?.event_id ?? null, mentionsJson, skillDirectivesJson);
      const id = Number(ctx.db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()?.id);
      // Durable inbox fanout: every active member except the sender, regardless
      // of mention status — durable visibility is the same as v0; only push
      // is mention/thread-aware.
      allRecipients = ctx.db
        .query<{ peer_id: string }, [number, string]>(
          "SELECT peer_id FROM group_members WHERE group_id = ? AND active = 1 AND peer_id != ?",
        )
        .all(group.group_id, senderPeerId)
        .map((recipient) => recipient.peer_id);
      const insertInbox = ctx.db.query("INSERT OR IGNORE INTO inbox (recipient_peer_id, event_id) VALUES (?, ?)");
      for (const recipient of allRecipients) insertInbox.run(recipient, id);

      // Push fanout. Main channel: mentioned peers only. Thread reply: root
      // author ∪ prior thread posters ∪ this-message mentions, excluding the
      // sender. Intersect with the active roster so a stale alias resolving
      // to a since-left peer doesn't push to someone who can't see the group.
      const mentionedActive = mentionedPeerIds.filter((peerId) => peerId !== senderPeerId && allRecipients.includes(peerId));
      let pushSet: Set<string>;
      if (parentEventId === null) {
        pushSet = new Set(mentionedActive);
      } else {
        const threadPosters = computeThreadParticipants(ctx.db, parentEventId, senderPeerId);
        pushSet = new Set([...threadPosters, ...mentionedActive].filter((peerId) => allRecipients.includes(peerId)));
      }
      pushTargets = [...pushSet];
      return id;
    })();
    const event = getEvent(ctx.db, eventId);
    // Replying in a thread counts as engaging with the parent (and the directly
    // replied-to event), so clear them from the sender's awaiting set.
    if (parentEventId !== null) {
      ackInboxEvents(ctx.db, senderPeerId, [parentEventId, directReplyTarget?.event_id ?? NaN]);
    }
    log(
      `group message stored event_id=${eventId} group=${group.name} sender=${senderPeerId} push=${pushTargets.length} mentions=${mentionedPeerIds.length} thread=${parentEventId ?? "main"} unresolved=${warnings.length}`,
    );
    emitWebStateChanged(ctx, { domains: ["events", "messages", "inbox"], eventId, groupId: group.group_id, peerId: senderPeerId });
    void notifySubscribers(ctx, pushTargets, event);

    // Always return `warnings` (and `delivery`) so consumers can destructure
    // without optional-chaining. Default-undefined fields are a trap for
    // LLM agents that may not write defensive code.
    const delivery = {
      pushed_to: pushTargets,
      inbox_only: allRecipients.filter((peerId) => !pushTargets.includes(peerId)),
    };
    return jsonResponse({ event, posted_to: buildReplyDestination(ctx.db, directReplyTarget, event), warnings, delivery }, { status: 201 });
  }

  const groupHistory = url.pathname.match(/^\/groups\/([^/]+)\/history$/);
  if (request.method === "GET" && groupHistory) {
    const group = getGroup(ctx.db, decodeURIComponent(groupHistory[1] ?? ""));
    const peerId = url.searchParams.get("peer_id");
    if (!peerId) throw new HttpError(400, "invalid_request", "peer_id query parameter is required");
    const member = ensureActiveMember(ctx.db, group.group_id, peerId);
    const cursor = parseCursor(url.searchParams.get("cursor"));
    if (url.searchParams.has("thread_of")) {
      throw new HttpError(400, "invalid_request", "thread_of was removed from group history; use bridge_get_thread(root_event_id: ...)");
    }
    const view = parseGroupHistoryView(url.searchParams.get("view"), url.searchParams.has("event_ids"));
    const selectors = parseSelectorsFromUrl(url);
    const historyFrom = Math.max(member.history_from_event_id ?? 0, cursor + 1);
    if (view === "events") {
      const eventIds = parseEventIdsParam(url.searchParams.get("event_ids"));
      const rows = eventIds.map((eventId) => {
        const event = getVisibleEvent(ctx.db, eventId, peerId);
        if (event.group_id !== group.group_id) {
          throw new HttpError(404, "event_not_found", `Event ${eventId} is not visible in group ${group.name}`);
        }
        if (event.parent_event_id !== null) {
          throw new HttpError(
            400,
            "event_is_thread_reply",
            `Event ${eventId} is a thread reply; use bridge_get_thread(root_event_id: ${event.parent_event_id})`,
          );
        }
        return event;
      });
      return jsonResponse({ view, events: rows, truncated: false });
    }
    if (view === "threads") {
      const threads = listGroupHistoryThreads(ctx.db, group.name, url, selectors);
      return jsonResponse({ view, threads: threads.rows, truncated: threads.truncated });
    }

    // Main-channel view augments each row with reply_count + last_reply_event_id
    // so agents can discover threads without an extra per-event probe.
    // It remains top-level-only: thread replies are read through /threads/:id.
    const mainRows = listGroupHistoryFlat(ctx.db, group.group_id, historyFrom, selectors);
    const items = attachReactions(ctx.db, mainRows.rows);
    return jsonResponse({
      view,
      items,
      events: items,
      next_cursor: items.at(-1)?.event_id ?? cursor,
      truncated: mainRows.truncated,
    });
  }

  return null;
}
