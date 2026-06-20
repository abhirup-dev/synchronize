import type { Meta, StoryObj } from "@storybook/react-vite";
import { AttachmentPreview, AttachmentPreviewList } from "./AttachmentPreview.tsx";
import type { MessageAttachment } from "../data/types.ts";

// A tiny inline 1x1-ish PNG so the image kind renders a real <img> with no network.
const SAMPLE_IMAGE =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120">
       <rect width="160" height="120" fill="#4D7CFE"/>
       <circle cx="80" cy="60" r="36" fill="#FFD43B"/>
     </svg>`,
  );

const imageAttachment: MessageAttachment = {
  id: "att-image",
  kind: "image",
  source: "external",
  name: "checkout-mock.png",
  mimeType: "image/png",
  size: 184_320,
  extension: "PNG",
  path: "/Users/atlas/screens/checkout-mock.png",
  previewUrl: SAMPLE_IMAGE,
};

// Image attachment that failed to produce a thumbnail — falls back to the type tile.
const imageNoPreview: MessageAttachment = {
  id: "att-image-bare",
  kind: "image",
  source: "staged",
  name: "diagram.heic",
  mimeType: "image/heic",
  size: 2_201_600,
  extension: "HEIC",
  path: "/tmp/diagram.heic",
};

const fileAttachment: MessageAttachment = {
  id: "att-file",
  kind: "file",
  source: "external",
  name: "migration-plan.pdf",
  mimeType: "application/pdf",
  size: 998_400,
  extension: "PDF",
  path: "/Users/atlas/docs/migration-plan.pdf",
};

const longNameFile: MessageAttachment = {
  id: "att-long",
  kind: "file",
  source: "external",
  name: "2026-q2-checkout-revamp-instrumentation-handoff-notes.md",
  mimeType: "text/markdown",
  size: 41_300,
  extension: "MD",
  path: "/Users/atlas/notes/2026-q2-checkout-revamp-instrumentation-handoff-notes.md",
};

const meta = {
  title: "Composer/AttachmentPreview",
  component: AttachmentPreview,
} satisfies Meta<typeof AttachmentPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

// Single image tile in draft mode, with the remove affordance.
export const DraftImage: Story = {
  args: { attachment: imageAttachment, mode: "draft", onRemove: () => {} },
};

// Single file tile (no thumbnail) — shows the hatched type placeholder.
export const DraftFile: Story = {
  args: { attachment: fileAttachment, mode: "draft", onRemove: () => {} },
};

// Image kind with no previewUrl — falls back to the extension tile like a file.
export const ImageWithoutPreview: Story = {
  args: { attachment: imageNoPreview, mode: "draft", onRemove: () => {} },
};

// Message mode: larger, no remove button (already sent).
export const MessageImage: Story = {
  args: { attachment: imageAttachment, mode: "message" },
};

// Long filename truncates with ellipsis in the footer.
export const LongFilename: Story = {
  args: { attachment: longNameFile, mode: "draft", onRemove: () => {} },
};

// A populated draft tray: mixed image + file attachments wrapping in a row.
export const List: StoryObj = {
  render: () => (
    <AttachmentPreviewList
      attachments={[imageAttachment, fileAttachment, imageNoPreview, longNameFile]}
      mode="draft"
      onRemove={() => {}}
    />
  ),
};

// AttachmentPreviewList renders nothing when there are no attachments.
export const ListEmpty: StoryObj = {
  render: () => <AttachmentPreviewList attachments={[]} mode="draft" />,
};
