import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { appendFile, writeFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";

import { ensureDir } from "../../fs.ts";
import { HttpError } from "../../http.ts";
import type { RuntimePaths } from "../../paths.ts";
import type { GroupRow } from "./groups.ts";

export interface MediaRow {
  media_id: string;
  group_id: number;
  original_path: string;
  copied_path: string;
  size_bytes: number;
  sha256: string;
  content_type: string;
  description: string | null;
  shared_by_peer_id: string;
  created_at: string;
}

export function getMedia(db: Database, mediaId: string): MediaRow {
  const media = db.query<MediaRow, [string]>("SELECT * FROM media_items WHERE media_id = ?").get(mediaId);
  if (!media) throw new HttpError(404, "media_not_found", `Media not found: ${mediaId}`);
  return media;
}

export async function hashFile(path: string): Promise<string> {
  const hasher = createHash("sha256");
  const bytes = await Bun.file(path).arrayBuffer();
  hasher.update(Buffer.from(bytes));
  return hasher.digest("hex");
}

export function guessContentType(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === ".json") return "application/json";
  if (ext === ".md" || ext === ".txt") return "text/plain";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".pdf") return "application/pdf";
  return "application/octet-stream";
}

export function webAttachmentRoot(paths: RuntimePaths): string {
  return join(paths.home, "tmp", "web-attachments");
}

export function safePathSegment(value: string, fallback: string): string {
  const safe = basename(value).replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^_+|_+$/g, "");
  return safe || fallback;
}

export function attachmentExtension(name: string, mimeType: string): string {
  const ext = extname(name).replace(/^\./, "");
  if (ext) return ext.toUpperCase();
  const subtype = mimeType.split("/")[1]?.split(";")[0]?.trim();
  return subtype ? subtype.replace(/[^a-zA-Z0-9]+/g, "-").toUpperCase() : "FILE";
}

export function resolveStagedAttachmentPath(paths: RuntimePaths, inputPath: string): string {
  const root = resolve(webAttachmentRoot(paths));
  const candidate = resolve(inputPath);
  const rel = relative(root, candidate);
  if (rel === "" || rel.startsWith("..") || rel.startsWith("/")) {
    throw new HttpError(400, "invalid_attachment_path", "path is not a staged web attachment");
  }
  return candidate;
}

export async function appendMediaIndex(group: GroupRow, media: MediaRow): Promise<void> {
  await ensureDir(group.media_dir);
  await appendFile(join(group.media_dir, "index.jsonl"), `${JSON.stringify(media)}\n`, "utf8");
}

export async function writeMediaReadme(group: GroupRow, db: Database): Promise<void> {
  const rows = db
    .query<MediaRow, [number]>("SELECT * FROM media_items WHERE group_id = ? ORDER BY created_at DESC LIMIT 50")
    .all(group.group_id);
  const body = [
    `# MediaStore: ${group.name}`,
    "",
    ...rows.map((row) => `- ${row.created_at} ${row.media_id} ${basename(row.copied_path)} ${row.description ?? ""}`.trim()),
    "",
  ].join("\n");
  await writeFile(join(group.media_dir, "README.md"), body, "utf8");
}
