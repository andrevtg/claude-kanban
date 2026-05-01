import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EventLogEntry } from "../../protocol/index.js";
import { encodeDone, encodeEvent, encodeHeartbeat } from "./encode.js";

// Minimal SSE parser. Yields { event, data } per dispatched chunk; ignores
// comment lines (`:`-prefixed). Just enough to round-trip what encode.ts
// produces. Never used outside this test.
type Frame = { event: string; data: string };
function parseSse(buf: string): Frame[] {
  const frames: Frame[] = [];
  for (const block of buf.split(/\n\n/)) {
    if (block.length === 0) continue;
    let event = "message";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) event = line.slice(6).trimStart();
      else if (line.startsWith("data:")) data += line.slice(5).trimStart();
    }
    if (data.length > 0 || event !== "message") frames.push({ event, data });
  }
  return frames;
}

describe("sse/encode", () => {
  it("encodeEvent round-trips through a minimal SSE parser", () => {
    const entry: EventLogEntry = {
      timestamp: "2026-05-01T12:00:00.000Z",
      message: {
        type: "event",
        event: { kind: "worker", level: "info", message: "hello" },
      },
    };
    const frame = encodeEvent(entry);
    const parsed = parseSse(frame);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.event, "message");
    assert.deepEqual(JSON.parse(parsed[0]!.data), entry);
  });

  it("encodeDone produces a `done` frame with exitCode payload", () => {
    const frame = encodeDone(0);
    const parsed = parseSse(frame);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.event, "done");
    assert.deepEqual(JSON.parse(parsed[0]!.data), { exitCode: 0 });
  });

  it("encodeHeartbeat is a comment line, not a delivered event", () => {
    const frame = encodeHeartbeat();
    assert.match(frame, /^:\s*hb\n\n$/);
    assert.equal(parseSse(frame).length, 0);
  });

  it("frames concatenate cleanly into a single stream", () => {
    const entry: EventLogEntry = {
      timestamp: "2026-05-01T12:00:01.000Z",
      message: { type: "ready" },
    };
    const stream = encodeEvent(entry) + encodeHeartbeat() + encodeDone(7);
    const parsed = parseSse(stream);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0]?.event, "message");
    assert.equal(parsed[1]?.event, "done");
    assert.deepEqual(JSON.parse(parsed[1]!.data), { exitCode: 7 });
  });
});
