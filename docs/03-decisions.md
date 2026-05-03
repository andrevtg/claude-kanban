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

---

## ADR-006: Test runner is `node --test`, not Vitest

**Date:** 2026-04-30
**Status:** accepted (ratifying existing practice)

**Context.** Phase-1 task files originally specified Vitest, but task-01's dependency list did not include it. Tasks 02 and 03 needed tests; Claude Code correctly followed the "no surprise dependencies" rule and used Node's built-in `node --test` runner with tsx for TypeScript loading.

**Decision.** Standardize on `node --test` + tsx for all tests in this project. Do not add Vitest.

**Alternatives.**

- *Vitest.* Better DX (richer assertions, snapshots, watch mode), and has the better React integration story for eventual component tests. Adds a dev dependency.
- *Jest.* Heavier, slower, worse TypeScript ergonomics. Not seriously considered.

**Rationale.** Phase 1-3 tests are pure-module tests (protocol round-trips, store CRUD, supervisor invariants, NDJSON parsing). Vitest's ergonomic advantages are minimal at this scale. CLAUDE.md's hard rule on dependencies says additions need an architectural justification, and "ergonomics after the fact" doesn't clear that bar.

**Trade-offs.** Less expressive matchers; clunkier watch mode; no built-in mocking. Acceptable for the test surface we have. Revisit if phase 2-3 component tests become unwieldy — at that point a Vitest ADR with a real ergonomic-limit citation would be a clean addition, not a retrofit.

---

## ADR-007: Cooperative cancellation via stdin reader, signals as backstop

**Date:** 2026-05-02
**Status:** accepted

**Context.** Phase-1 task-05 implemented `Supervisor.cancel` as SIGTERM-after-5s, SIGKILL-after-another-5s. That works but feels unresponsive — clicking Cancel in the UI takes 5+ seconds to register an event, and the SDK has no chance to drain a final result message cleanly. Phase-3 task-05 adds cooperative cancel.

**Decision.** Workers run a stdin reader concurrently with the SDK iterator. On a `{ type: "cancel" }` wire message, the reader calls `query.interrupt()`, which lets the SDK loop drain to a terminal result message before the worker exits. The supervisor's SIGTERM/SIGKILL escalation timers stay as a backstop for the case where the worker is itself stuck (e.g., infinite loop in a tool result handler).

**Alternatives.**

- *Signals only.* The phase-1 implementation. Simpler but slow and loses the final result message.
- *AbortController throughout.* More idiomatic Node, but the SDK's own interrupt API is what the project already targets, and adding an AbortController would be a parallel mechanism doing the same job.

**Trade-offs.** Worker code becomes more complex (two loops to keep in sync). Backstop signals are still required because cooperative cancel can hang if the worker itself is stuck. The exact concurrency primitive (Promise.race, generator pump, AbortController) is an implementation detail; task-05 leaves it to the implementor's choice documented inline.

---

## ADR-008: Stale-run worktree sweep policy

**Date:** 2026-05-02
**Status:** accepted

**Context.** Worktrees under `~/.claude-kanban/work/<run_id>/` are intentionally kept after a run completes (commit aa2d1db; corrected the phase-2 cleanup-on-success bug). Without pruning, they accumulate indefinitely.

**Decision.** A sweep runs once per supervisor construction (i.e. once per Next.js process / HMR cycle). It removes worktrees whose owning run has `endedAt` set and is older than 24h. It keeps worktrees with no `endedAt` (active or crashed-without-flush) and orphans (no matching card). Orphans are logged but never auto-deleted.

**Alternatives.**

- *Continuous schedule (every N hours).* Adds a long-lived timer to the supervisor; over-engineered for a single-user localhost tool where Next.js dev cycles are short.
- *Eager orphan cleanup.* Risky — an orphan might be a card whose JSON didn't flush, and deleting the worktree destroys forensic evidence. Logging is safer.
- *Cleanup on run completion.* Already explicitly rejected (commit aa2d1db); worktrees must persist for inspection and for phase-4 PR creation.

**Trade-offs.** Long-lived dev sessions accumulate worktrees until restart. 24h threshold is conservative — runs older than that are unlikely to be of interest, but a future "demo on Monday what I built on Friday" use case might want to bump it. Threshold is configurable via `opts.maxAgeMs`.

---

## ADR-009: Tailwind v4 upgrade ahead of shadcn introduction

**Date:** 2026-05-02
**Status:** accepted

**Context.** Phase-3/task-01 finished without shadcn/ui because shadcn's init step requires Tailwind v4. We were on Tailwind v3 from phase-2/task-01. Phase-3/task-02 onward (DnD board, drawer in task-04) want shadcn primitives.

**Decision.** Upgrade Tailwind v3 → v4 as a dedicated step before task-02, using the official `@tailwindcss/upgrade` codemod. Initialize shadcn in a follow-up step (separate prompt) so the upgrade and the shadcn introduction land in clean, reviewable commits.

**Alternatives considered.**

- *Stay on Tailwind v3 and hand-roll components instead of using shadcn.* Viable for the rest of phase 3 — task-04's drawer is where shadcn's value peaks, but Sheet can be hand-built. Rejected because the partner-network audience expects a recognizable shadcn surface, not a bespoke component library.
- *Upgrade Tailwind manually.* Rejected because the codemod handles the rename matrix and config migration mechanically; manual porting invites quiet utility-name regressions.
- *Pin shadcn to a hypothetical v3-compatible older version.* Rejected; shadcn has moved on, pinning is a maintenance debt.

**Trade-offs.** Tailwind v4's CSS-first config is genuinely different from v3's JS config; future contributors need to know this. v4 is also younger; expect occasional ecosystem rough edges (PostCSS plugins, IDE tooling). Net positive given the unblock. The codemod left a self-referential `--font-sans` line in `globals.css` assuming next/font integration; this project does not use next/font, so the line was removed and v4's default sans stack is accepted as the project's font.

**Follow-up.** A separate prompt initializes shadcn after this upgrade lands. ADR-010 will document that decision if it warrants one (it might not — shadcn introduction may be straightforward enough that the architecture-doc dependency note suffices).

---

## ADR-010: `gh` CLI as a hard dependency for PR creation

**Date:** 2026-05-03
**Status:** accepted

**Context.** The PR step needs to push a branch and open a pull request. Options: shell out to `gh`, call GitHub's REST API directly via a fetch wrapper, or abstract over hosts (GitHub, GitLab, Bitbucket).

**Decision.** Hard-require `gh`. The UI pre-flights `gh --version` and `gh auth status` and disables the Open PR button on either failure.

**Alternatives considered.**

- *Direct REST via PAT.* Forces us to ship a token-input flow and manage refresh. `gh` already owns that surface; piggybacking is cheaper than reimplementing.
- *Multi-host abstraction.* Real value, real cost. v1 targets GitHub users; GitLab and Bitbucket land as a separate ADR if/when there's demand.

**Local mode vs. Managed Agents.** Managed Agents bundles git auth into the sandbox; PR creation moves into a tool the agent calls (or the GitHub MCP server) rather than a worker-level wrapper around `gh`. The local-mode dependency on `gh` does not port forward.

**Trade-offs.** Users without `gh` cannot open PRs from the UI; they can still run the agent and inspect the diff. The pre-flight surfaces this clearly so it's a visible disable, not a runtime crash.
