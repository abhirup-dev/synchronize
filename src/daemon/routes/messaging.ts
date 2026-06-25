import { MAX_MESSAGE_CHARS } from "../../constants.ts";
import { HttpError, jsonResponse } from "../../http.ts";
import { getEvent, getVisibleEvent } from "../repo/events.ts";
import { ensureActiveMember, getGroupById } from "../repo/groups.ts";
import { ensurePeer } from "../repo/peers.ts";
import { ensureSenderNotArchived } from "../services/archive.ts";
import { notifySubscribers } from "../services/subscriptions.ts";
import { emitWebStateChanged } from "../services/web-events.ts";
import {
  buildReplyDestination,
  computeThreadParticipants,
  log,
  resolveMentions,
  type DaemonContext,
} from "../server.ts";
import { readBody, requirePositiveInteger, requireString } from "../validation.ts";

export async function tryHandleMessagingRoute(request: Request, ctx: DaemonContext, url: URL): Promise<Response | null> {
  if (request.method === "POST" && url.pathname === "/dm") {
    const body = await readBody(request);
    const senderPeerId = requireString(body, "sender_peer_id");
    const recipientPeerId = requireString(body, "recipient_peer_id");
    const message = requireString(body, "message");
    if (message.length > MAX_MESSAGE_CHARS) {
      throw new HttpError(413, "message_too_large", `Message exceeds ${MAX_MESSAGE_CHARS} characters`);
    }
    ensurePeer(ctx.db, senderPeerId);
    ensureSenderNotArchived(ctx.db, senderPeerId);
    ensurePeer(ctx.db, recipientPeerId);

    const eventId = ctx.db.transaction(() => {
      ctx.db
        .query(
          `INSERT INTO events (type, sender_peer_id, recipient_peer_id, body)
           VALUES ('dm', ?, ?, ?)`,
        )
        .run(senderPeerId, recipientPeerId, message);
      const id = Number(ctx.db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()?.id);
      ctx.db
        .query("INSERT INTO inbox (recipient_peer_id, event_id) VALUES (?, ?)")
        .run(recipientPeerId, id);
      return id;
    })();
    const event = getEvent(ctx.db, eventId);
    log(`dm stored event_id=${eventId} sender=${senderPeerId} recipient=${recipientPeerId} body_chars=${message.length}`);
    emitWebStateChanged(ctx, { domains: ["events", "messages", "inbox"], eventId, peerId: recipientPeerId });
    void notifySubscribers(ctx, [recipientPeerId], event);

    return jsonResponse({ event }, { status: 201 });
  }

  if (request.method === "POST" && url.pathname === "/reply") {
    const body = await readBody(request);
    const senderPeerId = requireString(body, "sender_peer_id");
    const inReplyTo = requirePositiveInteger(body, "in_reply_to");
    const message = requireString(body, "message");
    if (message.length > MAX_MESSAGE_CHARS) {
      throw new HttpError(413, "message_too_large", `Message exceeds ${MAX_MESSAGE_CHARS} characters`);
    }

    const target = getVisibleEvent(ctx.db, inReplyTo, senderPeerId);
    if (target.type !== "group_message" && target.type !== "dm") {
      throw new HttpError(
        400,
        "reply_target_not_message",
        `Cannot reply to event ${inReplyTo}: type is '${target.type}', not 'group_message' or 'dm'`,
      );
    }

    ensureSenderNotArchived(ctx.db, senderPeerId);

    if (target.type === "dm") {
      const recipientPeerId = target.sender_peer_id === senderPeerId ? target.recipient_peer_id : target.sender_peer_id;
      if (!recipientPeerId) {
        throw new HttpError(400, "reply_target_not_message", `Cannot reply to event ${inReplyTo}: missing DM peer`);
      }
      ensurePeer(ctx.db, senderPeerId);
      ensurePeer(ctx.db, recipientPeerId);

      const eventId = ctx.db.transaction(() => {
        ctx.db
          .query(
            `INSERT INTO events (type, sender_peer_id, recipient_peer_id, body, reply_to_event_id)
             VALUES ('dm', ?, ?, ?, ?)`,
          )
          .run(senderPeerId, recipientPeerId, message, target.event_id);
        const id = Number(ctx.db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()?.id);
        ctx.db
          .query("INSERT INTO inbox (recipient_peer_id, event_id) VALUES (?, ?)")
          .run(recipientPeerId, id);
        return id;
      })();
      const event = getEvent(ctx.db, eventId);
      const postedTo = buildReplyDestination(ctx.db, target, event);
      log(`reply dm stored event_id=${eventId} target=${inReplyTo} sender=${senderPeerId} recipient=${recipientPeerId} body_chars=${message.length}`);
      emitWebStateChanged(ctx, { domains: ["events", "messages", "inbox"], eventId, peerId: recipientPeerId });
      void notifySubscribers(ctx, [recipientPeerId], event);

      return jsonResponse({ event, posted_to: postedTo }, { status: 201 });
    }

    if (target.group_id === null) {
      throw new HttpError(400, "reply_target_not_message", `Cannot reply to event ${inReplyTo}: missing group`);
    }
    const group = getGroupById(ctx.db, target.group_id);
    ensureActiveMember(ctx.db, group.group_id, senderPeerId);
    // Thread root: if the target is already a thread reply, inherit its root;
    // if the target is a top-level message, the target itself becomes the root.
    // Must match resolveThreadParent so bridge_reply and bridge_send_group(in_reply_to)
    // thread identically (a top-level reply target was previously left parentless).
    const parentEventId = target.parent_event_id ?? target.event_id;
    const { peerIds: rawMentionedPeerIds, warnings } = resolveMentions(ctx.db, group.group_id, message);
    const mentionedPeerIds = rawMentionedPeerIds.filter((peerId) => peerId !== senderPeerId);
    const mentionsJson = mentionedPeerIds.length > 0 ? JSON.stringify(mentionedPeerIds) : null;

    let pushTargets: string[] = [];
    let allRecipients: string[] = [];
    const eventId = ctx.db.transaction(() => {
      ctx.db
        .query(
          "INSERT INTO events (type, sender_peer_id, group_id, body, parent_event_id, reply_to_event_id, mentions_json) VALUES ('group_message', ?, ?, ?, ?, ?, ?)",
        )
        .run(senderPeerId, group.group_id, message, parentEventId, target.event_id, mentionsJson);
      const id = Number(ctx.db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()?.id);
      allRecipients = ctx.db
        .query<{ peer_id: string }, [number, string]>(
          "SELECT peer_id FROM group_members WHERE group_id = ? AND active = 1 AND peer_id != ?",
        )
        .all(group.group_id, senderPeerId)
        .map((recipient) => recipient.peer_id);
      const insertInbox = ctx.db.query("INSERT OR IGNORE INTO inbox (recipient_peer_id, event_id) VALUES (?, ?)");
      for (const recipient of allRecipients) insertInbox.run(recipient, id);

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
    const postedTo = buildReplyDestination(ctx.db, target, event);
    log(
      `reply group stored event_id=${eventId} target=${inReplyTo} group=${group.name} sender=${senderPeerId} push=${pushTargets.length} mentions=${mentionedPeerIds.length} surface=${postedTo.surface} unresolved=${warnings.length}`,
    );
    emitWebStateChanged(ctx, { domains: ["events", "messages", "inbox"], eventId, groupId: group.group_id, peerId: senderPeerId });
    void notifySubscribers(ctx, pushTargets, event);

    const delivery = {
      pushed_to: pushTargets,
      inbox_only: allRecipients.filter((peerId) => !pushTargets.includes(peerId)),
    };
    return jsonResponse({ event, posted_to: postedTo, warnings, delivery }, { status: 201 });
  }

  return null;
}
