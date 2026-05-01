# Phase 2 — Next.js + live event log

Phase 2 wraps the phase-1 supervisor in a Next.js app and gets a single
card with a live event log working end-to-end in a browser. No kanban,
no DnD, no multi-card — those land in phase 3.

See the individual task files for goals, outputs, acceptance, and
out-of-scope:

- `task-01-nextjs-bootstrap.md` — Next.js 15 + Tailwind + supervisor singleton
- `task-02-route-handlers.md` — REST endpoints over the store + supervisor
- `task-03-sse.md` — `GET …/events` SSE stream (replay + live tail)
- `task-04-event-log-component.md` — single hardcoded card + run log UI

**Phase-2 done when:** browser shows a card with a Run button; clicking it
streams agent activity live, and the phase-1 CLI smoke test still works
unchanged.
