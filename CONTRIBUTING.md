# Contributing to VoiceInput

VoiceInput is an MIT-licensed TypeScript monorepo. The project uses PNPM and
Turborepo to coordinate its packages and maintainer playgrounds.

## Prerequisites

- Node.js 22.22.0 (see `.nvmrc`)
- Corepack enabled so the repository selects PNPM 11.23.0

## Setup

```bash
corepack enable
pnpm install
cp .env.example .env
```

Provider API keys are optional until provider-backed development begins. Keep
long-lived credentials in server-only environment variables. Never place them in
browser code, public-prefixed variables, fixtures, logs, or committed files.

## Workspace layout

- `packages/provider`: versioned provider contracts and conformance utilities
- `packages/core`: framework-neutral session, audio-source, and insertion
  behavior
- `packages/react`: React bindings and optional controls
- `packages/openai`: OpenAI client and server integration
- `packages/elevenlabs`: ElevenLabs client and server integration
- `packages/deepgram`: Deepgram client and server integration
- `apps/playground-next`: Next.js maintainer playground
- `apps/playground-vite`: Vite maintainer playground
- `apps/playground-api`: Fetch-standard playground API

## Commands

```bash
pnpm build
pnpm dev
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm test:browser
pnpm test:e2e
pnpm validate:packages
pnpm test:security
```

Run `pnpm format` to apply Prettier formatting. Oxlint is the only
JavaScript/TypeScript linter; do not add ESLint configuration or compatibility
packages.

`pnpm test:e2e` builds the workspace, starts both playground stacks, and runs
their deterministic fake-audio/provider flows. Maintainers with BrowserStack
credentials can run the same suite with `pnpm test:e2e:browserstack`; that
command supplements the Playwright matrix with a small WebDriver smoke on
branded current and previous macOS Safari.

`pnpm test:provider-smoke` loads an ignored root `.env` when present, mints a
short-lived credential for each provider, opens its live WebSocket, and sends
deterministic PCM without requesting a physical microphone. The Deepgram key
must have Member-or-higher permission so it can call `/v1/auth/grant`.

Run `pnpm changeset` for user-visible package work. The six public packages are
versioned as one fixed group until 1.0. Publishing is manual and must follow the
[release checklist](docs/release-checklist.md).
