# Desktop beta release record — 0.1.0-beta.1

This release prepares the six-package suite for a documented desktop beta. npm
publication, repository visibility, a landing page and adopter outreach remain
separate owner actions. The release identity is the full `candidateSha` in
`.release-manifest.json`, generated from the validated commit. CI stores that
manifest, the six hashed tarballs and `desktop-versions.json` together in the
`release-candidate-<SHA>` artifact. Use the artifact from the exact main
revision that will be published; a branch merge creates a new candidate
identity.

## Review findings and closure

| Review finding                            | Resolution                                                                                                                                                                                                                                 | Evidence                                                                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Disabled/read-only mounting failed        | Target support and writability are separate; wrappers mount safely and disable dictation. Dynamic disabled, read-only and disabled fieldsets stop capture and freeze the visible phrase.                                                   | Core text-engine and React component browser regressions, three engines                                                                  |
| Uncontrolled React onChange missed speech | Native prototype setters and bubbling InputEvents notify React. Wrapper onValueChange covers typing, voice, undo and redo once; optional onChange/onInput remain available.                                                                | React 18.3.1/19.2.8 packed consumers; wrapper callback-count regression; React Hook Form E2E                                             |
| Corrected interim text was duplicated     | Stable segment IDs retain phrase identity independently of text. Editing/re-anchoring suppresses the current segment and resumes at the next. Empty finals close a segment; duplicates are ignored.                                        | Manual correction/revision, repeated phrases, empty commits and ordered provider conformance tests                                       |
| Undo did not undo speech                  | Field-local history groups interim revisions with their final phrase; restores value and selection; typing, deletion, paste, composition and voice have separate transactions. Undo suppresses later revisions; redo restores frozen text. | Actual keyboard undo/redo in Chromium, Firefox and WebKit; browser history events; installed React consumers                             |
| Native constraints were bypassed          | Every voice mutation checks editability and UTF-16 maxLength capacity, truncating at complete grapheme boundaries. Limit events retain attempted/inserted text and source, stop capture, and leave full provider text in callbacks.        | Unicode selection replacement, dynamic read-only, current-phrase finalization, over-limit and asynchronous-transform browser regressions |

The five original regressions were reproduced as failing tests before their
fixes. The additional review gaps are closed in implementation as follows:

- Composition keeps DOM value and selection under browser control; affected
  segments remain transcript-only. Subsequent segments resume insertion.
- Capture starts after permission/audio setup and buffers ordered PCM while the
  provider connects. The queue holds at most 15 seconds and fails recoverably on
  overflow; it never overwrites queued audio. Maximum duration includes startup
  capture. Cancellation, timeout and unmount release resources and buffers.
- All three adapters await congestion above a 1 MiB outgoing WebSocket budget
  with a five-second deadline and cancellation. Protocol and lifecycle tests
  cover stalled sends, delayed finals and stop/cancel races.
- Hidden pages stop gracefully. Unexpected track termination and AudioContext
  interruption report recoverable audio errors and release capture resources; a
  new user-initiated recording can recover.
- Controllers and editing history survive provider/configuration rerenders.
  Configuration changes apply to the next recording. Target replacement, form
  reset, Strict Mode and ref cleanup are covered.
- The README starts with one field, a standalone provider and an authenticated
  token route. The credential-free simulated example includes a composer and
  tested React Hook Form validation, dirty state, reset, disabled and submitted
  value behavior. The maintainer lab remains available for diagnostics.
- Optional components tree-shake out of hook-only imports. Packed consumers
  exercise ESM/CommonJS, TypeScript, React 18/19, Next.js and Vite integration.
- Three provider credentials are configured in the existing GitHub
  `provider-smoke` environment. Its main-only branch restrictions remain intact;
  the credential configuration was verified by a successful workflow run.

## Validation evidence

Local validation on macOS arm64, Node 22.22.0, pnpm 11.23.0 and Playwright
1.61.1:

| Gate                     | Evidence                                                                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit behavior            | 201 workspace unit tests plus 11 release/smoke-script tests                                                                                                                           |
| Desktop browser behavior | 131 core browser tests plus 93 React browser tests                                                                                                                                    |
| Engine versions          | Chromium 149.0.7827.55, Firefox 151.0, WebKit 26.5                                                                                                                                    |
| End-to-end               | 14 tests, including two axe/keyboard accessibility flows and composer/form recipes across all three engines                                                                           |
| Installed Chrome         | Two simulated composer/form E2E flows on Chrome 152.0.7977.77; this is editing evidence, not physical-microphone certification                                                        |
| Package consumers        | React 18.3.1 + TypeScript 5.7.3; React 19.2.8 + TypeScript 7.0.2; Next 16.3.2 and Vite 8.2.2 builds; publint and Are the Types Wrong                                                  |
| Live providers           | All three default adapters minted credentials and returned distinct finalized segments for the repeated fixture; raw observations linked below                                        |
| Other gates              | Formatting, lint, typecheck, builds, CSP, browser/server credential isolation and Node package loading                                                                                |
| Release integrity        | CI scans Git history, tracked files and extracted tarballs; completed candidate workflow logs are scanned before publication; manifest binds SHA, package versions and SHA-512 hashes |

Counts describe the local suite; the candidate's CI logs provide the definitive
pass/fail results and Linux engine versions. Clear a candidate only after its
clean-room and Node runtime jobs pass and its completed workflow logs pass
secret scanning. The publication workflow repeats required gates and restores
the exact approved tarballs instead of rebuilding the published package set.

[Live fixture observations](desktop-beta-provider-smoke.json) retain
transcripts, segment IDs and timings. The corpus is one clean, short English
utterance, repeated for protocol testing. Deepgram omitted “By” on the second
repetition in this run; ElevenLabs' “MA” changes strict token-based WER. These
observations do not establish provider rankings, general accuracy or production
latency.

OpenAI now defaults to `gpt-transcribe` with 500 ms server VAD. The prior
`gpt-live-transcribe` default returned the repeated fixture as one segment until
Stop and rejected server VAD. It remains opt-in with manual commit and earlier
interim feedback. See [provider certification](../provider-certification.md).

## Migration and remaining external verification

Read the [editing contract](../editing-contract.md) and
[form recipes](../form-integration.md). Custom adapters should emit stable
`segmentId` values on every interim/final, including empty finals. Sequential
legacy adapters receive generated session IDs, but cannot reliably deduplicate
late finals without supplying IDs themselves. Wrappers need only `value` and
`onValueChange`; existing headless fields retain their normal change handler.
Keep each field controlled or uncontrolled for its lifetime.

Physical Safari/iOS microphones, Bluetooth routing, mobile interruptions, and
manual screen-reader verification remain pending. Playwright WebKit establishes
engine editing behavior, not Safari microphone support. Native IME event
lifecycle is covered synthetically; physical keyboard/IME and
assistive-technology passes remain separate. Browser-menu undo may not expose
field-local history when no cancelable history event is dispatched; desktop
keyboard shortcuts and explicit undo()/redo() are tested. History begins at
attachment, retains at most 100 transactions and 2 MiB of text, and does not
import older browser history.

For publication: merge the reviewed candidate, run CI and the main-only provider
smoke on that exact main SHA, retain the immutable artifact, complete the npm
trusted-publisher setup/reviewer check, then manually dispatch Publish packages
with version `0.1.0-beta.1` and dist-tag `next`. Do not publish a rebuilt or
modified local tarball. The documented desktop-beta scope does not require
pending mobile or manual assistive-technology certification; broader support
claims do.
