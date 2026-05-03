**STATUS: done**

# phase-3 / task-02 — Kanban columns with drag-and-drop

## Goal

Replace the flat card list from task-01 with a six-column kanban board
matching the `CardStatus` enum. Dragging a card between columns updates
its `status` via `PATCH /api/cards/:id`. Dragging a card *into* the
`running` column triggers a run via `POST /api/cards/:id/run` (in
addition to the status patch). Dragging back out of `running` does not
cancel the run — that's task-05.

## Inputs

- `tasks/phase-3/task-01-card-crud.md` — the list view this replaces
- `src/protocol/card.ts` — `CardStatusSchema` (the six column ids:
  `backlog`, `ready`, `running`, `review`, `done`, `failed`)
- `src/app/api/cards/[id]/route.ts` — `PATCH` accepts `status`
- `src/app/api/cards/[id]/run/route.ts` — `POST` with one-active-run
  invariant; returns `409 run_active` if a run is already going
- `src/components/card-list.tsx` from task-01 — restructured into a
  board view here
- `docs/01-architecture.md` — failure modes, especially "two runs
  spawned for same card"

## Outputs

### Dependencies

Add `@dnd-kit/core` and `@dnd-kit/sortable` to `dependencies`. Update
`docs/01-architecture.md` "Dependencies" section per the CLAUDE.md hard
rule on dependency surface.

### `src/components/board.tsx`

Client component. Replaces (or wraps) `card-list.tsx`. Renders six
columns in `CardStatusSchema` order. Wires up `<DndContext>` from
`@dnd-kit/core`.

State shape: `{ [status]: Card[] }`, derived from the initial card
array. On drag end:

1. Optimistically move the card between columns in local state.
2. Fire `PATCH /api/cards/:id` with `{ status: newStatus }`.
3. If the destination is `running` and the card was not already
   `running`, also fire `POST /api/cards/:id/run`.
4. On any HTTP error, revert the local move and surface an inline error
   on the affected card (per CLAUDE.md "no silent failures").

### `src/components/board-column.tsx`

Renders one column. Accepts `{ status, cards }`. Uses `useDroppable`.
Header shows the column title and card count. Empty columns must still
be valid drop targets (otherwise the board is unusable when starting
fresh).

### `src/components/board-card.tsx`

Renders one draggable card. Uses `useSortable`. Shows title, prompt
preview, and (when `status === "running"`) a small live indicator.
Click behavior is unchanged from task-01 (opens inline detail or, once
task-04 lands, the drawer).

### Run-trigger flow on drop into `running`

When a drop targets the `running` column:

- If `POST …/run` returns `200`, store the new `runId` on the card so
  task-04's drawer can find it. v1 may simply rely on `card.runs[]`
  being refetched on the next list reload — pick whichever is simpler
  and document it in the file's top comment.
- If it returns `409 run_active`, leave the card in `running` (status
  is consistent), surface a brief inline notice that an existing run
  is already active, and use the `runId` from the `409` body for any
  follow-up UI.
- If it returns any other error, revert the column move *and* the
  `status` patch. The card returns to the source column with an inline
  error.

### `src/app/page.tsx`

Update to render `<Board initial={cards} />` instead of `<CardList>`.
The empty state moves into the board (each column shows its own empty
hint).

## Acceptance

Manual acceptance — verify each column transition explicitly:

1. **Initial render.** With cards in mixed statuses, the board shows
   six columns in `CardStatusSchema` order. Each card lands in its
   correct column. Counts match.
2. **`backlog → ready`.** Drag a backlog card into ready. The card
   appears in ready immediately. Reload — it persisted as `ready`.
3. **`ready → running` triggers a run.** Drag a ready card into
   running. The card moves and a run starts: within a couple of
   seconds the live indicator is visible and (with the task-04
   drawer or the inline phase-2 log) events stream in. The card's
   `runs[]` has a new entry on reload.
4. **`running → review`.** Once a run finishes, drag the card from
   running to review. Status persists. The run that just completed
   stays visible in the card's run history.
5. **`review → done`.** Drag a review card to done. Status persists.
6. **`review → failed`.** Drag a review card to failed. Status persists.
7. **Drop into `running` re-triggers the same active run (409 path).**
   Trigger a run on a card. Before it finishes, drag the same card
   out of `running` (status now `ready` or wherever) and back into
   `running`. The drop succeeds visually but no second run starts;
   an inline notice indicates the existing run is already active.
   Verify by checking `~/.claude-kanban/logs/` has only one new
   ndjson file from this exercise. The notice carries the active
   `runId`.
8. **Server-error revert.** Stop the dev server, drag a card between
   two non-running columns. The card snaps back to its source column
   with an inline error. Restart the server and the previous status
   is unchanged on reload.
9. **Phase-2 regressions.** Run, event log, and create/edit/delete
   from task-01 still work. `pnpm cli run …` still works.

Document the walkthrough as the close-out evidence.

## Out of scope

- Cancel button or any way to stop a running card — task-05.
- Reordering cards *within* a column (sortable rank). v1 sorts by
  `updatedAt` desc; users can edit a card to bump it.
- Keyboard accessibility for drag (dnd-kit supports it; wiring the
  full a11y story is phase 5 polish).
- Drawer with run history — task-04. For this task, clicking a card
  keeps the phase-2 inline behavior.
- Visual polish, transition animations, drop-shadow treatment. The
  frontend-design skill owns this.
- PR creation when a card hits `done` — phase 4.
- Auto-moving a card to `review` when its run finishes. v1 leaves the
  card in `running` until the user drags it; phase 4 may automate.
