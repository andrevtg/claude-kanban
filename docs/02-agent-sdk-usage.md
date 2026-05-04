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
- **`settingSources: []`** is the default; flipped to `["project"]` per-card per phase-4/task-04 (see "Skills" below). With `[]` the SDK does not inherit user/project settings from wherever Next.js was started.
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

## Hooks

`PreToolUse` is registered (phase-4/task-03) to record every tool call to a per-run JSONL trace at `~/.claude-kanban/traces/<runId>.jsonl`. The hook is a pure observer — it never blocks or modifies tool calls. Its `tool_input` is redacted via `redactArgs` (4 KiB string cap, binary payloads replaced with `[truncated N bytes]`) before being written; the regular event log still carries the full input.

Configuration lives in `src/worker/run.ts`:

```ts
hooks: {
  PreToolUse: [
    {
      hooks: [async (input) => {
        if (input.hook_event_name === "PreToolUse") {
          void traceWriter.append({
            ts: new Date().toISOString(),
            tool: input.tool_name,
            args: redactArgs(input.tool_input),
          });
        }
        return { continue: true };
      }],
    },
  ],
}
```

Trace failures degrade silently after a single `worker warn: trace write failed` event so the run continues. The writer guarantees the trace file exists at close time even when no tool calls fired (zero-byte file documents that tracing was active).

## Skills

Skills loading is opt-in per card. The card carries a `loadSkills: boolean`
field (default `false`); when the user runs a card with `loadSkills: true`,
the worker:

- passes `settingSources: ["project"]` to `query()`, and
- adds `"Skill"` to `allowedTools` (de-duped against the supervisor's default
  set).

The SDK then loads skills from `<cwd>/.claude/skills/`. Because `cwd` is the
worktree (which inherits the user repo's checked-in `.claude/` directory),
this is equivalent to loading skills from `<repoPath>/.claude/skills/`.

UI flow:

- Toggle defaults to off. Off cards run with `settingSources: []` exactly as
  v1 did.
- Enabling the toggle requires a per-card per-session confirmation on the
  next Run. The confirmation modal names the resolved
  `<repoPath>/.claude/skills/` path and explains that the agent will read
  and follow instructions from there.
- Confirmation is stored in `sessionStorage` under
  `claude-kanban:skills-confirmed`. Closing the tab clears it; toggling
  `loadSkills` off and back on also clears it.

Security framing: skills are instructions written by whoever owns the
target repo. v1 trusts the user's judgment — there is no content
sandboxing or static vetting. The default-off / per-session confirmation
posture is the security guarantee.

## What we don't use (yet)

- `unstable_v2_*` APIs.
- `mcpServers` option (no custom MCP servers in v1).
- `agents` (subagents) — out of scope; one agent per run.
- File checkpointing — the worktree is throwaway, so checkpointing is redundant.
- `sessionStore` — we have our own NDJSON log; not interested in the SDK's session storage.
