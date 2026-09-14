# Changesets

Run `pnpm changeset` for a user-visible package change. All six public packages
are a fixed group, so a bump to one package bumps the complete suite to the same
version.

Publish stable 0.x releases on `latest`. The protected publish workflow is
manual; follow the [release checklist](../docs/maintainers/release-checklist.md)
after the version PR merges and npm trusted publishers are configured.
