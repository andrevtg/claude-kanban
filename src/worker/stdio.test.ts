// Verify NDJSON stdin parsing yields parsed WireMessages and surfaces
// ParseErrors as Result values without throwing.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import { makeSender, readWireMessages } from "./stdio.js";
import type { WireMessage } from "../protocol/messages.js";

function streamFrom(lines: string[]): Readable {
  return Readable.from(lines.map((l) => `${l}\n`));
}

describe("readWireMessages", () => {
  it("parses well-formed NDJSON lines into WireMessages", async () => {
    const input = streamFrom([
      JSON.stringify({ type: "ready" }),
      JSON.stringify({ type: "cancel" }),
    ]);
    const out: WireMessage[] = [];
    for await (const r of readWireMessages(input)) {
      assert.equal(r.ok, true);
      if (r.ok) out.push(r.value);
    }
    assert.deepStrictEqual(out, [{ type: "ready" }, { type: "cancel" }]);
  });

  it("yields a schema_mismatch Result for unknown discriminants", async () => {
    const input = streamFrom([JSON.stringify({ type: "nope" })]);
    const collected = [];
    for await (const r of readWireMessages(input)) collected.push(r);
    assert.equal(collected.length, 1);
    const first = collected[0];
    assert.ok(first);
    assert.equal(first.ok, false);
    if (!first.ok) assert.equal(first.error.kind, "schema_mismatch");
  });

  it("yields an invalid_json Result for malformed lines without throwing", async () => {
    const input = streamFrom(["{not json"]);
    const collected = [];
    for await (const r of readWireMessages(input)) collected.push(r);
    assert.equal(collected.length, 1);
    const first = collected[0];
    assert.ok(first);
    assert.equal(first.ok, false);
    if (!first.ok) assert.equal(first.error.kind, "invalid_json");
  });

  it("skips blank lines and terminates on EOF", async () => {
    const input = streamFrom(["", JSON.stringify({ type: "ready" }), ""]);
    const out: WireMessage[] = [];
    for await (const r of readWireMessages(input)) {
      if (r.ok) out.push(r.value);
    }
    assert.deepStrictEqual(out, [{ type: "ready" }]);
  });
});

describe("makeSender", () => {
  it("writes one NDJSON line per message", () => {
    const chunks: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(chunk.toString("utf8"));
        cb();
      },
    });
    const send = makeSender(sink);
    send({ type: "ready" });
    send({ type: "done", exitCode: 0 });
    const out = chunks.join("");
    const lines = out.split("\n").filter((l) => l.length > 0);
    assert.equal(lines.length, 2);
    assert.deepStrictEqual(JSON.parse(lines[0]!), { type: "ready" });
    assert.deepStrictEqual(JSON.parse(lines[1]!), { type: "done", exitCode: 0 });
  });
});
