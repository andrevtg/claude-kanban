# phase-5 / task-01 — ESLint module-boundary rule

## Goal

Commission an ESLint rule (or rule-set) that enforces the
`docs/01-architecture.md` "Module boundaries" hard rule at lint time.
Today the boundary is documented and skill-enforced (the
`module-boundaries` skill nudges Claude when an import would cross a
forbidden seam) but nothing fails CI if a future contributor draws an
import the wrong way. This task closes the loop: every rule listed in
the architecture doc has a matching ESLint rule, the rule fires on a
synthetic violation, the real codebase passes clean, and the choice
of tool (`eslint-plugin-boundaries` vs a custom rule) is recorded as
the next ADR. This is an audit + commission task; it produces lint
config and possibly a small number of import-shape fixes, not new
features.

## Inputs

- `docs/01-architecture.md` — "Module boundaries" section is the
  canonical rule list. Read it first; the lint config is a literal
  encoding of the prose there.
- `docs/03-decisions.md` — append the new ADR (likely ADR-011);
  read prior ADRs for the house style.
- `eslint.config.*` (current ESLint flat config that ships with the
  Next.js scaffold) — where the new rule lands.
- `package.json` — `pnpm lint` script and dev-deps surface; new
  package needs the architecture-doc dependency note per CLAUDE.md.
- The skills under `.claude/skills/module-boundaries/` (vendored or
  in-repo) — these encode the same rules from a different angle and
  serve as a cross-check.
- `src/` layout (already mapped in CLAUDE.md and architecture doc):
  - `src/protocol/` — must not import from any other `src/*`.
  - `src/worker/` — must not import from `src/lib/`, `src/app/`,
    or `src/components/`.
  - `src/lib/` — must not import from `src/worker/`, `src/app/`,
    or `src/components/`.
  - `src/app/` and `src/components/` — must not import from
    `src/worker/` (they may import from `src/lib/`, `src/protocol/`,
    each other, and `src/types/`).
  - `src/types/` — ambient-only; must not import from any other
    `src/*` (see architecture doc, which calls this out separately).
  - `src/cli/` — same posture as `src/app/`: forbidden from
    `src/worker/`, allowed to use `src/lib/` and `src/protocol/`.
- Existing test/setup files that intentionally cross-reference (if
  any) — surface them and decide whether to allow-list or refactor.

## Outputs

### Tool-choice decision (ADR-011)

The task starts with a real choice between two viable options:

- **`eslint-plugin-boundaries`** — config-driven, matches the
  five-element boundary set cleanly, well-maintained, but introduces
  a fourth lint plugin alongside `@typescript-eslint`,
  `eslint-config-next`, and any `eslint-import-resolver-typescript`
  needed to make path resolution work.
- **Custom rule via `@typescript-eslint`** — zero new deps, trivially
  inspectable (the rule is one file), but the writer carries the
  maintenance burden and reinvents path-pattern matching.

Either choice is defensible. The task file does not pre-decide;
the writer picks one, justifies it in the ADR, and lives with the
consequences. ADR-011 must record:

- Context: the existing skill-enforcement gap and the module
  boundary rules from architecture doc.
- Decision: the chosen tool and a one-paragraph "why this one."
- Alternatives considered: the rejected option, with its real cost.
- Trade-offs: what this rule *won't* catch (e.g. dynamic imports,
  `require()` in tests, indirection through a barrel) and the
  honest answer to "is that acceptable" (probably yes for v1).

### ESLint configuration

