# Browser and runtime support

VoiceInput is a **desktop beta**. Use this table to check requirements and the
scope of the available test evidence.

| Environment                         | Requirement or verified scope                                         |
| ----------------------------------- | --------------------------------------------------------------------- |
| React                               | React 18.2+ within React 18, or React 19                              |
| Node.js                             | Maintained Node.js versions starting at 22; CI checks 22, 24, and 26  |
| TypeScript                          | 5.7+ for published declarations; optional for JavaScript applications |
| Browser runtime                     | Secure context, `getUserMedia`, `AudioContext`, and `AudioWorklet`    |
| Desktop editing                     | Automated tests in Playwright Chromium, Firefox, and WebKit           |
| Microphone and strict CSP           | Automated Chromium coverage                                           |
| Physical Safari and iOS microphones | Not yet verified                                                      |
| Manual screen-reader checks         | Not yet verified                                                      |

`isSupported` checks browser API availability. It does not mean that the device
has been certified. WebKit test results alone do not verify Safari microphone
behavior. See [troubleshooting](troubleshooting.md) for setup failures.

## Runtime requirements

VoiceInput supports maintained Node.js releases starting with Node 22 for server
helpers, package tooling, and server-side rendering. CI loads every ESM and
CommonJS entry on Node 22, 24, and 26 independently of the repository's pinned
development runtime.

Published declarations support TypeScript 5.7 and newer. Packed consumers are
compiled with TypeScript 5.7 against React 18 and with the current compiler
against React 19. TypeScript is a development tool, not a runtime dependency or
peer dependency of VoiceInput.

The React package supports React 18.2+ within React 18 and React 19. This
release is a desktop beta. Automated editing and form integration run in
Playwright Chromium, Firefox and WebKit. Chromium also runs browser
microphone/AudioWorklet and strict-CSP checks. The release record lists exact
engine versions and live-provider fixture evidence.

## Browser verification

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

## Release support

Only the latest VoiceInput prerelease receives fixes before the stable release.
After stable releases begin, this page will list the supported stable release
lines and their security-fix windows.
