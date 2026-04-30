# 02 — Agent SDK usage

This document is the source of truth for *which* parts of `@anthropic-ai/claude-agent-sdk` we use, and why. If you find yourself wanting to use a different surface, update this doc first.

## Package

```
@anthropic-ai/claude-agent-sdk  (V1 stable; not v2 preview)
```

We are deliberately on V1 because:

- The streaming generator API maps cleanly to NDJSON-over-stdio.
- V2 is a preview with a different session model; we don't need its session helpers since each card run is one fresh session.
- Re-evaluate when V2 is stable.

## Entry point

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: card.prompt,
  options: {
    cwd: worktreePath,
    model: "claude-opus-4-7",
    allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
    permissionMode: "acceptEdits",
    settingSources: [],         // we are NOT loading user/project skills in v1
    maxTurns: 250,
  },
})) {
  forwardToParent(message);
}
```

### Notes on each option

- **`cwd`** is the worktree path under `~/.claude-kanban/work/<run_id>/`. Critical: this is *not* the user's repo path. We work on a worktree so the user's main checkout is never touched.
- **`model`** defaults to `claude-opus-4-7`. The settings UI lets the user override globally and per-card.
- **`allowedTools`** — minimal set for code edits and shell. We add `WebSearch` and `WebFetch` in phase 4 once we have a story for surfacing those calls in the UI.
- **`permissionMode: "acceptEdits"`** auto-approves file edits because the worker is operating in a throwaway worktree, not the user's actual checkout. Bash commands still hit the default permission flow (in v1 the worker auto-approves them too — see "Permissions" below).
- **`settingSources: []`** disables filesystem skill/CLAUDE.md loading. We don't want the worker to accidentally inherit settings from wherever Next.js was started. Phase 4 may flip `settingSources: ["project"]` and use the worktree's own `.claude/`.
- **`maxTurns: 250`** is generous; long-form coding tasks routinely exceed 50 turns. The supervisor enforces a wall-clock timeout (default 30 min) on top.

## Message types we handle

The SDK yields a discriminated union (`SDKMessage`). We forward all messages to the parent process unchanged but render only a subset in the UI. The kanban event log distinguishes:

| SDK message | UI rendering |
|---|---|
| `type: "system"`, `subtype: "init"` | "Agent started" badge with model + tools list |
| `type: "assistant"`, content blocks `text` | streamed reasoning bubble |
| `type: "assistant"`, content blocks `tool_use` | tool call chip with name + args |
| `type: "user"`, content blocks `tool_result` | tool result chip (truncated) |
| `type: "system"`, `subtype: "compact_boundary"` | small "compacted context" marker |
| `type: "result"` | terminal block; success or failure summary |

We do **not** use `includePartialMessages` in v1 (no token-by-token streaming). Phase 3 may add it for the assistant text channel only.

## Permissions

V1 ships with a deliberate, blunt policy: `permissionMode: "acceptEdits"` plus a worker-side allowlist of bash commands.

The worker pre-approves these bash patterns:
- `git status`, `git diff`, `git log`, `git add`, `git commit`
- `npm test`, `npm run *`, `pnpm *`, `yarn *`
- Test runners: `pytest`, `jest`, `vitest`, `go test`, `mvn test`, `cargo test`
- Read-only inspection: `cat`, `ls`, `head`, `tail`, `wc`, `find`, `rg`, `grep`

Anything else hits a `canUseTool` callback that the worker resolves by *denying* (logged to the event stream). v1 does not surface a "approve this command" UI mid-run — it's a v2 idea. The user can edit the allowlist in `settings.json` if a run keeps getting blocked on something legitimate.

## Cancellation

`query()` returns a `Query` object with `interrupt()`. We hold onto it in the worker:

```ts
const q = query({...});
process.on("message", (msg) => {
  if (msg.type === "cancel") q.interrupt();
});
for await (const m of q) { ... }
```

(Note: the worker uses NDJSON over stdio, not Node IPC `process.send`. The protocol module exposes a small read-stdin-as-jsonl helper.)

## Hooks and skills (deferred)

Hooks (`PreToolUse`, `PostToolUse`, etc.) and skills are out of scope for phases 1–3.

Phase 4 will introduce:
- A `PreToolUse` hook that records every tool call to a structured trace alongside the NDJSON log, useful for "what did the agent actually do" review.
- Optional skills loading via `settingSources: ["project"]` so users can drop a `.claude/skills/` into their target repo.

## What we don't use (yet)

- `unstable_v2_*` APIs.
- `mcpServers` option (no custom MCP servers in v1).
- `agents` (subagents) — out of scope; one agent per run.
- File checkpointing — the worktree is throwaway, so checkpointing is redundant.
- `sessionStore` — we have our own NDJSON log; not interested in the SDK's session storage.
