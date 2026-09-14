# Browser bundle size

Measured on 2026-09-02 with Node 22, pnpm 11.23.0, and Rolldown 1.2.5.

| Session validator         |     Core package | Minified browser bundle |               Gzip |
| ------------------------- | ---------------: | ----------------------: | -----------------: |
| Zod (`1b1b79b`)           |         87,522 B |               107,572 B |           30,081 B |
| Narrow validator (VI-104) |         88,747 B |                42,132 B |           13,103 B |
| Change                    | +1,225 B (+1.4%) |      -65,440 B (-60.8%) | -16,978 B (-56.4%) |

The package measurement is the generated `@voiceinput/core` tarball. It does not
include installed dependencies, so the small increase reflects the explicit
validator code while omitting the removed Zod package. The browser measurement
captures the consumer cost that matters here.

For the browser measurement, build the workspace and bundle an ESM entry that
re-exports `VoiceInputProvider`, `VoiceInput`, and `useVoiceInput` from the
React package. Rolldown runs with `platform: "browser"`, minification enabled,
and React externalized. The gzip column uses Node's `gzipSync` at level 9. This
entry exercises the documented React path and includes VoiceInput's runtime
dependencies without counting the host application's React copy.
