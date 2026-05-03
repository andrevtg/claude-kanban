# 01 — Architecture

## Process topology

```
┌────────────────────────────┐         ┌────────────────────────────┐
│  Browser (React)           │ ──SSE── │  Next.js server            │
│  - kanban UI               │ ◄─REST─ │  - route handlers          │
│  - dnd-kit                 │         │  - JSON store              │
│  - SSE consumer            │         │  - worker supervisor       │
└────────────────────────────┘         └─────────────┬──────────────┘
                                                     │ spawn + NDJSON
                                                     │ over stdio
                                                     ▼
                                       ┌────────────────────────────┐
                                       │  Worker (Node subprocess)  │
                                       │  - one per active run      │
                                       │  - claude-agent-sdk query  │
                                       │  - git operations          │
                                       │  - gh pr create            │
                                       └────────────────────────────┘
```

There is **exactly one** Next.js process. There is **zero or one** worker process per active card. Cards in non-running states have no worker.

## Module boundaries

```
src/
├── app/                    Next.js App Router (server + client)
├── components/             React components (kanban, cards, settings)
├── lib/
│   ├── store/              JSON-file persistence; only Next.js imports this
│   ├── supervisor/         Spawns and manages worker subprocesses
│   ├── sse/                Server-Sent Events plumbing
│   └── paths.ts            ~/.claude-kanban path helpers
├── worker/                 Worker entry point + SDK invocation
│   ├── index.ts            Entrypoint: parses init payload, runs query()
│   ├── git.ts              Worktree create/cleanup, diff, push
│   ├── pr.ts               gh pr create wrapper
│   └── stream.ts           Translates SDK messages → wire protocol
├── protocol/               Shared types & encoders (imported by both sides)
│   ├── messages.ts         WireMessage union type
│   ├── card.ts             Card, Run, EventLogEntry types
│   └── settings.ts         GlobalSettings type
└── types/                  Ambient type declarations for non-TS assets (e.g. CSS imports). No runtime code.
```

**Hard rule:** `src/worker/` and `src/lib/` must not import each other. `src/protocol/` is the only shared surface. Enforce with a lint rule in phase 5. These rules apply to `import type` as well as value imports; type-only coupling is still coupling.

