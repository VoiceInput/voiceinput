# VoiceInput website

Astro website with a live microphone demo, a Cloudflare Worker relay, and
Starlight documentation. The manifest in `src/lib/docs.ts` defines the public pages,
descriptions, and sidebar order.

Edit documentation in the repository Markdown files listed in that manifest.
`scripts/sync-docs.mjs` generates ignored MDX files before Astro loads content
and watches the sources during development. It maps repository links to public
docs routes and turns adjacent **npm** / **pnpm** fenced command blocks into
Starlight tabs. Use that format when adding consumer commands. Package-manager
selection persists across the homepage and docs. Keep workspace contributor
commands pnpm-only.

The quickstart lives in `docs/quickstart.md`; the README links to it. Do not
edit `src/content/docs/` directly. Search is indexed by Pagefind during the
production build; verify it using the built preview.

```sh
pnpm --filter @voiceinput/website dev
pnpm --filter @voiceinput/website build
pnpm --filter @voiceinput/website preview
pnpm --filter @voiceinput/website typecheck
pnpm --filter @voiceinput/website test:server
pnpm --filter @voiceinput/website test:e2e
pnpm --filter @voiceinput/website deploy:preview
pnpm --filter @voiceinput/website run deploy
```

The full local preview runs at `http://127.0.0.1:4322/`. Build first, then run
`preview`; keep it running while using `dev` at port 4321 for hot reload.
Astro proxies demo requests to the local Worker. `astro preview` alone does not
run the demo server.

The landing page's code tabs read `src/examples/` as raw source. Those files
are also typechecked by Astro; `app-auth.d.ts` describes the consuming app's
authentication and quota helpers, with full implementations linked from each
server example. Hono is a development dependency for checking its example;
the examples are not executed or bundled into the browser.

Vite caches are separated by Astro command under `node_modules/.vite/`.
Astro's build and sync steps can prebundle production React, so sharing their
cache with a running dev server can break hydration (`_jsxDEV` is undefined).
Keep this separation when changing the build configuration.

## Live demo credentials and limits

Put `OPENAI_API_KEY` in the website's ignored `.dev.vars` for local development.
The browser receives only a short-lived, single-use demo ticket. Both the
long-lived API key and OpenAI's temporary credential stay in the Worker. The
server uses the official OpenAI adapter; a small browser adapter transports
PCM16 and transcript events through the relay.

The relay permits 20 seconds / 960,000 bytes of audio, with separate 10-second
connection and finalization deadlines. SQLite-backed Durable Object storage
limits grants to 3 per IP per hour, 6 per IP per UTC day, and 100 across the demo
per UTC day. It permits at most 4 concurrent sessions, one per IP. Grants count
even if unused. Refreshing the page or restarting the Worker does not reset
these budgets. Limits live in `worker/limits.ts` and `src/lib/demo-config.ts`.

Audio and transcripts are streamed in memory and are never logged or stored.
Quota records use a salted daily hash of the Cloudflare-provided IP address;
expired records are pruned on subsequent requests. The SDK's normal direct
browser-to-provider connection is unchanged. The site uses no analytics.
Package-manager and theme preferences use browser local storage.

## Deploying

The production command deploys `voiceinput.dev`. Wrangler must be authenticated
to the account pinned in `wrangler.jsonc`. Before deploying this revision, set
the server secret separately for each environment:

```sh
pnpm --filter @voiceinput/website exec wrangler secret put OPENAI_API_KEY --env=""
pnpm --filter @voiceinput/website exec wrangler secret put OPENAI_API_KEY --env production
```

For a hosted preview, set its exact HTTPS origin in `DEMO_ORIGINS`; the default
preview configuration intentionally permits only local development URLs.
Production permits only `https://voiceinput.dev`. Both configurations route
`/api/demo/*` through the Worker. The Durable Object migration provisions persistent
quota storage on deployment. The Worker-only alias for the OpenAI server entry
avoids Wrangler's browser export condition; it must never be added to Astro.

Run `wrangler types worker/env.d.ts --include-runtime=false` after changing
bindings. TypeScript 6 is local to this app because Astro's checker requires its
programmatic API; SDK packages use the workspace TypeScript version.

`pnpm test:e2e` at the repository root includes these website checks. Review the
responsive screenshots produced under `output/playwright`. A custom `404.html`
handles unknown static routes. Ship the npm beta and public repository before
attaching the production domain so the installation and source links work.
