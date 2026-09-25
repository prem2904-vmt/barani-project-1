<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->

## New-design UI pattern (REQUIRED)
- All new-design screens MUST follow `docs/ND-PATTERN.md` and use the nd-kit
  (`apps/lms/src/app/shared/styles/_nd-kit.scss` global classes, `_nd-mixins.scss`).
- Canonical example: Order & Payments (`apps/lms/src/app/features/frontdesk/order-create/`).
- Non-negotiables: primary gradient ONLY on the single main CTA; the band is the same on
  every step and its pill is the context bar; band + main card + side card layout; slate
  toggles; neutral selected states; no truncation when there is room; one row per search
  result; web vs touch search modes; the bottom navbar is ALWAYS visible (layouts fit above
  it, never hide it); phone bottom bar / 92dvh sheet above the nav;
  spring motion with reduced-motion off; SVG stroked icons (no emoji); no native controls;
  ONE font (Noto Sans, tabular numbers for IDs — never monospace); palette = violet +
  neutrals/slate only (no green/teal decoration; exceptions: tube caps, blood fill, red
  Urgent / validation, amber unpriced/required dot).
