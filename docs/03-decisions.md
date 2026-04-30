# 03 — Decisions log

Lightweight ADR-style log. Each decision: context, choice, alternatives, rationale, date. Append-only.

---

## ADR-001: Worker subprocess per run, not in-process

**Date:** 2026-04-30
**Status:** accepted

**Context.** The Agent SDK's `query()` is long-running and itself spawns a Claude Code subprocess. Running it inside a Next.js route handler couples the agent's lifecycle to the web server's, blocks the request thread, and turns any SDK crash into an outage.

**Decision.** Each run executes in its own Node subprocess, supervised by Next.js. Communication is NDJSON over stdio.

**Alternatives considered.**
- *In-process.* Simpler, but unacceptable failure-blast-radius; also breaks the analogy with Managed Agents that we want to maintain.
- *Worker threads.* Shares memory and crash domain with the web server. Not enough isolation.
- *External queue (BullMQ/Redis).* Overkill for single-user local. Re-evaluate if we ever go multi-user.

**Trade-offs.** More IPC complexity; slower start (~200ms to spawn). Acceptable.

---

## ADR-002: JSON files for persistence

**Date:** 2026-04-30
**Status:** accepted

**Context.** Need to persist cards, run history, and event logs. Options span SQLite (Prisma), Postgres, and flat files.

**Decision.** Cards and settings as JSON documents under `~/.claude-kanban/`. Event logs as append-only NDJSON, one file per run.

**Alternatives.**
- *SQLite via Prisma.* Better querying, schema migrations. But adds a build step (Prisma client generation), and we don't have queries that benefit from SQL.
- *Postgres.* Cloud-native, matches the team's stack. Wrong tool for a local single-user app.

**Rationale.** Inspectable with `cat` and `jq`; backup is `cp -r`; replay is `cat`-ing an NDJSON file. The store interface in `src/lib/store/` is narrow enough to swap implementations later if needed.

**Trade-offs.** No ACID across files; no concurrent-writer story (not needed since Next.js is the only writer to card files).

---

## ADR-003: Local repo + `git worktree` for isolation

**Date:** 2026-04-30
**Status:** accepted

**Context.** Cards represent tasks against real repos. Letting the agent edit the user's actual checkout is dangerous (uncommitted work, branch checkouts, etc.).

**Decision.** For each run, create a `git worktree` of the user's repo at a scratch path under `~/.claude-kanban/work/<run_id>/`. The agent's `cwd` is that worktree. On success, push the worktree's branch to `origin` (if configured) and open a PR via `gh`.

**Alternatives.**
- *Clone fresh per run.* Slow on big repos. Worktree shares the object store.
- *Operate directly on the user's checkout.* Unacceptable; can corrupt user state.
- *Detached working copy without git.* Loses the ability to produce a PR.

**Trade-offs.** Worktree has rough edges (e.g. submodules, hooks). Phase 1 ignores both. Document them when they bite.

---

## ADR-004: V1 SDK, not V2 preview

**Date:** 2026-04-30
**Status:** accepted

**Context.** The Agent SDK has two interfaces: V1 (stable, generator-based) and V2 (preview, session-based with `send`/`stream`).

**Decision.** Use V1 (`query()`).

**Rationale.** Each card run is a fresh, single-prompt session — V1's shape fits exactly. V2's session helpers are designed for multi-turn chat; they'd add ceremony for no gain. Revisit when V2 is stable.

---

## ADR-005: Claude branding policy

**Date:** 2026-04-30
**Status:** accepted

**Context.** Anthropic permits but does not require Claude branding for partners building on the Agent SDK. The product can keep its own identity.

**Decision.** Product name is "claude-kanban" internally. UI uses generic terms ("Agent," "Run") with a small "Powered by Claude" footer. No Claude Code logo or ASCII art mimicry.

**Reference.** [Agent SDK overview — branding section](https://platform.claude.com/docs/en/agent-sdk/overview).
