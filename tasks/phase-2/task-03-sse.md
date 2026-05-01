# phase-2 / task-03 — SSE event stream

## Goal

Implement the live event stream that the browser uses to watch a run
progress. `GET /api/cards/:id/runs/:runId/events` opens a Server-Sent
Events connection. On connect, replay every `EventLogEntry` from the
NDJSON log via `store.readEvents(runId)`, then subscribe to the
supervisor's `run-event` for live messages, filtering to the requested
`runId`. Heartbeat every 15s. Close cleanly when the run ends or the
client disconnects.

## Inputs

- `docs/01-architecture.md` — SSE endpoint contract; "browser disconnects
  from SSE" failure mode
- `src/lib/store/index.ts` — `readEvents(runId): AsyncIterable<EventLogEntry>`
- `src/lib/supervisor/index.ts` — `run-event` and `run-done` emitters
  (note: emitted globally for all runs; the SSE handler must filter by
  `runId`)
- `src/protocol/card.ts` — `EventLogEntry` shape

## Outputs

### `src/lib/sse/encode.ts`

Pure helpers, no Next.js imports:

- `encodeEvent(entry: EventLogEntry): string` — formats as
  `event: message\ndata: <JSON>\n\n` (or just `data:` if you skip
  named events; pick one and stick with it across phase-2/3).
- `encodeHeartbeat(): string` — returns a comment line `: hb\n\n`.
- `encodeDone(exitCode: number): string` — terminal frame the client
  uses to know the run is over (event name `done`).

These are the only stream-shape decisions; route handlers compose them.

### `src/lib/sse/runStream.ts`

```ts
export function openRunStream(
  runId: string,
  supervisor: Supervisor,
  store: Store,
  signal: AbortSignal,
): ReadableStream<Uint8Array>;
```

Implementation outline:

1. Create a `ReadableStream` whose `start(controller)`:
   - Replays `store.readEvents(runId)` (await iteration), encoding each
     entry via `encodeEvent` and enqueuing to the controller.
   - After replay, attaches listeners on the supervisor: a `run-event`
     listener that filters by `runId` and enqueues; a `run-done`
     listener that enqueues `encodeDone(exitCode)` and then closes the
     controller.
   - Starts a `setInterval` heartbeat every 15s.
2. `cancel()` (called when the client disconnects, signaled via
   `signal.aborted`): clears the heartbeat, removes both listeners,
   resolves any pending iteration. Worker keeps running — disconnecting
   from SSE never cancels the run (per architecture failure-mode table).

The replay-then-tail seam has a known race: an event can fire on the
supervisor while replay is mid-iteration, then also be appended to the
NDJSON log and replayed. Acceptable duplication in v1; the client
de-dupes on `(runId, timestamp, message.type)` if it matters. Document
this in the file's top comment; phase-3's `Last-Event-ID` work cleans
it up.

### `src/app/api/cards/[id]/runs/[runId]/events/route.ts`

- `GET` → opens the run stream with `openRunStream(runId,
  getSupervisor(), getStore(), request.signal)` and returns
  `new Response(stream, { headers: { "content-type": "text/event-stream",
  "cache-control": "no-cache, no-transform", "connection": "keep-alive"
  } })`.
- `404` if the run id is unknown to the store.
- Set `export const dynamic = "force-dynamic"` and the appropriate
  runtime export so Next.js doesn't try to cache or pre-render.

## Acceptance

`node --test` tests for the pure encoders and the stream helper, run via
the existing `pnpm test` glob:

- `encode.test.ts` — round-trip an `EventLogEntry` through `encodeEvent`
  and assert the wire format is parseable by a minimal SSE parser
  (write one inline; don't pull a library). Cover the `done` and
  heartbeat frames.
- `runStream.test.ts` — drive `openRunStream` with a fake `Supervisor`
  (an `EventEmitter` typed as `Supervisor`) and a fake `Store` whose
  `readEvents` yields a scripted sequence. Assert:
  - Replay frames are emitted before any live frame.
  - A `run-event` for a *different* `runId` is filtered out.
  - `run-done` produces a `done` frame and closes the stream.
  - Aborting the `signal` removes listeners (assert via
    `supervisor.listenerCount("run-event") === 0` after abort).

No UI tests. No real network.

## Out of scope

- The browser-side `EventSource` consumer — task-04.
- `Last-Event-ID` reconnect with offset — phase 3 nice-to-have.
- Backpressure / slow-consumer handling. v1 trusts that an `EventSource`
  on `localhost` keeps up.
- Multiplexing multiple runs on one connection. One stream per run id.
- Re-broadcasting historical runs that have already ended. The replay
  works for those, but there are no live frames after replay; the
  stream will close immediately on the existing `run-done` event (or
  immediately if no `run-done` is ever emitted because the run is long
  finished — handle this explicitly: if `store` knows the run ended,
  emit `done` after replay and close).
