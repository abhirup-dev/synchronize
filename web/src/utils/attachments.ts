import type { MessageAttachment, MessageAttachmentKind } from "../data/types.ts";

export function attachmentKindFor(mimeType: string, name: string): MessageAttachmentKind {
  if (mimeType.startsWith("image/")) return "image";
  const extension = extensionFor(name, mimeType);
  return ["jpg", "jpeg", "png", "gif", "webp", "avif", "svg"].includes(extension.toLowerCase()) ? "image" : "file";
}

export function extensionFor(name: string, mimeType: string): string {
  const dot = name.lastIndexOf(".");
  if (dot >= 0 && dot < name.length - 1) return name.slice(dot + 1).toUpperCase();
  const subtype = mimeType.split("/")[1]?.split(";")[0]?.trim();
  if (subtype) return subtype.replace(/[^a-zA-Z0-9]+/g, "-").toUpperCase();
  return "FILE";
}

export function displayFileSize(size: number): string {
  if (!Number.isFinite(size) || size < 0) return "";
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  for (const unit of units) {
    if (value < 1024) return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
    value /= 1024;
  }
  return `${value.toFixed(1)} TB`;
}

export function attachmentPathLines(attachments: MessageAttachment[] | undefined): string[] {
  return (attachments ?? []).map((attachment) => attachment.path).filter(Boolean);
}

export function outgoingBodyWithAttachmentPaths(body: string, attachments: MessageAttachment[] | undefined): string {
  const trimmed = body.trim();
  const paths = attachmentPathLines(attachments);
  if (paths.length === 0) return trimmed;
  return trimmed ? `${trimmed}\n\n${paths.join("\n")}` : paths.join("\n");
}

export function nativeFilePath(file: File): string | null {
  const value = (file as File & { path?: unknown }).path;
  if (typeof value !== "string" || !value.startsWith("/")) return null;
  return value;
}

export function makeExternalAttachment(file: File, path: string, previewUrl?: string): MessageAttachment {
  return {
    id: crypto.randomUUID(),
    kind: attachmentKindFor(file.type, file.name),
    source: "external",
    name: file.name || path.split("/").at(-1) || "attachment",
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    extension: extensionFor(file.name || path, file.type),
    path,
    ...(previewUrl ? { previewUrl } : {}),
  };
}
