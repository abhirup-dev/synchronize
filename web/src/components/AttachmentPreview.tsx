import type { MessageAttachment } from "../data/types.ts";
import { displayFileSize } from "../utils/attachments.ts";

interface AttachmentPreviewProps {
  attachment: MessageAttachment;
  mode: "draft" | "message";
  onRemove?(): void;
}

export function AttachmentPreview({ attachment, mode, onRemove }: AttachmentPreviewProps) {
  const typeLabel = attachment.extension || (attachment.kind === "image" ? "IMG" : "FILE");
  return (
    <div className={`attachment-preview ${mode === "draft" ? "is-draft" : "is-message"} ${attachment.kind === "image" ? "is-image" : "is-file"}`}>
      {attachment.kind === "image" && attachment.previewUrl ? (
        <img className="attachment-image" src={attachment.previewUrl} alt={attachment.name} />
      ) : (
        <div className="attachment-file-face">
          <span className="attachment-file-type">{typeLabel}</span>
        </div>
      )}
      {onRemove && (
        <button
          type="button"
          className="attachment-remove"
          onClick={onRemove}
          aria-label={`remove ${attachment.name}`}
          title={`remove ${attachment.name}`}
        >
          x
        </button>
      )}
      <div className="attachment-meta">
        <span className="attachment-name" title={attachment.path}>{attachment.name}</span>
        <span className="attachment-detail">{typeLabel} {displayFileSize(attachment.size)}</span>
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
    <div className={`attachment-preview-list ${mode === "draft" ? "is-draft" : "is-message"}`} aria-label={`${mode} attachments`}>
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
