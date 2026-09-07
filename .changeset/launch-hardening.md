---
"@voiceinput/provider": minor
"@voiceinput/core": minor
"@voiceinput/react": minor
"@voiceinput/openai": minor
"@voiceinput/elevenlabs": minor
"@voiceinput/deepgram": minor
---

Make the built-in AudioWorklet safe under consumer bundling and report blocked
browser audio activation separately from microphone permission denial.

Preserve visible dictation when graceful shutdown times out, expose a
configurable finalization deadline and background-recording policy, and improve
initial React support detection, field writability subscriptions, and
prefilled-field selection.

Provide a stable user-facing error-message helper, retain upstream diagnostics
in error causes, and clarify provider defaults, accessibility, and release
channels.

Preserve visible text when finalization fails as well as when it times out. The
new `user-activation-required` error code requires updating exhaustive switches
over `VoiceInputErrorCode`.
