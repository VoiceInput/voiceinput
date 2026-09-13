# Release checklist

VoiceInput stays on prerelease `0.x` versions. The first release is the scoped
desktop beta described in the public support policy. Publishing is a deliberate
final action, separate from ordinary CI.

## Automated release-candidate gates

- `pnpm format:check`, `pnpm lint`, and `pnpm typecheck`
- `pnpm test` and `pnpm test:browser`
- `pnpm test:a11y`
- `pnpm test:voice-live`; it runs OpenAI, ElevenLabs, and Deepgram serially in
  real Chromium through the Vite/Hono playground, with the checked-in fake WAV,
  a 90-second timeout per provider, and no retries
- `pnpm validate:packages`
- `pnpm --filter @voiceinput/website test:dev`
- `pnpm test:e2e`
- Desktop Chromium, Firefox and WebKit editing and form tests
- Record exact versions and distinguish engine tests from branded-browser
  evidence
- `pnpm test:provider-smoke-suite`, producing separate sanitized protocol
  results for OpenAI, ElevenLabs, and Deepgram in
  `provider-smoke-results/report.json`. The Deepgram credential needs
  Member-or-higher permission for `/v1/auth/grant`.
- `pnpm test:security` after the playground production builds
- Gitleaks scans of full history, the tracked tree (including docs and
  workflows), extracted package tarballs, and completed candidate workflow logs

Record the immutable candidate SHA, run date, BrowserStack run URLs, provider
smoke run URL, and the uploaded compatibility artifacts in the release record.
The [test coverage map](test-coverage.md) identifies the current files behind
each automated claim. A command listed here is ready to run, not evidence that
it passed. Record a pass only after it finishes against the exact candidate.

## Physical browser baseline — required before beta exit

For the later beta-exit candidate, run the deployment with real provider
credentials on physical desktop Chrome, one current iPhone in Safari and Chrome,
and one current Android phone in Chrome. Record candidate SHA, date, tester,
device model, OS version, browser and version, provider, result, and evidence
URL for every row. A blank, planned, or partially completed row is not a pass.

Choose one provider per device/browser combination for the full flow below:

- `permissions`: Start from fresh, already-granted, denied, and dismissed
  microphone states where the browser exposes them. Confirm Allow begins
  dictation and denial/dismissal produces a clear, recoverable state.
- `permission-recovery`: Change a denied site to Allow through the browser or OS
  settings, reload when required, and confirm dictation starts.
- `activation`: Exercise both toggle and hold-to-talk activation with the device
  microphone.
- `lifecycle`: Confirm start, stop, restart, interim, final, graceful stop,
  cancel, a recoverable failure, and a new successful session.
- `interim-edits`: Replace a selection, move the caret, and type while interim
  text is present; confirm final text does not overwrite the user's edits in
  both controlled and uncontrolled fields. Switch fields during recording and
  confirm the previous session relinquishes ownership.
- `app-switch`: Switch to another app while listening, then return. Confirm the
  session either resumes safely or ends with a clear recoverable state—never a
  stuck microphone indicator or duplicated final text.
- `background-final`: Background the page while it is processing a final
  transcript, then return. Confirm a delayed final is applied at most once and
  only to its owned span.
- `lock-recovery`: Lock and unlock the device during a session. Confirm the app
  can start a new session afterward without a reload.
- `rotation`: On phones, rotate during a session and verify the field, focus,
  selection, and controls remain usable.

On each phone/browser combination, run basic start, audible transcription, stop,
and new-session start with each of the other two providers. Record the three
providers separately; one provider's pass does not cover another provider. The
desktop Chrome baseline needs the selected provider's full flow; the
additional-provider check applies to the phones.

Bluetooth input changes, incoming calls, Siri or another audio-session
interruption, iPad, older OS versions, more device models, and the broad
BrowserStack matrix are optional beta checks. Record any that are run, including
failures. They do not replace the required physical baseline.

## Evidence review

Before approving a beta-exit candidate, check that every required result names
the exact SHA and run date, tester, device and OS, browser version, provider,
scenario, result, and evidence location. Record individual provider failures and
timeouts. Available credentials or a test implementation are readiness evidence
only.

These physical and VoiceOver rows remain explicitly pending for the current
desktop beta and must not be shown as passed. Publication remains a later,
separate action. Re-run all gates required for the release being claimed against
its final candidate after candidate changes; do not carry a pass from a
different SHA into the publication record.

## Publishing setup (one-time)

For each of the six npm packages, configure the same GitHub repository,
`publish.yml` workflow filename, and `npm` environment as its trusted publisher.
Protect the `npm` environment with required reviewers and restrict both `npm`
and `provider-smoke` deployments to `main`. The scheduled `provider-smoke` check
must run unattended; its secrets are scoped to that environment. The workflows
also enforce the `main` ref as defense in depth. Publishing uses OIDC
(`id-token: write`) and does not accept a long-lived npm token.

When every gate is green, merge the Changesets version PR. Confirm that it
removed the pending release Changeset and added the intended version to every
public package changelog. Fill in the
[release record](release-record-template.md), then manually run
`Publish packages` from `main` and enter:

- `PUBLISH` as the confirmation
- the full approved candidate commit SHA
- the CI run ID containing `release-candidate-<candidate SHA>`
- the exact shared package version
- the explicit npm dist-tag (`next` for the beta)

The workflow reruns the gates, restores the exact hashed tarballs from the
approved CI artifact, scans that set and the candidate workflow logs, prints the
complete immutable package/version/tag plan, and publishes those files without
rebuilding them. Do not publish directly from a developer machine.

## First-publication bootstrap

The initial public launch has an owner-authorized exception to the CI-only
publication rule. npm trusted publishing requires each package to exist first.
For `0.1.0-beta.1` only, an authenticated owner may publish the exact six hashed
CI artifact tarballs, in the dependency order printed by `pnpm release:plan`,
with `--access public --tag next`. Run the plan against the successful main
candidate and scan the restored artifacts and completed workflow logs first. Do
not repack or publish workspace directories. Confirm each registry integrity
matches its manifest SHA-512 before proceeding to the next package.

After this one-time bootstrap, configure each package to trust
`VoiceInput/voiceinput`, workflow `publish.yml`, environment `npm`, with publish
permission. Require an owner review on the `npm` GitHub environment, retaining
its `main` restriction. All later versions use the existing publication
workflow.

## Next release after the launch hardening pass

The controlled-field restart fix and the launch-hardening Changeset must both be
consumed by the next version PR before publishing. Keep the beta channel until
stable-release support gates are complete; pushing fixes to main does not update
npm. Validate the versioned candidate and publish its immutable CI artifacts.

As verified on September 6, 2026, both `latest` and `next` point to
`0.1.0-beta.1`. `@next` explicitly follows beta releases; it does not imply that
an untagged install currently selects a stable version. For the first stable
release, exit Changesets prerelease mode, update all SDK install snippets to
untagged versions, and publish with explicit dist-tag `latest`. Check the tags
with `npm view @voiceinput/react dist-tags` after publishing, then test a fresh
registry install. Do not remove the only usable `latest` tag before a stable
replacement exists.
