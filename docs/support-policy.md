# Browser and runtime support

Check these requirements before enabling dictation in an application.

| Environment  | Requirement                                                           |
| ------------ | --------------------------------------------------------------------- |
| React        | React 18.2+ or 19                                                     |
| Node.js      | Maintained releases starting at Node.js 22                            |
| TypeScript   | 5.7+ for published declarations; optional for JavaScript applications |
| Browser APIs | Secure context, `getUserMedia`, `AudioContext`, and `AudioWorklet`    |

`isSupported` checks browser API availability. It cannot determine microphone
permission, device health, or provider availability.

## What is tested

- Editing and form behavior runs in Playwright Chromium, Firefox, and WebKit.
- Chromium covers microphone APIs, AudioWorklet, and strict CSP behavior.
- Package entries load as ESM and CommonJS on supported Node.js versions.
- Published types compile with React 18.2+ or 19.
- Manual Safari/iOS microphone and screen-reader testing is ongoing.

WebKit automation does not establish Safari microphone behavior. See
[troubleshooting](troubleshooting.md) for permissions and device recovery.

The latest VoiceInput 0.x release receives fixes.