`src/types/` is ambient-only: any file may rely on its declarations (they're picked up by the compiler globally), but `src/types/` itself must not import from `src/worker/`, `src/lib/`, `src/app/`, or `src/components/`. Ambient declarations should be self-contained.

## Data model

Everything is JSON on disk under `~/.claude-kanban/`:

```
~/.claude-kanban/
├── settings.json           GlobalSettings (api key reference, default repo, gh path)
├── cards/
│   └── card_01HXYZ.json    Card document with embedded run history
├── work/
│   └── run_01HABC/         Ephemeral worktree for an active or recent run
└── logs/
    └── run_01HABC.ndjson   Append-only event log per run
```

Card document shape (see `src/protocol/card.ts` for the canonical type):

```ts
type Card = {
  id: string;                       // card_<ulid>
  title: string;
  prompt: string;                   // the task description sent to the agent
  repoPath: string;                 // absolute local path
  baseBranch: string;               // e.g. "main"
  status: "backlog" | "ready" | "running" | "review" | "done" | "failed";
  runs: Run[];                      // history; latest at end
  createdAt: string;                // ISO
  updatedAt: string;
};

type Run = {
  id: string;                       // run_<ulid>
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
  branchName?: string;              // claude-kanban/<run_id>
  diffStat?: { files: number; insertions: number; deletions: number };
  prUrl?: string;
  // events live in the NDJSON log file, not in this JSON
};
```

## Wire protocol (Next.js ↔ Worker)

Bidirectional NDJSON over stdio. One JSON object per line.

**Parent → Worker:**

- `{ type: "init", run: RunInitPayload }` — sent once, immediately after spawn.
- `{ type: "approve_pr", title, body }` — instructs the worker to push and open a PR.
- `{ type: "cancel" }` — abort current SDK query.

**Worker → Parent:**

- `{ type: "ready" }` — worker is up.
- `{ type: "event", event: AgentEvent }` — wraps SDK messages and worker-internal events; see `src/protocol/messages.ts`.
- `{ type: "diff_ready", stat }` — git diff produced.
- `{ type: "pr_opened", url }` — PR successfully created.
- `{ type: "error", code, message }` — recoverable error.
- `{ type: "done", exitCode }` — run terminated; worker about to exit.

The protocol is intentionally narrow. Any new feature should add a single message type, not overload existing ones.

## Browser ↔ Next.js

- `GET /api/cards` → list of cards.
- `POST /api/cards` → create.
- `PATCH /api/cards/:id` → edit prompt / status.
- `POST /api/cards/:id/run` → spawn a worker; returns run id.
- `POST /api/cards/:id/runs/:runId/approve-pr` → relays `approve_pr`.
- `GET /api/cards/:id/runs/:runId/events` → SSE stream of events for that run (live tail of the NDJSON log + live messages from the worker).

## Why JSON files (and the limits)

- Zero setup, easy to inspect and back up.
- Append-only NDJSON event logs are forensic gold for a demo: you can replay any run.
- Concurrent writes: the Next.js process is the **only** writer to `cards/*.json`. Workers only write to `logs/*.ndjson` (their own file) and `work/<run_id>/`.
- This will not scale to multi-user. That's fine. If we ever need to, we replace `src/lib/store/` with a Postgres adapter behind the same interface.

## Failure modes worth designing for

| Failure | Behavior |
|---|---|
| Worker crashes mid-run | Supervisor marks run `failed`, includes last events, leaves worktree on disk for inspection. |
| Browser disconnects from SSE | Worker keeps running; reconnecting replays the NDJSON log from offset 0, then tails. |
| SDK returns `result` with `subtype !== "success"` | Run marked `failed`, error message surfaced on card. |
| `gh` not installed | PR step disabled with a clear message; the card still shows the diff. |
| User cancels mid-run | Parent sends `cancel`, worker calls `query.interrupt()`, exits cleanly. |
| Two runs spawned for same card | Second one rejected by supervisor (one-active-run-per-card invariant). |

## Out of scope (and why)

- **Concurrency limits across cards.** A laptop can run a handful of agents in parallel without help. If it becomes a problem, add a global semaphore to the supervisor.
- **Persistent SSE reconnect via Last-Event-ID.** Phase 3 nice-to-have; basic replay-from-zero is fine for now.
- **Auth.** Single-user tool on `localhost`. The `ANTHROPIC_API_KEY` lives in `~/.claude-kanban/settings.json` with file mode `0600`.

## Dependencies

The dependency surface is part of the architecture; new packages need a doc update before they land.

- Runtime: `@anthropic-ai/claude-agent-sdk` (worker only), `next` 15, `react`/`react-dom` 19, `ulid`, `zod`, `clsx` + `tailwind-merge` (shadcn `cn()` helper), `tw-animate-css` (CSS imported by `globals.css`).
- Dev: `typescript`, `tsx`, `eslint` + `@typescript-eslint/*`, `prettier`, `tailwindcss` 4, `@tailwindcss/postcss`, `postcss`, `eslint-config-next`, `@types/{node,react,react-dom}`, `shadcn` (CLI for `init`/`add`).

Phase-2/task-01 added Next.js 15 / React 19 / Tailwind 3. Tailwind v4 introduced in phase-3/setup; CSS-first configuration via `@theme` blocks in `src/app/globals.css`. See [ADR-009](./03-decisions.md).

shadcn/ui introduced in phase-3/setup. Component sources live under `src/components/ui/` and are owned by this project (per shadcn's copy-not-import model). Add new primitives via `pnpm dlx shadcn@latest add <name>`. Per-component dependencies (e.g. `@base-ui/react`, `class-variance-authority`, `lucide-react`) are added by the CLI when their first consumer lands, not at init time.

## Testing

Tests run with Node's built-in `node --test` runner via tsx (no Vitest); see [ADR-006](./03-decisions.md). Per CLAUDE.md hard rules, phase 1-3 covers the protocol, store, worker, and supervisor — not the UI layer.
