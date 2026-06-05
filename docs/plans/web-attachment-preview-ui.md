# Web Attachment Preview UI Plan

## Scope

Build the visual and interaction layer for attachments in the web chat UI:
users can paste images or choose files from the composer, see a draft preview,
send the message, and see image/file preview cards in the message stream.

This is still not the full attachment/media backend: it does not add durable
attachment transport, SQLite attachment rows, MCP attachment schemas, or media
store versioning. It does need one small local-path bridge so agents receive a
real file path: clipboard/paste attachments are copied into a simple runtime
staging folder, while picker-selected files use their original filesystem path
when the host can expose it.

The implementation work is tracked by Beads:

- `sync-q181` - Define web attachment preview contract
  - `sync-q181.1` - Add attachment metadata contract and helpers
  - `sync-q181.2` - Define runtime attachment staging and cleanup
- `sync-ntiv` - Build composer attachment intake UI
  - `sync-ntiv.1` - Wire composer file picker and paste intake
  - `sync-ntiv.2` - Render composer draft attachment previews
- `sync-ldo7` - Render and validate sent attachment previews
  - `sync-ldo7.1` - Render message attachment preview cards
  - `sync-ldo7.2` - Preserve attachment previews through send adapters
  - `sync-ldo7.3` - Validate attachment preview UI workflow

## Product Behavior

### Compose intake

- Enable the existing composer attach button and connect it to a hidden
  `<input type="file" multiple>`.
- Add `paste` handling on the composer textarea for clipboard file items.
- Treat images as visual previews and non-images as file preview cards.
- Support multiple draft attachments in one message.
- Let users remove a draft attachment before sending.
- Removing a draft attachment uses a cross button rendered on top of the
  attachment preview tile/card.
- If the removed draft attachment is a staged clipboard/paste file, delete the
  staged file from disk immediately.
- If the removed draft attachment references an existing picker-selected file,
  only remove it from the draft; never delete the user's original file.
- Allow sending when either trimmed text or at least one attachment exists.
- Clear draft attachments after a successful send.

### Draft preview

Draft attachments render inside the composer above the textarea:

- Image previews use object URLs created from the selected/pasted `File`.
- File previews use a compact card with the file extension/type as the dominant
  label, plus a filename/size row.
- Preview tiles use stable dimensions so the composer does not jump around when
  images load.
- The remove affordance is visually overlaid in the preview's top-right corner
  so it is attached to the specific image/file card being removed.
- Object URLs are revoked when an attachment is removed, sent, or the composer
  unmounts.

### Runtime staging and source paths

Attachment paths have two source modes:

- `external`: a picker-selected file whose original filesystem path is known.
  The message relays the original path and the UI must not copy or delete it.
- `staged`: a pasted/clipboard file, or a picker-selected file whose original
  path is not available to the web UI. The file is copied into the active
  synchronize runtime and the message relays that staged path.

The staging folder is deliberately simple:

```text
${SYNCHRONIZE_HOME}/tmp/web-attachments/<draft-id>/<safe-file-name>
```

The folder lives under the active synchronize runtime so manual tests and
worktrees remain isolated when they use different `SYNCHRONIZE_HOME` values.
Draft removal deletes only `staged` files created by this feature. Successful
send keeps the staged file in place because that path has been handed to the
agent.

Important browser constraint: the standard Web File API does not expose the
absolute path of a file selected from Finder, even though the picker UI is the
native macOS file picker. Original-path relay therefore requires a native host
bridge, such as a desktop shell/Tauri file dialog. In a pure browser/web build,
picker files must be treated as `staged` because the browser only exposes the
file name and bytes.

### Sent message preview

Sent messages render attachments below the markdown body:

- Image attachments render as bounded previews inside the message bubble.
- File attachments render as type-labeled cards, e.g. `PDF`, `DOCX`, `TXT`.
- Empty-body attachment messages still render cleanly instead of showing a blank
  markdown block.
- Locally sent daemon messages keep attachment metadata in the current browser
  session so the delivered optimistic replacement still shows previews. A later
  room refresh or browser reload may degrade to text paths until backend
  attachment transport exists.

## Data Model

Add a UI-level attachment contract in `web/src/data/types.ts`:

```ts
export type MessageAttachmentKind = "image" | "file";

export interface MessageAttachment {
  id: string;
  kind: MessageAttachmentKind;
  source: "external" | "staged";
  name: string;
  mimeType: string;
  size: number;
  extension: string;
  path: string;
  previewUrl?: string;
}
```

