# phase-2 / task-02 — Route handlers

## Goal

Implement the REST surface from `docs/01-architecture.md` "Browser ↔
Next.js" as App Router route handlers. Each is a thin wrapper around the
existing `Store` (phase-1/task-03) and `Supervisor` singleton from
phase-2/task-01. No business logic in routes beyond input validation and
mapping store/supervisor errors to HTTP status codes.

## Inputs

- `docs/01-architecture.md` — endpoint list and one-active-run-per-card
  invariant
- `src/protocol/card.ts`, `src/protocol/messages.ts` — types for request
  and response bodies
- `src/lib/store/index.ts` — `Store` interface
- `src/lib/supervisor/index.ts` — `Supervisor.startRun`, `cancel`,
  `approvePr`, `DuplicateRunError`, `UnknownRunError`
- `src/lib/supervisor/instance.ts` — `getSupervisor()` from task-01

## Outputs

### `src/app/api/cards/route.ts`

- `GET` → `store.listCards()`. Returns `Card[]`.
- `POST` → validates body with a Zod schema derived from
  `NewCardInput`, calls `store.createCard`, returns the created `Card`
  with status `201`.

### `src/app/api/cards/[id]/route.ts`

- `PATCH` → validates body as `Partial<Card>` (only mutable fields:
  `title`, `prompt`, `status`, `repoPath`, `baseBranch`). Returns updated
  `Card`. `404` if missing.
- `DELETE` → `store.deleteCard(id)`. `204` on success, `404` if missing.

### `src/app/api/cards/[id]/run/route.ts`

- `POST` → loads the card and current `GlobalSettings`, calls
  `supervisor.startRun(card, settings)`, returns
  `{ runId, cardId, pid, startedAt }` (the `RunHandle`). Maps:
  - `DuplicateRunError` → `409 Conflict` with `{ error: "run_active",
    runId }`.
  - Missing card → `404`.
  - Missing settings (`store.getSettings()` returns `null`) → `400` with
    a clear "configure settings first" message.

### `src/app/api/cards/[id]/runs/[runId]/cancel/route.ts`

- `POST` → calls `supervisor.cancel(runId)`. Always `202 Accepted`
  (cancellation is escalation-based per phase-1; the worker may take up
  to 10s to actually exit). See phase-3/task-05 README note for the
  cooperative-cancel follow-up.

### `src/app/api/cards/[id]/runs/[runId]/approve-pr/route.ts`

- `POST` → validates `{ title, body }`, calls `supervisor.approvePr`.
  `UnknownRunError` → `404`. `202 Accepted` on success — actual PR
  creation is async (phase-4 wires the worker side).

### Shared error handling

A small helper (`src/app/api/_lib/respond.ts` or similar, kept inside
`src/app/`) that converts:

- Zod validation failure → `400` with `{ error: "invalid_body", issues:
  [...] }`.
- Unexpected `Error` → `500` with `{ error: "internal", message }` and
  logs to `process.stderr`.

Per CLAUDE.md "no silent failures": every catch block either responds
with a structured error or rethrows.

## Acceptance

`node --test` integration tests under `src/app/api/**.test.ts` (run via
the existing `pnpm test` glob; extend the glob if needed). Tests use
`fetch` against route handlers invoked directly as functions (App Router
exports `GET/POST/...` so they can be imported and called with a `Request`)
— no real HTTP server needed.

- `POST /api/cards` with a valid body creates a card on disk (under a
  `CLAUDE_KANBAN_HOME` temp dir).
- `POST /api/cards` with a malformed body returns `400` and the card is
  not created.
- `PATCH /api/cards/:id` updates only the allowed fields; an attempt to
  patch `id` or `createdAt` is rejected (or silently dropped — pick one
  and document it in the route file's top comment).
- `POST /api/cards/:id/run` with a fake supervisor (inject via a test
  hook on `getSupervisor`, or by passing a `Supervisor` constructor
  override) returns `200` with a `RunHandle`.
- A second `POST /api/cards/:id/run` while the first is active returns
  `409`.
- `POST /api/cards/:id/runs/:runId/cancel` returns `202` regardless of
  whether the run is still active (cancel is idempotent per
  `Supervisor.cancel`'s "no-op if unknown" behavior).

No UI tests. No end-to-end tests against a real worker subprocess (those
live in the CLI smoke test).

## Out of scope

- SSE event streaming — task-03.
- The card UI that calls these endpoints — task-04.
- Settings endpoints (`/api/settings`) — phase 3 task-03.
- Authentication, rate limiting, CORS. Single-user localhost.
- A `Last-Event-ID`-aware stream for runs — phase 3 nice-to-have.
- Validating that `repoPath` is a real git repo at create time. The
  worker fails loudly if it isn't (phase-1 git error path); duplicating
  the check in the route is YAGNI.
