// In-memory Store. Used by tests that don't want to touch disk; also useful
// for unit tests of upstream code that just needs a Store fake. Behavior
// matches fileStore() at the contract level (errors thrown, ordering, etc.).

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
import { CardNotFoundError, RunNotFoundError } from "./errors.js";
import type { NewCardInput, Store } from "./index.js";

function nowIso(): string {
  return new Date().toISOString();
}

export function memoryStore(): Store {
  let settings: GlobalSettings | null = null;
  const cards = new Map<string, Card>();
  const events = new Map<string, EventLogEntry[]>();

  return {
    async getSettings() {
      return settings;
    },

    async saveSettings(s) {
      settings = GlobalSettingsSchema.parse(s);
    },

    async listCards() {
      return [...cards.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    async getCard(id) {
      return cards.get(id) ?? null;
    },

    async createCard(input: NewCardInput) {
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
      cards.set(card.id, card);
      return card;
    },

    async updateCard(id, patch) {
      const existing = cards.get(id);
      if (!existing) throw new CardNotFoundError(id);
      const merged: Card = CardSchema.parse({
        ...existing,
        ...patch,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: nowIso(),
      });
      cards.set(id, merged);
      return merged;
    },

    async deleteCard(id) {
      if (!cards.delete(id)) throw new CardNotFoundError(id);
    },

    async appendRun(cardId, run) {
      const existing = cards.get(cardId);
      if (!existing) throw new CardNotFoundError(cardId);
      const merged: Card = CardSchema.parse({
        ...existing,
        runs: [...existing.runs, run],
        updatedAt: nowIso(),
      });
      cards.set(cardId, merged);
    },

    async patchRun(cardId, runId, patch) {
      const existing = cards.get(cardId);
      if (!existing) throw new CardNotFoundError(cardId);
      const idx = existing.runs.findIndex((r) => r.id === runId);
      if (idx === -1) throw new RunNotFoundError(cardId, runId);
      const target = existing.runs[idx]!;
      const updated: Run = { ...target, ...patch, id: target.id };
      const runs = [...existing.runs];
      runs[idx] = updated;
      const merged: Card = CardSchema.parse({
        ...existing,
        runs,
        updatedAt: nowIso(),
      });
      cards.set(cardId, merged);
    },

    async appendEvent(runId, entry) {
      const validated = EventLogEntrySchema.parse(entry);
      const list = events.get(runId) ?? [];
      list.push(validated);
      events.set(runId, list);
    },

    async *readEvents(runId) {
      const list = events.get(runId) ?? [];
      for (const e of list) yield e;
    },
  };
}