Add the boundary rules to the existing flat config. Cover all five
modules per the architecture doc. Apply to `import`, `import type`,
and `require` (per the architecture doc's note that "type-only
coupling is still coupling"). Path resolution must work with the
TypeScript path aliases the project uses.

The rule set should produce a clear, single-line message for each
violation that names the source file's element, the imported file's
element, and points at the architecture doc. Future contributors who
hit a lint failure should read the message and immediately know what
to fix.

### Synthetic-violation test fixtures

Under `tests/eslint-boundaries/` (or wherever the writer prefers
that doesn't pollute `src/`), add small TypeScript files that
*deliberately violate* each rule. Run lint against them and assert
the expected violation fires. One fixture per rule is enough; the
goal is a regression check that the lint config still catches each
specific case if someone later edits the config.

These fixtures are not part of the build — exclude them from
`tsconfig.json` `include` and from the production lint pass. They
exist solely to be linted in a dedicated test invocation.

A simple shape:

```pre
tests/eslint-boundaries/
├── README.md
├── protocol-imports-lib.ts          # should fail
├── worker-imports-lib.ts             # should fail
├── lib-imports-worker.ts             # should fail
├── app-imports-worker.ts             # should fail
├── components-imports-worker.ts      # should fail
├── types-imports-lib.ts              # should fail
├── allowed-app-imports-lib.ts        # should pass
├── allowed-protocol-isolated.ts      # should pass
└── run.sh                            # invokes eslint, asserts results
```

`run.sh` (or a Node script — writer's choice) returns non-zero if
the expected-fail fixtures don't fail, or if the expected-pass
fixtures don't pass. Wire it into a `pnpm lint:boundaries` script
so it can run independently of the main `pnpm lint`.

### Real-codebase fixes

Run lint against `src/` after the rules are in place. Any violations
that surface are real bugs the discipline missed. Triage each:

- If it's a genuine boundary break: fix it (move the import,
  refactor through `src/protocol/`, or hoist the shared logic).
- If it's an intentional exception (none expected, but possible —
  e.g. an inline type re-export that the rule reads as a cross-
  module import): document it inline with `// eslint-disable-next-line
  boundaries/element-types` and a one-line reason.

Document the count and triage outcome in the task close-out (one
line per violation). If there are zero violations, that's the best
answer and worth recording as such.

### `pnpm lint` integration

The boundary rule must be part of the default `pnpm lint`
invocation, not a separate optional pass. Lint is the gate; if a
contributor's PR violates a boundary, CI must fail. Update the
`lint` script as needed; if the synthetic-fixture pass is separate
(`pnpm lint:boundaries`), wire both into a `lint:all` umbrella
that the `task-completion` skill expects.

### Documentation updates

- `docs/01-architecture.md`: replace the phase-5 "Enforce with a
  lint rule in phase 5" sentence with a present-tense note pointing
  at the chosen rule and the ADR.
- `docs/03-decisions.md`: append ADR-011.
- The `module-boundaries` skill (or its vendored equivalent): add
  a one-line note that the rule is now lint-enforced as well as
  skill-enforced. The skill's value isn't gone — it catches mistakes
  before the file is saved — but the lint rule is the gate.

## Acceptance

Acceptance for this task is "the rule fires when it should and
doesn't when it shouldn't." Verify each:

1. **Each forbidden import fires the rule.** Run `pnpm lint` (or
   `pnpm lint:boundaries`) against the synthetic fixtures. Each
   `expected-fail` fixture produces exactly one boundary violation
   with the documented message shape; each `expected-pass` fixture
   produces zero boundary violations.
2. **Real codebase passes clean.** Run `pnpm lint` against `src/`.
   Either zero boundary violations, or every violation is a
   documented inline exception with a justification comment.
3. **Type-only imports are caught.** Add a transient
   `import type { X } from "../worker/foo"` in a `src/lib/` file;
   `pnpm lint` fails. Remove; lint passes. The architecture doc
   explicitly says type-only coupling counts.
4. **`src/types/` posture is enforced.** A fixture under
   `src/types/` that imports from `src/lib/` fails lint.
5. **Lint message is actionable.** The error message names the
   source element, the imported element, and references
   `docs/01-architecture.md` (or the ADR). A contributor reading the
   raw lint output should know how to fix it without asking.
6. **`pnpm lint:boundaries` exits non-zero on a regression.** Edit
   one of the rule entries to be wrong (e.g. allow worker→lib).
   `pnpm lint:boundaries` fails. Revert; passes again.
7. **ADR-011 is in `docs/03-decisions.md`** and follows the existing
   ADR shape (Date, Status, Context, Decision, Alternatives,
   Trade-offs).
8. **`docs/01-architecture.md` is updated** to point at the lint
   rule rather than describing it as future work.
9. **`pnpm typecheck` and `pnpm lint` both pass** on the full repo.

### Regression checks

- All phase-1..4 acceptance scenarios still pass to the extent the
  task touched them. The only code changes expected here are import
  refactors in any files that violated the rule and were fixed in
  place. Each refactor must preserve behavior; if a fix can't be
  done without behavior change, surface it in the ADR and leave a
  TODO with a follow-up task rather than rewriting under cover of
  a lint pass.

## Out of scope

- A custom architecture-conformance test framework beyond ESLint.
  The lint rule is the gate; richer architecture-fitness tests
  (e.g. ts-arch) are deferred indefinitely — single-developer
  project, the lint rule plus the skill is enough.
- Catching dynamic boundary breaks via `await import()` or
  `require()` with a string-built path. Out of scope; would require
  runtime instrumentation, and the project doesn't use dynamic
  imports across module boundaries today.
- Boundary rules between submodules within `src/lib/` (e.g.
  `src/lib/store/` vs `src/lib/supervisor/`). The architecture doc
  treats `src/lib/` as one element; finer-grained internal seams
  are a "if it bites, write a follow-up" question.
- A lint rule that enforces "every new dependency requires an
  architecture-doc entry." That's a CLAUDE.md hard rule, not
  something ESLint can check. Skill enforcement and review
  discipline is the only enforcement we have for that one.
- Migrating ESLint flat config off `eslint-config-next`'s legacy
  shim if the chosen plugin doesn't compose with it. If that
  conflict surfaces, document it in the ADR and pick whichever
  gets the project to "lint enforces boundaries" fastest; a clean
  ESLint config rewrite is its own task.
- Backporting the rule to existing branches. Phase 5 is a polish
  pass on `main`; long-lived feature branches that pre-date this
  task are the branch owner's problem.
