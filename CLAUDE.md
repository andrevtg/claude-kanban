# Claude Code Orientation

You are working on `claude-kanban`, a kanban UI for runs of the Claude Agent SDK. This file is your entry point. Read it fully before doing anything else.

## What this project is

A Next.js app that lets a developer:

1. Add a card describing a task ("fix the auth token expiry bug").
2. Pick a local git repo and a branch to base the work on.
3. Spawn a Claude Agent SDK run in a separate Node worker process; the worker clones the repo into a temp working directory, lets Claude work, and streams events back.
4. See the run progress live on the kanban card; on completion, optionally push a branch and open a PR via GitHub CLI (`gh`).

The architectural reference is the Cursor `agent-kanban` cookbook example, but the runtime is the Claude Agent SDK in **local** mode (no Anthropic-hosted sandbox), and execution happens in a worker subprocess for isolation.

## How to work in this repo

**Read these first, in order:**

1. `docs/00-overview.md` — what we're building
2. `docs/01-architecture.md` — how it fits together
3. `docs/02-agent-sdk-usage.md` — exact SDK surfaces in use
4. `tasks/README.md` — phased roadmap

**Then start with the lowest-numbered unfinished task in `tasks/`.**

Each task file follows this shape:

- **Goal** — single-paragraph statement
- **Inputs** — files you should read first
- **Outputs** — files you must create or change
- **Acceptance** — how to verify it's done
- **Out of scope** — what NOT to do in this task

Do one task per session. After finishing a task, mark it done by appending `**STATUS: done**` to the top of the task file and adding a one-line entry to `docs/CHANGELOG.md`.

## Hard rules

- **TypeScript strict mode.** No `any` without an inline `// reason: ...` comment.
- **No silent failures.** If something can fail, surface it on the card's event log.
- **The worker process never imports from the Next.js app, and vice versa.** They communicate via the protocol defined in `src/protocol/`. Treat that as a hard module boundary.
- **JSON store is the source of truth for card state.** The Next.js process owns reads/writes; workers send events, the parent applies them.
- **Do not pull in extra dependencies without updating `docs/01-architecture.md` first.** The dependency surface is part of the architecture.
- **No tests for the UI layer in phase 1–2.** Tests for the protocol, store, and worker are required.

## Conventions

- Use `pnpm`. The repo's package manager is pinned in `package.json` once Phase 1 lands.
- Commit messages: `phase-N: <imperative summary>`. One commit per task is fine.
- Card IDs are `card_` + ULID. Run IDs are `run_` + ULID. Generate via `ulid` package.
- Paths under `~/.claude-kanban/` are referenced via the `paths.ts` helper, never hardcoded.

## What you should NOT do

- Do not start implementing the Managed Agents version. That's a separate project, deliberately deferred.
- Do not add authentication, multi-user support, or remote deployment concerns. This is a local single-user tool.
- Do not add a database. JSON files are the chosen persistence; that decision is closed.
- Do not skip the worker process and run the SDK in-process in Next.js. The process boundary is the whole point.

## When you're stuck

Stop and write your question into `docs/QUESTIONS.md` with the date and task number. Don't guess at architectural decisions; surface them.
