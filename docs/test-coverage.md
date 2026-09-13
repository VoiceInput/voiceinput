# Test coverage

This page maps release claims to the tests that currently provide evidence. It
is intentionally a map, not an exhaustive list of every assertion. A test file
is evidence only for the behavior it actually exercises; simulated devices,
browser engines, fake providers, and streamed fixtures do not replace a manual
run with a physical microphone.

| Area                               | Current automated evidence                                                                                                                                                                       | What it establishes                                                                                                                                                                  | Remaining manual evidence                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Session lifecycle and final drain  | `packages/core/src/index.test.ts`, `packages/core/src/audio-queue.test.ts`                                                                                                                       | Start/stop/cancel, connection deadlines, duration limits, ordered audio, graceful finalization, and delayed finals                                                                   | Real permission prompts, device interruptions, backgrounding, and lock/unlock                        |
| Browser capture and worklet        | `packages/core/src/browser-audio.test.ts`, `packages/core/src/audio-worklet.browser.test.ts`, `packages/core/src/strict-csp.browser.test.ts`                                                     | Browser API capability/error handling, PCM worklet protocol, and worklet loading under strict CSP in Chromium                                                                        | Physical microphone capture and browser-specific permission recovery                                 |
| Editing ownership                  | `packages/core/src/text-engine.test.ts`, `packages/core/src/text-engine.browser.test.ts`, `packages/core/src/text-engine/history.test.ts`                                                        | Interim/final replacement, selection and caret changes, concurrent edits, controlled reconciliation, transforms, undo history, and target validation                                 | Touch keyboards, mobile selection behavior, and lifecycle changes during an active interim           |
| React integration and coordination | `packages/react/src/use-voice-input.browser.test.tsx`, `packages/react/src/components.browser.test.tsx`, `packages/react/src/coordinator.browser.test.tsx`, `packages/react/src/types.test-d.ts` | Hook lifecycle, controls, coordinator ownership, and public type declarations                                                                                                        | Assistive-technology announcements and real-device gestures                                          |
| Playground integration             | `e2e/playgrounds.spec.ts`, `e2e/simulated.spec.ts`                                                                                                                                               | Next.js and Vite/Hono fake-provider auth, interim/final, stop/cancel/retry, field switching, edits, undo/redo, and form-library behavior in Playwright Chromium, Firefox, and WebKit | Live microphone/provider flows and branded-browser behavior                                          |
| Automated accessibility            | `e2e/accessibility.spec.ts`                                                                                                                                                                      | Axe scans and keyboard operation of toggle and hold-to-talk in both playgrounds in Chromium                                                                                          | The short VoiceOver/Safari check required below; broader screen-reader coverage is optional evidence |
| Provider adapters                  | `packages/openai/src/*.test.ts`, `packages/elevenlabs/src/*.test.ts`, `packages/deepgram/src/*.test.ts`, `packages/provider/src/*.test.ts`                                                       | Protocol messages, server credential handlers, provider conformance, ordered PCM accumulation through stop/finish, errors, and option mapping                                        | Credential-backed end-to-end browser sessions                                                        |
| Provider fixture harness           | `scripts/provider-smoke.test.mjs` and `scripts/provider-smoke.mjs`                                                                                                                               | Harness behavior plus credential-backed Node streaming when the smoke command is run                                                                                                 | Browser capture, UI integration, and device lifecycle behavior                                       |
| Demo relay and quotas              | `apps/website/worker/*.test.ts`, `apps/website/tests/*.test.*`                                                                                                                                   | Quota ownership, abuse limits, reconnect policy, delayed finalization, sanitized errors, isolated development ports, overrides, and page/proxy readiness                             | Hosted-environment operational evidence                                                              |
| Packaging and release controls     | `scripts/release.test.ts`, `scripts/validate-packages.mjs`, `scripts/scan-secrets.mjs`                                                                                                           | Release-plan invariants, packed-consumer validation, and secret-scan behavior when their commands run                                                                                | Approval and publication evidence for the exact candidate                                            |

The configurations for `pnpm test:browser` and the playground and simulated
tests in `pnpm test:e2e` use Playwright's Chromium, Firefox, and WebKit engines.
`pnpm test:a11y` runs its axe and keyboard checks in Chromium. These choices are
configured in `packages/core/vitest.browser.config.ts`,
`packages/react/vitest.browser.config.ts`, and `playwright.config.ts`. Record
the exact versions for each candidate. Do not relabel these engine runs as
physical Chrome, Safari, Firefox, iPhone, or Android results.

## Live browser gate

`pnpm test:voice-live` runs serially in real Chromium against the Vite/Hono
playground. It will feed the checked-in fake WAV through the browser and
exercise OpenAI, ElevenLabs, and Deepgram with real temporary credentials. Each
provider gets a 90-second timeout and no retry. Its result is recorded
separately for each provider so one failure cannot be hidden by an aggregate
pass.

The implementation is in `voice-live/providers.voice-live.spec.ts`,
`playwright.voice-live.config.ts`, and the `scripts/voice-live-*` files. Its
presence means the gate is ready to run; it is not pass evidence. Record the
exact command, candidate SHA, browser version, provider, result, duration, and
CI artifact in the release record. The sanitized report is
`voice-live-results/report.json`.

For initial local setup, install Chromium with
`pnpm exec playwright install chromium`. Provide `OPENAI_API_KEY`,
`ELEVENLABS_API_KEY`, and `DEEPGRAM_API_KEY` through `.env` or the environment,
then run `pnpm test:voice-live`. The runner reserves ports 5175 and 8789 and
does not reuse existing servers; an occupied port fails the run. The separate
Node protocol suite is `pnpm test:provider-smoke-suite`, and its sanitized
report is `provider-smoke-results/report.json`.

These commands and report locations describe how to collect evidence. Their
presence and results from an earlier SHA do not establish a pass for a future
candidate.

The optional BrowserStack workflow performs a local configuration sanity check
before starting cloud sessions. That check verifies required environment names
and structural settings in `browserstack.yml`; it does not query BrowserStack's
live device catalog or prove that a configured device is currently available.
