# @voiceinput/provider

## 0.1.0-beta.1

### Patch Changes

- Prepare the documented desktop beta with segment-aware editing, field-local
  undo/redo, grapheme-safe maxLength enforcement, composition protection, and
  safe disabled/read-only/reset behavior. VoiceTextarea and VoiceInput now
  notify one onValueChange callback for typing and voice edits, including
  undo/redo; uncontrolled React onChange also receives dictation. Recording
  configuration is sampled at Start so inline provider factories do not
  interrupt recording.

  Capture buffers up to 15 seconds while connecting, provider sends have bounded
  congestion deadlines, and backgrounding and audio interruptions clean up
  resources. New public APIs include segmentId, undo(), redo(), onTextLimit and
  the max-length, target-unavailable and backgrounded stop reasons. OpenAI now
  defaults to gpt-transcribe with 500 ms server VAD: the live model remains
  opt-in for one manual-commit segment per recording.

  See docs/editing-contract.md and docs/form-integration.md for migration and
  integration details. Automated desktop engine coverage, installed React 18/19
  consumers and the no-account simulated example accompany this beta; physical
  mobile and manual assistive-technology verification remain pending.

## 0.1.0-beta.0

### Minor Changes

- 604dca7: Prepare the fixed VoiceInput package suite for its initial `0.x`
  prerelease.
