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

- `packages/core`: framework-neutral session and browser behavior
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
pnpm run pack
```

Run `pnpm format` to apply Prettier formatting. Oxlint is the only
JavaScript/TypeScript linter; do not add ESLint configuration or compatibility
packages.
