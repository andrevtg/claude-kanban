// Store contract tests. Runs both implementations through the same suite so
// we keep them honest: the in-memory store is only useful as a fake if it
// behaves like the real one at the boundary.
//
// Run with: pnpm test:store

import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  CardNotFoundError,
  RunNotFoundError,
  StoreReadError,
  fileStore,
  memoryStore,
  type Store,
} from "./index.js";
import type { EventLogEntry, GlobalSettings, Run } from "../../protocol/index.js";
import { cardFile, claudeKanbanDir, runLog } from "../paths.js";

const sampleSettings: GlobalSettings = {
  apiKeyPath: "/dev/null",
  defaultModel: "claude-opus-4-7",
  bashAllowlist: ["git status"],
  prAutoApprove: false,
};

function sampleRun(id = "run_TEST"): Run {
  return {
    id,
    startedAt: "2026-04-30T00:00:00.000Z",
  };
}

function sampleEvent(): EventLogEntry {
  return {
    timestamp: "2026-04-30T00:00:00.000Z",
    message: { type: "ready" },
  };
}

type StoreFactory = () => { store: Store; setup(): Promise<void>; teardown(): Promise<void> };

const factories: Array<{ name: string; make: StoreFactory }> = [
  {
    name: "memoryStore",
    make: () => {
      const store = memoryStore();
      return { store, setup: async () => {}, teardown: async () => {} };
    },
  },
  {
    name: "fileStore",
    make: () => {
      let tmp = "";
      let prev: string | undefined;
      const store = fileStore();
      return {
        store,
        setup: async () => {
          tmp = await mkdtemp(join(tmpdir(), "claude-kanban-test-"));
          prev = process.env.CLAUDE_KANBAN_HOME;
          process.env.CLAUDE_KANBAN_HOME = tmp;
        },
        teardown: async () => {
          if (prev === undefined) delete process.env.CLAUDE_KANBAN_HOME;
          else process.env.CLAUDE_KANBAN_HOME = prev;
          await rm(tmp, { recursive: true, force: true });
        },
      };
    },
  },
];

for (const { name, make } of factories) {
  describe(`Store contract — ${name}`, () => {
    let h: ReturnType<StoreFactory>;
    beforeEach(async () => {
      h = make();
      await h.setup();
    });
    afterEach(async () => {
      await h.teardown();
    });

    it("settings round-trip", async () => {
      assert.equal(await h.store.getSettings(), null);
      await h.store.saveSettings(sampleSettings);
      assert.deepStrictEqual(await h.store.getSettings(), sampleSettings);
    });

    it("create / list / get / update / delete card", async () => {
      const created = await h.store.createCard({
        title: "t",
        prompt: "p",
        repoPath: "/tmp/r",
        baseBranch: "main",
      });
      assert.match(created.id, /^card_/);
      assert.equal(created.status, "backlog");
      assert.equal(created.runs.length, 0);

      const list = await h.store.listCards();
      assert.equal(list.length, 1);
      assert.equal(list[0]!.id, created.id);

      const got = await h.store.getCard(created.id);
      assert.deepStrictEqual(got, created);

      const updated = await h.store.updateCard(created.id, { status: "running" });
      assert.equal(updated.status, "running");
      assert.equal(updated.id, created.id);
      assert.equal(updated.createdAt, created.createdAt);
      assert.notEqual(updated.updatedAt, created.updatedAt);

      await h.store.deleteCard(created.id);
      assert.equal(await h.store.getCard(created.id), null);
      assert.equal((await h.store.listCards()).length, 0);
    });

    it("getCard returns null for missing", async () => {
      assert.equal(await h.store.getCard("card_DOES_NOT_EXIST"), null);
    });

    it("updateCard throws CardNotFoundError for missing", async () => {
      await assert.rejects(
        () => h.store.updateCard("card_NOPE", { status: "done" }),
        CardNotFoundError,
      );
    });

    it("deleteCard throws CardNotFoundError for missing", async () => {
      await assert.rejects(() => h.store.deleteCard("card_NOPE"), CardNotFoundError);
    });

    it("appendRun and patchRun", async () => {
      const card = await h.store.createCard({
        title: "t",
        prompt: "p",
        repoPath: "/tmp/r",
        baseBranch: "main",
      });
      await h.store.appendRun(card.id, sampleRun("run_A"));
      const after1 = await h.store.getCard(card.id);
      assert.equal(after1!.runs.length, 1);
      assert.equal(after1!.runs[0]!.id, "run_A");

      await h.store.patchRun(card.id, "run_A", {
        endedAt: "2026-04-30T01:00:00.000Z",
        exitCode: 0,
      });
      const after2 = await h.store.getCard(card.id);
      assert.equal(after2!.runs[0]!.exitCode, 0);
      assert.equal(after2!.runs[0]!.endedAt, "2026-04-30T01:00:00.000Z");

      await assert.rejects(
        () => h.store.patchRun(card.id, "run_NOPE", { exitCode: 1 }),
        RunNotFoundError,
      );
      await assert.rejects(() => h.store.appendRun("card_NOPE", sampleRun()), CardNotFoundError);
    });

    it("100 concurrent appendEvent calls produce 100 valid lines", async () => {
      const runId = "run_CONCURRENT";
      const tasks: Array<Promise<void>> = [];
      for (let i = 0; i < 100; i++) {
        tasks.push(
          h.store.appendEvent(runId, {
            timestamp: new Date().toISOString(),
            message: { type: "event", event: { kind: "worker", level: "info", message: `n=${i}` } },
          }),
        );
      }
      await Promise.all(tasks);
      const seen: EventLogEntry[] = [];
      for await (const e of h.store.readEvents(runId)) seen.push(e);
      assert.equal(seen.length, 100);
      for (const e of seen) {
        assert.equal(e.message.type, "event");
      }
    });

    it("readEvents on missing run yields nothing", async () => {
      const seen: EventLogEntry[] = [];
      for await (const e of h.store.readEvents("run_DOES_NOT_EXIST")) seen.push(e);
      assert.equal(seen.length, 0);
    });

    it("appendEvent then readEvents round-trips an event", async () => {
      await h.store.appendEvent("run_RT", sampleEvent());
      const seen: EventLogEntry[] = [];
      for await (const e of h.store.readEvents("run_RT")) seen.push(e);
      assert.equal(seen.length, 1);
      assert.deepStrictEqual(seen[0], sampleEvent());
    });
  });
}

