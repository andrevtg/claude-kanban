# Phase 3 — Multi-card kanban

Phase 3 turns the phase-2 single-card demo into a real kanban with
persistent state, drag-to-run, cancel, and a settings page.

See the individual task files for goals, outputs, acceptance, and
out-of-scope:

- `task-01-card-crud.md` — card list + create/edit/delete UI
- `task-02-dnd-columns.md` — six-column board with `@dnd-kit` and
  drop-into-running triggers a run
- `task-03-settings-page.md` — `/settings` for `GlobalSettings`
- `task-04-card-detail-drawer.md` — drawer with run history and per-run
  event log
- `task-05-cancel-and-cleanup.md` — cooperative cancel via
  `query.interrupt()`, Cancel button, stale-run sweep on startup

**Phase-3 done when:** Multi-card kanban with persistent state.
Drag-to-run, cancel, settings.

Phase 3 explicitly does NOT do: PR creation, `gh` integration, hooks,
skills loading, MCP servers, persistence migrations. Those are phase 4
and beyond.
