# Minimal Next.js App Router example

This is a consumer-sized integration, separate from the maintainer playground.
It uses a controlled textarea, Clerk session authentication, exact-origin CSRF
checking, and an Upstash Redis-backed quota before OpenAI issues a short-lived
browser credential.

Copy `.env.example` to `.env.local`, fill every value, then run:

```bash
npm install
npm run dev
```

Configure Clerk for `APP_ORIGIN`. Keep every non-`NEXT_PUBLIC_` value on the
server. In production, serve the app over HTTPS and keep `/api/voice-token`
same-origin. Before deployment, review the repository's
[browser and security requirements](../../docs/golden-paths.md).
