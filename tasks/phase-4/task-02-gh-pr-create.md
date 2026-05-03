**STATUS: done**

# phase-4 / task-02 — `gh pr create` integration

## Goal

When a card reaches `review` status with a captured diff (task-01) and
the user clicks "Open PR," the worker pushes the run's branch to the
configured remote and opens a pull request via the GitHub CLI (`gh`).
The card's run record gains `prUrl`; the UI surfaces the URL as a link
and disables the button on subsequent clicks for that run. Pre-flight
checks (`gh` installed, `gh` authenticated) gate the button so failures
are visible state, not error toasts at click time. The decision to
hard-require `gh` (rather than abstract over hosts) is recorded as
ADR-010 as part of this task.

## Inputs

- `src/worker/index.ts` — needs an `approve_pr` handler that runs after
  the SDK loop completes, before the worker exits
- `src/lib/supervisor/index.ts` — `approvePr(runId, { title, body })`
  already forwards to the worker; `pr_opened` is already routed
  through `handleWorkerMessage`. This task adds persistence
  (`updateRun(prUrl)`) and the pre-flight surface
- `src/protocol/messages.ts` — `ApprovePrMessageSchema` and
  `PrOpenedMessageSchema` exist; this task settles on `error` with
  stable PR-related codes rather than a new wire variant
- `src/protocol/card.ts` — `Run.prUrl` already exists
- `src/app/api/cards/[id]/runs/[runId]/approve-pr/route.ts` — exists
  per phase-2/task-02; this task extends its preconditions and status
  codes
- `src/components/card-drawer.tsx` — host for the Open PR button and
  the resulting link
- `src/lib/store/index.ts` — uses `updateRun` from task-01
- `docs/01-architecture.md` — Failure-modes table replaces the existing
  `gh` row with a fuller treatment
- `docs/03-decisions.md` — append ADR-010 (see Outputs)
- `docs/05-relation-to-cursor-cookbook.md` — the `autoCreatePR` row
  gains a sentence about the local-mode `gh` dependency vs Managed
  Agents' bundled git auth
- `tasks/phase-4/task-01-git-diff.md` — task-02 builds on task-01's
  `Store.updateRun` and on `Run.diffStat` being populated

## Outputs

### Worker module: `src/worker/pr.ts`

New file. Two responsibilities, both worker-side because the worker is
the only process that shells out to `gh`:

```ts
export type GhStatus =
  | { state: "ok"; version: string; account: string }
  | { state: "missing" }                   // gh binary not on PATH
  | { state: "unauthenticated"; message: string };

export async function checkGh(): Promise<GhStatus>;

export interface OpenPrArgs {
  worktreePath: string;
  baseBranch: string;
  branchName: string;
  remote: string;          // default "origin"
  title: string;
  body: string;
}

export type PrErrorCode =
  | "GH_MISSING"
  | "GH_UNAUTH"
  | "PUSH_FAILED"
  | "PR_CREATE_FAILED"
  | "PR_URL_MISSING";

export type OpenPrResult =
  | { ok: true; url: string }
  | { ok: false; code: PrErrorCode; message: string; stderr?: string };

export async function openPr(args: OpenPrArgs): Promise<OpenPrResult>;
```

Behavior:

1. `git -C <worktreePath> push -u <remote> <branchName>`. On non-zero
   exit, return `PUSH_FAILED` with stderr.
2. `gh pr create --title <title> --body-file - --base <baseBranch> --head <branchName>`
   piping `body` on stdin. Capture stdout (the PR URL) and trim.
3. If stdout is empty or doesn't parse as a URL, return
   `PR_URL_MISSING`. (Yes, this happens.)
4. On success, return `{ ok: true, url }`.

Tests in `src/worker/pr.test.ts` cover each branch via a stubbed
`execFile`; no real network calls.

### Supervisor-side pre-flight: `src/lib/gh/preflight.ts`

`src/worker/` and `src/lib/` cannot import each other (CLAUDE.md hard
rule), so the `gh` pre-flight used by the supervisor lives in its own
shared-format module:

- `src/worker/pr.ts` owns the full PR flow.
- `src/lib/gh/preflight.ts` exports the same `checkGh()` for the
  supervisor's pre-flight call.

