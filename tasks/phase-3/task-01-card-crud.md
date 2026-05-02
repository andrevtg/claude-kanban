# phase-3 / task-01 — Card CRUD UI

## Goal

Replace the phase-2 single-hardcoded-card demo with a real card list backed
by `GET /api/cards` and a create/edit/delete UI. After this task, a user
can land on `/`, see every persisted card, open a form to create a new one,
edit any existing card's mutable fields, and delete a card with a
confirmation step. No kanban columns yet (task-02 adds DnD); cards render
as a flat list grouped by `status` for now.

## Inputs

- `tasks/phase-2/task-04-event-log-component.md` — the demo card pattern
  this task replaces
- `src/app/page.tsx` — current demo page that hardcodes one card; will be
  rewritten to render the real list
- `src/app/api/cards/route.ts`, `src/app/api/cards/[id]/route.ts` — the
  existing `GET`/`POST`/`PATCH`/`DELETE` endpoints (no API changes needed)
- `src/lib/store/index.ts` — `NewCardInput` shape, mutable Card fields
- `src/protocol/card.ts` — `CardSchema`, `CardStatusSchema`
- `docs/01-architecture.md` — Card data model

## Outputs

### `src/components/card-list.tsx`

Client component. Fetches `GET /api/cards` on mount, renders a flat list
(or `status`-grouped sections — the visual treatment is for the
frontend-design skill to decide). Holds the cards array in local state so
create/edit/delete can update without a full refetch. Exposes "New card",
"Edit", and "Delete" affordances per row.

### `src/components/card-form.tsx`

Client component. One form, two modes: `create` and `edit`. Fields:

- `title` (required, non-empty)
- `prompt` (required, non-empty multiline)
- `repoPath` (required, absolute path — surface a validation error if
  the value doesn't start with `/`; the worker's git step is the real
  authority on whether it's a repo, per task-02 out-of-scope)
- `baseBranch` (required, non-empty)
- `status` (edit mode only; `CardStatusSchema` enum)

On submit:

- `create` → `POST /api/cards` with `NewCardInput`. On `201`, lift the
  new card to the parent list; on `400`, render per-field validation
  messages from the response's `issues` array.
- `edit` → `PATCH /api/cards/:id` with only the changed fields. Same
  `400` handling.

Disable submit while in flight. Surface unexpected errors (`500`,
network) inline with the form, not a global toast — every failure
should be visible at the point of action per CLAUDE.md "no silent
failures".

### `src/components/card-delete-confirm.tsx`

Small confirmation surface (modal, popover, inline — design skill's
call). Two-step: click Delete → "Delete `<title>`? This removes the
card and its run history." → confirm calls `DELETE /api/cards/:id` and
removes the row on `204`. Cancel dismisses.

### `src/app/page.tsx`

Rewrite. Server component that:

- Calls `getStore().listCards()` and renders `<CardList initial={cards} />`.
- Drops the `PHASE2_DEMO_REPO`/`PHASE2_DEMO_BRANCH` env-var gating and
  the `ensureDemoCard` helper. The empty state is "no cards yet — click
  New card to start."
- Keeps `export const dynamic = "force-dynamic"`.

The phase-2 `RunCard` and `RunLog` components stay where they are;
clicking a card row shows them inline (or in task-04's drawer once
that lands — for this task, inline-under-the-row is fine).

### shadcn/ui

This is the right task to introduce shadcn/ui if the design skill asks
for it. Don't pre-decide which primitives to install in this task file;
the shadcn skill informs the install commands when the design skill
lands on a layout.

## Acceptance

UI testing is excluded by CLAUDE.md hard rules. Manual acceptance —
verify each of the following visible states by walking through them in
the browser:

1. **Empty state.** Wipe `~/.claude-kanban/cards/` (or point
   `CLAUDE_KANBAN_HOME` at a fresh temp dir), `pnpm dev`, navigate to
   `/`. The page shows the empty-state message and a "New card" affordance.
2. **Create — happy path.** Click New card. Fill all fields with valid
   values. Submit. The new card appears in the list immediately, with
   the title, prompt preview, and `status: backlog`. Reload the page —
   it's still there (proves it persisted via the API, not just local state).
3. **Create — validation error.** Open the form, leave `title` empty,
   submit. The form stays open, the title field shows an inline error,
   no card is created (verify by reload).
4. **Create — server error.** With the dev server running, submit a
   form whose `repoPath` is a relative path like `foo`. The form
   surfaces the `400 invalid_body` issue inline; no card is created.
5. **Edit — happy path.** Click Edit on an existing card. Change the
   `title` and `status`. Submit. The row updates in place. Reload —
   the change persisted.
6. **Edit — validation error.** Open Edit, clear `prompt`, submit. The
   form stays open with an inline error; the card is unchanged after
   reload.
7. **Delete — confirmation flow.** Click Delete on a card. The
   confirmation surface appears with the card's title. Click Cancel —
   the card is still in the list. Click Delete again, then Confirm —
   the row disappears immediately and the card file is gone from
   `~/.claude-kanban/cards/`.
8. **Phase-2 run pipeline still works.** Pick any card, click Run on
   it (the phase-2 `RunCard` button), watch the event log populate.
   This is a regression check: the rewrite of `page.tsx` must not
   break the run flow.

Document the manual walkthrough as the close-out evidence; no
automated UI tests.

## Out of scope

- Kanban columns and drag-and-drop — task-02.
- A side drawer for card detail with run history — task-04.
- Cancel button on a running card — task-05.
- Settings page (default repo, default model) — task-03. Until then,
  `repoPath` and `baseBranch` are entered per-card.
- PR creation, `gh` integration, diff rendering — phase 4.
- Bulk operations (multi-select delete, bulk status change). YAGNI for v1.
- Optimistic update rollback if a `PATCH` fails after an in-place edit.
  v1 keeps it simple: refetch the row on error.
- shadcn component selection. The design skill drives layout; the
  shadcn skill drives install commands. This task only commits to
  *what data and states* the form must handle.
