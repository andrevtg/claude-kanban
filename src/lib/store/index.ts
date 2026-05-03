// JSON-on-disk persistence for ~/.claude-kanban/. Only the Next.js process
// (and the phase-1 CLI) imports this module. Workers must never import it —
// see docs/01-architecture.md "Module boundaries". Two implementations live
// alongside this interface: file.ts (default) and memory.ts (tests).

import type { Card, EventLogEntry, GlobalSettings, Run } from "../../protocol/index.js";

// What the caller supplies on createCard. id, runs, timestamps, and default
// status are filled in by the store.
export type NewCardInput = {
  title: string;
  prompt: string;
  repoPath: string;
  baseBranch: string;
  status?: Card["status"];
};

export interface Store {
  // settings
  getSettings(): Promise<GlobalSettings | null>;
  saveSettings(s: GlobalSettings): Promise<void>;

  // cards
  listCards(): Promise<Card[]>;
  getCard(id: string): Promise<Card | null>;
  createCard(input: NewCardInput): Promise<Card>;
  updateCard(id: string, patch: Partial<Card>): Promise<Card>;
  deleteCard(id: string): Promise<void>;

  // runs (within a card)
  appendRun(cardId: string, run: Run): Promise<void>;
  updateRun(cardId: string, runId: string, patch: Partial<Run>): Promise<Run>;

  // event logs (NDJSON, append-only)
  appendEvent(runId: string, entry: EventLogEntry): Promise<void>;
  readEvents(runId: string): AsyncIterable<EventLogEntry>;
}

export { CardNotFoundError, RunNotFoundError, StoreReadError } from "./errors.js";
export { fileStore } from "./file.js";
export { memoryStore } from "./memory.js";
