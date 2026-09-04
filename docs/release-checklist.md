# Release checklist

VoiceInput stays on prerelease `0.x` versions. The first release is the scoped
desktop beta described in the public support policy. Publishing is a deliberate
final action, separate from ordinary CI.

## Automated release-candidate gates

- `pnpm format:check`, `pnpm lint`, and `pnpm typecheck`
- `pnpm test` and `pnpm test:browser`
- `pnpm test:a11y`
- `pnpm validate:packages`
- `pnpm test:e2e`
- Desktop Chromium, Firefox and WebKit editing and form tests
- Record exact versions and distinguish engine tests from branded-browser
  evidence
- A successful credential-backed provider smoke run for OpenAI, ElevenLabs, and
  Deepgram. The Deepgram credential needs Member-or-higher permission for
  `/v1/auth/grant`.
- `pnpm test:security` after the playground production builds
- Gitleaks scans of full history, the tracked tree (including docs and
  workflows), extracted package tarballs, and completed candidate workflow logs

Record the immutable candidate SHA, run date, BrowserStack run URLs, provider
smoke run URL, and the uploaded compatibility artifacts in the release record.
For a later full production claim, the BrowserStack matrix covers current and
previous Chrome, Edge, branded Firefox, macOS Safari, and real-device iOS Safari
on both iPhone and iPad. Missing rows remain unverified for the desktop beta.

## Physical iPhone and iPad pass — required for full production support

Run this pass in Safari on physical iPhone and iPad hardware for both the
current and previous supported iOS releases, using the release-candidate
playground deployment and real provider credentials. Record the device model,
OS/Safari version, provider, date, candidate SHA, tester, and result for every
row; a blank row is not a pass.

- Start from fresh, already-granted, denied, and dismissed Safari microphone
  states. Confirm Allow begins dictation and denial/dismissal produces a clear,
  recoverable state.
- Change a denied site to Allow in Safari Settings, reload the page, and confirm
  dictation starts. VoiceInput does not promise that a browser notices a
  settings change without a reload.
- Exercise both toggle and hold-to-talk activation with the device microphone.
- Confirm start, interim, final, graceful stop, cancel, token error, provider
  disconnect, and retry behavior.
- Replace a selection, move the caret, and type while interim text is present;
  confirm final text does not overwrite the user's edits in both controlled and
  uncontrolled fields. Switch fields during recording and confirm the previous
  session relinquishes ownership.
- Switch to another app while listening, then return. Confirm the session either
  resumes safely or ends with a clear recoverable state—never a stuck microphone
  indicator or duplicated final text.
- Background the page while it is processing a final transcript, then return.
  Confirm a delayed final is applied at most once and only to its owned span.
- Lock and unlock the device during a session. Confirm the app can start a new
  session afterward without a reload.
- Rotate between portrait and landscape during a session and verify the field,
  focus, selection, and controls remain usable.
- Interrupt capture with an incoming call, Siri, or another audio session;
  confirm recovery is explicit and a new session can start.
- Change between the built-in microphone and a Bluetooth headset while idle and
  while listening; confirm the app never remains stuck or duplicates a final.

Any failure blocks a full production-support claim. These physical-device checks
are not gates for the explicitly scoped desktop beta. BrowserStack automation is
useful compatibility evidence, but it does not replace this physical microphone
and route-change pass.

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
