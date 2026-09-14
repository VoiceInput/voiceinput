# Vite + Hono example

This full-stack example keeps the browser and API same-origin through Vite's
development proxy. Clerk authenticates the application user, Upstash Redis
enforces a durable subject quota, and the browser receives only a short-lived
OpenAI credential.

Copy `.env.example` to `.env.local`, fill every value, then run these in two
terminals:

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

**npm**

```bash
npm run dev:web
```

**pnpm**

```bash
pnpm run dev:web
```

Configure Clerk for `APP_ORIGIN`. Open `http://localhost:5173`, sign in, and try
dictation. In production, serve the built Vite assets and `/api/voice-token`
from one HTTPS origin. Before deployment, review
[Browser and runtime support](../../docs/support-policy.md).
