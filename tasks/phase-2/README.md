# Phase 2 — Stubs

These are placeholders. Expand each into a full task file (matching the phase-1 format) when phase 1 is complete and you have a clearer picture of what Next.js needs.

---

## task-01 — Next.js bootstrap

Add Next.js 15 (App Router), Tailwind, shadcn/ui. Configure to coexist with the existing `src/cli/`, `src/lib/`, `src/worker/`, `src/protocol/`. The worker must still build as a standalone TS file consumed by `child_process.spawn`.

## task-02 — Route handlers

Implement `GET/POST /api/cards`, `PATCH/DELETE /api/cards/:id`, `POST /api/cards/:id/run`. All thin wrappers around the store + supervisor.

## task-03 — SSE

`GET /api/cards/:id/runs/:runId/events` opens an SSE stream. On connect, replay `store.readEvents(runId)`, then subscribe to live `run-event` from the supervisor for that run id. Heartbeat every 15s.

## task-04 — Event log component

Single hardcoded card on a stub page; "Run" button POSTs to the run endpoint, then opens the SSE stream and renders events incrementally. No DnD, no kanban yet.

**Phase-2 done when:** browser shows a card with a Run button; clicking it streams agent activity live.
