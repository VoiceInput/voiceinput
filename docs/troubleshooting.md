# Troubleshooting

If recording or text insertion fails, check `voice.error.code`. The same error
is available in the `onError` callback. Use the code to choose a recovery
action; error messages may change between releases.

| Error or symptom                                | First thing to check                                          |
| ----------------------------------------------- | ------------------------------------------------------------- |
| `unsupported-browser` or disabled control       | HTTPS, microphone APIs, and AudioWorklet                      |
| `permission-denied`                             | Site and operating-system microphone permissions              |
| `device-not-found` / `device-busy`              | Connected microphone and other apps using it                  |
| `unauthorized`, HTTP 401/403                    | Sign-in session, cookies, and configured origin               |
| `rate-limited`, HTTP 429                        | Retry delay and your app’s quota                              |
| `token-error`                                   | Server environment variables and provider credential response |
| `network-error`                                 | Token endpoint, WebSocket connection, and CSP                 |
| `audio-error`                                   | Microphone capture and AudioWorklet loading                   |
| `provider-error`                                | Provider settings, server logs, and provider status           |
| `invalid-configuration` / `unsupported-feature` | Option values and the selected provider’s supported settings  |

Inspect `error.cause` in local developer diagnostics when you need more detail.
Do not display raw provider or browser errors to end users.

## The control is disabled or `isSupported` is false

VoiceInput requires all of the following:

- a secure context (`https:`), except browser localhost exceptions
- `navigator.mediaDevices.getUserMedia`
- `AudioContext`
- `AudioWorklet`

Use `getBrowserVoiceInputSupport()` from `@voiceinput/core` to list missing
capabilities. Do not attempt microphone access from an insecure embedded frame.
If the application is framed, verify the top-level `Permissions-Policy` allows
microphone access for the frame's origin.

## Permission is denied

`permission-denied` means the browser or operating system rejected access.

- Trigger recording from a real click, pointer press, Enter, or Space event.
- Check the site's microphone permission in browser settings.
- Check the operating system's microphone privacy settings.
- After changing permission, reload the page; browser behavior after a denial
  differs.
- On iOS, also verify Safari's per-site microphone setting.

VoiceInput requests permission only during activation. It does not prompt on
mount.

## No microphone or a busy device

- `device-not-found`: the browser found no usable audio input.
- `device-busy`: another application, tab, exclusive driver, or operating system
  policy prevented capture.
- `audio-error`: capture or AudioWorklet setup failed for another reason.

Disconnect/reconnect the device, close competing applications, and retry from a
fresh user gesture. Preserve `error.cause` in local development logs; do not
show raw browser errors to end users.

## Safari starts late or does not start

Safari may create a suspended `AudioContext`. VoiceInput resumes it inside the
activation path, but the start still must follow a user gesture. Avoid calling
`start()` from an effect, timer, or promise chain that has lost user activation.

On iOS Safari:

- test on HTTPS or localhost
- avoid starting while the page is backgrounded
- expect capture to be interrupted when the tab or app backgrounds
- let VoiceInput stop and start a new session after returning to the foreground
  instead of assuming the old socket/microphone survived

## The token endpoint returns 401 or 403

The required `authorize(request)` callback returned `null` or your surrounding
server rejected the request.

- Keep the token endpoint same-origin when using cookie sessions.
- Confirm session cookies reach the endpoint.
- Check cookie `Secure`, `SameSite`, domain, and path settings.
- If cross-origin cookie auth is intentional, pass the provider factory a custom
  `fetch` wrapper using `credentials: "include"`, and configure credentialed
  CORS for the exact browser origin. Official adapters otherwise use
  `credentials: "same-origin"`.

Do not remove authorization to make the error disappear.

## Credentials expire or opening fails intermittently

Official adapters request a fresh short-lived credential for every session. Do
not cache token-handler responses; they include `Cache-Control: no-store`.

If the browser receives a token but waits too long before opening the provider
socket, start a new session so the adapter requests another credential. Confirm
that server and client clocks are reasonably synchronized and that proxies are
not caching `POST` responses.

## Rate limits

`rate-limited` may come from your application `rateLimit` hook or the provider.
Use `error.retryAfterMs` when present. Production quota state should live in a
durable shared store; an in-memory map is unsafe across serverless or
multi-instance deployments.

## Network and provider failures

- `network-error`: the token endpoint or realtime connection could not be
  reached; it is normally retryable.
- `token-error`: the endpoint or provider failed to issue a valid credential.
- `provider-error`: the realtime provider rejected the session, sent malformed
  output, or closed unexpectedly.

Inspect the token endpoint's HTTP status and server logs, then the browser's
WebSocket connection. Check CSP `connect-src`, proxies, VPNs, ad blockers, and
provider status. Never log the provider key or issued client credential.

If microphone permission succeeds but setup reports `audio-error`, check for a
blocked AudioWorklet request. The default path needs `blob:` in the effective
script policy; a strict policy can use the documented
[same-origin worklet path](content-security-policy.md) instead.

VoiceInput preserves provider-finalized text already received. It discards
untrusted provisional text if graceful provider finalization times out.

## An option fails before the permission prompt

This is intentional. Core and adapter validation runs before audio preparation.
`invalid-configuration` means the value is malformed. `unsupported-feature`
means the value is well formed but the selected model/provider cannot implement
that portable option faithfully, including provider-specific capability limits.

Treat `code` as the stable branching contract; messages are diagnostic and may
improve between releases. `provider`, `retryable`, and `retryAfterMs` add
provider identity and retry guidance, while `cause` is for debugging rather than
application control flow.

Review the selected provider README:

- [OpenAI](../packages/openai/README.md)
- [ElevenLabs](../packages/elevenlabs/README.md)
- [Deepgram](../packages/deepgram/README.md)

## Text appears in the wrong place

- Spread `voice.getTriggerProps()` onto the real activation button so selection
  is captured before focus changes.
- For native controlled fields using the hook, pass `value` and `onValueChange`
  and keep the field’s ordinary `onChange` handler for typing. Controlled
  `VoiceInput` and `VoiceTextarea` wrappers use `onValueChange` for both typing
  and dictation; they do not need a second state setter.
- Do not use unsupported input types such as `email`, `number`, or `date`.
- If the user edits or moves the caret during dictation, VoiceInput deliberately
  freezes text it can no longer prove ownership of and re-anchors later speech.

Use `voice.getTextSnapshot()` in a development inspector to see the current
selection and owned spans.

## Development playground login or quota behavior

The repository playgrounds use a loopback-only signed cookie fixture and
maintainer controls for unauthorized and expired states. The fixture is disabled
in production and is **not production authentication or rate limiting**.
Application integrations must use their real identity and durable quota systems.
