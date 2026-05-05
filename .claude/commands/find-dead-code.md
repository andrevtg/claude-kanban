---
description: Report dead code left behind by recent changes on the current branch (compares HEAD against a base ref). Reports only — never deletes.
argument-hint: "[base-ref] (optional, defaults to git merge-base HEAD origin/main)"
---

# Find dead code from changes

Find rot a refactor or feature removal left behind: symbols whose last consumer was just removed, files whose last importer is gone, doc strings naming components that no longer exist.

This is **change-scoped** — not a whole-repo unused-export scan. Only flag things the diff *stopped pointing at*. Whole-repo sweeps belong to `knip`/`ts-prune`/`depcheck`; recommend those as a follow-up if the user wants broader coverage.

The output is a **report**. Do not delete anything. The user reviews and decides.

## How to run it

### 1. Pick the base ref

If `$ARGUMENTS` is non-empty, treat it as the base ref. Otherwise default to `git merge-base HEAD origin/main` (the branch's fork point from main).

If `origin/main` doesn't exist or the repo isn't on a feature branch, ask the user what base to use rather than guessing. Echo the resolved SHA so the report is reproducible.

### 2. Enumerate what the diff removed references to

Run `git diff <base>...HEAD` and extract every identifier that the diff *stopped pointing at*:

- Function, class, type, and constant names removed from a call site or import
- Files deleted entirely (their entire export surface is suspect)
- Component names removed from JSX
- `package.json` script names removed from a script body
- Environment variable names removed from a config read site
- Routes / endpoint paths removed from a fetch site
- CLI flag names removed from a `parseArgs` options block

Skip identifiers the diff *also redefines or moves* — those were renamed, not killed.

### 3. Classify remaining references

For each identifier from step 2, search the rest of the tree (excluding the diff's own changes and `CHANGELOG`/history files). Use `rg` when available; fall back to `grep -r`.

Classify:

- **Definition-only**: only remaining reference is the symbol's own definition. → likely dead.
- **Self + tests**: defined plus referenced only by its own test file. → likely dead (tests are testing dead code).
- **Self + docs/comments**: defined plus referenced only in `.md`, JSDoc, or `//` comments. → docs-rot.
- **Self + barrel re-export**: defined and re-exported from an `index.ts`/similar but never imported anywhere. → likely dead, with a public-surface caveat.
- **In active use**: still imported and called by non-self, non-test, non-doc code. → drop from the report.

### 4. Files orphaned by the diff

Identify files where the diff removed the **last** import site. For each suspect, search for `from ['"].*<filename-without-ext>['"]` (or the equivalent in this language). If matches are only inside the file itself or in a barrel re-export, flag it.

### 5. Re-exports and prop pass-through

For barrel files (`index.ts`, `mod.ts`, `index.js`) the diff touched: if the diff removed the last consumer of a re-export, the re-export is dead.

For component prop types: if a prop was removed from the JSX call site but the type still lists it, flag the type entry.

### 6. Dead `package.json` scripts and config

If the diff deleted a script that other scripts called via `pnpm`/`npm` chaining, flag the callers (different from dead, but worth surfacing).

If a settings key is no longer read anywhere, flag it.

## Output format

Write the report inline (no file creation unless asked). One section per category, each row formatted as `path:line — symbol — why`. Cap each section at ~15 entries; if more, summarize the tail with a count.

Sections, in this order:

1. **Likely-dead symbols** (definition-only or self+tests)
2. **Doc-rot** (self + docs/comments only)
3. **Likely-orphaned files** (no remaining importers)
4. **Dead barrel re-exports**
5. **Dead prop types / interface members**
6. **Dead `package.json` scripts or config keys**
7. **Notes & uncertainty** — anything that looked dead but might be a public API kept on purpose; symbols you couldn't classify confidently

End with the resolved base SHA and `git diff --stat <base>...HEAD` so the user can reproduce.

## What this command is NOT

- **Not a whole-repo unused-export scan.** Recommend `knip` / `ts-prune` / `depcheck` as a follow-up if the user wants broader coverage.
- **Not a deletion tool.** Reports only. If asked to delete after the report, do that as a separate step with the user's per-item or per-section confirmation.
- **Not a linter.** ESLint's `no-unused-vars` and TS's `noUnusedLocals` already catch in-file dead code. If `pnpm lint` / `pnpm typecheck` haven't been run yet, suggest running them first to clear in-file noise before the cross-file scan.

## Edge cases

- **Type-only imports**: `import type { Foo }` references are real references. Don't ignore them.
- **Dynamic imports / `require(name)`**: string-literal imports are findable; computed ones are not. Note in "uncertainty" if a candidate is referenced anywhere by string template.
- **Public API / library exports**: if the repo's `package.json` has an `exports` field, anything listed there is a public surface — surface it under "Notes" instead of marking dead.
- **Generated code**: skip files with `// generated` or `// AUTO-GENERATED` headers.
- **Test fixtures**: a fixture referenced only by the test that owns it is fine; don't flag.

## This repo specifically

Module boundaries are enforced by `pnpm lint:boundaries` (ESLint `no-restricted-imports` rules; see ADR-011). If a file under `src/worker/`, `src/lib/`, or `src/app/` looks orphaned, double-check it isn't intentionally retained for the worker-process boundary before flagging.

The wire protocol in `src/protocol/` is the only shared surface between worker and Next.js. Types defined there often have one consumer per side and zero appears-unused on either. Don't flag a `src/protocol/` export as dead unless **both** sides have stopped using it.
