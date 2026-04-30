# Roadmap

Five phases. Each phase is a working deliverable, not a code-complete milestone.

## Phase 1 — Skeleton that runs an agent (no UI)

The smallest thing that proves the worker architecture: a CLI entry point that takes a repo path and a prompt, spawns a worker, runs the SDK, and prints events. No Next.js, no kanban, no PR.

- `phase-1/task-01-init-monorepo.md`
- `phase-1/task-02-protocol-types.md`
- `phase-1/task-03-store.md`
- `phase-1/task-04-worker-skeleton.md`
- `phase-1/task-05-supervisor.md`
- `phase-1/task-06-cli-smoke-test.md`

**Done when:** `pnpm cli run --repo ~/some-repo --prompt "summarize the README"` spawns a worker, runs the SDK, and prints assistant text and tool calls to the terminal.

## Phase 2 — Next.js app with one card

Replace the CLI with a minimal web app. One hardcoded card, no DnD, no settings UI. SSE streams events to the browser.

- `phase-2/task-01-nextjs-bootstrap.md`
- `phase-2/task-02-route-handlers.md`
- `phase-2/task-03-sse.md`
- `phase-2/task-04-event-log-component.md`

**Done when:** Browser shows a single card; clicking "Run" spawns a worker and streams agent output live into a scrollable log.

## Phase 3 — Real kanban

Multiple cards, drag-and-drop between columns, settings page, persistent state across reloads.

- `phase-3/task-01-card-crud.md`
- `phase-3/task-02-dnd-columns.md`
- `phase-3/task-03-settings-page.md`
- `phase-3/task-04-card-detail-drawer.md`
- `phase-3/task-05-cancel-and-cleanup.md`

**Done when:** A user can create, edit, delete, and drag cards. State survives reload. Cancel button works.

## Phase 4 — PR flow and quality of life

Diff display, PR creation via `gh`, hooks for tool tracing, basic skill loading.

- `phase-4/task-01-git-diff.md`
- `phase-4/task-02-gh-pr-create.md`
- `phase-4/task-03-pretooluse-hook.md`
- `phase-4/task-04-skill-loading-toggle.md`

**Done when:** A successful run produces a PR URL on the card. Users can opt to load `.claude/skills/` from the target repo.

## Phase 5 — Polish

Lint rules enforcing module boundaries, error UX, README/demo, and a deliberate handoff doc to the eventual Managed Agents version.

- `phase-5/task-01-eslint-boundaries.md`
- `phase-5/task-02-error-states.md`
- `phase-5/task-03-readme-and-demo.md`
- `phase-5/task-04-managed-agents-handoff.md`

**Done when:** Project is demoable end-to-end and has a written plan for the cloud port.

---

## Working rules

- Don't skip phases.
- Don't combine tasks within a phase. Each is meant to fit in one Claude Code session.
- If a task turns out wrong-sized (too big, too small, or blocked), update the task file and write a note in `docs/QUESTIONS.md`.
- Update `docs/CHANGELOG.md` after every completed task.
