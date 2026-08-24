# Release checklist

VoiceInput stays on prerelease `0.x` versions until the product criteria in
`.private/PRODUCT.md` pass. Publishing is a deliberate final action, separate
from ordinary CI.

## Automated release-candidate gates

- `pnpm format:check`, `pnpm lint`, and `pnpm typecheck`
- `pnpm test` and `pnpm test:browser`
- `pnpm validate:packages`
- `pnpm test:e2e`
- A successful BrowserStack compatibility run
- A successful credential-backed provider smoke run for OpenAI, ElevenLabs, and
  Deepgram. The Deepgram credential needs Member-or-higher permission for
  `/v1/auth/grant`.
- `pnpm test:security` after the playground production builds

## Physical iPhone and iPad pass

Run this pass in Safari on one current iPhone and one current iPad using the
release-candidate playground deployment and real provider credentials.

- Start from a fresh Safari site permission state. Confirm Allow begins
  dictation, Deny produces a recoverable permission error, and a later Allow
  succeeds without reloading the page.
- Exercise both toggle and hold-to-talk activation with the device microphone.
- Replace a selection, move the caret, and type while interim text is present;
  confirm final text does not overwrite the user's edits.
- Switch to another app while listening, then return. Confirm the session either
  resumes safely or ends with a clear recoverable state—never a stuck microphone
  indicator or duplicated final text.
- Background the page while it is processing a final transcript, then return.
  Confirm a delayed final is applied at most once and only to its owned span.
- Lock and unlock the device during a session. Confirm the app can start a new
  session afterward without a reload.
- Repeat once with a Bluetooth headset if it is part of the supported release
  setup.

Record device model, OS version, Safari version, provider, and result in the
release notes. Any failure blocks the release.

## Publishing setup (one-time)

For each of the six npm packages, configure the same GitHub repository,
`publish.yml` workflow filename, and `npm` environment as its trusted publisher.
Protect the `npm` and `provider-smoke` GitHub environments with required
reviewers and deployment branch rules that allow only `main`. The workflows also
enforce the `main` ref as defense in depth. Publishing uses OIDC
(`id-token: write`) and does not accept a long-lived npm token.

When every gate is green, merge the Changesets version PR and manually run
`Publish packages`. Do not publish directly from a developer machine.
