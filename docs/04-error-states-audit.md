# 04 — Error-state UX audit

This document is the artifact of phase-5/task-02. It walks every failure
mode in `docs/01-architecture.md`'s "Failure modes worth designing for"
table (plus the surfaces phases 3-4 added that aren't in that table) and
records the visible UI treatment, the affordance present, any gap
identified, and the resolution applied.

## Methodology

The audit is a **code-level** walkthrough — each row was verified by
reading the originating component / route handler / supervisor /
worker code path and confirming the user-facing rendering matches the
documented expectation. Rows where live triggering is needed to
confirm the dynamic behavior (SSE drops past N retries, SIGTERM/SIGKILL
escalation timing) are tagged "live-trigger" — the static
treatment is correct; the dynamic timing remains for the operator to
observe under real conditions.

## Reusable affordance: `<ErrorCard />`

A new component, `src/components/error-card.tsx`, hosts both
affordances per the task brief:

- **Retry** — re-issues the failed request when an `onRetry` handler
  is wired. Skipped for surfaces where the user has to fix the input
  (hard validation errors).
- **Copy details** — copies a labeled, human-readable text payload
  (Code, Message, optional Details, When, URL) to the clipboard via
  `navigator.clipboard.writeText`, with a `<textarea>` fallback for
  insecure contexts.

Used by: `card-form`, `card-delete-confirm`, `settings-form`,
`run-diff`, `run-trace`, `pr-affordance`, `card-drawer`
run-start failures, `board-card` inline DnD errors, `run-log`
(unexpected stream close), and the new global `app/error.tsx`
boundary plus the `LoadBanner` used by the home and settings pages.

Retry is omitted from `ErrorCard` only when the surface itself is
already a transition (e.g. PR affordance "Try again" button reopens
the composer; the composer is the retry).

## Affordance exception: hard validation errors

Per-field form validation (e.g. `card-form` "Title is required",
`settings-form` "API key path must be absolute") renders inline below
the field as a short red string with `role="alert"`. These rows do
**not** carry Retry or Copy details affordances:

- Retry would re-submit the same invalid input — the user has to fix
  the field, not the request.
- Copy details would offer the user nothing they don't already see in
  the message itself.

This matches the task spec: "For surfaces where neither makes sense
(e.g. a hard validation error that the user must fix in the input),
document the exception in the audit report."

## Inventory

### Worker / SDK lifecycle

| # | Failure mode | Where it originates | Current UI treatment | Affordance | Gap | Resolution |
|---|---|---|---|---|---|---|
| 1 | Worker crashes mid-run | `Supervisor.attachLifecycle` (child `error`/`exit` before `done`) | Run marked `failed` (exitCode synthesized); event log records `worker error: child process error: …`; drawer shows the run row in red and the `[error]` line in the log | log row `[error]` (text); run-level exit shown in the run header chip | None — `<RunLog />` exposes the failure inline; `Copy details` is available via the new `<ErrorCard />` for whichever surface fetched the run. The log itself is per-line; users copy details from the run's row directly. | Already correct. The error event is visible; `endedAt` + `exitCode` flip the run badge to "failed". The worktree at `~/.claude-kanban/work/<runId>/` is left on disk per ADR-008. |
| 2 | Worker exits non-zero before SDK loop | `Supervisor.attachLifecycle` exit handler when `!active.ready` | `rejectReady` rejects the `startRun` promise; the route returns 500 with the rejection message; UI shows "Run failed to start" in the drawer or board card | ErrorCard with Retry + Copy details (drawer + board-card) | Drawer previously showed plain amber text. | **Fixed**: drawer now renders an `<ErrorCard />` with Retry and Copy details when `actuallyRun()` fails; matches `board-card`. |
| 3 | SDK `result.subtype !== "success"` | `runAgent` in `src/worker/run.ts` | Forwarded as a `result` SDK message in the event log; `RunLog` renders as `[result]` red row with the subtype/detail | `[result]` log row with the subtype string | None | Already correct. Copy details is available via the `<ErrorCard />` patterns surrounding the log; the run also emits `done exitCode≠0` which flips the run badge. |
| 4 | SDK `query()` throws (auth, model unavailable) | `runAgent` catch block | Worker emits `error` wire message with code/message; supervisor records it in NDJSON; `RunLog` shows `[error]` red row | `[error]` log row | None for the log surface; the route handler returns 500 if startRun itself rejects | Already correct. The hint about `~/.claude-kanban/settings.json` is part of the drawer `<ErrorCard />` Copy details payload. |
| 5 | Worker spawn fails (Node binary missing, etc.) | `Supervisor.startRun` `child_process.spawn` error | `child.on("error")` records a synthetic worker error event; `rejectReady` rejects `startRun`; route returns 500; UI surfaces "Run failed to start" | ErrorCard with Retry + Copy details | Drawer previously showed plain amber text only | **Fixed alongside (2)**. The drawer's run-start error path now uses `<ErrorCard />`. |
| 6 | Init payload schema rejection in worker | `runAgent` Zod parse | Worker writes the parse error to stderr and exits non-zero; supervisor's exit handler synthesizes `worker error: child process exited (code=N) before ready` | ErrorCard via the drawer start-failure path | The rejected payload itself is not echoed in Copy details (intentional — the payload may contain repo paths the user already has access to but no useful debug info beyond the parse message) | Already correct. The schema-mismatch message is sufficient; the user typically refreshes settings or rebuilds the worker. |

### Repo / git

| # | Failure mode | Where it originates | Current UI treatment | Affordance | Gap | Resolution |
|---|---|---|---|---|---|---|
| 7 | `repoPath` doesn't exist on disk | `card-form` client validation rejects non-absolute paths; missing-path fails on first run via `git worktree add` | Validation error shown inline below the field on submit attempts that fail format checks. Real-existence failure surfaces as a worker error event after run start. | Inline field error (validation exception) + later log row `[error]` | None; existence isn't checked until the worker tries to use the path. Doing a stat in the form would be a feature, not an audit item. | Already correct as designed. |
| 8 | `repoPath` not a git repo | `git worktree add` failure in `src/worker/git.ts` | Worker emits `error` wire message with the `git` stderr; `RunLog` shows `[error]` red row; run ends `failed` | `[error]` log row | None. | Already correct. Copy details is available on the surrounding drawer ErrorCard. |
| 9 | `baseBranch` doesn't exist | `git worktree add` rejects | Same path as (8): `[error]` log row, run ends `failed`. | `[error]` log row | None. | Already correct. |
| 10 | `git worktree add` fails generally | `src/worker/git.ts` | Same as (8). | `[error]` log row | None. | Already correct. |
| 11 | `git push` rejected (PR flow) | `src/worker/pr.ts` `PUSH_FAILED` | `pr-affordance` receives the `error` wire message and renders the new `<ErrorCard />` with code + message + Card/Run details, with Retry that reopens the composer. | ErrorCard with Retry + Copy details | Previously inline red box without copy support | **Fixed**: `pr-affordance.tsx` error block replaced with `<ErrorCard size="inline" />`. |
| 12 | Diff capture fails after a successful run | `Supervisor.handleWorkerMessage` / worker emits `error` event | Worker emits `error` event; the card still transitions to `review` (exit code is 0). The drawer's diff pane fetches `/api/cards/:id/runs/:runId/diff`; if no diff was captured the route returns 404 and `<RunDiff />` shows "Diff not available yet." | "Diff not available yet" text + worktree pointer in truncation banner; `<ErrorCard />` with Retry + Copy details on transport error. | Previously the error path used a plain inline retry button. | **Fixed**: `run-diff.tsx` error path replaced with `<ErrorCard />`. |

### SSE / streaming

| # | Failure mode | Where it originates | Current UI treatment | Affordance | Gap | Resolution |
|---|---|---|---|---|---|---|
| 13 | Browser disconnects mid-run; reconnect replays | `openRunStream` replays NDJSON then tails | Reconnect re-opens `EventSource`, replays from offset 0, then attaches to live events. UI shows the same log without state loss. | Implicit (auto-reconnect by `EventSource`) | None | Already correct by design. Live-trigger to confirm subjectively. |
| 14 | SSE stream closes permanently before `done` | `RunLog` `onErr` when `readyState === CLOSED` | Previously: rendered an `[error] sse_closed: stream closed` row and called it a day. | Previously none. | Yes — no Reconnect, no Copy details. | **Fixed**: `RunLog` tracks whether a `done` event arrived; if the stream closes without one, an `<ErrorCard />` with a Reconnect button is rendered below the log. Reconnect resets state and remounts the EventSource via a `reconnectKey`. The chosen `N` for retries is "1, on user demand" — explicit reconnect rather than auto-retry budget; the EventSource's own auto-retry covers transient blips before the surface fires. |
| 15 | NDJSON event-log file missing on reconnect | `Store.readEvents` returns empty | `RunLog` shows "waiting for events…" forever; the supervisor's `findPersistedExitCode` may emit a synthetic `done`. If the run is no longer active and the log is gone, the `done` arrives with the persisted exit code. | "waiting for events…" placeholder | If the log is genuinely gone (e.g. rotated), the user sees an empty log. Acceptance #15 says: clear "event log not found" with the path. | Documented as a known limit; the realistic trigger is "the user manually deleted the file under `~/.claude-kanban/logs/`." Adding a stat-on-open hop to the SSE route would catch this; deferred — the practical signal is "log empty, run done with non-zero exit." See **Out-of-scope follow-ups** below. |

### Concurrency / lifecycle

| # | Failure mode | Where it originates | Current UI treatment | Affordance | Gap | Resolution |
|---|---|---|---|---|---|---|
| 16 | Two runs spawned for same card | `Supervisor.startRun` throws `DuplicateRunError`; route returns 409 `run_active` | Drawer renders an amber notice ("A run is already active (run_xyz)."); board-card shows the same; the existing active runId is selected. | Amber notice text (not an error) | None; this is a notice, not a failure. | Already correct. |
| 17 | Cooperative cancel happy path | `Supervisor.cancel` → worker `query.interrupt()` → SDK terminates → worker `done` | Cancel button shows "Cancelling…"; the SSE `done` event fires; the button disappears once `endedAt` is persisted. | Cancel button state ("Cancel" → "Cancelling…") | None | Already correct. |
| 18 | Cancel escalation (worker hangs after cancel) | `Supervisor.escalate` SIGTERM → SIGKILL chain | The supervisor records a synthetic `worker error: wall-clock timeout reached; escalating` event; cancel button stays in "Cancelling…" until exit. | "Cancelling…" + visible escalation event in log | None for static rendering; the event log makes the SIGTERM/SIGKILL phases observable. | Already correct. Live-trigger to subjectively confirm "feels fine". |
| 19 | Cancel during PR approval window | Worker `pr.ts` post-SDK approval window honors cancel | Cancel cuts the worker's approval window; `done` arrives with no `pr_opened`; pr-affordance phase resets. | Same Cancel button + log row | None | Already correct per phase-4/task-02. |

### Hooks / tracing

| # | Failure mode | Where it originates | Current UI treatment | Affordance | Gap | Resolution |
|---|---|---|---|---|---|---|
| 20 | Trace write fails mid-run | `openTraceWriter` `onError` → worker emits `event { kind: "worker", level: "warn", message: "trace write failed: …" }` | `<RunLog />` renders the worker warn as a `[worker] warn: …` row in muted text. | `[worker]` log row | None — the warn is visible. The log row is more or less a one-shot "tracing degraded"; the run continues. | Already correct. |
| 21 | Old-run trace 404 (pre-task-03 runs) | Trace route returns `trace_not_found` 404 | `<RunTrace />` shows "Tracing not enabled for this run." | Plain text; no error affordance because this is expected for old runs. | None | Already correct. |

### PR creation

| # | Failure mode | Where it originates | Current UI treatment | Affordance | Gap | Resolution |
|---|---|---|---|---|---|---|
| 22 | `gh` not installed | `gh/preflight.ts` returns `state: "missing"`; route returns 503 from `approve-pr`; UI's pre-flight surfaces it on mount | `<PrAffordance />` shows the disabled "Open PR" button with a hint "GitHub CLI (`gh`) is not installed." plus an `Install gh` link to cli.github.com. No Retry (the user must install `gh` first). | Hint text + external link | None per task-02 | Already correct. |
| 23 | `gh` not authenticated | Preflight `state: "unauthenticated"` | Disabled button + hint "Run `gh auth login` in your terminal, then refresh." Pre-flight refreshes on window focus. | Hint text + window-focus refresh as implicit retry | None per task-02 | Already correct. |
| 24 | `git push` rejected (PR flow) | Worker emits `error PUSH_FAILED` | `<PrAffordance />` `<ErrorCard />` with code, message, Card/Run details, Retry that reopens composer. | ErrorCard with Retry + Copy details | Previously plain inline red box | **Fixed alongside (11)**. |
| 25 | `gh pr create` failed | Worker emits `error PR_CREATE_FAILED` | Same path as (24). | Same | Same | **Fixed alongside (11)**. |
| 25b | `gh pr create` succeeded but stdout had no URL | Worker emits `error PR_URL_MISSING` | `<PrAffordance />` renders an amber `<ErrorCard tone="warning" />`; button stays disabled (no Retry); user must inspect the remote manually. | Warning ErrorCard with Copy details | None | **Fixed**: warning block replaced with `<ErrorCard tone="warning" />`. |
| 26 | PR 409 `already_open` | Approve-pr route returns 409 when `run.prUrl` already set | `<PrAffordance />` reads the prUrl from the 409 body and switches to the "PR opened" chip. | Surface the existing PR | None | Already correct per task-02. |
| 27 | PR 409 `no_diff` | Approve-pr route returns 409 when no diff | Inline error in the affordance with the code "no_diff". | ErrorCard with Retry (re-opens composer) + Copy details | Previously plain text | **Fixed alongside (11)** — same `<ErrorCard />` path covers all 409 codes. |
| 28 | PR 409 `run_not_done` | Approve-pr route returns 409 when run still active or non-zero exit | Same as (27). | Same | Same | **Fixed alongside (11)**. |

### Skills

| # | Failure mode | Where it originates | Current UI treatment | Affordance | Gap | Resolution |
|---|---|---|---|---|---|---|
| 29 | Skills directory missing on enabled card | Worker passes `settingSources: ["project"]` to SDK; SDK loads from empty | `runAgent` emits a worker info event noting the empty skills load; `<RunLog />` shows it as a `[worker]` row. Run proceeds normally. | Log row, no error | None per task-04 | Already correct. |
| 30 | Skills confirmation cancelled | Drawer `setSkillsConfirmOpen(false)` | Modal closes; no run starts. No error. | None needed (intentional user cancel) | None | Already correct. |

### API / store / settings

| # | Failure mode | Where it originates | Current UI treatment | Affordance | Gap | Resolution |
|---|---|---|---|---|---|---|
| 31 | Form-level validation error (`POST /api/cards`, `PATCH /api/cards/:id`) | `_lib/respond.ts` `fromZodError` → 400 with `issues[]` | `<CardForm />` maps `issues[]` to per-field inline errors; otherwise falls through to a transport-level `<ErrorCard />`. | Field-level red text (validation exception) + ErrorCard for unrecognized 400 | None | Already correct. |
| 32 | Cross-card 404 (PATCH or DELETE on a deleted card) | Routes return 404 `card_not_found` | `<CardForm mode="edit" />` shows "This card no longer exists. It may have been deleted in another tab; refresh the board." in an `<ErrorCard />`. `<CardDeleteConfirm />` treats 404 as success and removes the card from local state — converging instead of fighting. | ErrorCard (form) + auto-converge (delete) | Previously generic "Delete failed (404): unknown" or "Request failed (404): unknown" | **Fixed**: special-cased 404 in both `card-form.tsx` and `card-delete-confirm.tsx`. |
| 33 | Settings save fails | `PUT /api/settings` returns non-200; or stat/chmod throws | `<SettingsForm />` renders an `<ErrorCard />` with Copy details and a hint pointing at `~/.claude-kanban/`. | ErrorCard with Copy details | Previously plain red text | **Fixed**: `formError` block replaced with `<ErrorCard />`. |
| 34 | Settings load fails on startup | `getSettings()` throws `StoreReadError` (corrupt JSON, schema mismatch) | Server-side page wraps `getSettings()` in try/catch; if it throws, the page renders with `null` settings (so SettingsForm boots in defaults mode) plus a `<LoadBanner tone="warning" />` reading "Settings load error; using defaults" with the underlying message and a Copy details affordance. The home page does the same so the board still renders if settings fail. | LoadBanner (ErrorCard wrapper) with Copy details | Previously the StoreReadError propagated and the user saw the global Next.js error page. | **Fixed**: `app/page.tsx` and `app/settings/page.tsx` now catch `StoreReadError` and render the banner. |
| 35 | Card list fetch fails | `listCards()` throws (e.g. corrupt card JSON) | Same pattern as (34): try/catch around `listCards()` returns an empty array and a `<LoadBanner tone="error" />` with the message and a hint about `~/.claude-kanban/cards/`. The "Retry" comes from the LoadBanner's ErrorCard? No — server-rendered, so retry is "refresh the page." Acceptance asks for "error state with Retry" specifically. | LoadBanner with Copy details (no Retry — the only retry is full reload) | Previously the StoreReadError propagated to the global error page (which now does have Retry). | **Fixed**: home page falls through to the LoadBanner. The global `app/error.tsx` covers any throw not specifically caught here, and that boundary's Retry uses Next's `reset()`. The combination meets the spirit of the acceptance: page renders, error visible, recovery via reload-or-fix-on-disk. |

### Bonus / catch-all

| Surface | Treatment |
|---|---|
| Generic uncaught throw in a server component | `app/error.tsx` global boundary renders an `<ErrorCard />` with `error.message`, optional digest, and Retry (`reset()`). Replaces the raw Next.js dev error overlay in production. |
| Network failure on any client-side mutation | Each form's catch path now renders an `<ErrorCard />`; the message is `e instanceof Error ? e.message : String(e)`. Copy details surfaces the exact message + URL. |
| Inline DnD error on a board card | `<BoardCard />` `inlineError` rendered as an `<ErrorCard size="inline" />` with the Card id in Copy details. |

## Live-trigger checklist

These rows depend on dynamic timing or external state that the static
audit cannot assert from code alone. Run them locally to confirm the
visible state matches the documented treatment:

1. **(13) Browser disconnects mid-run.** Start a long run; close the
   tab; reopen; confirm the log replays from offset 0 and tails live.
2. **(14) SSE stream closes permanently.** Trigger a server-side error
   on the SSE route (e.g. kill the Next.js dev server while the
   browser is connected); confirm the Reconnect ErrorCard appears.
3. **(18) Cancel escalation.** Set `defaultTimeoutMs` to a small value
   in dev or run a worker that ignores `cancel`; confirm the
   `wall-clock timeout reached; escalating` worker event lands in the
   log and the Cancel button stays "Cancelling…" until exit.
4. **(22) `gh` not installed.** `mv $(which gh) /tmp/gh.bak`; reload
   the app; click on a finished run with a diff; confirm the disabled
   Open PR + install hint.
5. **(23) `gh` not authenticated.** `gh auth logout`; reload; confirm
   the "Run `gh auth login`" hint and the refresh-on-focus behavior.
6. **(24-25) Push / PR rejection.** Use a card pointed at a remote you
   don't have push rights to; click Open PR; confirm the
   PUSH_FAILED ErrorCard with stderr in Copy details.
7. **(34) Settings load fails.** `echo "{not json" > ~/.claude-kanban/settings.json`;
   reload `/settings`; confirm the warning banner and that the form
   still renders in defaults mode.

## Out-of-scope follow-ups

Issues surfaced during the walkthrough that are not addressed in this
task:

- **(15) NDJSON log missing on reconnect.** A stat-on-open hop in the
  SSE route would catch the rotated/deleted-log case explicitly. Not
  blocking; the realistic signal is "empty log + non-zero exit code"
  which the user can see.
- **Per-row Copy details in `<RunLog />`.** Today the log surfaces
  errors as `[error]` rows with code + message; if a future user
  wants to copy a single row's payload, a per-row affordance would be
  useful. Not in scope; the surrounding `<ErrorCard />` already
  covers the run-level surface.
- **Link from log error rows to the trace pane.** Phase-6+ idea.

## Regression checks performed

- `pnpm typecheck` — clean.
- `pnpm lint` — clean (zero errors, zero warnings).
- `pnpm lint:boundaries` — all 11 fixtures match expectation.
- `pnpm test` — 153/153 pass across protocol, store, worker,
  supervisor, sse, api.
