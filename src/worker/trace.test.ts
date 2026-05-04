// Tests for the trace writer + redactArgs.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, chmod, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MAX_ARG_BYTES, openTraceWriter, redactArgs, type TraceEntry } from "./trace.js";

describe("redactArgs", () => {
  it("returns short strings unchanged", () => {
    assert.equal(redactArgs("hello"), "hello");
  });

  it("truncates strings longer than maxBytes and reports the cut size", () => {
    const big = "x".repeat(10_000);
    const out = redactArgs(big, 100);
    assert.equal(typeof out, "string");
    assert.match(out as string, /\[truncated 9900 bytes\]$/);
  });

  it("walks objects and arrays recursively", () => {
    const big = "y".repeat(8000);
    const out = redactArgs({ a: { b: big, c: [big, "ok"] }, d: 1, e: true }, 100) as {
      a: { b: string; c: string[] };
      d: number;
      e: boolean;
    };
    assert.match(out.a.b, /\[truncated 7900 bytes\]$/);
    assert.match(out.a.c[0]!, /\[truncated 7900 bytes\]$/);
    assert.equal(out.a.c[1], "ok");
    assert.equal(out.d, 1);
    assert.equal(out.e, true);
  });

  it("replaces typed-array payloads with a marker", () => {
    const buf = new Uint8Array(2048);
    assert.equal(redactArgs(buf, 100), "[truncated 2048 bytes]");
  });

  it("uses a 4 KiB default cap", () => {
    const big = "z".repeat(DEFAULT_MAX_ARG_BYTES * 2);
    const out = redactArgs(big) as string;
    assert.match(out, /\[truncated \d+ bytes\]$/);
  });
});

describe("openTraceWriter", () => {
  async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), "ck-trace-"));
    try {
      return await fn(dir);
    } finally {
      // Restore writability before rm in case a test chmodded it.
      try {
        await chmod(dir, 0o700);
      } catch {
        // best effort
      }
      await rm(dir, { recursive: true, force: true });
    }
  }

  it("appends entries as JSONL and round-trips on read", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "run.jsonl");
      const w = openTraceWriter(path);
      const entries: TraceEntry[] = [
        { ts: "2026-05-04T00:00:00.000Z", tool: "Read", args: { path: "x" } },
        { ts: "2026-05-04T00:00:01.000Z", tool: "Bash", args: { cmd: "ls" } },
      ];
      for (const e of entries) await w.append(e);
      await w.close();
      const text = await readFile(path, "utf8");
      const lines = text
        .trim()
        .split("\n")
        .filter((l) => l.length > 0);
      assert.equal(lines.length, 2);
      assert.deepEqual(JSON.parse(lines[0]!), entries[0]);
      assert.deepEqual(JSON.parse(lines[1]!), entries[1]);
    });
  });

  it("preserves order under concurrent appends", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "run.jsonl");
      const w = openTraceWriter(path);
      const N = 50;
      // Fire all appends in parallel without awaiting individually; the
      // writer's internal queue must serialize them in submission order.
      const promises: Array<Promise<void>> = [];
      for (let i = 0; i < N; i++) {
        promises.push(w.append({ ts: new Date(i).toISOString(), tool: "T", args: { i } }));
      }
      await Promise.all(promises);
      await w.close();
      const text = await readFile(path, "utf8");
      const parsed = text
        .trim()
        .split("\n")
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l) as TraceEntry);
      assert.equal(parsed.length, N);
      for (let i = 0; i < N; i++) {
        assert.deepEqual((parsed[i]!.args as { i: number }).i, i);
      }
    });
  });

  it("creates the file even when no append is called", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "run.jsonl");
      const w = openTraceWriter(path);
      await w.close();
      const text = await readFile(path, "utf8");
      assert.equal(text, "");
    });
  });

  it("emits exactly one onError on a failing target and continues silently", async () => {
    await withTempDir(async (dir) => {
      // Make a read-only subdir so create-stream fails with EACCES on the
      // open or first write. We open in a non-existent nested path *under*
      // a read-only parent so mkdir(dirname, recursive) will fail.
      const ro = join(dir, "ro");
      await mkdir(ro, { recursive: true });
      await chmod(ro, 0o500);
      const path = join(ro, "nested", "run.jsonl");

      const errors: string[] = [];
      const w = openTraceWriter(path, {
        onError: (m) => errors.push(m),
      });
      // Multiple appends should still resolve and not blow up.
      await w.append({ ts: "t", tool: "A", args: {} });
      await w.append({ ts: "t", tool: "B", args: {} });
      await w.append({ ts: "t", tool: "C", args: {} });
      await w.close();
      assert.equal(errors.length, 1, "expected exactly one onError invocation");
    });
  });
});
