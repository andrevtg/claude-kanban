# Module-boundary lint fixtures

Synthetic TypeScript files that exercise the module-boundary ESLint rules
defined in `eslint.boundaries.js` and ADR-011. They are not part of the
build (`tsconfig.json` excludes `tests/`); they exist only to be linted by
`pnpm lint:boundaries`.

## Layout

One subdirectory per source element. Inside each subdirectory:

- `fail-*.ts` — should produce **at least one** `no-restricted-imports`
  violation when linted.
- `pass-*.ts` — should produce **zero** boundary violations.

The runner at `run.mjs` lints every fixture against
`eslint.config.boundaries.js` and asserts the expected outcome per file.
A regression in the rule (a forbidden pattern that no longer fires, or an
allowed pattern that now fires) causes the runner to exit non-zero.

The main `pnpm lint` invocation globally ignores this directory; the
boundary rules are exercised here separately so the fixtures themselves
do not break CI.
