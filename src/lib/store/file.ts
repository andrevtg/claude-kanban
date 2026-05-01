// File-backed Store over ~/.claude-kanban/.
//
// Writes use the tmp-then-rename dance so a crashed write never leaves a
// partial cards/*.json or settings.json on disk. NDJSON event logs are
// append-only; concurrent appendEvent calls for the same run are serialized
// through an in-memory promise chain so each line lands intact.

import { appendFile, mkdir, readFile, readdir, rename, rm, open } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import { ulid } from "ulid";
import {
  CardSchema,
  EventLogEntrySchema,
  GlobalSettingsSchema,
  type Card,
  type EventLogEntry,
  type GlobalSettings,
  type Run,
} from "../../protocol/index.js";
import { cardFile, cardsDir, ensureDirs, logsDir, runLog, settingsFile } from "../paths.js";
import { CardNotFoundError, RunNotFoundError, StoreReadError } from "./errors.js";
import type { NewCardInput, Store } from "./index.js";

async function atomicWriteJson(path: string, data: unknown, mode = 0o600): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const fh = await open(tmp, "w", mode);
  try {
    await fh.writeFile(JSON.stringify(data, null, 2), "utf8");
    await fh.sync();
  } finally {
    await fh.close();
  }
  await rename(tmp, path);
}

async function readJson<T>(path: string, parse: (raw: unknown) => T): Promise<T | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new StoreReadError(path, `invalid JSON: ${(e as Error).message}`);
  }
  try {
    return parse(parsed);
  } catch (e) {
    throw new StoreReadError(path, `schema mismatch: ${(e as Error).message}`);
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

// Per-runId queue so concurrent appendEvent calls don't interleave. Cleared
// only by process exit; the map is small (one entry per active run).
const eventQueues = new Map<string, Promise<void>>();

function enqueueEvent(runId: string, work: () => Promise<void>): Promise<void> {
  const prev = eventQueues.get(runId) ?? Promise.resolve();
  const next = prev.then(work, work);
  eventQueues.set(
    runId,
    next.catch(() => {}),
  );
  return next;
}

export function fileStore(): Store {
  return {
    async getSettings(): Promise<GlobalSettings | null> {
      return readJson(settingsFile(), (raw) => GlobalSettingsSchema.parse(raw));
    },

    async saveSettings(s: GlobalSettings): Promise<void> {
      await ensureDirs();
      const validated = GlobalSettingsSchema.parse(s);
      await atomicWriteJson(settingsFile(), validated);
    },

    async listCards(): Promise<Card[]> {
      let names: string[];
      try {
        names = await readdir(cardsDir());
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw e;
      }
      const cards: Card[] = [];
      for (const name of names) {
        if (!name.endsWith(".json")) continue;
        const card = await readJson(`${cardsDir()}/${name}`, (raw) => CardSchema.parse(raw));
        if (card) cards.push(card);
      }
      cards.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return cards;
    },

    async getCard(id: string): Promise<Card | null> {
      return readJson(cardFile(id), (raw) => CardSchema.parse(raw));
    },

    async createCard(input: NewCardInput): Promise<Card> {
      await ensureDirs();
      const now = nowIso();
      const card: Card = CardSchema.parse({
        id: `card_${ulid()}`,
        title: input.title,
        prompt: input.prompt,
        repoPath: input.repoPath,
        baseBranch: input.baseBranch,
        status: input.status ?? "backlog",
        runs: [],
        createdAt: now,
        updatedAt: now,
      });
      await atomicWriteJson(cardFile(card.id), card);
      return card;
    },

    async updateCard(id: string, patch: Partial<Card>): Promise<Card> {
      const existing = await readJson(cardFile(id), (raw) => CardSchema.parse(raw));
      if (!existing) throw new CardNotFoundError(id);
      const merged: Card = CardSchema.parse({
        ...existing,
        ...patch,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: nowIso(),
      });
      await atomicWriteJson(cardFile(id), merged);
      return merged;
    },

    async deleteCard(id: string): Promise<void> {
      try {
        await rm(cardFile(id));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") {
          throw new CardNotFoundError(id);
        }
        throw e;
      }
    },

    async appendRun(cardId: string, run: Run): Promise<void> {
      const existing = await readJson(cardFile(cardId), (raw) => CardSchema.parse(raw));
      if (!existing) throw new CardNotFoundError(cardId);
      const merged: Card = CardSchema.parse({
        ...existing,
        runs: [...existing.runs, run],
        updatedAt: nowIso(),
      });
      await atomicWriteJson(cardFile(cardId), merged);
    },

    async patchRun(cardId: string, runId: string, patch: Partial<Run>): Promise<void> {
      const existing = await readJson(cardFile(cardId), (raw) => CardSchema.parse(raw));
      if (!existing) throw new CardNotFoundError(cardId);
      const idx = existing.runs.findIndex((r) => r.id === runId);
      if (idx === -1) throw new RunNotFoundError(cardId, runId);
      // findIndex hit, so this entry exists; assert for noUncheckedIndexedAccess.
      const target = existing.runs[idx]!;
      const updated: Run = { ...target, ...patch, id: target.id };
      const runs = [...existing.runs];
      runs[idx] = updated;
      const merged: Card = CardSchema.parse({
        ...existing,
        runs,
        updatedAt: nowIso(),
      });
      await atomicWriteJson(cardFile(cardId), merged);
    },

    async appendEvent(runId: string, entry: EventLogEntry): Promise<void> {
      const validated = EventLogEntrySchema.parse(entry);
      const line = `${JSON.stringify(validated)}\n`;
      return enqueueEvent(runId, async () => {
        await mkdir(logsDir(), { recursive: true });
        await appendFile(runLog(runId), line, "utf8");
      });
    },

    async *readEvents(runId: string): AsyncIterable<EventLogEntry> {
      const path = runLog(runId);
      let fh;
      try {
        fh = await open(path, "r");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
        throw e;
      }
      const stream = fh.createReadStream({ encoding: "utf8" });
      try {
        const rl = createInterface({ input: stream, crlfDelay: Infinity });
        for await (const line of rl) {
          if (line.length === 0) continue;
          let raw: unknown;
          try {
            raw = JSON.parse(line);
          } catch (e) {
            throw new StoreReadError(path, `invalid JSON line: ${(e as Error).message}`);
          }
          try {
            yield EventLogEntrySchema.parse(raw);
          } catch (e) {
            throw new StoreReadError(path, `schema mismatch: ${(e as Error).message}`);
          }
        }
      } finally {
        stream.destroy();
      }
    },
  };
}
