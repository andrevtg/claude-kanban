# Phase 5

See individual task files in this directory:

- `task-01-eslint-boundaries.md` — commission an ESLint rule that
  enforces `docs/01-architecture.md` module boundaries at lint
  time; choose tool (`eslint-plugin-boundaries` vs custom rule)
  in ADR-011
- `task-02-error-states.md` — audit every failure mode in the
  architecture doc and verify each renders visible card-level
  state with a Retry or Copy details affordance
- `task-03-readme-and-demo.md` — replace the scaffold-era README
  with one describing a working artifact; add `docs/DEMO.md` with
  a timed 2-minute walkthrough
- `task-04-managed-agents-handoff.md` — write
  `docs/06-managed-agents-port.md`, the strategic plan for
  porting from local Agent SDK mode to Claude Managed Agents

**Phase-5 done when:** the lint rule enforces the module
boundaries on the real codebase, every failure mode renders as
visible state with an affordance, the README and DEMO doc let an
unfamiliar reader run and demo the project, and
`docs/06-managed-agents-port.md` answers "could you actually port
this and what would it cost?" for a partner-network reader.
