# Next.js App Router example

This full-stack example uses a controlled textarea, Clerk session
authentication, exact-origin CSRF checking, and an Upstash Redis-backed quota
before OpenAI issues a short-lived browser credential.

`proxy.ts` runs Clerk middleware for application routes.

Copy `.env.example` to `.env.local`, fill every value, then run:

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

Configure Clerk for `APP_ORIGIN`. Keep every non-`NEXT_PUBLIC_` value on the
server. In production, serve the app over HTTPS and keep `/api/voice-token`
same-origin. Before deployment, review
[Browser and runtime support](../../docs/support-policy.md).
