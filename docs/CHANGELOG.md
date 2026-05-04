# Changelog

One line per completed task. Newest at top.

<!-- Format:
- YYYY-MM-DD — phase-N/task-NN — short description
-->

- 2026-05-04 — chore — column-card delete confirm now opens as a centered viewport modal (via `createPortal` to `document.body`) rather than expanding inline within the ~280px column. Backdrop click and Escape both dismiss; drawer keeps its inline confirm because drawer width handles it fine.
- 2026-05-04 — chore — drop Cancel button from column card; column card is now Open + Delete only (plus the running-pulse indicator). Cancel still lives in the drawer's run history. Architecture doc's status section + failure-modes table updated to describe the new run-driven card transitions.
- 2026-05-04 — chore — auto-transition card status from the supervisor: `Supervisor.startRun` persists `status: "running"` after `appendRun`, and `Supervisor.finalize` persists `status: "review"` on exit 0 / `status: "failed"` otherwise. Previously status changes were entirely manual (drag-and-drop or edit form), so a drawer-launched run would optimistically appear in the running column then snap back to its prior status on the next refetch.
- 2026-05-04 — chore — collapse column-card actions to a single "Open" button: drop the inline Edit form (cramped at column width), drop the inline Run button, route both into the drawer. Delete confirm stays inline (fits the column). Removes dead `run-card.tsx`.
- 2026-05-04 — phase-5/task-04 — `docs/06-managed-agents-port.md` port plan: cites Managed Agents Sessions/Quickstart/Events/Environments/Skills/Pricing pages (all fetched 2026-05-04); quantifies reuse (~63% direct + restructuring → ~two-thirds); six-phase migration plan with parity checks; risks cover API-shift / pricing / auth / latency / feature-lag / data-residency / repo-mount gap; lessons cite ADR-001 seam, trace-vs-event-log split, no-silent-failures, wire-protocol discriminated union, per-session skills consent; pointer added in `docs/05-relation-to-cursor-cookbook.md` to the new doc as canonical
- 2026-05-04 — phase-5/task-03 — rewrite README around shipped artifact (drop scaffold framing, install/run walkthrough, status rollup, attribution kept above the fold, LICENSE+screenshot flagged as follow-ups), add `docs/DEMO.md` with timed 2-minute script and backup notes, drift-fix `docs/05-relation-to-cursor-cookbook.md` (PR step shipped, no recent-repos list, skills toggle past tense, README attribution clause closed)
- 2026-05-04 — phase-5/task-02 — error-state UX audit: new `<ErrorCard />` reusable surface with Retry + Copy details affordances; applied to card-form / settings-form / card-delete-confirm / run-card / run-diff / run-trace / pr-affordance / card-drawer (run-start error split from "active run" notice) / board-card / run-log (Reconnect on unexpected SSE close); new global `app/error.tsx` route boundary; `<LoadBanner />` on home + settings pages catches `StoreReadError` from `listCards()` / `getSettings()` so the app boots in defaults mode; cross-card 404 special-cased in card-form ("this card no longer exists") and card-delete-confirm (treat as success); audit recorded in `docs/04-error-states-audit.md` with a live-trigger checklist for dynamic surfaces; architecture doc's failure-mode table extended with the new rows
- 2026-05-04 — phase-5/task-01 — ESLint module-boundary rule via `no-restricted-imports` (zero new deps); shared boundary blocks in `eslint.boundaries.js`, dedicated `eslint.config.boundaries.js` for synthetic fixtures under `tests/eslint-boundaries/`, new `pnpm lint:boundaries` + `pnpm lint:all` scripts; ADR-011 records the tool choice
- 2026-05-04 — tasks/phase-5 — fix task-02 acceptance numbering
- 2026-05-04 — tasks/phase-5 — expand stubs into real task files
- 2026-05-04 — phase-4/task-04 — per-card `loadSkills` toggle: Card schema field (default false, legacy-tolerant), `RunInitPayload` carries it, supervisor passes it through, worker flips `settingSources: ["project"]` and adds `Skill` to `allowedTools` when on; card-form checkbox + drawer per-session per-card confirmation modal (sessionStorage, key `<cardId>:<state>`, cleared on toggle change); docs updated
- 2026-05-04 — phase-4/task-03 — register `PreToolUse` hook that writes redacted tool calls to `~/.claude-kanban/traces/<runId>.jsonl`; supervisor populates `tracePath`, sweep removes stale traces; new `GET /api/cards/:id/runs/:runId/trace` route and `<RunTrace>` drawer pane
- 2026-05-03 — phase-4/task-02 — `gh pr create` integration: worker post-SDK approval window, `openPr` with PUSH_FAILED/PR_CREATE_FAILED/PR_URL_MISSING/GH_* error codes, `GET /api/gh/status` pre-flight, drawer Open PR composer, supervisor persists `prUrl` on `pr_opened`; ADR-010 records `gh` as a hard dependency
- 2026-05-03 — phase-4/task-01 — capture git diff after successful runs; persist diffStat; serve patch via `GET /api/cards/:id/runs/:runId/diff`; render diff pane in card drawer; sweep stale patches alongside worktrees
- 2026-05-03 — tasks/phase-4 — refine task-01 docs, task-02 worker lifecycle, task-04 confirmation invalidation
- 2026-05-03 — tasks/phase-4 — expand stubs into real task files
- 2026-05-03 — phase-3/task-05 — cooperative cancel in worker (stdin reader → `query.interrupt()`), stale-worktree sweep on supervisor construction, Cancel button on active run in drawer + board card, run-done watcher refreshes card on SSE `done`
- 2026-05-03 — phase-3/task-04 — card detail drawer: clicking a board card opens a side panel with metadata, run history, and a per-run event log via `<RunLog key={runId}>`; Run/Edit/Delete affordances integrate with existing endpoints and shared local state
- 2026-05-03 — phase-3/task-03 — add settings page and `/api/settings` (GET/PUT) with apiKeyPath validation, inline-key write to 0600 file, allowlist editor, and defaultRepoPath prefill in card create form
- 2026-05-03 — phase-3/task-02 — six-column kanban board with dnd-kit (drag to move, drop into running triggers run, 409/error revert)
- 2026-05-02 — phase-3/setup — remove dead next/font self-reference, accept Tailwind v4 default sans
- 2026-05-02 — phase-3/setup — initialize shadcn/ui ahead of task-02 (`components.json`, `src/lib/utils.ts`, base-nova theme tokens in `globals.css`)
- 2026-05-02 — phase-3/setup — Tailwind v3 → v4 upgrade (CSS-first config, `@tailwindcss/postcss`); see ADR-009
- 2026-05-03 — phase-3/task-01 — replace demo card with real CRUD UI (list, create/edit form, delete confirm); stabilize RunLog onDone ref to fix re-render tear-down race
- 2026-05-02 — docs/decisions — add ADR-007 (cooperative cancel) and ADR-008 (worktree sweep policy)
- 2026-05-02 — tasks/phase-3 — fix acceptance contradictions in tasks 02/03/04
- 2026-05-02 — tasks/phase-3 — expand stub README into five task files (card CRUD, DnD, settings, drawer, cancel/cleanup)
- 2026-05-01 — phase-2/task-04 — render single demo card with run button and live SSE event log
- 2026-05-01 — fix — suppress hydration warning on <html> for browser-extension attrs
- 2026-05-01 — phase-2/task-03 — add SSE encoders, run-stream replay-then-tail, and events route
- 2026-05-01 — fix — make /api/* routes load under next dev
- 2026-05-01 — phase-2/task-02 — add card/run REST route handlers with deps seam and integration tests
- 2026-05-01 — phase-2/task-01 — bootstrap Next.js 15 + Tailwind 3 alongside worker, add supervisor singleton
- 2026-05-01 — tasks/phase-2 — fix Next.js API name, add deps seam, resolve task-03 contradiction
- 2026-05-01 — tasks/phase-2 — expand stubs into real task files
- 2026-05-01 — docs — align skills + phase-3 README with phase-1 reality
- 2026-05-01 — phase-1/task-06 — add CLI smoke test entrypoint wiring store + supervisor + worker
- 2026-05-01 — phase-1/task-05 — add supervisor with one-active-run-per-card invariant and timeout escalation
- 2026-05-01 — phase-1/task-04 — implement worker skeleton (stdio, git worktree, runAgent, entrypoint)
- 2026-04-30 — docs/test-runner — ratify node --test, update task files
- 2026-04-30 — phase-1/task-03 — implement JSON store with file/memory backends and contract tests
- 2026-04-30 — skills/agent-sdk — flag worker examples as illustrative until task-04
- 2026-04-30 — skills/wire-protocol — align with real protocol types
- 2026-04-30 — skills/task-completion — drop sha from changelog format
- 2026-04-30 — phase-1/task-02 — define wire protocol and on-disk types with zod schemas
- 2026-04-30 — phase-1/task-01 — init monorepo with strict typescript, eslint, prettier
- 2026-04-30 — skills/module-boundaries — clarify type-only imports
- 2026-04-30 — skills/module-boundaries — clarify components/ rule
- 2026-04-30 — skills — add three project skills (wire-protocol, module-boundaries, task-completion) for review
- 2026-04-30 — skills — add agent-sdk skill and vendor claude-api skill
- 2026-04-30 — docs — link CLAUDE.md and README.md to the Cursor agent-kanban cookbook
- 2026-04-30 — phase-0/task-00 — initial scaffold and planning docs
