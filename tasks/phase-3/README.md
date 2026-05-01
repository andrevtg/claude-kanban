# Phase 3 — Stubs

## task-01 — Card CRUD UI

Modal/drawer for creating and editing cards. Form fields: title, prompt, repo path, base branch, model override.

## task-02 — DnD columns

`@dnd-kit/core` + `@dnd-kit/sortable`. Six columns matching `CardStatus` (`backlog`, `ready`, `running`, `review`, `done`, `failed`). Drag updates the card's status via `PATCH`. Dragging into "running" triggers `POST /run`.

## task-03 — Settings page

Edit `GlobalSettings`. API key entry (write to a 0600 file under `~/.claude-kanban/`). Default repo, default model, bash allowlist editor.

## task-04 — Card detail drawer

Click a card → side drawer with full event log, run history, and (later) diff/PR.

## task-05 — Cancel and cleanup

Cancel button on a running card. Calls `POST /api/cards/:id/runs/:runId/cancel`. Old worktree directories are GC'd on a stale-run sweep at app startup.

> Note: phase-1 supervisor's `cancel(runId)` writes a `{type:"cancel"}` line to the worker's stdin, but the worker's SDK loop in `src/worker/run.ts` does not read stdin — only the SIGTERM/SIGKILL escalation in `Supervisor.escalate` actually stops the run. Before this UI lands, wire `q.interrupt()` in `src/worker/run.ts` (consume `readWireMessages` concurrently with the SDK iterator) so Cancel feels responsive instead of waiting out the 5+5s escalation.

**Phase-3 done when:** Multi-card kanban with persistent state. Drag-to-run, cancel, settings.
