// Supervisor tests. Use scripted fake workers (see __fixtures__/) so we
// never invoke the real Agent SDK. Each test creates its own
// CLAUDE_KANBAN_HOME under tmpdir so the file store stays isolated.

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { Card, EventLogEntry, GlobalSettings } from "../../protocol/index.js";
import { memoryStore, type Store } from "../store/index.js";
import { DuplicateRunError, Supervisor, type RunHandle } from "./index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "__fixtures__");
const HAPPY = join(FIXTURES, "happy-worker.mjs");
const MALFORMED = join(FIXTURES, "malformed-worker.mjs");
const HANG = join(FIXTURES, "hang-worker.mjs");
const DIFF = join(FIXTURES, "diff-worker.mjs");
const PR_OK = join(FIXTURES, "pr-worker.mjs");
const PR_ERR = join(FIXTURES, "pr-error-worker.mjs");

const settings: GlobalSettings = {
  apiKeyPath: "/dev/null",
  defaultModel: "claude-opus-4-7",
  bashAllowlist: [],
  prAutoApprove: false,
};

async function makeCard(store: Store, overrides: Partial<Card> = {}): Promise<Card> {
  return store.createCard({
    title: overrides.title ?? "fixture",
    prompt: overrides.prompt ?? "do the thing",
    repoPath: overrides.repoPath ?? "/tmp/fake-repo",
    baseBranch: overrides.baseBranch ?? "main",
  });
}

async function withHome<T>(fn: () => Promise<T>): Promise<T> {
  const home = await mkdtemp(join(tmpdir(), "ck-supervisor-"));
  const prev = process.env.CLAUDE_KANBAN_HOME;
  process.env.CLAUDE_KANBAN_HOME = home;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_KANBAN_HOME;
    else process.env.CLAUDE_KANBAN_HOME = prev;
    await rm(home, { recursive: true, force: true });
  }
}

