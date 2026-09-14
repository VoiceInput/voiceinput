# Troubleshooting

Check `voice.error.code` when recording or insertion fails. The same error is
available to `onError`.

| Error or symptom                                | First thing to check                                |
| ----------------------------------------------- | --------------------------------------------------- |
| `unsupported-browser` or disabled control       | HTTPS, microphone APIs, and AudioWorklet            |
| `user-activation-required`                      | Start again from a direct button or keyboard action |
| `permission-denied`                             | Site and operating-system microphone permissions    |
| `device-not-found` / `device-busy`              | Connected microphone and other apps using it        |
| `unauthorized`, HTTP 401/403                    | Sign-in session, cookies, and configured origin     |
| `rate-limited`, HTTP 429                        | Retry delay and the application's quota             |
| `token-error`                                   | Server environment and provider credential response |
| `network-error`                                 | Token endpoint, WebSocket, proxy, and CSP           |
| `audio-error`                                   | Microphone capture and AudioWorklet loading         |
| `provider-error`                                | Provider status and server diagnostics              |
| `invalid-configuration` / `unsupported-feature` | The selected [provider's options](providers.md)     |

Display `getVoiceInputErrorMessage(error)` from `@voiceinput/react` when the
user needs an explanation. Keep `error.message` and `error.cause` for local
diagnostics because they can contain implementation detail.

## The control is disabled

VoiceInput needs a secure context, `navigator.mediaDevices.getUserMedia`,
`AudioContext`, and `AudioWorklet`. Localhost is normally treated as secure for
development. `getBrowserVoiceInputSupport()` from `@voiceinput/core` lists
missing capabilities.

For an embedded application, confirm the top-level `Permissions-Policy` allows
microphone access for the frame's origin.

## Permission is denied

- Start from a real click, pointer press, Enter, or Space action.
- Check the site's microphone permission in browser settings.
- Check the operating system's microphone privacy settings.
- Reload after changing a denied permission if the browser requires it.
- On iOS, check Safari's per-site microphone setting.

VoiceInput asks for permission only when recording starts.

## No microphone or a busy device

Reconnect the input, close applications that may hold it, and retry from a fresh
user action. `device-not-found` means no usable input was available.
`device-busy` means another application, driver, or policy blocked capture.

## Safari starts late or stops in the background

Start recording directly from a user action. Avoid calling `start()` from an
effect or delayed callback that has lost user activation. On iOS, start on an
HTTPS page in the foreground. If backgrounding interrupts capture, start a new
session after returning instead of reusing the old one.

Safari microphone testing is manual and ongoing. See
[browser support](support-policy.md) for the current scope.

## The token endpoint returns 401 or 403

- Keep the endpoint same-origin when using cookie sessions.
- Confirm the session cookie reaches the endpoint.
- Check cookie `Secure`, `SameSite`, domain, and path settings.
- Compare `Origin` to the configured application origin.

For an intentional cross-origin session, supply a custom provider `fetch` with
`credentials: "include"` and configure credentialed CORS for the exact browser
origin. Official adapters otherwise use `credentials: "same-origin"`.

## Credentials expire or opening fails intermittently

Official adapters request a fresh temporary credential for each session. Do not
cache token-handler responses; they include `Cache-Control: no-store`. If a
credential sits unused before the provider socket opens, begin a new session.

## Rate limits

`rate-limited` may come from your application or the provider. Respect
`error.retryAfterMs` when present. Store production quotas in shared durable
storage so every server instance sees the same limit.

## Network, provider, and audio failures

Inspect the token endpoint status, server diagnostics, and browser WebSocket.
Check CSP `connect-src`, proxies, VPNs, blockers, and provider status. Never log
provider keys or issued credentials.

If capture reports `audio-error`, check for a blocked AudioWorklet request. A
strict policy can use the documented
[same-origin worklet](content-security-policy.md).

VoiceInput keeps final text already received. If graceful provider finalization
times out, it preserves the last interim text as a fallback in the field and
`finalTranscript`.

## Text appears in the wrong place

- Spread `voice.getTriggerProps()` onto the real activation button so selection
  is captured before focus changes.
- Attach `voice.targetRef` to a supported native input or textarea.
- Keep a controlled native field's ordinary `onChange` and pass `value` with
  `onValueChange` to the hook.
- Avoid unsupported input types such as `email`, `number`, and `date`.

If the user edits or moves the caret during dictation, VoiceInput freezes text
it can no longer prove ownership of and inserts later phrases at the new caret.
Use `voice.getTextSnapshot()` in development to inspect the selection and owned
spans.
