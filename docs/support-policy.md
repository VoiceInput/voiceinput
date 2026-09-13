# Browser and runtime support

VoiceInput is a **desktop beta**. Use this table to check requirements and the
scope of the available test evidence.

| Environment                 | Requirement or verified scope                                           |
| --------------------------- | ----------------------------------------------------------------------- |
| React                       | React 18.2+ within React 18, or React 19                                |
| Node.js                     | Maintained Node.js versions starting at 22; CI checks 22, 24, and 26    |
| TypeScript                  | 5.7+ for published declarations; optional for JavaScript applications   |
| Browser runtime             | Secure context, `getUserMedia`, `AudioContext`, and `AudioWorklet`      |
| Desktop editing             | Automated tests in Playwright Chromium, Firefox, and WebKit             |
| Microphone and strict CSP   | Automated Chromium coverage                                             |
| Physical desktop Chrome     | Not yet verified; required before beta exit                             |
| Physical mobile microphones | Not yet verified; one current iPhone and Android phone before beta exit |
| Manual screen-reader checks | Not yet verified; macOS VoiceOver/current Safari before beta exit       |

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
release remains a desktop beta. Automated editing and form integration run in
Playwright Chromium, Firefox and WebKit. Chromium also runs browser
microphone/AudioWorklet and strict-CSP checks. The release record lists exact
engine versions and live-provider fixture evidence.

## Browser verification

Engine automation is not branded-browser or physical-device certification. The
beta-exit release-candidate baseline adds manual runs in physical desktop
Chrome, current iPhone Safari and Chrome, and current Android Chrome, using one
phone for each mobile platform. It also includes a short macOS VoiceOver/current
Safari check. These results apply only to the recorded device, OS, browser,
provider, and candidate SHA. WebKit success alone does not verify Safari
microphone behavior, and a passing run on one phone is not a promise about all
phones or OS versions.

Bluetooth route changes, calls and Siri interruptions, iPad, older OS releases,
additional devices, other desktop screen readers, and the broad branded-browser
BrowserStack matrix are useful optional evidence. They become required only if a
later release explicitly claims those environments. See the
[release checklist](release-checklist.md), [test coverage](test-coverage.md),
and [accessibility testing](accessibility-testing.md) for the exact evidence to
record.

Runtime capability checks still require a secure context, microphone APIs and
AudioWorklet. `isSupported` reports API availability, not a certification
result. See [editing limitations](editing-contract.md) and
[accessibility testing](accessibility-testing.md).

## Release support

VoiceInput is a prerelease community project. Issue reports and fixes are
handled on a best-effort basis; no maintenance term or support window is
promised.
