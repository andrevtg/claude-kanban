# Phase 5 — Stubs

## task-01 — ESLint module-boundary rule

Use `eslint-plugin-boundaries` (or a custom rule). Forbid:
- `src/worker/**` importing from `src/lib/**` or `src/app/**`.
- `src/lib/**` importing from `src/worker/**` or `src/app/**`.
- Anything importing from `src/protocol/**` is fine.

## task-02 — Error states

Error UX pass: every failure mode in `docs/01-architecture.md` "Failure modes" gets a real card-level rendering. No silent failures. Every error shown has either a "Retry" or a "Copy details" affordance.

## task-03 — README and demo

Replace the scaffold README with a real one: screenshots/GIF, install steps, demo script. A 2-minute demo flow: create card → drag to running → watch it work → review diff → click Open PR → click PR URL.

## task-04 — Managed Agents handoff doc

Write `docs/04-managed-agents-port.md` documenting:
- The seam where the local supervisor would be replaced by a Managed Agents client.
- What changes in the worker module (basically: most of it goes away; `query()` becomes a `/v1/sessions` create + SSE consume).
- What stays the same (UI, store, protocol, card model).
- Estimated effort and risks.

**Phase-5 done when:** repo is demoable, and there's a written, credible plan to do the cloud port.
