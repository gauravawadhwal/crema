# Agent instructions

The project notes for coding agents live in [CLAUDE.md](CLAUDE.md). They cover what Crema is, the repo layout, commands, conventions and the pitfalls already hit.

Then read [docs/architecture.md](docs/architecture.md) and [docs/design.md](docs/design.md).

The workflows in `.claude/skills/` are plain Markdown and any agent can follow them:
- `verify-crema`: checks to run before calling a change done.
- `refresh-demo-assets`: regenerating the demo data, screenshots, recording and site.