Both shell out to `gh --version` and `gh auth status` and parse with
the same logic. Acceptable duplication: the alternative is putting
side-effecting shell calls in `src/protocol/`, which would mix
protocol with execution. Document the duplication choice inline at
both files' top comments.

### New API route: `GET /api/gh/status`

Returns `GhStatus` JSON. The drawer fetches this on mount (and on
window focus) so the Open PR button reflects current state. Cache for
~10s client-side; no need to re-shell on every render.

### Wire protocol additions (`src/protocol/messages.ts`)

PR failures use `{ type: "error", code: PrErrorCode, message }` with
the stable codes above, rather than a new wire variant. Document the
codes as part of `messages.ts` and round-trip-test each in
`messages.test.ts`. The `ErrorMessageSchema` already accepts an
arbitrary `code: string` so no schema change is required; only the
documentation and tests gain rows.

`RunInitPayloadSchema` gains
`approveTimeoutMs: z.number().int().positive().optional()` so the
supervisor can configure the worker's post-SDK approval-window
duration (default `15 * 60 * 1000` if absent). Round-trip test added.

### Worker integration (`src/worker/index.ts`)

After the run completes successfully and `diff_ready` is sent, do not
exit. Enter a small loop reading further wire messages from stdin
until either:

- `approve_pr` arrives → call `openPr`; on success emit `pr_opened`,
  on failure emit `error` with the appropriate code; either way exit
  after the response is sent.
- A wall-clock timeout fires (default `init.approveTimeoutMs`, see
  below) → emit no further messages and exit. The supervisor's
  existing close-on-exit path runs.
- Stdin closes → exit.

The cooperative-cancel reader from phase-3/task-05 is already running
concurrently; extend its message handling to recognize `approve_pr`
so cancel and approve cohabit cleanly. Document the post-SDK message
loop in the file's top comment.

Skip the post-SDK loop entirely when `agentExit !== 0` (no PR for a
failed run).

#### Worker lifecycle change

This task is the first time the worker has a lifecycle phase beyond
the SDK loop. Treat it as a meaningful change from phases 1-3, not
just a wire-protocol addition.

1. **Two lifecycle phases.** The worker now has SDK execution
   (unchanged from phase 1) and a post-SDK approval window (new). The
   `done` wire message is emitted only when the worker is about to
   exit, not when the SDK loop completes. Anything downstream that
   treated SDK-loop-completion and worker-exit as the same instant
   needs to pick which one it actually meant.

2. **Cancel during the approval window.** If `cancel` arrives during
   the approval window, the worker exits immediately with `done`;
   `pr_opened` is never emitted. The supervisor's existing escalation
   timers (5s SIGTERM, 5s SIGKILL from phase-1/task-05) continue to
   apply as a backstop in case the worker hangs in the approval loop
   itself.

3. **Configurable approval timeout.** The 60s wall-clock default is
   replaced by a configurable `approveTimeoutMs` field on
   `RunInitPayload`, defaulting to `15 * 60 * 1000` (15 minutes).
   Rationale: long enough that "user got distracted and came back"
   works; short enough that abandoned cards don't keep workers alive
   indefinitely.

4. **`Run.endedAt` semantics.** `endedAt` is set when the worker
   exits, not when the SDK loop completes. For runs that wait in the
   approval window, `endedAt` reflects the worker's full lifetime
   including the wait. Document this as a one-sentence note in the
   data-model section of `docs/01-architecture.md`.

### Supervisor persistence (`src/lib/supervisor/index.ts`)

In `handleWorkerMessage`, on `pr_opened`:
`Store.updateRun(cardId, runId, { prUrl: msg.url })`. On `error` with a
PR-related code, persist nothing but route the error into the event
log (already happens). Tests added.

### API route adjustments

`POST /api/cards/:id/runs/:runId/approve-pr` (existing):

- `409 already_open` if `card.runs[runId].prUrl` is already set.
- `409 no_diff` if `card.runs[runId].diffStat` is missing or
  all-zero.
- `409 run_not_done` if the run's `endedAt` is unset or
  `exitCode !== 0`.
