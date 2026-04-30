# phase-1 / task-01 — Init monorepo

## Goal

Initialize the project as a TypeScript-strict pnpm workspace, with the directory structure called out in `docs/01-architecture.md`. No app code yet — just `package.json`, `tsconfig.json`, and empty source folders.

## Inputs

- `docs/01-architecture.md` — module boundaries
- `docs/02-agent-sdk-usage.md` — pinned SDK package

## Outputs

- `package.json` with `"packageManager": "pnpm@9.x"` (whichever is current).
- `pnpm-workspace.yaml` if you split into packages; not required, single-package is fine for v1.
- `tsconfig.json` with `strict: true`, `noUncheckedIndexedAccess: true`, `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`.
- `.gitignore` covering `node_modules`, `.next`, dist outputs, and `~/.claude-kanban` (for the rare case it lives in-repo for testing).
- `.editorconfig`, `.nvmrc` (Node 22+).
- Empty directories with a `.gitkeep` each:
  - `src/app/`
  - `src/components/`
  - `src/lib/store/`
  - `src/lib/supervisor/`
  - `src/lib/sse/`
  - `src/worker/`
  - `src/protocol/`

## Dependencies to install

Production:
- `@anthropic-ai/claude-agent-sdk`
- `ulid`
- `zod`

Dev:
- `typescript`
- `@types/node`
- `tsx`
- `eslint`, `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser`
- `prettier`

Do **not** install Next.js or React in this task. Phase 2 does that.

## Acceptance

- `pnpm install` succeeds.
- `pnpm tsc --noEmit` succeeds (no source yet, so it's a quick check).
- `pnpm eslint .` succeeds (or returns no errors).
- A short `package.json` script section exists with `"build"`, `"typecheck"`, `"lint"`, `"format"`, `"format:check"`.

## Out of scope

- Any application code.
- Next.js setup (phase 2).
- Tests (added in task 04+).
- CI configuration.
