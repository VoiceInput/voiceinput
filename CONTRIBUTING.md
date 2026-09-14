# Contributing to VoiceInput

VoiceInput is an MIT-licensed TypeScript monorepo built with pnpm and Turborepo.

## Prerequisites

- Node.js 22.22.0 via `.nvmrc`; root and package `engines` require Node.js
  22.18+
- Corepack enabled so the repository selects pnpm 11.23.0

## Setup

```bash
corepack enable
pnpm install
cp .env.example .env
```

Provider keys are optional until you work on a live integration. Keep them in
server-only environment variables and out of browser code, fixtures, logs, and
committed files.

## Workspace layout

- `packages/provider`: provider contracts, transport utilities, and conformance
  cases
- `packages/core`: framework-neutral sessions, browser audio, and text editing
- `packages/react`: React bindings and optional controls
- `packages/openai`, `packages/elevenlabs`, `packages/deepgram`: provider
  adapters
- `apps/website`: the documentation site and live demo
- `apps/playground-next`: Next.js maintainer playground
- `apps/playground-vite`: Vite maintainer playground
- `apps/playground-api`: Fetch-standard playground API
- `apps/playground-auth`: shared development authentication fixture
- `apps/playground-shared`: shared playground components and utilities
- `examples`: runnable consumer integrations and the credential-free simulation

The playgrounds contain development fixtures for contributors; application
integrations should follow the public guides and examples.

## Commands

```bash
pnpm build
pnpm dev
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:browser
pnpm test:a11y
pnpm test:e2e
pnpm test:voice-live
pnpm test:provider-smoke-suite
pnpm test:secrets
pnpm test:security
pnpm validate:packages
pnpm generate:worklet
```

Run `pnpm format` to apply Prettier formatting. Oxlint is the JavaScript and
TypeScript linter.

Live provider commands load an ignored root `.env` when present. The Deepgram
credential needs permission to create temporary grants. BrowserStack checks are
available through `pnpm test:e2e:browserstack` when credentials are configured.

Run `pnpm changeset` for user-visible package changes. The six public packages
are versioned as one fixed group. Maintainers can find release and validation
procedures in [docs/maintainers](docs/maintainers/README.md).
