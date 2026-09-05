# Example projects

Choose a simulation to explore editing, or an authenticated example for real
transcription. The two authenticated projects use **OpenAI, Clerk, and
Upstash**. You can [switch providers](providers.md) after setup.

| Example          | What you can try                                   | Requirements                                                     |
| ---------------- | -------------------------------------------------- | ---------------------------------------------------------------- |
| Simulated fields | Dictation at the cursor, undo, and React Hook Form | Node.js and the repository’s pinned pnpm version; no credentials |
| Next.js          | A controlled field with a secure server route      | OpenAI key, configured Clerk app, Upstash Redis                  |
| Vite + Hono      | A React field with a separate Node API             | OpenAI key, configured Clerk app, Upstash Redis                  |

## Simulated fields

Clone the repository and run these commands from its root. This is a pnpm
workspace; the contributor workflow uses the pinned pnpm version.

```bash
git clone https://github.com/VoiceInput/voiceinput.git
cd voiceinput
corepack enable
pnpm install
pnpm build
pnpm --filter @voiceinput/example-simulated dev
```

Open `http://127.0.0.1:5174`. The first field uses the hook, and the second uses
React Hook Form. Try changing the cursor position, dictating, and undoing an
edit. This simulation never records audio or connects to a provider.
[View the example source](../examples/simulated).

## Next.js with Clerk and Upstash

Copy the [Next.js example directory](../examples/nextjs-app-router) into a
standalone project. Copy `.env.example` to `.env.local` and fill every value.
Configure Clerk for your `APP_ORIGIN`, then run inside that project:

**npm**

```bash
npm install
npm run dev
```

**pnpm**

```bash
pnpm install
pnpm run dev
```

Open the URL printed by Next.js, sign in, and try dictation. A working setup
inserts speech into the field and permits ordinary typing and undo. See the
[Next.js guide](nextjs.md) for how the parts connect.

## Vite + Hono with Clerk and Upstash

Copy the [Vite example directory](../examples/vite-hono) into a standalone
project. Copy `.env.example` to `.env.local`, fill every value, and configure
Clerk for `APP_ORIGIN`. Install dependencies and start the API:

**npm**

```bash
npm install
npm run dev:api
```

**pnpm**

```bash
pnpm install
pnpm run dev:api
```

In a second terminal in the same directory, start Vite:

**npm**

```bash
npm run dev:web
```

**pnpm**

```bash
pnpm run dev:web
```

Open the Vite URL, sign in, and try the field. Vite proxies `/api` to Hono, so
session cookies and token requests stay on the same origin. The
[Vite + Hono guide](vite-hono.md) explains this setup.

## Before deploying an example

Use HTTPS, keep provider keys server-only, and authenticate and rate-limit token
requests. Set your actual deployed origin in `APP_ORIGIN`. Review the
[deployment checklist](nextjs.md#deployment-checklist),
[Content Security Policy setup](content-security-policy.md), and
[browser support](support-policy.md). Repository maintainer playgrounds have
separate development-only authentication fixtures; use these consumer examples
for application integration.
