// Replay-then-tail SSE stream for one run.
//
// Sequence on connect:
//   1. Drain the persisted NDJSON log via store.readEvents(runId).
//   2. Subscribe to the supervisor for live events filtered by runId.
//   3. If the run is no longer active in the supervisor, look up its
//      exitCode from the store and emit a terminal `done` frame.
//   4. Tick a 15s heartbeat comment to keep proxies from idling out.
//
// Known race: between replay finishing and listeners attaching, the
// supervisor may emit an event that *also* lands in the NDJSON log. In
// v1 we accept the duplicate; clients de-dupe on (timestamp, message).
// Phase-3 `Last-Event-ID` work fixes this properly.

import type { EventLogEntry } from "../../protocol/index.js";
import type { Store } from "../store/index.js";
import type { Supervisor } from "../supervisor/index.js";
import { encodeDone, encodeEvent, encodeHeartbeat } from "./encode.js";

const HEARTBEAT_MS = 15_000;

export function openRunStream(
  runId: string,
  supervisor: Supervisor,
  store: Store,
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let runEventListener: ((id: string, entry: EventLogEntry) => void) | null = null;
  let runDoneListener: ((id: string, exitCode: number) => void) | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let abortListener: (() => void) | null = null;
  let closed = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (frame: string): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          // controller already closed — happens on a racy abort
        }
      };

      const teardown = (): void => {
        if (closed) return;
        closed = true;
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (runEventListener) supervisor.off("run-event", runEventListener);
        if (runDoneListener) supervisor.off("run-done", runDoneListener);
        if (abortListener) signal.removeEventListener("abort", abortListener);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      abortListener = teardown;
      signal.addEventListener("abort", abortListener);

      // Replay persisted events.
      for await (const entry of store.readEvents(runId)) {
        if (signal.aborted || closed) return;
        enqueue(encodeEvent(entry));
      }

      if (signal.aborted || closed) return;

      // Subscribe to live events for this run.
      runEventListener = (id: string, entry: EventLogEntry): void => {
        if (id !== runId) return;
        enqueue(encodeEvent(entry));
      };
      runDoneListener = (id: string, exitCode: number): void => {
        if (id !== runId) return;
        enqueue(encodeDone(exitCode));
        teardown();
      };
      supervisor.on("run-event", runEventListener);
      supervisor.on("run-done", runDoneListener);

      // Heartbeat keeps the connection warm under intermediaries.
      heartbeatTimer = setInterval(() => enqueue(encodeHeartbeat()), HEARTBEAT_MS);

      // If the run already terminated, no run-done will fire — emit one
      // synthesized from the persisted exit code and close.
      if (!supervisor.isActive(runId)) {
        const exitCode = await findPersistedExitCode(store, runId);
        enqueue(encodeDone(exitCode ?? 0));
        teardown();
      }
    },
    cancel() {
      if (closed) return;
      closed = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (runEventListener) supervisor.off("run-event", runEventListener);
      if (runDoneListener) supervisor.off("run-done", runDoneListener);
      if (abortListener) signal.removeEventListener("abort", abortListener);
    },
  });
}

async function findPersistedExitCode(
  store: Store,
  runId: string,
): Promise<number | undefined> {
  for (const card of await store.listCards()) {
    const run = card.runs.find((r) => r.id === runId);
    if (run) return run.exitCode;
  }
  return undefined;
}
