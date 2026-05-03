// Filesystem layout for ~/.claude-kanban/. Tests inject CLAUDE_KANBAN_HOME
// to redirect every helper at a temp dir. Always read the env at call time;
// caching it would defeat per-test isolation.

import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";

export function claudeKanbanDir(): string {
  const override = process.env.CLAUDE_KANBAN_HOME;
  return override && override.length > 0 ? override : join(homedir(), ".claude-kanban");
}

export function settingsFile(): string {
  return join(claudeKanbanDir(), "settings.json");
}

export function cardsDir(): string {
  return join(claudeKanbanDir(), "cards");
}

export function cardFile(id: string): string {
  return join(cardsDir(), `${id}.json`);
}

export function workDir(): string {
  return join(claudeKanbanDir(), "work");
}

export function runDir(runId: string): string {
  return join(workDir(), runId);
}

export function logsDir(): string {
  return join(claudeKanbanDir(), "logs");
}

export function runLog(runId: string): string {
  return join(logsDir(), `${runId}.ndjson`);
}

export function diffsDir(): string {
  return join(claudeKanbanDir(), "diffs");
}

export function diffPath(runId: string): string {
  return join(diffsDir(), `${runId}.patch`);
}

export async function ensureDirs(): Promise<void> {
  await mkdir(claudeKanbanDir(), { recursive: true });
  await mkdir(cardsDir(), { recursive: true });
  await mkdir(workDir(), { recursive: true });
  await mkdir(logsDir(), { recursive: true });
  await mkdir(diffsDir(), { recursive: true });
}
