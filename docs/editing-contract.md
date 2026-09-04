# Editing contract

VoiceInput enhances native text, search, URL and telephone inputs and textareas.
The application owns the field value; provider transcripts are a separate record
of what was recognized. Suppressed or length-limited text remains available in
transcript state and callbacks.

## Phrases and manual edits

A phrase is one provider-finalized segment, not necessarily a sentence. Official
adapters identify segments independently of their text. Repeated words in two
segments are both retained; a repeated final for the same segment is ignored.
OpenAI uses item identifiers, Deepgram uses the audio start boundary, and
ElevenLabs uses sequential commit boundaries. ElevenLabs partial results belong
to the pending commit; informational `final_transcript` events do not commit
text.

Editing or moving the caret while provisional text is present freezes that
phrase. Later revisions of that segment cannot overwrite or duplicate it. The
next segment inserts at the current caret. Disjoint application updates can
shift an owned range without losing ownership if the range can still be proved.

During IME composition, the browser owns value and selection. Segments received
during composition remain transcript-only, including their later final updates.
Insertion resumes with a subsequent segment after composition ends.

## Undo, redo and reset

Keyboard Undo/Redo and `voice.undo()` / `voice.redo()` use field-local history.
Each dictated phrase, including its interim revisions, is one transaction.
Adjacent typing is grouped within one second; paste, composition, selection
changes and voice activity establish separate groups. Post-stop transforms are
separate undoable transactions. Values and selections are restored together.
Undoing an active phrase suppresses its later provider updates; redo restores
frozen text rather than provider ownership.

History starts when the target is attached. It retains at most 100 transactions
and 2 MiB of text; older transactions are evicted. It does not import the
browser's pre-existing undo stack. Standard desktop keyboard shortcuts are
tested. Browser menus that do not dispatch a cancelable `historyUndo` /
`historyRedo` event may not expose this history; use keyboard shortcuts or the
explicit methods there.

Native form reset clears ownership and history and stops the active session.
External controlled replacements establish a new history baseline. Late speech
or asynchronous transforms cannot repopulate a reset or detached target.

## Disabled fields and length limits

Disabled and read-only fields render normally with dictation disabled. If a
field becomes unavailable during capture, VoiceInput stops with
`target-unavailable` and freezes visible text. Delayed results and transforms
cannot change it.

Voice insertion respects `maxLength`, including selection replacements and
transforms. Capacity is measured in UTF-16 units, as in HTML, while truncation
keeps complete grapheme clusters. When the limit is reached, VoiceInput inserts
what fits and stops with `max-length`. The current owned phrase may finish
within the limit; subsequent results remain transcript-only. Existing
application text is never shortened just because its length exceeds a newly
applied limit.

`onTextLimit(event)` and the `text-limit` session event report `maxLength`,
`text` (the attempted insertion including normalized boundaries),
`insertedText`, and `source` (`interim`, `final`, or `transform`). Read the
final transcript callback to obtain the complete provider-finalized text after
graceful shutdown.

## React notifications

`VoiceInput` and `VoiceTextarea` need only `value` and `onValueChange` when
controlled. That callback fires once for each typing, voice, undo or redo edit.
Optional native `onChange` and `onInput` listeners also observe those edits.
Uncontrolled fields work with ordinary `onChange`, `name`, `defaultValue`, and
form registration.

For a headless controlled field, retain its ordinary keyboard `onChange` handler
and pass `value` / `onValueChange` to the hook. Voice changes use the binding
callback. The field's committed application value remains authoritative.

Provider and recording options are sampled at the next recording start. Changing
a provider object during rendering does not interrupt the active recording. To
switch immediately, explicitly stop and then start. Keep provider objects at
module scope when convenient, to avoid unnecessary factory allocations.

Keep a field controlled or uncontrolled for its attachment lifetime; use a new
React key to switch modes. Core session `updateOptions` changes recording
configuration only; its text engine remains attached for the session lifetime.
