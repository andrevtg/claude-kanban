# phase-1 / task-03 — JSON store

## Goal

Implement the persistence layer over `~/.claude-kanban/`. Only Next.js code (and Phase 1's CLI) ever calls into this module. Workers do not.

## Inputs

- `src/protocol/` (built in task-02)
- `docs/01-architecture.md` "Data model" section

## Outputs

### `src/lib/paths.ts`
- `claudeKanbanDir()` returns `~/.claude-kanban/` (respects `$CLAUDE_KANBAN_HOME` if set, useful for tests).
- `cardFile(id)`, `runDir(id)`, `runLog(id)`, `settingsFile()` helpers.
- `ensureDirs()` — idempotent mkdir for the four subdirs.

### `src/lib/store/index.ts`
A small interface with one in-memory implementation (for tests) and one file-backed implementation:

```ts
interface Store {
  // settings
  getSettings(): Promise<GlobalSettings>;
  saveSettings(s: GlobalSettings): Promise<void>;

  // cards
  listCards(): Promise<Card[]>;
  getCard(id: string): Promise<Card | null>;
  createCard(input: NewCardInput): Promise<Card>;
  updateCard(id: string, patch: Partial<Card>): Promise<Card>;
  deleteCard(id: string): Promise<void>;

  // runs (within a card)
  appendRun(cardId: string, run: Run): Promise<void>;
  patchRun(cardId: string, runId: string, patch: Partial<Run>): Promise<void>;

  // event logs (NDJSON)
  appendEvent(runId: string, entry: EventLogEntry): Promise<void>;
  readEvents(runId: string): AsyncIterable<EventLogEntry>;
}
```

### Implementation requirements

- File writes for `cards/*.json` and `settings.json` use **atomic write**: write to `.tmp`, `fsync`, `rename`. Don't truncate-and-write.
- Reads validate against the Zod schema; corrupt/partial writes throw a typed error.
- `appendEvent` opens the log in append mode for each call (or holds an `fs.WriteStream` per run id; either is fine for v1).
- `readEvents` streams the NDJSON line by line; do not load the whole file.

## Acceptance

- Vitest tests covering each method, using a temp dir injected via `CLAUDE_KANBAN_HOME`.
- Round-trip test: create a card, list it, update status, delete, confirm no file remains.
- Concurrent-write test: 100 `appendEvent` calls from the same process produce 100 valid lines.

## Out of scope

- Multi-process write coordination. Workers don't write cards; this is fine.
- Migrations / schema versioning. Add when the schema first changes; until then, YAGNI.
