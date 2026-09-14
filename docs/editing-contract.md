# Editing and undo

VoiceInput inserts speech into native text fields while preserving the user's
selection and edits. Applications can expose the same field-local undo command:

```tsx
<button type="button" onClick={() => voice.undo()}>
  Undo
</button>
```

## What to expect

| Action                           | Result                                                    |
| -------------------------------- | --------------------------------------------------------- |
| Place the cursor and speak       | Text is inserted at that position                         |
| Select text and speak            | Dictation replaces the selection                          |
| Edit a phrase while it appears   | The correction stays; later revisions cannot overwrite it |
| Move the cursor during dictation | The next phrase is inserted at the new position           |
| Undo                             | The last typing group or dictated phrase is reverted      |
| Reset the form                   | Recording stops and voice history is cleared              |

If a prefilled field has never received focus and still exposes the browser's
initial `0, 0` selection, the first dictated phrase is appended. After focus,
VoiceInput honors the actual selection, including a caret at the start.

## Phrases and manual edits

A phrase is one provider-finalized segment. Editing or moving the caret while
provisional text is present freezes that phrase, so later revisions cannot
overwrite the user's change. The next phrase inserts at the current caret.

Repeated text from distinct phrases is retained, while repeated finals for the
same phrase are ignored. Official adapters provide stable identity for this
behavior. Custom adapter authors should follow
[segment identity](../packages/provider/README.md#segment-identity).

During IME composition, the browser owns the value and selection. Speech
received during composition remains available in transcript callbacks but is not
inserted. A later phrase can insert after composition ends.

## Undo, redo, and reset

Keyboard Undo/Redo and `voice.undo()` / `voice.redo()` use field-local history.
Each dictated phrase, including interim revisions, is one transaction. Adjacent
typing is grouped, while paste, composition, selection changes, and voice
activity create separate groups. Values and selections are restored together.

History starts when the target is attached. It retains up to 100 transactions
and 2 MiB of text. It does not import the field's earlier browser undo stack. If
a browser menu does not dispatch a cancelable history event, use a keyboard
shortcut or the explicit methods.

A native form reset clears ownership and history and stops the active session.
An external controlled replacement establishes a new baseline. Late speech or
asynchronous transforms cannot repopulate a reset or detached target.

## Disabled fields and length limits

Disabled and read-only fields render normally with dictation disabled. If a
field becomes unavailable during capture, VoiceInput stops with
`target-unavailable` and cannot apply delayed results.

Voice insertion respects `maxLength`. Capacity uses UTF-16 units to match HTML,
while truncation preserves complete grapheme clusters. When the limit is
reached, VoiceInput inserts what fits and stops with `max-length`.

Use `onTextLimit` to tell the user what happened:

```tsx
const voice = useVoiceInput({
  provider,
  onTextLimit: ({ insertedText, text }) => {
    console.info(`Inserted ${insertedText.length} of ${text.length} units`);
  },
});
```

The event also includes `maxLength` and `source` (`interim`, `final`, or
`transform`). Final transcript callbacks still receive the complete recognized
text after a graceful stop.

For controlled and uncontrolled component behavior, see the
[React API](../packages/react/README.md).
