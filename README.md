# claude-kanban

A Linear-style kanban board for Claude Agent SDK runs. Each card represents a
task the agent works on inside an isolated worktree of a real local git
repository, optionally pushing a branch and opening a PR when done.

> **Origin.** This project is a port to the
> [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript)
> of the
> [`agent-kanban`](https://github.com/cursor/cookbook/tree/main/sdk/agent-kanban)
> example from the [Cursor SDK cookbook](https://github.com/cursor/cookbook)
> (MIT). The UX, the kanban-of-agent-runs idea, and several architectural
> choices come from that project. The runtime, the process model, and the
> persistence layer are different — see
> [`docs/05-relation-to-cursor-cookbook.md`](docs/05-relation-to-cursor-cookbook.md)
> for a side-by-side.

## What it does

- Create a card with a task description, a local repo path, and a base branch.
- Run an agent in a fresh `git worktree`, watching tool calls and reasoning
  stream live to the card.
- Review the resulting diff and, with one click, push the branch and open a PR
  via the GitHub CLI.

## Screenshot

> *Follow-up:* a screenshot or short GIF of the running board belongs here.
> Ship one in `docs/assets/` when a recording is convenient; this README links
> the asset rather than describes it.

## Requirements

- Node.js **22+**
- [pnpm](https://pnpm.io/) **10+** (pinned via `packageManager` in
  `package.json`)
- `git`
- Optionally [`gh`](https://cli.github.com/) — only required for the *Open PR*
  affordance. Runs themselves do not need it; pre-flight gates the button when
  `gh` is missing or unauthenticated. See
  [ADR-010](docs/03-decisions.md#adr-010-gh-cli-as-a-hard-dependency-for-pr-creation).
- An `ANTHROPIC_API_KEY` (set in the settings page or in the environment).

## Install and run

```sh
pnpm install
pnpm dev
```

Then open <http://localhost:3000>:

1. Visit `/settings` once and either paste your `ANTHROPIC_API_KEY` (written to
   `~/.claude-kanban/settings.json` with mode `0600`) or point the settings at
   an existing key file.
2. Click **New card**, paste a prompt, set the repo path and base branch, save.
3. Drag the card from **Backlog** to **Running** (or click **Run**).

You should see a worker spawn, the SDK init banner appear in the run log, then
streamed `assistant` text and `tool_use` chips. When the run finishes
successfully and produces a non-empty diff, the card moves to **Review** and
the drawer surfaces the diff plus an **Open PR** button.

Other useful scripts:

```sh
pnpm build         # tsc -p tsconfig.json
pnpm typecheck     # tsc --noEmit
pnpm lint          # eslint .
pnpm lint:all      # also runs the boundary-rule fixtures (see ADR-011)
pnpm test          # node --test across protocol/store/worker/supervisor/sse/api
pnpm cli -- --repo <path> --prompt "..."   # headless smoke test, no UI
```

## Configuration

All persistent state lives under `~/.claude-kanban/`:

```pre
~/.claude-kanban/
├── settings.json           GlobalSettings (mode 0600)
├── cards/<card_id>.json    one file per card; runs[] embedded
├── logs/<run_id>.ndjson    append-only event log per run
├── work/<run_id>/          throwaway worktree
├── diffs/<run_id>.patch    captured diff
└── traces/<run_id>.jsonl   PreToolUse trace
```

`settings.json` carries the API-key reference (inline or file path), the
default repo path, the bash allowlist, and the `gh` binary path. Path helpers
live in `src/lib/paths.ts`; nothing in the codebase hardcodes the
`~/.claude-kanban/` prefix.

## Architecture

One Next.js process owns the JSON store, REST routes, and SSE plumbing. Each
active run is a separate Node subprocess that runs `query()` from
`@anthropic-ai/claude-agent-sdk` against a `git worktree` and emits NDJSON
events over stdio; the supervisor turns those into store updates and SSE
frames. Worker and Next.js never import each other — they share only types
under `src/protocol/`, enforced by `no-restricted-imports`. See
[`docs/01-architecture.md`](docs/01-architecture.md) for the full topology and
failure-mode table, and [`docs/02-agent-sdk-usage.md`](docs/02-agent-sdk-usage.md)
for the exact SDK options in use.

## Status

All five phases have shipped a working deliverable:

- **Phase 1** — CLI smoke test that spawns a worker, runs the SDK, and prints
  events. (`pnpm cli` still works as the headless escape hatch.)
- **Phase 2** — Next.js app with one card; clicking Run streams agent output
  live into a scrollable log via SSE.
- **Phase 3** — six-column kanban with drag-and-drop, settings page, card
  detail drawer, persistent state, and cooperative cancel.
- **Phase 4** — captured diffs, PR creation via `gh`, `PreToolUse` trace, and
  a per-card `loadSkills` toggle.
- **Phase 5** — polish: ESLint module boundaries, error-state UX audit, this
  README and demo doc, and the
  [Managed Agents handoff doc](tasks/phase-5/task-04-managed-agents-handoff.md)
  (in progress).

The phase-by-phase rollup of what shipped lives in
[`docs/CHANGELOG.md`](docs/CHANGELOG.md).

## Cursor cookbook side-by-side

Same UX idea, different runtime: claude-kanban runs the Agent SDK locally with
an explicit worker subprocess and JSON-on-disk persistence, where the Cursor
example uses a hosted sandbox and Cursor's own run store. The full table of
what was kept, changed, and dropped is in
[`docs/05-relation-to-cursor-cookbook.md`](docs/05-relation-to-cursor-cookbook.md).

## Demo

A timed two-minute walkthrough script lives in
[`docs/DEMO.md`](docs/DEMO.md) — useful when showing the artifact to a
colleague or a partner-network conversation.

## Contributing / extending

This project is built to be developed *with* Claude Code; that workflow is a
deliberate meta-feature, not just an internal convention. The entry points:

- [`CLAUDE.md`](CLAUDE.md) — orientation for Claude Code (and humans) on how
  to work in this repo.
- [`tasks/`](tasks/) — phased roadmap. Each task file is sized to fit one
  Claude Code session and follows the same Goal / Inputs / Outputs /
  Acceptance / Out-of-scope shape.
- [`docs/03-decisions.md`](docs/03-decisions.md) — the ADR log; consult before
  proposing architectural changes.

## License

> *Follow-up:* this repo does not currently ship a `LICENSE` file. The Cursor
> cookbook this project ports from is MIT-licensed; the intended license for
> claude-kanban is undecided at the time of writing. Add a `LICENSE` and
> declare it here before the project is shared publicly.

## Acknowledgments

- The [Cursor team](https://cursor.com/) for publishing the
  [`agent-kanban`](https://github.com/cursor/cookbook/tree/main/sdk/agent-kanban)
  cookbook example. The kanban-of-agent-runs UX is a clean idea well executed,
  and this project owes its shape to theirs.
- [Anthropic](https://www.anthropic.com/) for the
  [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript)
  and Claude Code, which is the primary tool used to build this project.
