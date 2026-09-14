# Pre-launch hardening review

The September 6, 2026 review verified the pre-launch findings against the
current source and added regression coverage for the confirmed reliability
issues. These changes prepare the next release; they do not themselves publish
to npm.

## Reliability and editing

- The built-in AudioWorklet is generated as a self-contained ES2019 string at
  build time. Package validation bundles a packed consumer with ES2019 and
  `keepNames`, then loads and flushes the processor in Chromium.
- Graceful audio/provider shutdown defaults to 15 seconds and accepts
  `finalizationTimeoutMs`. Expiry preserves visible interim text, releases
  resources, completes the text engine, and returns to idle with stop reason
  `finalization-timeout`. Transcript transforms have their own timeout.
  ElevenLabs' standalone finish timeout defaults to 20 seconds so the core
  fallback gets the first opportunity to complete a default session.
- Browser capture attempts permission and audio activation instead of rejecting
  starts based on an expired transient activation flag. Blocked audio activation
  reports `user-activation-required`. Field handoff releases capture without
  waiting for the previous provider or transcript transform to finish.
- React reads support through an external-store snapshot and suppresses initial
  live-region chatter. Writability changes come from the text engine's existing
  observer instead of a second observer rebuilt on every render.
- A prefilled field's untouched initial zero-position selection defaults to the
  end until the engine observes focus. Explicit selections after focus are
  preserved. The editing contract documents the rule.
- Backgrounding still stops recording by default. `stopWhenHidden: false`
  enables desktop background dictation; page hide/freeze and actual browser
  audio interruptions still stop it.

## Developer experience

- `getVoiceInputErrorMessage` supplies stable display messages and is used by
  default controls and public examples. Adapter diagnostics remain in `cause`.
- Browser-only core, React, and provider packages no longer impose a Node engine
  requirement. Server adapter runtime requirements remain documented.
- Provider endpointing defaults, including ElevenLabs' SDK-selected 650 ms,
  appear in the provider guide. Toggle-mode pointer focus behavior is
  documented.
- Subscriber error reporting shares one implementation. Transform timeout
  defaults share one constant, and validation text matches integer validation.
- Hook configuration errors state how to fix the inputs and link to the docs.
- Website lint includes its test fixtures. The generated worker declaration file
  remains deliberately excluded; its generator-owned lint header is not edited.

## Release decisions and deferred scope

The controlled-field restart fix is still pending publication, as are these
changes. Both Changesets must be consumed by the next version PR. On September
6, 2026 the registry reported `next` and `latest` at `0.1.0-beta.1`; the
quickstart and release checklist now explain that state and the explicit
first-stable tag transition. The package set remains in beta until its stable
support gates are complete. No npm version or dist-tag is changed by this
review.

A new development token-server CLI is deferred. It would add a new package and
credential-serving surface immediately before launch. The quickstart instead
links directly to the existing live microphone demo, with the simulated example
available for local exploration without credentials.

The audit's positive findings did not call for changes to token authorization,
quota enforcement, publication artifact integrity, or the ownership model's
other editing rules. Existing automated coverage for those paths remains part of
the release checks. Automated browser fixtures do not replace physical-device,
real-microphone, or manual screen-reader validation in the release checklist.

## Initial-pass verification

- Workspace build, type checks, lint, and source formatting passed. Formatting
  excludes the local review input; installed agent-skill copies retain upstream
  formatting.
- 251 unit tests and 248 SDK browser tests passed. Browser coverage includes
  Chromium, Firefox, and WebKit.
- All 71 end-to-end tests passed: 14 playground/accessibility flows and 57
  website flows. Demo error tests also verify that raw server diagnostics stay
  hidden while quota retry delays remain visible.
- Packed-package validation passed for exports/types, ESM/CommonJS, React 18 and
  19, Next.js/Vite consumers, tree shaking, and the bundled AudioWorklet probe.
- Live OpenAI, ElevenLabs, and Deepgram checks issued temporary credentials and
  transcribed the repeated checked-in audio fixture successfully. Recognition
  quality varies by provider; these are protocol checks, not an accuracy claim.
- Browser credential-isolation checks and packed-artifact secret scanning
  passed.

Physical microphone, branded Safari, mobile-device, and manual screen-reader
checks were not performed in this pass. Follow the release checklist for those
checks and the subsequent npm publication.

## Re-audit follow-up

- Provider failures during graceful Stop now preserve visible interim text just
  like deadline expiry. This includes error stream parts, rejected finish calls,
  and audio flush failures. The text engine completes, the session reports the
  error and returns to idle, and a new recording can start.
- Every suspended audio-context resume has a one-second bound, including when
  the browser has no `navigator.userActivation` API.
- The shared exception reporter is marked internal and removed from the public
  API list.
- The demo retains known worker-authored busy and daily-limit messages,
  including retry timing, while unexpected server diagnostics still get a safe
  fallback.
- `pnpm format:check` now explicitly ignores the local `project-audit.md` input;
  the file itself remains untracked and unchanged.
- The hardening Changeset is minor to describe the added API and default
  changes. It notes the added `user-activation-required` error code for
  exhaustive switches. No compatibility shims or separate beta release were
  added for this follow-up.

The end-to-end pass also reproduced a demo hydration race: early typing could be
lost when React initialized the controlled field. The demo now keeps fields
read-only and JavaScript-dependent controls disabled until hydration completes.
A deliberately delayed-hydration test covers this boundary, draft switching, and
clearing a prefilled draft. SDK controlled-value semantics are unchanged.
