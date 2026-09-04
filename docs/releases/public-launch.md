# Public desktop beta launch — September 4, 2026

The six SDK packages were published as `0.1.0-beta.1` with the `next` dist-tag
from candidate `37e871ba3de710112d387aa50adf6129992aa667`. The repository is
public, and the website and 18 documentation pages are deployed to
`voiceinput.dev`.

- [Successful candidate CI](https://github.com/VoiceInput/voiceinput/actions/runs/33925517234)
- [Successful live provider smoke](https://github.com/VoiceInput/voiceinput/actions/runs/33925519169)
- [Candidate source](https://github.com/VoiceInput/voiceinput/tree/37e871ba3de710112d387aa50adf6129992aa667)
- [Release and hashed artifacts](https://github.com/VoiceInput/voiceinput/releases/tag/v0.1.0-beta.1)

Repository history, tracked files, extracted tarballs, and completed candidate
workflow logs passed Gitleaks. Each public npm tarball's SHA-512 was compared
with the corresponding immutable CI artifact. The initial owner-authenticated
bootstrap is complete. All packages now trust GitHub workflow `publish.yml` in
`VoiceInput/voiceinput`, environment `npm`; that environment requires owner
review and remains restricted to `main`.

Website checks cover 21 scenarios across Chromium, Firefox, and WebKit,
including editing, undo, accessibility, responsive layouts, and JavaScript/WebGL
fallbacks. Lighthouse on the Cloudflare preview measured mobile performance 99,
desktop performance 96, accessibility 100, and zero layout shift. These are lab
measurements, not a guarantee for every device or connection. Mobile uses a
static silver waveform; desktop loads the interactive Three.js sculpture.

The [desktop beta support limits](../support-policy.md) continue to apply.

Final public verification succeeded after npm's publish-time scan completed:
the exact website installation command installed from the public registry in
an empty temporary project, and the React hook, OpenAI provider, and server
token handler exports loaded successfully. Anonymous GitHub access returned
the public repository.

Cloudflare's production custom-domain binding is enabled for `voiceinput.dev`
on `voiceinput-website`. Google and Cloudflare public DNS resolve the domain;
all 19 sitemap URLs return HTTP 200 after redirects, with valid HTTPS. The
production simulation, undo, and quickstart passed in Chromium with no browser
errors. The launch machine's local DNS proxy still returned an empty answer at
verification time, so the production browser check used the publicly resolved
Cloudflare address while retaining normal hostname and certificate validation.