describe("Supervisor", () => {
  let store: Store;

  beforeEach(() => {
    store = memoryStore();
  });

  afterEach(() => {
    // memoryStore is GC'd; nothing to clean.
  });

  it("happy path: ready → events → done", async () => {
    await withHome(async () => {
      const sup = new Supervisor({ store, workerEntry: HAPPY });
      const card = await makeCard(store);

      const events: EventLogEntry[] = [];
      sup.on("run-event", (_runId, e) => events.push(e));
      const dones: Array<[string, number]> = [];
      sup.on("run-done", (runId, code) => dones.push([runId, code]));

      const handle = await sup.startRun(card, settings);
      assertHandle(handle, card.id);

      await sup.waitForDone(handle.runId);

      assert.equal(dones.length, 1);
      assert.equal(dones[0]?.[0], handle.runId);
      assert.equal(dones[0]?.[1], 0);

      // The worker emits one info event before done.
      assert.ok(
        events.some(
          (e) =>
            e.message.type === "event" &&
            e.message.event.kind === "worker" &&
            e.message.event.level === "info",
        ),
        "expected at least one worker info event",
      );

      const updated = await store.getCard(card.id);
      const run = updated?.runs.find((r) => r.id === handle.runId);
      assert.ok(run, "run should be persisted");
      assert.equal(run?.exitCode, 0);
      assert.ok(run?.endedAt, "run should have endedAt");
    });
  });

  it("emits a synthetic error event on a malformed line and stays alive", async () => {
    await withHome(async () => {
      const sup = new Supervisor({ store, workerEntry: MALFORMED });
      const card = await makeCard(store);

      const events: EventLogEntry[] = [];
      sup.on("run-event", (_id, e) => events.push(e));

      const handle = await sup.startRun(card, settings);
      await sup.waitForDone(handle.runId);

      const synthetic = events.filter(
        (e) =>
          e.message.type === "event" &&
          e.message.event.kind === "worker" &&
          e.message.event.level === "error" &&
          e.message.event.message.startsWith("supervisor:"),
      );
      assert.ok(synthetic.length >= 1, "expected a synthetic supervisor error event");

      const updated = await store.getCard(card.id);
      const run = updated?.runs.find((r) => r.id === handle.runId);
      assert.equal(run?.exitCode, 0, "run should still finish cleanly after a bad line");
    });
  });

  it("rejects a duplicate startRun for the same card", async () => {
    await withHome(async () => {
      const sup = new Supervisor({ store, workerEntry: HANG });
      const card = await makeCard(store);

      const handle = await sup.startRun(card, settings);
      try {
        await assert.rejects(
          () => sup.startRun(card, settings),
          (err: unknown) => err instanceof DuplicateRunError,
        );
      } finally {
        // Tear down the hang worker so the test process exits.
        await sup.cancel(handle.runId);
        // Forcefully kill via timeout escalation isn't wired up in this
        // supervisor instance; SIGKILL the child directly via the public
        // surface by constructing an aggressive shutdown supervisor — but
        // simpler: just send SIGKILL on the next event loop tick by
        // awaiting waitForDone with a fallback escalation.
        setTimeout(() => {
          // Best-effort: if the child is still alive, kill it.
          // The hang fixture installs a SIGTERM no-op, so SIGKILL only.
          try {
            process.kill(handle.pid, "SIGKILL");
          } catch {
            // already dead
          }
        }, 50);
        await sup.waitForDone(handle.runId);
      }
    });
  });

  it("persists diffStat onto the run when the worker emits diff_ready", async () => {
    await withHome(async () => {
      const sup = new Supervisor({ store, workerEntry: DIFF });
      const card = await makeCard(store);

      const handle = await sup.startRun(card, settings);
      await sup.waitForDone(handle.runId);

      // The updateRun call is fire-and-forget; let it settle.
      await new Promise((r) => setTimeout(r, 20));

      const updated = await store.getCard(card.id);
      const run = updated?.runs.find((r) => r.id === handle.runId);
      assert.deepStrictEqual(run?.diffStat, { files: 3, insertions: 7, deletions: 2 });
    });
  });

  it("persists prUrl when the worker emits pr_opened", async () => {
    await withHome(async () => {
      const sup = new Supervisor({ store, workerEntry: PR_OK });
      const card = await makeCard(store);

      const handle = await sup.startRun(card, settings);
      await sup.waitForDone(handle.runId);

      // updateRun is fire-and-forget; let it settle.
      await new Promise((r) => setTimeout(r, 20));

      const updated = await store.getCard(card.id);
      const run = updated?.runs.find((r) => r.id === handle.runId);
      assert.equal(run?.prUrl, "https://github.com/example/repo/pull/42");
    });
  });

  it("does not persist prUrl on a PR-related error message", async () => {
    await withHome(async () => {
      const sup = new Supervisor({ store, workerEntry: PR_ERR });
      const card = await makeCard(store);

      const handle = await sup.startRun(card, settings);
      await sup.waitForDone(handle.runId);
      await new Promise((r) => setTimeout(r, 20));

      const updated = await store.getCard(card.id);
      const run = updated?.runs.find((r) => r.id === handle.runId);
      assert.equal(run?.prUrl, undefined, "prUrl must remain unset on error");
    });
  });

  it("escalates a hung worker through cancel → SIGTERM → SIGKILL on timeout", async () => {
    await withHome(async () => {
      const sup = new Supervisor({
        store,
        workerEntry: HANG,
        defaultTimeoutMs: 50,
        sigtermDelayMs: 50,
        sigkillDelayMs: 50,
      });
      const card = await makeCard(store);

      const events: EventLogEntry[] = [];
      sup.on("run-event", (_id, e) => events.push(e));

      const start = Date.now();
      const handle = await sup.startRun(card, settings);
      await sup.waitForDone(handle.runId);
      const elapsed = Date.now() - start;

      // Cancel + SIGTERM + SIGKILL all fire on ~50ms timers; total well
      // under a few seconds. Allow generous slack.
      assert.ok(elapsed < 10_000, `expected quick escalation, took ${elapsed}ms`);

      const updated = await store.getCard(card.id);
      const run = updated?.runs.find((r) => r.id === handle.runId);
      assert.ok(run, "run should be persisted");
      assert.notEqual(run?.exitCode, 0, "killed worker should have non-zero exit");
      assert.ok(run?.endedAt, "run should have endedAt after escalation");

      // Synthetic event recording the timeout escalation.
      assert.ok(
        events.some(
          (e) =>
            e.message.type === "event" &&
            e.message.event.kind === "worker" &&
            e.message.event.level === "error" &&
            e.message.event.message.includes("wall-clock timeout"),
        ),
        "expected a timeout-escalation synthetic event",
      );
    });
  });
});

function assertHandle(handle: RunHandle, cardId: string): void {
  assert.equal(handle.cardId, cardId);
  assert.match(handle.runId, /^run_[0-9A-Z]{26}$/);
  assert.ok(handle.pid > 0, "pid should be a real number");
  assert.ok(handle.startedAt.length > 0, "startedAt should be set");
}
