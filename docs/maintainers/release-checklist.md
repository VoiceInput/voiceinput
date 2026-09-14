# Release checklist

Publish the fixed six-package suite as **0.1.0 on `latest`**. Publishing is a
manual owner action after the version PR merges and the final candidate passes
its checks. Package versions stay on the 0.x line.

## Version the release

1. Add the launch changeset alongside `openai-stop-flush.md`.
2. Run `pnpm changeset pre exit`. Changesets marks `pre.json` as `exit`; the
   version command removes it when it consumes the prerelease changesets.
3. Confirm `pnpm changeset version` produces `0.1.0` for all six packages in an
   isolated copy. Do not commit a local version bump.
4. Merge the implementation. Let `release-pr.yml` open the **Version packages**
   PR, then review its versions, internal dependencies, and generated
   changelogs.
5. Merge the version PR and validate that exact main commit before publishing.

## Automated checks

Run these against the final candidate and record the results in the
[release record](release-record-template.md):

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:browser
pnpm build
pnpm validate:packages
pnpm test:security
pnpm --filter @voiceinput/website build
pnpm test:e2e
pnpm test:a11y
pnpm --filter @voiceinput/website test:dev
pnpm test:node-compat
```

Run `pnpm test:provider-smoke-suite` with provider credentials and retain the
sanitized results in `provider-smoke-results/report.json`. Run
`pnpm test:voice-live` for Chromium microphone-to-provider coverage, recording
one result per provider. Deepgram's credential needs Member-or-higher permission
for `/v1/auth/grant`.

Scan the full history, tracked files, package tarballs, and completed workflow
logs with the configured secret checks. Keep the immutable CI package artifact,
its SHA-512 manifest, the candidate SHA, runtime/browser versions, and check
URLs. See the [test coverage map](test-coverage.md) for the checks behind each
claim. Only record a pass after a command completes; rerun affected checks when
the candidate changes.

## Browser and accessibility checks

Open the deployed site in Chrome, Firefox, and Safari, run the demo, and visit
every documentation sidebar entry. Confirm the install widget uses untagged
package names. Record results by browser and provider.

Physical mobile microphones, Safari microphone behavior, and manual
screen-reader coverage remain ongoing work. Record any manual testing with
device, OS, browser, provider, scenario, and result. Do not infer a physical
Safari or iOS result from Playwright WebKit. Broader device and screen-reader
testing is outside this launch implementation; do not mark unrun checks as
passed. Use the [accessibility checklist](accessibility-testing.md) when
performing those checks.

## Publishing setup

Each npm package must trust `VoiceInput/voiceinput`, workflow `publish.yml`, and
the `npm` environment. Protect that environment with required reviewers and
restrict both `npm` and `provider-smoke` environments to `main`. The scheduled
provider smoke check must be able to run unattended with its scoped secrets.
Publishing uses OIDC, without a long-lived npm token.

## Publish from the approved candidate

The owner runs **Publish packages** from the versioned main commit and enters:

- Confirmation: `PUBLISH`
- The full approved candidate SHA
- The successful CI run ID containing `release-candidate-<candidate SHA>`
- Version: `0.1.0`
- Dist-tag: `latest`

The workflow reruns its gates, restores the exact hashed tarballs from the
approved CI artifact, scans the package set and workflow logs, validates the
release plan, and publishes those files. Do not repack or publish workspace
folders from a developer machine.

## After publication — owner steps

1. Point the testing channel at the public release by running this for each of
   `provider`, `core`, `react`, `openai`, `elevenlabs`, and `deepgram`:

   ```bash
   npm dist-tag add @voiceinput/<pkg>@0.1.0 next
   ```

2. Tag the published commit `v0.1.0` and create the GitHub release with the
   initial public API and validation notes. Earlier beta versions were owner
   testing builds, so no beta migration contract applies.
3. Copy the [release record template](release-record-template.md) to
   `docs/maintainers/releases/0.1.0.md` and fill it with actual results and
   artifact hashes. Attach the manifest and CI artifact to the GitHub release.
4. Check the registry:

   ```bash
   npm view @voiceinput/react dist-tags
   ```

   Confirm `latest` and `next` both point to `0.1.0`; check all six packages.

5. In an empty project, run `npm install @voiceinput/react @voiceinput/openai`
   and confirm imports of `useVoiceInput` and `createOpenAITokenHandler` work.
6. Change VoiceInput dependencies in `examples/nextjs-app-router` and
   `examples/vite-hono` from `next` to `^0.1.0`, refresh their lockfiles if
   present, and build both full-stack examples against the published packages.
7. Confirm repository settings: description “Add dictation to any React input or
   textarea”, homepage `https://voiceinput.dev`, and topics `react`,
   `speech-to-text`, `dictation`, `voice-input`, `openai`, `elevenlabs`,
   `deepgram`, `typescript`. Enable private vulnerability reporting; enable
   Discussions if wanted.
