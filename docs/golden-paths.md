# Golden paths

The small examples below are consumer integrations, not maintainer test labs:

- [Next.js App Router with Clerk and Upstash](../examples/nextjs-app-router)
- [Vite + Hono with Clerk and Upstash](../examples/vite-hono)

Both teach the same order:

1. Keep the textarea under ordinary application state.
2. Give VoiceInput the field ref plus controlled `value` and `onValueChange`.
3. Keep the provider object stable outside the component.
4. Authenticate and rate-limit the application user before minting.
5. Keep the token endpoint same-origin and the long-lived provider key on the
   server.

Provider selection changes the browser factory, token handler, and environment
key—not field ownership. See the
[authentication recipes](authentication-recipes.md) to adapt an existing Clerk,
Auth.js, Supabase, or Better Auth session.

Voice capture needs a user gesture, microphone permission, and a secure context
with `getUserMedia`, `AudioContext`, and `AudioWorklet`; use HTTPS in production
and localhost during development. Keep the token endpoint same-origin,
authenticate and durably rate-limit it, and expose only a short-lived provider
credential to the browser. Review the
[deployment checklist](nextjs.md#deployment-checklist),
[strict-CSP setup](content-security-policy.md), and
[permission/browser troubleshooting](troubleshooting.md) before deployment.
