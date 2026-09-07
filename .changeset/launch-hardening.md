---
"@voiceinput/provider": patch
"@voiceinput/core": patch
"@voiceinput/react": patch
"@voiceinput/openai": patch
"@voiceinput/elevenlabs": patch
"@voiceinput/deepgram": patch
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
