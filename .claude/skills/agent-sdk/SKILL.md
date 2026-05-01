---
name: agent-sdk
description: Use when writing or modifying code that imports @anthropic-ai/claude-agent-sdk, calls query(), configures allowedTools/permissionMode, or handles SDK message types. Encodes the project's locked-in decisions from docs/02-agent-sdk-usage.md so you don't have to re-read that doc.
---

# Claude Agent SDK — claude-kanban conventions

This skill is the in-context cheat sheet for SDK code in this repo. The full rationale lives in `docs/02-agent-sdk-usage.md`; consult it only when changing one of these decisions (and update both files together).

## Package version

Use `@anthropic-ai/claude-agent-sdk` **V1 stable**. Do **not** use `unstable_v2_*` APIs. We chose V1 because its streaming generator API maps cleanly to NDJSON-over-stdio, and we don't need V2's session helpers — each card run is one fresh session.

## The single entry point

There is exactly one shape for invoking the SDK in this repo. It lives in the worker (`src/worker/`), not in the Next.js app. If you find yourself adding a second call site, stop and reconsider — the process boundary is the whole point.

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";

const q = query({
  prompt: card.prompt,
  options: {
    cwd: worktreePath,                       // ~/.claude-kanban/work/<run_id>
    model: "claude-opus-4-7",                // overridable per-card
    allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
    permissionMode: "acceptEdits",
    settingSources: [],
    maxTurns: 250,
  },
});

for await (const message of q) {
  // Wrap as AgentEvent and emit a WireMessage of type "event":
  //   { type: "event", event: { kind: "sdk", message } }
  forwardToParent(message);
}
```

> The `forwardToParent` helper is set by `src/worker/stream.ts` (per `docs/01-architecture.md` module map; **TODO: align after phase-1/task-04**). It must wrap each `SDKMessage` as `{ kind: "sdk", message }` to satisfy `AgentEventSchema` in `src/protocol/messages.ts`, then encode a `{ type: "event", event }` `WireMessage` with `encodeWireMessage` and write the line to stdout.

### Locked-in option values

| Option | Value | Why |
|---|---|---|
| `cwd` | worktree path under `~/.claude-kanban/work/<run_id>/` | Never the user's checkout. Resolve via `paths.ts`, never hardcode. |
| `model` | `claude-opus-4-7` default | Overridable globally and per-card via settings UI. |
| `allowedTools` | `["Read","Write","Edit","Glob","Grep","Bash"]` | Minimal edit + shell set. `WebSearch`/`WebFetch` are deferred to phase 4. |
| `permissionMode` | `"acceptEdits"` | Worktree is throwaway; auto-approving edits is safe. Bash still gates through `canUseTool`. |
| `settingSources` | `[]` | Disables filesystem skill/CLAUDE.md loading so the worker doesn't inherit Next.js's environment. Phase 4 may flip to `["project"]`. |
| `maxTurns` | `250` | Generous; supervisor enforces a wall-clock timeout (default 30 min) on top. |
| `includePartialMessages` | omitted | No token streaming in v1. Phase 3 may add it for assistant text only. |

Do **not** add: `mcpServers`, `agents` (subagents), `sessionStore`, file checkpointing. They're explicitly deferred.

## Message handling

`query()` yields a discriminated union `SDKMessage`. **Forward every message to the parent unchanged** (the parent applies it to the JSON store). Only the UI is selective. Recognized shapes:

| Discriminator | Meaning | UI treatment |
|---|---|---|
| `type: "system"`, `subtype: "init"` | Run started | "Agent started" badge with model + tools |
| `type: "assistant"`, blocks `text` | Reasoning | Streamed bubble |
| `type: "assistant"`, blocks `tool_use` | Tool call | Chip with name + args |
| `type: "user"`, blocks `tool_result` | Tool result | Truncated chip |
| `type: "system"`, `subtype: "compact_boundary"` | Context compaction | Small marker |
| `type: "result"` | Terminal | Success/failure summary; ends the run |

When narrowing on `type: "assistant"`, iterate the content blocks — a single assistant message can interleave `text` and `tool_use` blocks. Don't assume one block per message.

A `type: "result"` message means the run is over from the SDK's perspective. The worker should still flush its NDJSON log and exit cleanly; don't keep iterating.

## Permissions

V1 policy is deliberately blunt: `permissionMode: "acceptEdits"` plus a worker-side bash allowlist enforced via `canUseTool`. There is **no mid-run "approve this command" UI** — that's a v2 idea.

The worker pre-approves these bash patterns:

- `git status`, `git diff`, `git log`, `git add`, `git commit`
- `npm test`, `npm run *`, `pnpm *`, `yarn *`
- Test runners: `pytest`, `jest`, `vitest`, `go test`, `mvn test`, `cargo test`
- Read-only inspection: `cat`, `ls`, `head`, `tail`, `wc`, `find`, `rg`, `grep`

Anything else: deny via `canUseTool`, log a `permission_denied` event to the NDJSON stream, and continue. The user can extend the allowlist in `settings.json` — do not add interactive prompts.

## Cancellation

`query()` returns a `Query` with `interrupt()`. Hold onto it; don't reassign or shadow it. Cancellation arrives as an NDJSON line on stdin (not Node IPC `process.send` — the worker uses stdio JSONL via the protocol module's helper):

```ts
const q = query({ prompt, options });
onStdinMessage((msg) => {
  if (msg.type === "cancel") q.interrupt();
});
for await (const m of q) forwardToParent(m);
```

> `onStdinMessage` is illustrative; the exact helper name and shape are set by `src/worker/stdio.ts` (**TODO: align after phase-1/task-04**). Whatever it's called, it must read NDJSON lines from stdin, run them through `parseWireMessage` from `src/protocol/messages.ts`, and only act on `{ ok: true }` results — never throw on a malformed line.

After `interrupt()`, the loop will still drain a final `result` message — let it complete normally rather than `break`-ing early.

## What's deferred (do not add in phases 1–3)

- Hooks (`PreToolUse`, `PostToolUse`, etc.) — phase 4 adds `PreToolUse` for tool-call traces.
- Skills loading (`settingSources: ["project"]`) — phase 4.
- `WebSearch` / `WebFetch` tools — phase 4, once UI rendering for them exists.
- Token-level streaming (`includePartialMessages`) — phase 3 maybe.
- Subagents (`agents` option) — out of scope; one agent per run.
- Custom MCP servers (`mcpServers`) — not in v1.
- Session storage (`sessionStore`) — we own the NDJSON log.

## Process boundary reminders

- The worker imports the SDK; the Next.js app does **not**. If you're tempted to import `query` from app code, stop — read `docs/01-architecture.md`.
- All worker → parent communication is the protocol in `src/protocol/`. Don't invent ad-hoc message shapes; extend the protocol module.
- The JSON store is the source of truth for card state. Workers emit events; the parent applies them.

## When to update this skill vs. the doc

If you're adjusting a value in the option table or the permission allowlist:

1. Edit `docs/02-agent-sdk-usage.md` first (it's the source of truth).
2. Mirror the change here.
3. Note it in `docs/CHANGELOG.md`.

If the change introduces a new SDK surface (hooks, MCP, subagents), it is almost certainly a phase boundary — open a question in `docs/QUESTIONS.md` before implementing.
