# Changesets

Run `pnpm changeset` for a user-visible package change. All six public packages
are a fixed group until the first stable release, so a bump to one package bumps
the complete suite to the same version.

Keep releases on the `0.x` line while the product-readiness criteria remain
open. The protected publish workflow is intentionally manual; do not invoke it
until the release checklist is complete and npm trusted publishers are set up.
