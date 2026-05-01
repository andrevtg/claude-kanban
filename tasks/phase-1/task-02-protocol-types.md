**STATUS: done**

# phase-1 / task-02 — Protocol types

## Goal

Define and export the canonical types and Zod schemas for everything that crosses the Next.js ↔ worker boundary, plus the on-disk card and run shapes. This is the seam the rest of the project hangs off; get it right.

## Inputs

- `docs/01-architecture.md`, sections "Data model" and "Wire protocol"

## Outputs

Create the following files under `src/protocol/`:

### `card.ts`

- `CardStatus` union: `"backlog" | "ready" | "running" | "review" | "done" | "failed"`.
- `Card` type and matching Zod schema `CardSchema`.
- `Run` type and `RunSchema`.
- `EventLogEntry` type — what one line in `logs/run_*.ndjson` looks like (timestamp + the `WireMessage` from `messages.ts`).

### `messages.ts`

- `WireMessage` discriminated union covering both directions (parent→worker and worker→parent), discriminator field is `type`.
- For each variant, a Zod schema and an exported `parseWireMessage(line: string)` function that returns a `Result<WireMessage, ParseError>`.
- Re-export the SDK's `SDKMessage` type so callers don't need to import from the SDK directly.

Use Zod's `z.discriminatedUnion("type", [...])` for compile-time and run-time safety.

### `settings.ts`

- `GlobalSettings` type:
  - `apiKeyPath: string` *(path to a file containing the API key, not the key itself in plaintext beyond mode 0600 — see ADR-005 follow-up. v1 may keep the key directly with a TODO)*
  - `defaultModel: string` (default: `"claude-opus-4-7"`)
  - `defaultRepoPath?: string`
  - `bashAllowlist: string[]` (defaults from `docs/02-agent-sdk-usage.md`)
  - `prAutoApprove: boolean` (default false)
- Zod schema with sane defaults.

### `index.ts`

Barrel export.

## Acceptance

- `pnpm tsc --noEmit` clean.
- A small inline test (or a `*.test.ts` if you've added vitest) round-trips: build a `WireMessage` of each variant, encode to a JSON line, parse back, deep-equal check.
- `parseWireMessage` rejects malformed input cleanly (returns an error, does not throw).

## Out of scope

- Any actual file I/O.
- Any worker or supervisor code.
- Persisting types to disk.

## Notes

- Prefer `z.infer<typeof Schema>` for the exported TS types so the schema is the source of truth.
- The wire protocol is the API contract between two processes you control. Keep it small and explicit; don't reach for "extensible" patterns (no `extra: Record<string, unknown>`).
