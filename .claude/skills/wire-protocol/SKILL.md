---
name: wire-protocol
description: Use when editing or creating files under src/protocol/, adding a variant to the WireMessage discriminated union, constructing or parsing wire messages from src/worker/ or src/lib/, or adding a field to Card/Run/EventLogEntry. Encodes the rules for the Next.js ↔ worker IPC contract. Do not trigger on general TypeScript work.
---

# Wire protocol — claude-kanban rules

`src/protocol/` is the **only** module both `src/worker/` and `src/lib/` are allowed to import from. It's the seam the rest of the system hangs off, and it has tighter rules than ordinary TypeScript code in this repo. This skill makes those rules explicit so you don't have to re-read `docs/01-architecture.md` and ADR-001 every time.

If you're tempted to relax any rule below, stop and write the question into `docs/QUESTIONS.md`. Don't guess.

## The six rules

### 1. Zod is the source of truth

Always declare the Zod schema first and derive the TypeScript type from it:

```ts
export const RunSchema = z.object({
  id: z.string(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  exitCode: z.number().int().optional(),
  // ...
});
export type Run = z.infer<typeof RunSchema>;
```

Never declare a `type Run = { ... }` and a separate `RunSchema = z.object({ ... })` — they will drift. If you find a `type` declaration without a matching `z.infer`, that's a bug to fix, not a pattern to copy.

### 2. Discriminated unions use `z.discriminatedUnion`

For `WireMessage` and any other tagged union (e.g. `AgentEvent` if it grows tags), use:

```ts
export const WireMessageSchema = z.discriminatedUnion("type", [
  InitMsgSchema,
  ApprovePrMsgSchema,
  CancelMsgSchema,
  ReadyMsgSchema,
  EventMsgSchema,
  // ...
]);
```

Never use `z.union([...])` for tagged shapes. `z.union` does best-effort matching with overlapping shapes and produces awful errors. `discriminatedUnion` matches on the literal `type` field and gives precise diagnostics.

### 3. `parseWireMessage` returns a `Result`, never throws

The signature is:

```ts
export function parseWireMessage(line: string): Result<WireMessage, ParseError>;
```

It must:

- Return `{ ok: false, error: ParseError }` for: invalid JSON, schema mismatch, unknown `type`.
- Never throw. Workers and supervisors run this on untrusted lines (NDJSON over stdio); a thrown error from a partial line crashes the wrong process.
- Surface the underlying Zod error in `ParseError` so the parent process can log it to the run's NDJSON event log.

If you need to bubble up a different failure shape, extend `ParseError` — don't re-introduce throws.

### 4. The protocol is intentionally narrow

New features add new message types. They do **not** add escape hatches.

Forbidden:

- `extra: Record<string, unknown>`
- `payload: unknown` or `data: any`
- A "generic event" type used as a junk drawer

Adding `{ type: "diff_ready", stat: ... }` for a new feature is right. Stuffing it into `event.payload` is wrong. The whole point of the protocol module is that one side knows exactly what the other side can send.

### 5. Every new variant needs a round-trip test

When you add a `WireMessage` variant, add a test that does:

```pre
build a value → JSON.stringify → parseWireMessage → deepEqual to original
```

Plus at least one negative case (malformed JSON or wrong `type`) asserting `parseWireMessage` returns `{ ok: false }` rather than throwing.

The tests live alongside the schemas. They are not optional in phase 1 — see `tasks/phase-1/task-02-protocol-types.md`'s acceptance criteria. UI tests are deferred; protocol tests are required.

### 6. The protocol module imports from no one in this repo

`src/protocol/**` may import from:

- `zod`
- `@anthropic-ai/claude-agent-sdk` (only for re-exporting `SDKMessage`)
- Other files inside `src/protocol/`

It must **not** import from `src/worker/`, `src/lib/`, `src/app/`, or `src/components/`. That import would invert the dependency graph and let two processes share state through the protocol module — defeating the whole worker-subprocess isolation from ADR-001.

A phase-5 lint rule will enforce this; until then it's on you.

## When you're adding a field to Card / Run / EventLogEntry

These are persisted to JSON on disk and replayed from NDJSON logs. A new field must be either:

- **Optional** (`.optional()` in Zod), so existing on-disk documents still parse; or
- Accompanied by a migration step that rewrites existing files in `~/.claude-kanban/cards/`.

Phase 1 does not have a migration framework. Default to optional.

Never reorder the `CardStatus` union members casually — the JSON store and the UI both pattern-match on these strings.

## Common mistakes

- **Using `z.union` instead of `z.discriminatedUnion`.** Symptom: parse errors that don't tell you which branch failed; rules above explain why this is non-negotiable for tagged shapes.
- **Adding a variant but forgetting the round-trip test.** The compiler won't catch this — you'll only find out when malformed lines crash a worker in production. Always add the test in the same commit as the schema change.
- **Declaring a TS type and a Zod schema separately.** They will drift. The runtime check passes; the compiler is happy; the actual shape on disk diverges silently. Always `z.infer`.
- **Adding an `any`-typed field to "unblock" something.** Never acceptable in this module. If the SDK or another dependency hands you an opaque value, model it as `z.unknown()` at the boundary, then narrow it where it's used. If you genuinely cannot model it, stop and write to `docs/QUESTIONS.md` with the date and task number.
- **Importing from `src/worker/` or `src/lib/` "just for a type".** A type-only import still couples the modules and breaks the boundary. Move the type into `src/protocol/` instead.
- **Reusing an existing message type for a new purpose** (e.g. piggybacking on `event` for a diff stat). Add a new `type` variant. The protocol module's job is to be boring and explicit.

## Where the rules came from

- Process boundary and "narrow protocol" stance: `docs/01-architecture.md` ("Wire protocol" and "Module boundaries").
- Subprocess isolation rationale: `docs/03-decisions.md` ADR-001.
- Required tests and Zod-as-source-of-truth: `tasks/phase-1/task-02-protocol-types.md`.

If you're changing the rules themselves, edit those documents first, then mirror here, then add a one-line entry to `docs/CHANGELOG.md`.
