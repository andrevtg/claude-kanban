# Demo: claude-kanban in 2 minutes

This is the cheat sheet for showing the artifact to a colleague or a
partner-network conversation. Aspire to two minutes; three is the hard cap.

## Setup (do this before the call)

- `pnpm install` (cached is fine).
- `pnpm dev`; confirm <http://localhost:3000> loads.
- `~/.claude-kanban/settings.json` populated with a working
  `ANTHROPIC_API_KEY` (or the inline key written via the Settings page).
- `gh auth status` succeeds. If `gh` is missing or unauthenticated, fall back
  to the [backup script](#backup-script-when-something-breaks).
- A small sandbox repo on disk you don't mind a worktree against. Single-file
  README repos work great; large monorepos are slower and noisier.
- Pre-create one card in **Backlog** so you don't burn time on the form. Use:
  - **Title:** `Add a hello world test.`
  - **Prompt:** something short and concrete that produces a small diff, e.g.
    *"Add a `hello.test.js` file at the repo root that runs `console.log('hi')`
    and asserts true. Don't touch other files."*
  - **Repo path:** the sandbox repo above.
  - **Base branch:** `main`.
  - **Load skills:** off.
- Have a second tab parked at the repo's GitHub page (or `gh repo view --web`)
  so the PR opens to a familiar place at the end.

## The demo (2:00 target / 3:00 hard cap)

### 0:00 – 0:15 — Frame the problem

> "Imagine I have ten small tasks I'd punt to an agent. Where's the place I
> track them? Not in a chat. Not in a TODO file. Here."

### 0:15 – 0:30 — Show the board

Open <http://localhost:3000>. Point at the columns:

> "Backlog, ready, running, review, done, failed."

If asked: cards survive reload because everything is JSON on disk under
`~/.claude-kanban/`.

### 0:30 – 0:45 — Drag the prepared card to Running

Drag the pre-staged card from **Backlog** to **Running**. The agent starts.
Point at the live event log in the drawer.

> "That's the SDK streaming over SSE. The worker is a separate Node process so
> a crash in here doesn't take the web app with it."

### 0:45 – 1:30 — Watch the agent work

Wait. The agent is doing actual work. Don't fill the silence with talk; let
the demo breathe. ~30–45 seconds for a small task. If a tool call is
interesting (a `Grep` finding the right file, an `Edit` chip with a tight
diff), point at it.

### 1:30 – 1:45 — Review the diff

The card moved to **Review**. Open the drawer. Point at the diff pane and the
file-by-file view.

> "Diff is captured to `~/.claude-kanban/diffs/<run_id>.patch` after the run.
> Same place the trace and event log live."

### 1:45 – 2:00 — Open the PR

Click **Open PR**. Confirm the title and body in the composer; click submit.
The PR URL appears as a chip. Click the chip — GitHub opens with the PR.

> "Branch was pushed and the PR opened via `gh`. The agent never touched the
> user's working copy — it ran inside a `git worktree`."

## Timing notes

- The agent run is the longest single segment. Budget 30–45s for "small task"
  prompts and 60–90s for "fix this bug" prompts. If you want predictable
  timing, keep the prompt scoped to a single file.
- If the run is taking too long, talk over it. The point is the *shape* of the
  artifact, not the model speed.
- If the demo breaks live, the trace at
  `~/.claude-kanban/traces/<run_id>.jsonl` and the event log at
  `~/.claude-kanban/logs/<run_id>.ndjson` are forensic gold. Pivot to "let me
  show you what the agent did" rather than pretending it didn't break — the
  *no silent failures* property is itself demo-able.
- Hot-reload during a live run makes the SSE stream reconnect; the run keeps
  going server-side. If a partner sees a brief gap in the log, that's why —
  the Reconnect affordance on the run-log error card recovers the stream.

## Backup script (when something breaks)

If **`gh` auth has lapsed or `gh` is missing:** skip the PR step. Show the
card sitting in **Review** with the diff visible and talk through what *would*
happen on **Open PR** — point at
[ADR-010](03-decisions.md#adr-010-gh-cli-as-a-hard-dependency-for-pr-creation)
for why the dependency is hard. The pre-flight disabling the button (rather
than crashing at click) is itself a demo point.

If **the agent run fails:** open the failed card's drawer, show the event log
with the terminal `result` block, then open
`~/.claude-kanban/traces/<run_id>.jsonl` to walk the tool sequence. End with
"in any other tool this would be a black box; here it's text on disk."

If **the dev server is hot-reloading at the wrong moment** (Tailwind tweak,
file save during the run): leave the run going, restart `pnpm dev` only if the
SSE stream actually wedges, then skip to **1:30** — the diff and PR steps work
on the persisted state. Reload the browser tab if the kanban looks stale.

If **the worker hangs and Cancel feels slow:** that's expected — the
cooperative cancel via stdin gives the SDK time to drain a final result
message before the supervisor escalates to SIGTERM/SIGKILL. See
[ADR-007](03-decisions.md#adr-007-cooperative-cancellation-via-stdin-reader-signals-as-backstop).
