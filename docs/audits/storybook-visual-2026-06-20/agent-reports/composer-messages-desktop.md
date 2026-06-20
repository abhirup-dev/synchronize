# Composer + Messages Desktop Storybook Visual Audit

Date: 2026-06-20
Scope: brutal-theme desktop pass only, `1280x720`.

Capture method: isolated headless Playwright against `http://localhost:6006/iframe.html?id=<story-id>&viewMode=story`. Static stories were captured with a local headless Chromium script after `networkidle` plus a settle wait. Interaction-only context menu variants were checked in isolated headless pages with right-click actions. The Codex in-app browser was not used.

Deferred for interaction: none. All assigned interaction/play stories were checked with isolated Playwright. No glass, compact, medium, mobile, or responsive-only stories from the assigned bucket were audited.

## Confirmed Issues

### `messages-messagerow--rich-with-reactions`

Severity: 3
Likely cause: component render/state or Storybook args wiring.

Screenshot: [composer-messages-desktop--messages-messagerow--rich-with-reactions.png](../screenshots/composer-messages-desktop--messages-messagerow--rich-with-reactions.png)

Expected from source: `MessageRow.stories.tsx` says `m2` carries markdown, a fenced SQL block, reactions, and a thread reply count. The seed fixture confirms `m2` has a rocket reaction and `threadReplyCount: 2`.

Observed: the rendered stable desktop state shows the markdown/code message only. There is no reaction footer, no reaction button, and no thread reply badge. DOM probing found no `.reactions` or `.thread-badge` nodes for this story.

Uncertainty: this may be story wiring rather than `MessageRow` itself. `MessageRow` only renders the thread badge when `onOpenThread` is supplied, and the story does not pass one; however, the story comment advertises the busy reactions/thread state.

### `surfaces-contextmenu--message-actions`

Severity: 2
Likely cause: story play/harness wiring.

Screenshot: [composer-messages-desktop--surfaces-contextmenu--message-actions.png](../screenshots/composer-messages-desktop--surfaces-contextmenu--message-actions.png)

Expected from source: the play function right-clicks the `Right-click me` target and leaves a typical message action menu open for inspection.

Observed: the final post-play state opens the menu at the viewport origin (`x=0`, `y=0`) instead of beside the right-click target. The popup partially covers the target from the top-left corner, making the story look like a positioning failure even though the menu items themselves are readable.

Uncertainty: isolated manual right-clicks against `surfaces-contextmenu--with-disabled-item` and `surfaces-contextmenu--single-action` anchored correctly beside their targets, so this appears specific to the `MessageActions` play interaction rather than the base context menu component.

## Passed Stories

- `composer-attachmentpreview--draft-image`
- `composer-attachmentpreview--draft-file`
- `composer-attachmentpreview--image-without-preview`
- `composer-attachmentpreview--message-image`
- `composer-attachmentpreview--long-filename`
- `composer-attachmentpreview--list`
- `composer-attachmentpreview--list-empty`
- `composer-composer--default`
- `composer-composer--thread-reply`
- `composer-composer--collapsed`
- `composer-composer--with-thread-summary`
- `composer-composer--direct-message`
- `composer-composer--type-and-send`
- `surfaces-contextmenu--with-disabled-item`
- `surfaces-contextmenu--single-action`
- `messages-markdown--from-seed`
- `messages-markdown--tables-and-mentions`
- `messages-markdown--type-script-code`
- `messages-markdown--rich-formatting`
- `messages-markdown--empty`
- `messages-messagerow--plain`
- `messages-messagerow--grouped-with-prev`
- `messages-messagerow--self-message`
- `messages-messagerow--react-with-picker`
- `messages-pollwidget--open`
- `messages-pollwidget--voted`
- `messages-pollwidget--closed-results`
- `messages-pollwidget--empty-no-deadline`
