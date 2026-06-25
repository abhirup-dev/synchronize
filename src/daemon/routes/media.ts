import { copyFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";

import { ensureDir } from "../../fs.ts";
import { HttpError, jsonResponse } from "../../http.ts";
import { ensureActiveMember, getGroup } from "../repo/groups.ts";
import {
  appendMediaIndex,
  getMedia,
  guessContentType,
  hashFile,
  writeMediaReadme,
  type MediaRow,
} from "../repo/media.ts";
import { getEvent } from "../repo/events.ts";
import { notifySubscribers } from "../services/subscriptions.ts";
import { emitWebStateChanged } from "../services/web-events.ts";
import {
  log,
  type DaemonContext,
} from "../server.ts";
import { optionalString, parseLimit, readBody, requireString } from "../validation.ts";

export async function tryHandleMediaRoute(request: Request, ctx: DaemonContext, url: URL): Promise<Response | null> {
  const groupMedia = url.pathname.match(/^\/groups\/([^/]+)\/media$/);
  if (request.method === "POST" && groupMedia) {
    const group = getGroup(ctx.db, decodeURIComponent(groupMedia[1] ?? ""));
    const body = await readBody(request);
    const sharedByPeerId = requireString(body, "shared_by_peer_id");
    const originalPath = requireString(body, "path");
    const description = optionalString(body, "description");
    ensureActiveMember(ctx.db, group.group_id, sharedByPeerId);

    const info = await stat(originalPath).catch(() => {
      throw new HttpError(400, "media_not_found", `File does not exist: ${originalPath}`);
    });
    if (!info.isFile()) throw new HttpError(400, "media_not_file", `Path is not a file: ${originalPath}`);

    await ensureDir(group.media_dir);
    const mediaId = crypto.randomUUID();
    const safeBase = basename(originalPath).replace(/[^a-zA-Z0-9._-]/g, "_");
    const copiedPath = join(group.media_dir, `${new Date().toISOString().replace(/[:.]/g, "-")}_${sharedByPeerId}_${safeBase}`);
    await copyFile(originalPath, copiedPath);
    const sha256 = await hashFile(copiedPath);
    const contentType = guessContentType(originalPath);

    let recipients: string[] = [];
    const eventId = ctx.db.transaction(() => {
      ctx.db
        .query(
          `INSERT INTO media_items
             (media_id, group_id, original_path, copied_path, size_bytes, sha256, content_type, description, shared_by_peer_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(mediaId, group.group_id, originalPath, copiedPath, info.size, sha256, contentType, description ?? null, sharedByPeerId);
      ctx.db
        .query("INSERT INTO events (type, sender_peer_id, group_id, body, media_id) VALUES ('media_shared', ?, ?, ?, ?)")
        .run(sharedByPeerId, group.group_id, description ?? "", mediaId);
      const id = Number(ctx.db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()?.id);
      recipients = ctx.db
        .query<{ peer_id: string }, [number, string]>(
          "SELECT peer_id FROM group_members WHERE group_id = ? AND active = 1 AND peer_id != ?",
        )
        .all(group.group_id, sharedByPeerId)
        .map((recipient) => recipient.peer_id);
      const insertInbox = ctx.db.query("INSERT OR IGNORE INTO inbox (recipient_peer_id, event_id) VALUES (?, ?)");
      for (const recipient of recipients) insertInbox.run(recipient, id);
      return id;
    })();

    const media = getMedia(ctx.db, mediaId);
    await appendMediaIndex(group, media);
    await writeMediaReadme(group, ctx.db);
    const event = getEvent(ctx.db, eventId);
    log(`media shared event_id=${eventId} group=${group.name} media_id=${mediaId} sender=${sharedByPeerId} recipients=${recipients.length}`);
    emitWebStateChanged(ctx, { domains: ["events", "media", "inbox"], eventId, groupId: group.group_id, peerId: sharedByPeerId });
    void notifySubscribers(ctx, recipients, event);
    return jsonResponse({ media, event }, { status: 201 });
  }

  if (request.method === "GET" && groupMedia) {
    const group = getGroup(ctx.db, decodeURIComponent(groupMedia[1] ?? ""));
    const query = url.searchParams.get("query")?.trim();
    const limit = parseLimit(url.searchParams.get("limit"));
    const rows = query
      ? ctx.db
          .query<MediaRow, [number, string, string, string, number]>(
            `SELECT * FROM media_items
             WHERE group_id = ? AND (media_id LIKE ? OR original_path LIKE ? OR description LIKE ?)
             ORDER BY created_at DESC
             LIMIT ?`,
          )
          .all(group.group_id, `%${query}%`, `%${query}%`, `%${query}%`, limit)
      : ctx.db
          .query<MediaRow, [number, number]>(
            `SELECT * FROM media_items
             WHERE group_id = ?
             ORDER BY created_at DESC
             LIMIT ?`,
          )
          .all(group.group_id, limit);
    return jsonResponse({ media: rows });
  }

  const mediaGet = url.pathname.match(/^\/media\/([^/]+)$/);
  if (request.method === "GET" && mediaGet) {
    return jsonResponse({ media: getMedia(ctx.db, decodeURIComponent(mediaGet[1] ?? "")) });
  }

  return null;
}
