// Per-run tool-call trace writer (phase-4/task-03). Append-only JSONL at
// ~/.claude-kanban/traces/<runId>.jsonl. Hooked from the SDK PreToolUse
// matcher in run.ts. Trace failures must never crash the run: the writer
// emits exactly one warn event via the injected onError on first failure
// and silently skips subsequent appends.

import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export interface TraceEntry {
  ts: string;
  tool: string;
  args: unknown;
}

export interface TraceWriter {
  append(entry: TraceEntry): Promise<void>;
  close(): Promise<void>;
}

export interface OpenTraceWriterOptions {
  // Called at most once when a write or open fails. Subsequent failures
  // are swallowed to avoid log spam.
  onError?: (message: string) => void;
}

export const DEFAULT_MAX_ARG_BYTES = 4096;

export function openTraceWriter(
  path: string,
  opts: OpenTraceWriterOptions = {},
): TraceWriter {
  let stream: WriteStream | null = null;
  let failed = false;
  let warned = false;
  let closed = false;

  function reportFailure(e: unknown): void {
    failed = true;
    if (!warned) {
      warned = true;
      opts.onError?.(e instanceof Error ? e.message : String(e));
    }
  }

  // Open eagerly so the file exists even if no tool calls fire (acceptance #5).
  const openPromise = (async () => {
    try {
      await mkdir(dirname(path), { recursive: true });
      stream = createWriteStream(path, { flags: "a" });
      stream.on("error", (e) => reportFailure(e));
    } catch (e) {
      reportFailure(e);
    }
  })();

  let queue: Promise<void> = openPromise;

  return {
    append(entry: TraceEntry): Promise<void> {
      if (closed) return Promise.resolve();
      const next = queue.then(async () => {
        if (failed || closed || !stream) return;
        try {
          const line = `${JSON.stringify(entry)}\n`;
          await new Promise<void>((resolve, reject) => {
            stream!.write(line, (err) => (err ? reject(err) : resolve()));
          });
        } catch (e) {
          reportFailure(e);
        }
      });
      queue = next;
      return next;
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      try {
        await queue;
      } catch {
        // queue chain swallows errors via reportFailure; ignore
      }
      if (stream) {
        const s = stream;
        await new Promise<void>((resolve) => s.end(() => resolve()));
        stream = null;
      }
    },
  };
}

// Walk the tool input and truncate large strings; replace binary payloads
// with a "[truncated N bytes]" marker. The trace is forensic: long inputs
// stay in the regular event log, not here.
export function redactArgs(input: unknown, maxBytes: number = DEFAULT_MAX_ARG_BYTES): unknown {
  return walk(input, maxBytes);
}

function walk(value: unknown, maxBytes: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    const byteLen = Buffer.byteLength(value, "utf8");
    if (byteLen <= maxBytes) return value;
    const head = Buffer.from(value, "utf8").subarray(0, maxBytes).toString("utf8");
    return `${head}…[truncated ${byteLen - maxBytes} bytes]`;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return typeof value === "bigint" ? value.toString() : value;
  }
  if (value instanceof Uint8Array) {
    return `[truncated ${value.byteLength} bytes]`;
  }
  if (Array.isArray(value)) {
    return value.map((v) => walk(v, maxBytes));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = walk(v, maxBytes);
    }
    return out;
  }
  return undefined;
}
