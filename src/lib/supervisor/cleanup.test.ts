// Tests for sweepStaleWorktrees. Each case redirects ~/.claude-kanban via
// CLAUDE_KANBAN_HOME so the sweep works on isolated temp directories.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sweepStaleWorktrees } from "./cleanup.js";
import { memoryStore, type Store } from "../store/index.js";
import { diffPath, diffsDir, workDir } from "../paths.js";

const HOUR = 60 * 60 * 1000;

describe("sweepStaleWorktrees", () => {
  let homeDir: string;
  let prevHome: string | undefined;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "ck-sweep-"));
    prevHome = process.env.CLAUDE_KANBAN_HOME;
    process.env.CLAUDE_KANBAN_HOME = homeDir;
    await mkdir(workDir(), { recursive: true });
  });

  afterEach(async () => {
    if (prevHome === undefined) delete process.env.CLAUDE_KANBAN_HOME;
    else process.env.CLAUDE_KANBAN_HOME = prevHome;
    await rm(homeDir, { recursive: true, force: true });
  });

  async function makeWorktree(runId: string): Promise<string> {
    const path = join(workDir(), runId);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "marker"), "x", "utf8");
    return path;
  }

  async function exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }

  async function seedCardWithRun(
    store: Store,
    runId: string,
    endedAt: string | null,
  ): Promise<void> {
    const card = await store.createCard({
      title: "t",
      prompt: "p",
      repoPath: "/tmp/repo",
      baseBranch: "main",
    });
    await store.appendRun(card.id, { id: runId, startedAt: new Date(0).toISOString() });
    if (endedAt !== null) {
      await store.updateRun(card.id, runId, { endedAt, exitCode: 0 });
    }
  }

  it("returns empty result when work dir does not exist", async () => {
    await rm(workDir(), { recursive: true, force: true });
    const store = memoryStore();
    const r = await sweepStaleWorktrees(store);
    assert.deepEqual(r, { removed: [], kept: [], orphans: [] });
  });

  it("removes a worktree whose owning run ended longer ago than maxAgeMs", async () => {
    const store = memoryStore();
    const runId = "run_old";
    const path = await makeWorktree(runId);
    const endedAt = new Date(Date.now() - 48 * HOUR).toISOString();
    await seedCardWithRun(store, runId, endedAt);

    const r = await sweepStaleWorktrees(store, { maxAgeMs: 24 * HOUR });
    assert.deepEqual(r.removed, [runId]);
    assert.deepEqual(r.kept, []);
    assert.deepEqual(r.orphans, []);
    assert.equal(await exists(path), false);
  });

  it("keeps a recently finished run", async () => {
    const store = memoryStore();
    const runId = "run_recent";
    const path = await makeWorktree(runId);
    const endedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await seedCardWithRun(store, runId, endedAt);

    const r = await sweepStaleWorktrees(store, { maxAgeMs: 24 * HOUR });
    assert.deepEqual(r.removed, []);
    assert.deepEqual(r.kept, [runId]);
    assert.equal(await exists(path), true);
  });

  it("keeps an active run (no endedAt)", async () => {
    const store = memoryStore();
    const runId = "run_active";
    const path = await makeWorktree(runId);
    await seedCardWithRun(store, runId, null);

    const r = await sweepStaleWorktrees(store, { maxAgeMs: 24 * HOUR });
    assert.deepEqual(r.removed, []);
    assert.deepEqual(r.kept, [runId]);
    assert.equal(await exists(path), true);
  });

  it("flags orphans without deleting them", async () => {
    const store = memoryStore();
    const runId = "run_orphan";
    const path = await makeWorktree(runId);

    const r = await sweepStaleWorktrees(store, { maxAgeMs: 24 * HOUR });
    assert.deepEqual(r.removed, []);
    assert.deepEqual(r.kept, []);
    assert.deepEqual(r.orphans, [runId]);
    assert.equal(await exists(path), true);
  });

  it("ignores non run_-prefixed entries", async () => {
    const store = memoryStore();
    const stray = join(workDir(), "stray-dir");
    await mkdir(stray);

    const r = await sweepStaleWorktrees(store, { maxAgeMs: 24 * HOUR });
    assert.deepEqual(r, { removed: [], kept: [], orphans: [] });
    assert.equal(await exists(stray), true);
  });

  it("removes a stale run's diff patch alongside its worktree", async () => {
    const store = memoryStore();
    const runId = "run_diff_old";
    const path = await makeWorktree(runId);
    await mkdir(diffsDir(), { recursive: true });
    const patch = diffPath(runId);
    await writeFile(patch, "*** patch ***\n", "utf8");
    const endedAt = new Date(Date.now() - 48 * HOUR).toISOString();
    await seedCardWithRun(store, runId, endedAt);

    const r = await sweepStaleWorktrees(store, { maxAgeMs: 24 * HOUR });
    assert.deepEqual(r.removed, [runId]);
    assert.equal(await exists(path), false);
    assert.equal(await exists(patch), false);
  });

  it("uses the supplied `now` for deterministic age calculation", async () => {
    const store = memoryStore();
    const runId = "run_explicit";
    await makeWorktree(runId);
    const endedAt = "2026-01-01T00:00:00.000Z";
    await seedCardWithRun(store, runId, endedAt);

    const r = await sweepStaleWorktrees(store, {
      maxAgeMs: HOUR,
      now: new Date("2026-01-01T00:30:00.000Z"),
    });
    assert.deepEqual(r.kept, [runId]);

    const r2 = await sweepStaleWorktrees(store, {
      maxAgeMs: HOUR,
      now: new Date("2026-01-01T02:00:00.000Z"),
    });
    assert.deepEqual(r2.removed, [runId]);
  });
});