// File-store-specific assertions: atomic writes, leftover .tmp cleanup, and
// corruption surfacing as StoreReadError.
describe("fileStore — disk-specific", () => {
  let tmp = "";
  let prev: string | undefined;
  const store = fileStore();

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "claude-kanban-test-"));
    prev = process.env.CLAUDE_KANBAN_HOME;
    process.env.CLAUDE_KANBAN_HOME = tmp;
  });
  afterEach(async () => {
    if (prev === undefined) delete process.env.CLAUDE_KANBAN_HOME;
    else process.env.CLAUDE_KANBAN_HOME = prev;
    await rm(tmp, { recursive: true, force: true });
  });

  it("respects CLAUDE_KANBAN_HOME for path resolution", async () => {
    assert.ok(claudeKanbanDir().startsWith(tmp));
  });

  it("delete removes the JSON file from disk", async () => {
    const card = await store.createCard({
      title: "t",
      prompt: "p",
      repoPath: "/tmp/r",
      baseBranch: "main",
    });
    const file = cardFile(card.id);
    await assert.doesNotReject(readFile(file));
    await store.deleteCard(card.id);
    await assert.rejects(readFile(file));
  });

  it("write does not leave .tmp files behind", async () => {
    await store.createCard({
      title: "t",
      prompt: "p",
      repoPath: "/tmp/r",
      baseBranch: "main",
    });
    const names = await readdir(join(tmp, "cards"));
    const tmpLeft = names.filter((n) => n.includes(".tmp-"));
    assert.equal(tmpLeft.length, 0);
  });

  it("getCard surfaces StoreReadError on corrupt JSON", async () => {
    const card = await store.createCard({
      title: "t",
      prompt: "p",
      repoPath: "/tmp/r",
      baseBranch: "main",
    });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(cardFile(card.id), "{ not valid json", "utf8");
    await assert.rejects(() => store.getCard(card.id), StoreReadError);
  });

  it("readEvents surfaces StoreReadError on corrupt NDJSON line", async () => {
    const runId = "run_BAD";
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(join(tmp, "logs"), { recursive: true });
    await writeFile(runLog(runId), "{not json}\n", "utf8");
    await assert.rejects(async () => {
      for await (const _e of store.readEvents(runId)) {
        // exhaust
      }
    }, StoreReadError);
  });
});