- `503 gh_unavailable` with body `{ state, message }` if pre-flight
  fails. The drawer can also call `/api/gh/status` directly to render
  the disabled state without making the user click first.
- `202 accepted` otherwise; the actual outcome arrives via SSE
  (`pr_opened` or `error`).

### UI: Open PR affordance in `src/components/card-drawer.tsx`

In the run-row of a `done` (exitCode 0) run that has a non-empty
`diffStat`, render visible states:

1. **`gh` missing.** Button disabled, tooltip "GitHub CLI (`gh`) is
   not installed." Inline link to `https://cli.github.com`.
2. **`gh` unauthenticated.** Button disabled, tooltip "Run
   `gh auth login` in your terminal, then refresh."
3. **Authenticated, no PR yet.** Button enabled, label "Open PR".
   Click opens a small composer (modal/popover — design skill's call)
   with a default title (the card title) and body (the prompt + diff
   stat summary). Submit issues `POST /approve-pr`.
4. **Pushing/creating.** Spinner state while waiting on the SSE event.
   Button disabled to prevent double-submits.
5. **`PUSH_FAILED`.** Inline error: "Push to `<remote>` failed:
   <stderr>." Button re-enabled.
6. **`PR_CREATE_FAILED`.** Inline error with stderr; button
   re-enabled.
7. **`PR_URL_MISSING`.** Inline warning: "PR may have been created but
   `gh` returned no URL. Check `<remote>` manually." Button stays
   disabled to prevent a duplicate push.
8. **`pr_opened`.** Button replaced by an external-link chip showing
   the PR URL.

Visual treatment is the frontend-design / shadcn skills' call.

### ADR-010 — `gh` as a hard dependency

Append to `docs/03-decisions.md`:

```text
ADR-010: gh CLI as a hard dependency for PR creation
Date: 2026-05-03
Status: accepted

Context. The PR step needs to push a branch and open a pull request.
Options: shell out to `gh`, call GitHub's REST API directly via a
fetch wrapper, or abstract over hosts (GitHub, GitLab, Bitbucket).

Decision. Hard-require `gh`. The UI pre-flights `gh --version` and
`gh auth status` and disables the Open PR button on either failure.

Alternatives considered.
- Direct REST via PAT. Forces us to ship a token-input flow and
  manage refresh. `gh` already owns that surface; piggybacking is
  cheaper than reimplementing.
- Multi-host abstraction. Real value, real cost. v1 targets GitHub
  users; GitLab and Bitbucket land as a separate ADR if/when there's
  demand.

Local mode vs. Managed Agents. Managed Agents bundles git auth into
the sandbox; PR creation moves into a tool the agent calls (or the
GitHub MCP server) rather than a worker-level wrapper around `gh`.
The local-mode dependency on `gh` does not port forward.

Trade-offs. Users without `gh` cannot open PRs from the UI; they can
still run the agent and inspect the diff. The pre-flight surfaces
this clearly so it's a visible disable, not a runtime crash.
```

### Failure-mode rows in `docs/01-architecture.md`

Replace the existing "`gh` not installed" row with:

| `gh` not installed | Pre-flight returns `missing`; Open PR button disabled with install hint. |
| `gh` not authenticated | Pre-flight returns `unauthenticated`; Open PR disabled with `gh auth login` hint. |
| `git push` rejected (no rights) | Worker emits `error PUSH_FAILED` with stderr; UI shows inline error; run state unchanged. |
| `gh pr create` fails | Worker emits `error PR_CREATE_FAILED`; UI shows inline error. |
| `gh pr create` succeeds but stdout has no URL | Worker emits `error PR_URL_MISSING`; UI warns and disables to prevent double-push. |

### Cookbook divergence note

In `docs/05-relation-to-cursor-cookbook.md`, append to the
`autoCreatePR` row a sentence: "Local mode hard-requires `gh` for the
push + PR step (see ADR-010); Managed Agents bundles git auth into the
sandbox and exposes PR creation as a tool/MCP call instead."

## Acceptance

Manual acceptance — exercise each visible state. Preconditions for the
PR-flow steps: a sandbox repo configured per the user's phase-4 setup
with push rights, branch protection off, and "delete branches after
merge" on. The task does not name a specific repo path; use the user's
configured sandbox repo.

1. **`gh` not installed.** With `gh` removed from PATH, open the
   drawer for a `done` card with a non-empty diff. Open PR button is
   disabled with the install hint. `GET /api/gh/status` returns
   `{ state: "missing" }`. Forcing a click on the disabled button
   issues no request.
2. **`gh` installed but not authenticated.** With `gh` on PATH and
   `gh auth logout` run, button is disabled with the auth hint.
   `GET /api/gh/status` returns `unauthenticated` with the message
   from `gh auth status`.
3. **Authenticated but no push rights.** Configure the sandbox repo's
   `origin` to a remote the user cannot push to (e.g., a fork URL
   without write access). Click Open PR. Inline error
   `PUSH_FAILED` with the rejection reason. Button re-enabled.
4. **Push succeeds, `pr create` fails.** Force `gh pr create` to fail
   (e.g., set `--base` to a branch that doesn't exist on the remote).
   Inline error `PR_CREATE_FAILED`; the pushed branch remains on the
   remote (acceptable; user can clean up).
5. **`pr create` succeeds but URL is missing.** Stub `gh` with a
   wrapper that prints empty stdout. Inline `PR_URL_MISSING` warning;
   button stays disabled.
6. **Happy path.** With everything configured, click Open PR. Within
   ~10s the SSE stream emits `pr_opened`; the button becomes a chip
   linking to the PR URL; `card.runs[runId].prUrl` persists; reload
   the page and the chip is still there.
7. **Idempotency.** Click Open PR a second time on a run that already
   has `prUrl`. The API returns `409 already_open`; the UI shows the
   existing chip, not a new request.
8. **No diff guard.** With an empty-diff run from task-01, the Open PR
   button is hidden. Forcing the request via
   `curl POST .../approve-pr` returns `409 no_diff`.
9. **Run-not-done guard.** With a still-running run,
   `curl POST .../approve-pr` returns `409 run_not_done`.
10. **Protocol round-trip.** `node --test src/protocol/messages.test.ts`
    passes for the new error codes.
11. **Worker tests.** `node --test src/worker/pr.test.ts` passes for
    every `OpenPrResult` branch.
12. **Supervisor test.** A new test covers "supervisor persists prUrl
    on pr_opened" and "supervisor does not persist prUrl on PR error."
13. **`/api/gh/status` test.** Route returns the expected shape across
    `ok`, `missing`, and `unauthenticated`.

### Regression checks

- Phase-2 run pipeline: drag a card to running, watch events stream
  end-to-end.
- Phase-3/task-01 card CRUD: create, edit, delete still work.
- Phase-3/task-02 DnD: drag between columns still works.
- Phase-3/task-03 settings page: GET/PUT still work.
- Phase-3/task-04 drawer: opens, run history, log selection still
  work.
- Phase-3/task-05 cancel + sweep: cancel still cooperates within ~1s;
  sweep still runs on supervisor construction.
- Phase-4/task-01 diff capture: `diff_ready` still persists `diffStat`;
  the diff pane still renders.
- `pnpm cli run …` still works.
- `pnpm typecheck` and `pnpm lint` pass.

## Note for phase-5/task-04 handoff

In Managed Agents mode, git auth is bundled with the sandbox and PR
creation is a tool the agent calls (or the GitHub MCP server). The
worker-level `openPr` wrapper is deleted; `approve_pr` becomes a
session message that triggers the managed PR tool. The
`/api/gh/status` route and the Open PR pre-flight UI go away because
the cloud sandbox's auth state is part of the session, not the user's
local install.

## Out of scope

- GitLab, Bitbucket, or self-hosted alternatives. Future ADR if there's
  demand.
- A "draft PR" toggle. Trivial follow-up; not v1.
- Editing PR title/body after creation. Out of scope; users can edit
  on GitHub.
- Linking the PR back into the diff pane (e.g., "view on GitHub" per
  hunk). Phase 5 polish.
- Auto-syncing PR status (merged / closed) back to the card. Out of
  scope; the card's `prUrl` is a pointer, not a mirror.
- MCP server configuration, the Managed Agents port itself, multi-repo
  per card, multi-PR per run, scheduled runs, watch mode, deployable
  form — deferred to phase 5+.
