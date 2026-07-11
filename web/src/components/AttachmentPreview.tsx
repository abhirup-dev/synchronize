import type { MessageAttachment } from "../data/types.ts";
import { displayFileSize } from "../utils/attachments.ts";
import { cn } from "../lib/cn.ts";

interface AttachmentPreviewProps {
  attachment: MessageAttachment;
  mode: "draft" | "message";
  onRemove?(): void;
}

export function AttachmentPreview({ attachment, mode, onRemove }: AttachmentPreviewProps) {
  const typeLabel = attachment.extension || (attachment.kind === "image" ? "IMG" : "FILE");
  const isMessage = mode === "message";
  const isFile = attachment.kind !== "image";
  return (
    <div
      className={cn(
        "relative grid grid-rows-[minmax(0,1fr)_auto] w-[148px] min-w-0 overflow-hidden bg-paper-2 [border:var(--line-2)] rounded-md shadow-sm",
        !isMessage && (isFile ? "h-[118px]" : "h-[132px]"),
        isMessage && "w-[min(280px,100%)] bg-paper",
        isMessage && (isFile ? "h-[128px]" : "h-[196px]"),
      )}
    >
      {attachment.kind === "image" && attachment.previewUrl ? (
        <img
          className={cn(
            "w-full h-full min-h-0 object-cover bg-paper-3",
            isMessage && "object-contain p-1",
          )}
          src={attachment.previewUrl}
          alt={attachment.name}
        />
      ) : (
        <div className="grid place-items-center min-h-[68px] [background:repeating-linear-gradient(45deg,color-mix(in_srgb,var(--paper-3)_86%,white_14%)_0_12px,color-mix(in_srgb,var(--yellow)_28%,transparent_72%)_12px_24px)]">
          <span className="max-w-[calc(100%-18px)] overflow-hidden text-ellipsis text-ink font-mono text-[length:var(--text-18)] font-[950] leading-none">
            {typeLabel}
          </span>
        </div>
      )}
      {onRemove && (
        <button
          type="button"
          className="absolute top-1.5 right-1.5 z-[1] grid place-items-center w-6 h-6 p-0 bg-pink text-ink [border:var(--line-sm)] rounded-sm shadow-xs font-mono text-[length:var(--text-13)] font-[950] leading-none hover:translate-x-[-1px] hover:translate-y-[-1px] hover:[box-shadow:var(--shadow-hover-sm)]"
          onClick={onRemove}
          aria-label={`remove ${attachment.name}`}
          title={`remove ${attachment.name}`}
        >
          x
        </button>
      )}
      <div className="min-w-0 px-2 py-1.5 [border-top:var(--line-sm)] bg-paper">
        <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-ink font-mono text-[length:var(--text-11)] font-extrabold" title={attachment.path}>
          {attachment.name}
        </span>
        <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap mt-0.5 text-ink-soft text-[length:var(--text-10)]">
          {typeLabel} {displayFileSize(attachment.size)}
        </span>
      </div>
    </div>
  );
}

export function AttachmentPreviewList({
  attachments,
  mode,
  onRemove,
}: {
  attachments: MessageAttachment[];
  mode: "draft" | "message";
  onRemove?(attachment: MessageAttachment): void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div
      className={cn(
        "flex flex-wrap gap-2 min-w-0",
        mode === "draft" ? "px-2.5 pt-2" : "mt-2.5",
      )}
      aria-label={`${mode} attachments`}
    >
      {attachments.map((attachment) => (
        <AttachmentPreview
          key={attachment.id}
          attachment={attachment}
          mode={mode}
          {...(onRemove ? { onRemove: () => onRemove(attachment) } : {})}
        />
      ))}
    </div>
  );
}
