# 05 — Relation to the Cursor cookbook

## Lineage

This project is a port of [`cursor/cookbook/sdk/agent-kanban`](https://github.com/cursor/cookbook/tree/main/sdk/agent-kanban) to the Claude Agent SDK. The Cursor cookbook is MIT-licensed; we acknowledge it as the design source for the kanban-of-agent-runs UX and several architectural patterns.

We are not vendoring or copying their code. The codebase is rebuilt from scratch, in TypeScript, against `@anthropic-ai/claude-agent-sdk`. This document records what we kept, what we changed, and why — both as honest attribution and as a navigation aid for anyone comparing the two.

## What we kept

- **The core mental model.** A card represents an agent task. Columns map to status. Cards are created from a repo + prompt. The agent works asynchronously and posts results back when done.
- **Linear-style board layout.** Five columns, drag-and-drop between them, card detail in a side drawer. Phase 3 builds this.
- **Local settings file.** Cursor stores its API key at `~/.agent-kanban/settings.json`. We use `~/.claude-kanban/settings.json` with the same shape (file mode 0600).
- **Streaming-first UX.** The card surfaces agent activity as it happens, not on completion. The Cursor version uses the SDK's `run.stream()`; we use the Agent SDK's `query()` async generator.
- **PR creation as a first-class outcome.** A successful run can result in a pushed branch and a PR. The Cursor version surfaces this as a card affordance; so do we.

## What we changed (and why)

### Runtime: local Agent SDK, not Cursor's cloud sandbox

| Cursor cookbook | claude-kanban |
|---|---|
| `Agent.create({ cloud: { repos, autoCreatePR } })` — Cursor-hosted VM with repo clone, dev environment, and PR opening built in. | `query()` from the Agent SDK in **local mode**. The worker process owns the working tree on disk. |

**Why.** The Claude equivalent of Cursor's cloud sandbox is [Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview), which is the right target for a *production* port. We deliberately chose local mode for v1 to (a) avoid the public-beta API churn, (b) eliminate the session-hour billing, (c) get the team fluent in the Agent SDK surface before adding managed infrastructure, and (d) ship a demoable artifact in days rather than weeks.

A port to Managed Agents is the planned v2; phase-5/task-04 produces the handoff doc.

### Execution model: explicit worker subprocess

| Cursor cookbook | claude-kanban |
|---|---|
| The SDK's cloud mode hides the execution boundary. The kanban talks to `Agent.getRun(id)` and assumes the run is happening *somewhere*. | One Node subprocess per active run. The Next.js process is a supervisor; workers communicate over stdio with NDJSON. |

**Why.** When you don't have a hosted sandbox, you need the boundary somewhere. Putting it inside the Next.js process (in-process `query()`) couples the agent's lifecycle to the web server, blocks the request thread, and turns any SDK crash into an outage. Putting it in a subprocess gives crash isolation, clean cancellation, and — critically — *the same architectural shape* as the eventual Managed Agents version. When we port to v2, the worker module gets replaced by an HTTP/SSE client; everything else stays.

### Repo handling: `git worktree`, not a cloud clone

| Cursor cookbook | claude-kanban |
|---|---|
| Cloud agent gets a fresh clone in its VM. The user's local checkout is irrelevant. | Worker creates a `git worktree` at `~/.claude-kanban/work/<run_id>/` from the user's local repo. Shares the object store; doesn't touch the user's working copy. |

**Why.** We're operating on real local repos. Letting the agent edit the user's checkout directly is dangerous (uncommitted work, branch state, IDE conflicts). A worktree gives isolation without paying the cost of a full clone. Trade-off: worktrees have rough edges with submodules and certain hooks; we accept those for v1.

### `autoCreatePR`: composed, not declared

| Cursor cookbook | claude-kanban |
|---|---|
| `cloud: { autoCreatePR: true }` flag on agent creation; the runtime owns the PR step. | Worker explicitly runs `git push` + `gh pr create` after a successful run, gated on user approval from the card UI. |

**Why.** The Agent SDK has no equivalent flag because the SDK doesn't own the cloud sandbox or the git remote. Keeping PR creation as a separate, user-approved step is also a feature, not a bug — it gives the human a review gate before anything hits a remote. (Phase 4 implements this.) Local mode hard-requires `gh` for the push + PR step (see ADR-010); Managed Agents bundles git auth into the sandbox and exposes PR creation as a tool/MCP call instead.

### Persistence: JSON files, not the platform's run store

| Cursor cookbook | claude-kanban |
|---|---|
| Run history lives in Cursor's cloud, addressable via `Agent.getRun(id)` and a list endpoint. The kanban is mostly a view over that. | Cards, runs, and event logs live on disk under `~/.claude-kanban/`. NDJSON event logs are append-only and replayable. |

**Why.** No managed run store in local mode. JSON-on-disk is simple, inspectable, and enough for single-user. ADR-002 captures the trade-offs.

### Repository picker

| Cursor cookbook | claude-kanban |
|---|---|
| The Cloud Agents API exposes a "repos available to this account" endpoint that populates the new-card dropdown. | The user configures a default repo path in settings, and per-card can override with any local path. No GitHub OAuth in v1. |

**Why.** No equivalent endpoint in local mode (and we don't want to ship GitHub OAuth in v1). Phase 4 may add a "recent repos" list pulled from local git config.

## What we dropped

- **Multi-repo mounting per run.** Cursor's cloud lets you specify multiple repos. We allow one repo per card.
- **Cloud reconnect ergonomics.** Cursor advertises "agents keep running when your laptop sleeps." Our agents stop when the laptop sleeps because they're literally on the laptop. SSE reconnect just resumes the live tail; the run itself was paused with the rest of the OS.
- **Cursor-specific model selection** (`composer-2`, `gpt-5.5` etc.). We use Claude models exclusively (`claude-opus-4-7` default).
- **The Cursor IDE integration loop.** Cursor's cookbook example ties into "agents started programmatically can be inspected manually in the Cursor app." We have no equivalent — the kanban is the only surface.

## What stays the same in the Managed Agents port (phase-5/task-04)

When we port to Claude Managed Agents:

- **Stays:** the UI, the card/run data model, the wire protocol shape (re-targeted at SSE from Anthropic's run endpoint), the JSON-file store (or swapped for a managed run store; either works).
- **Changes:** the worker module is mostly deleted. `query()` becomes a `POST /v1/sessions` call. `git worktree` and `gh pr create` move into MCP tools or get composed via the GitHub MCP server. Wall-clock timeout is replaced by Anthropic's session lifecycle.
- **Net effect:** the local version is roughly 70% of the codebase the cloud version reuses. That's the whole point of getting the seams right now.

## Attribution and license

The original cookbook is © Anysphere Inc., MIT-licensed. We thank the Cursor team for publishing it; the kanban-of-agents UX is a clean idea well executed and worth porting. This project is independent and not affiliated with Anysphere.

When phase 5 produces the public README, that README must include this attribution prominently — not buried in a docs file.