Extend:

- `Message.attachments?: MessageAttachment[]`
- `SendMessageInput.attachments?: MessageAttachment[]`

`path` is the exact path sent to agents. For `external` attachments it is the
original selected path when the native host exposes one. For `staged`
attachments it is the copied runtime path under
`${SYNCHRONIZE_HOME}/tmp/web-attachments/`.

## Current Code Touchpoints

- `web/src/components/Composer.tsx`
  - owns text state, skill picker, mention picker, attach button, send button.
  - should own draft attachment state and paste/file input handlers.
- `web/src/components/MessageRow.tsx`
  - owns bubble rendering and should render `message.attachments`.
- `web/src/data/types.ts`
  - owns the single component-facing contract.
- `web/src/data/mock.ts`
  - should echo attachments on mock messages and ack replacements.
- `web/src/data/daemon.ts`
  - should attach draft metadata to optimistic messages and preserve it on the
    delivered replacement in the current browser session.
  - may call a minimal local staging/cleanup bridge for pasted files, but should
    not add durable attachment transport or media-store APIs.
- runtime staging bridge
  - should copy clipboard/paste files into
    `${SYNCHRONIZE_HOME}/tmp/web-attachments/`.
  - should remove staged draft files when the user clicks the overlay cross
    before send.
  - should return native picker paths only when the host can expose real paths;
    otherwise picker files fall back to staged copies.
- `web/src/components/extra.css`
  - owns the active composer and message row styling.

## Daemon Adapter Behavior

Until backend transport exists, daemon sending should keep the existing message
endpoint contract:

- Send the user's text body when text exists.
- When attachments exist, append one local path line per attachment to the
  message body sent over the bus so agents receive the path-shaped handoff text.
- If the user sends only attachments, send the attachment path lines as the
  daemon message body.
- The path lines use original external paths for native-host picker selections
  and staged runtime paths for clipboard/paste files.
- In the web UI, locally preserved attachment metadata lets the current browser
  render preview cards instead of relying on the daemon response to carry bytes
  or attachment JSON.

This behavior is a bridge, not a storage contract. It should be small and easy
to remove once real backend attachment persistence lands.

## Visual Design

The previews should match the existing neo-brutalist chat language:

- hard black borders, small radius, slight offset shadow;
- restrained color use with high-contrast file-type labels;
- no floating nested cards;
- image tiles use `object-fit: cover` for draft chips and `contain`/bounded
  sizing for sent previews so screenshots remain inspectable;
- compact controls use symbols: paperclip for attach, `x` for remove.
- remove controls sit on top of the attachment card/image, not beside the
  entire composer, so the delete target is unambiguous.

## Accessibility

- The attach button has a real `aria-label` and remains keyboard focusable.
- The hidden file input is triggered by the button but is not focus-trapping.
- Remove buttons include attachment names in labels.
- Image previews use the filename as `alt`.
- File cards expose filename, type, and size as text.

## Verification

Required checks for implementation:

- `bun run typecheck`
- `cd web && bun run typecheck`
- `cd web && bun run build`
- Manual browser verification against the web UI:
  - paste an image into the composer and see a draft image preview;
  - use the attach button to pick an image and see an image preview;
  - use the attach button to pick a non-image file and see a type card;
  - remove a staged draft attachment and verify its runtime file is deleted;
  - remove an external picker attachment and verify the original file is not
    deleted;
  - send text plus attachment and verify the sent bubble shows preview;
  - send attachment-only and verify the sent bubble shows preview;
  - verify the daemon receives path-shaped message text in the current bridge
    implementation.

Use a throwaway `SYNCHRONIZE_HOME=/tmp/...` for any daemon-backed manual test.

## Non-Goals

- No daemon file upload endpoint.
- No SQLite attachment schema.
- No MCP tool schema changes.
- No durable reload persistence for preview metadata.
- No deletion of original picker-selected files.
- No drag-and-drop support unless it falls out naturally from the same helper.
- No PDF rendering or document thumbnail generation.

## Implementation Slices

1. Add typed attachment metadata and small browser utilities.
2. Add runtime staging and cleanup for pasted/clipboard files, with original
   path support only when the native host exposes it.
3. Add composer file picker, paste handling, draft preview rendering, and
   cleanup.
4. Add sent-message attachment rendering and styles.
5. Wire mock and daemon adapters to preserve attachment metadata in the current
   browser session while sending path-shaped text over existing endpoints.
6. Validate with typechecks, web build, and browser/manual coverage.
