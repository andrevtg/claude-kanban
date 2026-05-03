// Stale-run sweep. Deletes worktree directories under ~/.claude-kanban/work/
// whose owning run has finished and is older than `maxAgeMs`. Active runs
// (no `endedAt`) and orphans (no card claims the run id) are kept; orphans
// are returned to the caller for logging.
//
// `rm -rf` only — we don't run `git worktree remove` because the supervisor
// can't import worker code (module-boundaries skill) and the per-card repo
// path may have moved since the run finished. Stale entries in
// `<repo>/.git/worktrees/` are harmless and pruned by `git worktree prune`.

import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { workDir } from "../paths.js";
import type { Run } from "../../protocol/index.js";
import type { Store } from "../store/index.js";

export interface SweepResult {
  removed: string[];
  kept: string[];
  orphans: string[];
}

export interface SweepOptions {
  maxAgeMs?: number;
  now?: Date;
}

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export async function sweepStaleWorktrees(
  store: Store,
  opts: SweepOptions = {},
): Promise<SweepResult> {
  const maxAgeMs = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const now = opts.now ?? new Date();
  const dir = workDir();

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { removed: [], kept: [], orphans: [] };
    }
    throw e;
  }

  const cards = await store.listCards();
  const runIndex = new Map<string, Run>();
  for (const card of cards) {
    for (const run of card.runs) {
      runIndex.set(run.id, run);
    }
  }

  const removed: string[] = [];
  const kept: string[] = [];
  const orphans: string[] = [];

  for (const name of entries) {
    if (!name.startsWith("run_")) continue;
    const run = runIndex.get(name);
    if (!run) {
      orphans.push(name);
      continue;
    }
    if (!run.endedAt) {
      kept.push(name);
      continue;
    }
    const endedAtMs = Date.parse(run.endedAt);
    if (!Number.isFinite(endedAtMs)) {
      kept.push(name);
      continue;
    }
    const ageMs = now.getTime() - endedAtMs;
    if (ageMs < maxAgeMs) {
      kept.push(name);
      continue;
    }
    try {
      await rm(join(dir, name), { recursive: true, force: true });
      removed.push(name);
    } catch (e) {
      // Surface but don't fail the whole sweep; the directory stays and
      // will be retried on the next supervisor construction.
      kept.push(name);
      process.stderr.write(
        `[supervisor] sweep failed to remove ${name}: ${e instanceof Error ? e.message : String(e)}\n`,
      );
    }
  }

  return { removed, kept, orphans };
}
