// Cooperative cancel for runAgent. Uses a fake `query` so we can assert
// that interrupt() is called on a `cancel` wire line and that re-entrant
// cancels are no-ops.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import type { query } from "@anthropic-ai/claude-agent-sdk";
import { runAgent } from "./run.js";
import type { RunInitPayload, WireMessage } from "../protocol/messages.js";

function makeInit(): RunInitPayload {
  return {
    runId: "run_canceltest",
    cardId: "card_canceltest",
    prompt: "noop",
    repoPath: "/tmp/repo",
    baseBranch: "main",
    worktreePath: "/tmp/wt",
    branchName: "claude-kanban/run_canceltest",
    model: "claude-opus-4-7",
    allowedTools: ["Read"],
    bashAllowlist: [],
    maxTurns: 1,
  };
}

interface FakeQuery {
  q: ReturnType<typeof query>;
  awaitLoopReady: () => Promise<void>;
  interrupt: () => Promise<void>;
  finish: () => void;
  interruptCalls: number;
}

// Returns an SDK-shaped Query that yields nothing until either `finish()` is
// called externally or the consumer awaits `interrupt()`. The for-await loop
// over `q` therefore stays open until cancellation lands.
function fakeQuery(): FakeQuery {
  let interruptCalls = 0;
  let resolveLoop!: (v: IteratorResult<unknown>) => void;
  const pending = new Promise<IteratorResult<unknown>>((r) => {
    resolveLoop = r;
  });

  const iter: AsyncGenerator<unknown, void> = {
    next: () => pending,
    return: async () => ({ value: undefined, done: true }),
    throw: async (e: unknown) => {
      throw e instanceof Error ? e : new Error(String(e));
    },
    [Symbol.asyncIterator]() {
      return iter;
    },
    [Symbol.asyncDispose]: async () => {},
  };

  const q = Object.assign(iter, {
    interrupt: async () => {
      interruptCalls += 1;
      // Settle the iterator so the for-await loop in runAgent exits.
      resolveLoop({ value: undefined, done: true });
    },
    setPermissionMode: async () => {},
    setModel: async () => {},
    supportedCommands: async () => [],
    supportedModels: async () => [],
    mcpServerStatus: async () => [],
    setSettingSources: async () => {},
  }) as unknown as ReturnType<typeof query>;

  return {
    q,
    awaitLoopReady: async () => {
      // Yield to the event loop so the cancel reader and the SDK iterator
      // both subscribe before the test writes the cancel line.
      await new Promise((r) => setImmediate(r));
    },
    interrupt: async () => {
      await (q as unknown as { interrupt: () => Promise<void> }).interrupt();
    },
    finish: () => resolveLoop({ value: undefined, done: true }),
    get interruptCalls(): number {
      return interruptCalls;
    },
  };
}

describe("runAgent cooperative cancel", () => {
  it("calls query.interrupt() on a cancel wire message and emits a worker event", async () => {
    const fake = fakeQuery();
    const queryFn = (() => fake.q) as unknown as typeof query;

    const cancelLine = `${JSON.stringify({ type: "cancel" })}\n`;
    const input = Readable.from([cancelLine]);

    const collected: WireMessage[] = [];
    const send = (m: WireMessage): void => {
      collected.push(m);
    };

    const { exitCode } = await runAgent(makeInit(), send, input, { queryFn });

    assert.equal(exitCode, 0);
    assert.equal(fake.interruptCalls, 1, "expected interrupt() to be called once");

    const cancellingEvents = collected.filter(
      (m) =>
        m.type === "event" &&
        m.event.kind === "worker" &&
        m.event.message.startsWith("cancelling"),
    );
    assert.equal(cancellingEvents.length, 1, "expected exactly one cancelling worker event");
  });

  it("ignores re-entrant cancel messages", async () => {
    const fake = fakeQuery();
    const queryFn = (() => fake.q) as unknown as typeof query;

    const lines = [
      `${JSON.stringify({ type: "cancel" })}\n`,
      `${JSON.stringify({ type: "cancel" })}\n`,
      `${JSON.stringify({ type: "cancel" })}\n`,
    ];
    const input = Readable.from(lines);

    const collected: WireMessage[] = [];
    const { exitCode } = await runAgent(
      makeInit(),
      (m) => collected.push(m),
      input,
      { queryFn },
    );

    assert.equal(exitCode, 0);
    assert.equal(fake.interruptCalls, 1, "interrupt() should fire once even with multiple cancels");

    const cancellingEvents = collected.filter(
      (m) =>
        m.type === "event" &&
        m.event.kind === "worker" &&
        m.event.message.startsWith("cancelling"),
    );
    assert.equal(cancellingEvents.length, 1);
  });

  it("ignores unknown stdin messages and leaves the SDK iterator running", async () => {
    const fake = fakeQuery();
    const queryFn = (() => fake.q) as unknown as typeof query;

    // Send an approve_pr line (valid wire message, not handled by the worker
    // in phase-3) and then finish the SDK loop externally. The cancel reader
    // must not call interrupt() here.
    const approveLine = `${JSON.stringify({ type: "approve_pr", title: "x", body: "y" })}\n`;
    const input = Readable.from([approveLine]);

    const collected: WireMessage[] = [];

    // Schedule the SDK iterator to settle on its own so runAgent returns.
    setImmediate(() => fake.finish());

    const { exitCode } = await runAgent(
      makeInit(),
      (m) => collected.push(m),
      input,
      { queryFn },
    );

    assert.equal(exitCode, 0);
    assert.equal(fake.interruptCalls, 0, "interrupt() must not fire for non-cancel messages");
  });
});
