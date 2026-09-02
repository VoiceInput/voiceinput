# Support policy

VoiceInput supports maintained Node.js releases starting with Node 22 for server
helpers, package tooling, and server-side rendering. CI loads every ESM and
CommonJS entry on Node 22, 24, and 26 independently of the repository's pinned
development runtime.

Published declarations support TypeScript 5.7 and newer. Packed consumers are
compiled with TypeScript 5.7 against React 18 and with the current compiler
against React 19. TypeScript is a development tool, not a runtime dependency or
peer dependency of VoiceInput.

The React package supports React 18 and 19. Browser support covers the current
and previous stable Chrome, Edge, Firefox, macOS Safari, and iOS Safari releases
subject to the secure-context and microphone APIs described in
[troubleshooting](troubleshooting.md).

Only the latest VoiceInput prerelease receives fixes before the stable release.
After stable releases begin, this page will list the supported stable release
lines and their security-fix windows.
