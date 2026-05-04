// Reset runtime state: clear runs[] and reset status to "backlog" on every
// card, and remove all artifacts under ~/.claude-kanban/{work,traces,diffs,
// logs}/. Card identities and settings are preserved.
//
// Stop the dev server before running. The Next.js process is the only
// writer to cards/*.json; this script bypasses that invariant for
// maintenance, so a concurrently running server could observe a partial
// reset state.

import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { fileStore } from "../lib/store/index.js";
import { claudeKanbanDir, diffsDir, logsDir, tracesDir, workDir } from "../lib/paths.js";

async function listEntries(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

async function main(): Promise<number> {
  let yes = false;
  try {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: { yes: { type: "boolean", default: false } },
    });
    yes = values.yes === true;
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }

  const store = fileStore();
  const cards = await store.listCards();
  const totalRuns = cards.reduce((sum, c) => sum + c.runs.length, 0);

  const artifactDirs: Array<readonly [string, string]> = [
    ["work", workDir()],
    ["traces", tracesDir()],
    ["diffs", diffsDir()],
    ["logs", logsDir()],
  ];
  const counts = await Promise.all(
    artifactDirs.map(async ([, p]) => (await listEntries(p)).length),
  );
  const totalArtifacts = counts.reduce((a, b) => a + b, 0);

  process.stdout.write(`reset:runs target ${claudeKanbanDir()}\n`);
  process.stdout.write(
    `  ${cards.length} cards (${totalRuns} runs to clear, status → backlog)\n`,
  );
  artifactDirs.forEach(([name], i) => {
    process.stdout.write(`  ${name}/: ${counts[i]} entries\n`);
  });

  if (!yes) {
    process.stdout.write(`\ndry run. pass --yes to actually do it.\n`);
    return 0;
  }

  if (cards.length === 0 && totalArtifacts === 0) {
    process.stdout.write(`\nnothing to do.\n`);
    return 0;
  }

  for (const card of cards) {
    if (card.runs.length === 0 && card.status === "backlog") continue;
    await store.updateCard(card.id, { runs: [], status: "backlog" });
  }

  for (const [, dir] of artifactDirs) {
    const entries = await listEntries(dir);
    await Promise.all(
      entries.map((e) => rm(join(dir, e), { recursive: true, force: true })),
    );
  }

  process.stdout.write(`\ndone.\n`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
    process.stderr.write(`reset:runs fatal: ${msg}\n`);
    process.exit(1);
  });
