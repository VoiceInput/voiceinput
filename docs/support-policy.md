# Support policy

VoiceInput supports maintained Node.js releases starting with Node 22 for server
helpers, package tooling, and server-side rendering. CI loads every ESM and
CommonJS entry on Node 22, 24, and 26 independently of the repository's pinned
development runtime.

Published declarations support TypeScript 5.7 and newer. Packed consumers are
compiled with TypeScript 5.7 against React 18 and with the current compiler
against React 19. TypeScript is a development tool, not a runtime dependency or
peer dependency of VoiceInput.

The React package supports React 18 and 19. This release is a desktop beta.
Automated editing and form integration run in Playwright Chromium, Firefox and
WebKit. Chromium also runs browser microphone/AudioWorklet and strict-CSP
checks. The release record lists exact engine versions and live-provider fixture
evidence.

Engine automation is not branded-browser or physical-device certification.
Current/previous branded Chrome, Edge, Firefox, macOS Safari, physical
iPhone/iPad microphones, and manual screen-reader checks remain the broader
stable-release matrix. An environment is marked verified only when its
corresponding evidence exists. WebKit success alone does not verify Safari
microphone behavior.

Runtime capability checks still require a secure context, microphone APIs and
AudioWorklet. `isSupported` reports API availability, not a certification
result. See [editing limitations](editing-contract.md) and
[accessibility testing](accessibility-testing.md).

Only the latest VoiceInput prerelease receives fixes before the stable release.
After stable releases begin, this page will list the supported stable release
lines and their security-fix windows.
