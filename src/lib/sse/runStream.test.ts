import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import type { EventLogEntry } from "../../protocol/index.js";
import { memoryStore, type Store } from "../store/index.js";
import type { Supervisor } from "../supervisor/index.js";
import { openRunStream } from "./runStream.js";

// Fake supervisor: an EventEmitter plus an `isActive(runId)` toggle. Cast
// to Supervisor at the boundary since openRunStream only touches on/off
// and isActive.
class FakeSupervisor extends EventEmitter {
  active = new Set<string>();
  isActive(runId: string): boolean {
    return this.active.has(runId);
  }
}

function asSupervisor(fake: FakeSupervisor): Supervisor {
  // reason: structural test double; FakeSupervisor only implements the
  // subset openRunStream consumes (on/off/listenerCount/isActive).
  return fake as unknown as Supervisor;
}

function decode(chunks: Uint8Array[]): string {
  const dec = new TextDecoder();
  return chunks.map((c) => dec.decode(c)).join("");
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return decode(chunks);
}

function evt(timestamp: string, msg: string): EventLogEntry {
  return {
    timestamp,
    message: { type: "event", event: { kind: "worker", level: "info", message: msg } },
  };
}

describe("openRunStream", () => {
  it("replays persisted events before live frames", async () => {
    const store = memoryStore();
    const sup = new FakeSupervisor();
    sup.active.add("run_A");

    await store.appendEvent("run_A", evt("2026-05-01T00:00:00.000Z", "replay-1"));
    await store.appendEvent("run_A", evt("2026-05-01T00:00:01.000Z", "replay-2"));

    const ac = new AbortController();
    const stream = openRunStream("run_A", asSupervisor(sup), store, ac.signal);

    const reader = stream.getReader();
    const dec = new TextDecoder();
    let buf = "";
    // Read at least the two replay frames.
    const firstSeen = await Promise.race([
      (async () => {
        while (!buf.includes("replay-2")) {
          const { value, done } = await reader.read();
          if (done) return false;
          if (value) buf += dec.decode(value);
        }
        return true;
      })(),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1000)),
    ]);
    assert.equal(firstSeen, true, "expected both replay frames");

    // Now emit a live event; it must arrive after the replay output.
    sup.emit("run-event", "run_A", evt("2026-05-01T00:00:02.000Z", "live-1"));

    while (!buf.includes("live-1")) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) buf += dec.decode(value);
    }
    const replayIdx = buf.indexOf("replay-1");
    const liveIdx = buf.indexOf("live-1");
    assert.ok(replayIdx >= 0 && liveIdx > replayIdx, "live frame must follow replay");

    ac.abort();
    await reader.cancel().catch(() => {});
  });

  it("filters live events for other runs", async () => {
    const store = memoryStore();
    const sup = new FakeSupervisor();
    sup.active.add("run_A");

    const ac = new AbortController();
    const stream = openRunStream("run_A", asSupervisor(sup), store, ac.signal);

    const reader = stream.getReader();

    // Emit one event for the wrong run, then one for ours, then done.
    setImmediate(() => {
      sup.emit("run-event", "run_OTHER", evt("t1", "wrong-run"));
      sup.emit("run-event", "run_A", evt("t2", "right-run"));
      sup.active.delete("run_A");
      sup.emit("run-done", "run_A", 0);
    });

    let buf = "";
    const dec = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) buf += dec.decode(value);
    }

    assert.ok(!buf.includes("wrong-run"), "must not leak other-run events");
    assert.ok(buf.includes("right-run"), "must include this-run events");
    assert.ok(buf.includes("event: done"), "must emit done frame");
  });

  it("run-done emits a done frame and closes the stream", async () => {
    const store = memoryStore();
    const sup = new FakeSupervisor();
    sup.active.add("run_A");

    const ac = new AbortController();
    const stream = openRunStream("run_A", asSupervisor(sup), store, ac.signal);

    const reader = stream.getReader();
    // Wait one microtask so listeners attach, then fire done.
    setImmediate(() => {
      sup.active.delete("run_A");
      sup.emit("run-done", "run_A", 42);
    });

    let buf = "";
    const dec = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) buf += dec.decode(value);
    }

    assert.match(buf, /event: done/);
    assert.match(buf, /"exitCode":42/);
    assert.equal(sup.listenerCount("run-event"), 0);
    assert.equal(sup.listenerCount("run-done"), 0);
  });

  it("aborting the signal removes listeners", async () => {
    const store = memoryStore();
    const sup = new FakeSupervisor();
    sup.active.add("run_A");

    const ac = new AbortController();
    const stream = openRunStream("run_A", asSupervisor(sup), store, ac.signal);

    // Read once so start() runs and listeners attach.
    const reader = stream.getReader();
    // Kick the event loop so start() proceeds past replay (empty here).
    await new Promise((r) => setImmediate(r));
    // After replay, listeners should be on.
    assert.equal(sup.listenerCount("run-event"), 1);

    ac.abort();
    // Drain any pending output.
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    assert.equal(sup.listenerCount("run-event"), 0);
    assert.equal(sup.listenerCount("run-done"), 0);
  });

  it("synthesizes a done frame when the run already terminated", async () => {
    const store: Store = memoryStore();
    // Seed a card whose run carries an exitCode.
    const card = await store.createCard({
      title: "t",
      prompt: "p",
      repoPath: "/tmp/r",
      baseBranch: "main",
    });
    await store.appendRun(card.id, { id: "run_DONE", startedAt: "2026-05-01T00:00:00.000Z" });
    await store.updateRun(card.id, "run_DONE", { endedAt: "2026-05-01T00:00:05.000Z", exitCode: 3 });

    const sup = new FakeSupervisor(); // run_DONE is not active.
    const ac = new AbortController();
    const stream = openRunStream("run_DONE", asSupervisor(sup), store, ac.signal);

    const out = await readAll(stream);
    assert.match(out, /event: done/);
    assert.match(out, /"exitCode":3/);
  });
});
