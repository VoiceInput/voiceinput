# VoiceInput website

Static Astro website with a React SDK simulation and a lazy Three.js sculpture.
The docs manifest in `src/lib/docs.ts` renders the repository's public Markdown
at build time. Add public pages to that explicit manifest; avoid copying guides.

```sh
pnpm --filter @voiceinput/website dev
pnpm --filter @voiceinput/website build
pnpm --filter @voiceinput/website typecheck
pnpm --filter @voiceinput/website test:e2e
pnpm --filter @voiceinput/website deploy:preview
pnpm --filter @voiceinput/website run deploy
```

The final command deploys the production custom domain `voiceinput.dev`.
Wrangler must be authenticated to the account pinned in `wrangler.jsonc`.
The preview Worker has no production domain. The website uses no provider
credentials, cookies, microphone access, or analytics. React 19 and the same
workspace SDK power the simulation. TypeScript 6 is intentionally local to this
app because Astro's checker requires its programmatic API; SDK packages use the
workspace TypeScript version.

`pnpm test:e2e` at the repository root includes these website checks. Review the
responsive screenshots produced under `output/playwright`. A custom `404.html`
handles unknown static routes. Ship the npm beta and public repository before
attaching the production domain so the installation and source links work.
