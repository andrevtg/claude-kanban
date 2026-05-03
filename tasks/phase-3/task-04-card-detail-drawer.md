# phase-3 / task-04 — Card detail drawer with run history

## Goal

Clicking a card on the board opens a side drawer showing the card's
metadata, its full `runs[]` history, and a selectable event log per
run. Selecting a run in the history loads that run's events via the
existing SSE endpoint (which replays the NDJSON log on connect, then
tails). The active run is selected by default; older runs are read-only.

## Inputs

- `tasks/phase-3/task-02-dnd-columns.md` — the board this drawer hangs
  off of
- `src/components/run-card.tsx`, `src/components/run-log.tsx` — the
  phase-2 components whose responsibilities split here: the drawer
  takes over orchestration, `run-log` is reused for rendering events
- `src/app/api/cards/[id]/runs/[runId]/events/route.ts` — SSE replay
  endpoint; works for both active and finished runs (it emits a `done`
  frame immediately for finished ones)
- `src/protocol/card.ts` — `Run` shape (`id`, `startedAt`, `endedAt`,
  `exitCode`, `branchName`, `diffStat`, `prUrl`)
- `docs/01-architecture.md` — SSE replay-then-tail contract

## Outputs

### `src/components/card-drawer.tsx`

Client component. Open/close state lifted to `<Board>` (drawer is a
sibling of the board, not nested in a column). Props:
`{ card: Card | null; onClose: () => void }`. When `card` is null,
the drawer is closed.

Contents:

- Header: card title, status badge, edit and delete affordances
  (reuse the components from task-01).
- Metadata block: `repoPath`, `baseBranch`, `createdAt`, `updatedAt`.
- Run history list: every entry in `card.runs`, newest first. Each
  row shows `runId`, `startedAt`, duration (`endedAt - startedAt` if
  finished), `exitCode`, and `branchName` if present.
- Event log pane: renders `<RunLog cardId runId>` for the selected
  run. Switching the selection unmounts the previous `RunLog` (closes
  its EventSource) and mounts a new one for the new `runId`.

### Run selection state

- Default selection: the latest run (`card.runs[card.runs.length - 1]`)
  if any, else "no runs yet" empty state.
- A small "Run" button in the drawer header triggers `POST …/run`
  (same flow as the phase-2 `<RunCard>`). On `200`, the new run is
  appended to the history and auto-selected.
- A `409 run_active` response auto-selects the active run from the
  body (consistent with the board's drop-into-running behavior in
  task-02).

### `src/components/board.tsx` integration

Holds `selectedCardId` state. Clicking a `<BoardCard>` sets it; the
drawer reads `selectedCardId` and finds the card in local state.
Closing the drawer clears it.

When a card is updated (edit, status change, run started) the board's
local state already updates per task-01/task-02 — the drawer just
reads from that source, so no separate refetch is needed.

### Event log reuse

`src/components/run-log.tsx` from phase-2 already accepts
`{ cardId, runId }` and closes its EventSource on unmount. No changes
needed; the drawer just remounts it on selection change. If a switch
between two finished runs feels janky, an explicit `key={runId}` on
`<RunLog>` forces the remount.

## Acceptance

Manual acceptance — verify each visible state:

1. **Open drawer from a card with no runs.** Create a card, leave it
   in `backlog`. Click it. Drawer opens with title, metadata, and an
   empty run history ("no runs yet"). The event log pane shows the
   empty hint.
2. **Open drawer from a card with one finished run.** Run a card to
   completion (drag to running and let it finish). Click the card.
   Drawer shows the run in history with `exitCode`, duration, and
   `startedAt`. Event log pane auto-loads that run's full event log
   from the NDJSON replay (init row, reasoning/tool rows, terminal
   row).
3. **Open drawer on an active run.** Drag a card to running. Before
   it finishes, click the card. Drawer shows the active run at the
   top of history with no `endedAt`. Event log streams new events
   live; the live indicator on the row updates.
4. **Switch between past runs.** With a card that has at least two
   finished runs (run it, drag back to ready, run again), open the
   drawer and click the older run in history. The event log pane
   re-mounts and shows the older run's full event log. Click the
   newer run — it switches back. Each switch closes the previous
   EventSource (verify via DevTools Network panel: only one open
   `/events` connection at a time).
5. **Run from the drawer.** Click Run in the drawer header on a
   `ready` card. New run appears at the top of history and is
   auto-selected; events stream live.
6. **`409 run_active` from the drawer.** Click Run on a card whose
   run is already active. The drawer surfaces an inline message and
   auto-selects the active run.
7. **Edit from the drawer.** Click Edit. The phase-3/task-01 form
   opens (modal or inline). Change the title. Save. The drawer
   header updates immediately; the board card title also updates
   (shared local state).
8. **Delete from the drawer.** Click Delete, confirm. Drawer closes.
   Card disappears from the board. NDJSON logs are not deleted
   (they're per-run, not per-card; that's deliberate for forensic
   value). Confirm `~/.claude-kanban/cards/<id>.json` is gone.
9. **Close drawer.** Click outside or press Escape. Drawer closes.
   Reopening the same card defaults to the latest run, regardless
   of which run was selected when the drawer was closed.
10. **Phase-2/3 regressions.** Drag-and-drop, board state, settings
    page all unaffected.

## Out of scope

- Diff rendering for a finished run — phase 4. The drawer just shows
  `diffStat` numbers if present.
- PR creation UI (`POST …/approve-pr`) — phase 4.
- Cancel button on the active run — task-05.
- Live token streaming inside an assistant message — deferred per
  `docs/02-agent-sdk-usage.md`.
- Persisting drawer-open state in the URL (`?card=<id>`). Nice-to-have,
  phase 5.
- Restoring the last-selected run id when the drawer reopens.
- Visual treatment of the drawer (slide-in, full-screen on mobile,
  overlay vs. push). The frontend-design skill owns this.
- Bulk run history operations (clear history, delete a single run).
  Run history is append-only by design.
