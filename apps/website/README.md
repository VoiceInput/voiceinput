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

Set `OPENAI_API_KEY` in the ignored `apps/website/.dev.vars`, then run
`pnpm --filter @voiceinput/website dev`. This one command builds workspace
dependencies and website assets, starts the local Worker on port 4322, checks
configuration and Durable Object storage, then starts Astro with hot reload at
`http://127.0.0.1:4321/`. The backend has 30 seconds to become ready. The check
never calls OpenAI or consumes demo quota; a configured key still needs to be
valid for actual transcription.

Both ports are fixed. Stop any existing `dev` or `preview` process first; the
launcher will not reuse unknown servers. Ctrl+C stops both services and their
child processes. If either service exits, the launcher stops the other and
reports the failure. Correct the error and rerun `dev`.

For a production-build preview, build first and run `preview` on its own at
`http://127.0.0.1:4322/`. Do not run it alongside `dev`. Running Astro directly
starts only the frontend and cannot power the demo without the Worker.

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
ticket is a bearer capability and is not bound to the WebSocket connection’s IP:
HTTP and WebSocket requests can take different network routes. Concurrency and
usage are always charged to the original issuer. Origin checks, unpredictable
tickets, 60-second expiry, and atomic single-use consumption remain enforced. The
server uses the official OpenAI adapter; a small browser adapter transports
PCM16 and transcript events through the relay.

The relay permits 20 seconds / 960,000 bytes of audio, with a separate 10-second
connection deadline and a 30-second finalization deadline. Microphone capture
stops immediately on Stop; the browser allows five additional seconds for the
server result to arrive. The 20-second recording allowance is unchanged. SQLite-backed Durable Object storage
limits recordings to 30 per IP per hour, 100 per IP per UTC day, and 1,000 across the demo
per UTC day. It permits at most 4 concurrent sessions, one per IP. Grants reserve allowance atomically; the first audio frame commits it.
Empty sessions, failed startups, and busy handshakes return their reservation, and unused tickets
return it when they expire after 60 seconds. A separate 30-attempts-per-minute
IP limit protects against repeated failed connections. Refreshing the page or restarting the Worker does not reset
these budgets. Startup can retry once before sending audio; quota responses
are not automatically retried. Limits live in `worker/limits.ts` and `src/lib/demo-config.ts`.

Audio and transcripts are streamed in memory and are never logged or stored.
Fixed relay error messages, connection phase, elapsed time, received/forwarded audio duration, and transcript
event counts are logged for diagnostics; provider payloads and credentials are excluded.
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

## Demo reliability checks

`pnpm --filter @voiceinput/website test:dev` exercises the development launcher,
fixed ports, missing configuration, cleanup, restart, and the real local Worker
and WebSocket relay. It uses an isolated test-only transcription adapter and
storage, requires no OpenAI credentials, and must run with ports 4321/4322 free.
The fixture is selected only by a temporary test Wrangler config; it is never
included in the production configuration.

Run the real Worker with the local OpenAI secret, then exercise the landing-page
button and repeat recordings in each browser. Only microphone input is replaced
with the repository's prerecorded speech sample; HTTP, WebSocket, the SDK,
transcription, and microphone cleanup all run normally.

```sh
node apps/website/scripts/check-demo.mjs --origin http://127.0.0.1:4323 --browser all --runs 3
node apps/website/scripts/check-demo-admission.mjs http://127.0.0.1:4323
node apps/website/scripts/check-demo.mjs --origin http://127.0.0.1:4321 --browser all --runs 3 --record-seconds 10
node apps/website/scripts/check-demo.mjs --origin https://voiceinput.dev --runs 5 --connections 20
```

The admission check is local-only: it changes trusted proxy addresses between
ticket issuance and WebSocket connection and opens eight simultaneous sessions.
The live check uses production quota and provider audio. Its report is written to
`output/playwright/demo-reliability-<host>-<browser>.json`. Each recording must receive a fresh
`ready`, final transcript, and `finished` event; leftover text cannot pass a run.
