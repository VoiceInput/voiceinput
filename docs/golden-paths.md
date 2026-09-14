# Example projects

Run the simulation to explore editing without credentials, or choose a
full-stack example for real transcription.

| Example                | What you can try                                   | Requirements                                            |
| ---------------------- | -------------------------------------------------- | ------------------------------------------------------- |
| Simulated fields       | Cursor insertion, undo, and React Hook Form        | Repository workspace; no microphone or provider account |
| Full-stack Next.js     | Controlled field, Clerk session, and Upstash quota | OpenAI, Clerk, and Upstash accounts                     |
| Full-stack Vite + Hono | React field with a separate Node API               | OpenAI, Clerk, and Upstash accounts                     |

## Simulated fields

Clone the repository and run the example from the workspace root:

```bash
git clone https://github.com/VoiceInput/voiceinput.git
cd voiceinput
corepack enable
pnpm install
pnpm build
pnpm --filter @voiceinput/example-simulated dev
```

Open `http://127.0.0.1:5174`. The first field uses the hook, and the second uses
React Hook Form. The simulation never records audio or connects to a provider.
[View its source](../examples/simulated).

## Full-stack Next.js example

Copy the [Next.js example](../examples/nextjs-app-router) into a standalone
project. Copy `.env.example` to `.env.local`, fill each value, and configure
Clerk for `APP_ORIGIN`.

```bash
pnpm install
pnpm dev
```

Open the URL printed by Next.js, sign in, and try dictation. See the
[Next.js guide](nextjs.md) for the route, provider, and field setup.

## Full-stack Vite + Hono example

Copy the [Vite + Hono example](../examples/vite-hono) into a standalone project.
Copy `.env.example` to `.env.local`, fill each value, and configure Clerk for
`APP_ORIGIN`.

```bash
pnpm install
pnpm dev:api
```

In a second terminal, run `pnpm dev:web`. Open the Vite URL, sign in, and try
the field. Vite proxies `/api` to Hono so session cookies stay same-origin. See
the [Vite + Hono guide](vite-hono.md) for the full setup.

## Before deployment

Use HTTPS, keep provider keys server-only, authenticate and rate-limit token
requests, and set the deployed origin in `APP_ORIGIN`. Review the
[deployment checklist](nextjs.md#deployment-checklist),
[Content Security Policy guide](content-security-policy.md), and
[browser support](support-policy.md).
