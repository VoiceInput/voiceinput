# VoiceInput release record

- Version:
- npm dist-tag: `latest`
- Approved candidate SHA:
- CI run and immutable package artifact:
- Desktop engine versions and automated runs:
- Branded browsers / BrowserStack evidence (unverified unless recorded):
- Provider credential smoke run:
- Live Chromium/Vite-Hono run (`pnpm test:voice-live`; one result per provider):
- Automated accessibility evidence:
- Manual macOS VoiceOver/current Safari results (unrun unless recorded):
- Physical browser results (record device, browser, and provider):
- Optional device/browser/interruption evidence:
- Full-history/tree/tarball/workflow-log secret scan:
- Reviewer and approval date:

## Package hashes

Copy the six `sha512` entries from `.release-manifest.json` without editing
them. Attach that manifest and the exact CI package artifact to the GitHub
release.

## Changes

Copy the generated Changesets release notes for the shared package version.

## Manual result template

Copy one row for every device, browser, and provider result. Do not combine
providers in one result.

| Candidate SHA | Date | Tester | Device | OS  | Browser/version | Provider | Scope                                             | Scenario                                                                                                                                                           | Result | Evidence/notes |
| ------------- | ---- | ------ | ------ | --- | --------------- | -------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | -------------- |
|               |      |        |        |     |                 |          | full flow / basic provider / VoiceOver / optional | permissions / permission-recovery / activation / lifecycle / interim-edits / app-switch / background-final / lock-recovery / rotation / basic-provider / VoiceOver |        |                |

For each tested physical browser, copy one row per applicable full-flow scenario
for the selected provider. For each phone/browser combination, add one
`basic-provider` row for each of the other two providers. The desktop Chrome
baseline does not require those two additional-provider rows. Record failures
and timeouts as results; a blank row is unverified, and an aggregate `full flow`
pass without its scenario rows is incomplete.

## Automated result template

| Candidate SHA | Date | Runner/tester | Command | Runtime/browser version | Provider | Result | Duration | Evidence/notes |
| ------------- | ---- | ------------- | ------- | ----------------------- | -------- | ------ | -------- | -------------- |
|               |      |               |         |                         |          |        |          |                |

## Exceptions

Every gate required for the release being claimed must pass for the exact
candidate. Manual device and screen-reader checks remain unrun unless individual
results are recorded. Record observed failures explicitly and describe any
approved exceptions. Candidate approval does not publish packages; publication
is a separate owner action through the protected workflow.
