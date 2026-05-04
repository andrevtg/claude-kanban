**STATUS: done**

# phase-5 / task-02 — Error-state UX audit

## Goal

Audit every failure mode the project explicitly designs for and
verify each one renders as visible, actionable card-level state in
the UI. CLAUDE.md's "no silent failures" hard rule has been followed
by construction across phases 1-4, but the audit was always implicit;
this task is the explicit pass. For each failure mode in
`docs/01-architecture.md`'s "Failure modes worth designing for"
table (plus the surfaces phases 3-4 added that aren't in that table
yet), confirm the user can see *what* went wrong and *what to do
about it*. Each visible error gets either a "Retry" or a "Copy
details" affordance — the user shouldn't have to dig through stderr
to know where the failure was.

This is an audit-and-fix task, not a feature task. Most failure
modes will already have correct treatment from their originating
phase. The work here is enumerating, verifying, and closing the
gaps.

## Inputs

- `docs/01-architecture.md` — "Failure modes worth designing for"
  table is the canonical list. Read it end-to-end before starting.
- The CLAUDE.md "no silent failures" hard rule — the audit's success
  criterion is literally "is this still true."
- `src/components/` — every component that can render an error:
  - `card-form.tsx` — create/edit validation + server errors
  - `card-delete-confirm.tsx` — delete failures
  - `board.tsx`, `board-card.tsx`, `board-column.tsx` — DnD revert
    on 409, run-spawn errors
  - `card-drawer.tsx` — host for run history, diff pane, trace
    pane, PR affordance, cancel
  - `run-card.tsx`, `run-log.tsx` — SSE stream, run-failed state
  - `run-diff.tsx` — fetch errors, truncation banner, "diff
    unavailable" state
  - `run-trace.tsx` — fetch errors, "tracing not enabled" state
  - `pr-affordance.tsx` — pre-flight states, push/PR errors
  - `cancel-button.tsx` — cancel-in-flight, cancelled-but-not-yet-
    done
  - `settings-form.tsx` — load/save errors, validation
- The route handlers under `src/app/api/` — what error shapes they
  emit and which surface to render which (`400 invalid_body`,
  `404 not_found`, `409 conflict`, `503 unavailable`, `500`).
- `docs/02-agent-sdk-usage.md` — failure paths described there
  (e.g. SDK `result.subtype !== "success"`).
- The phase-3/task-05 cancel flow and phase-4/task-02 PR flow —
  both have rich error surfaces; verify they still match what's
  documented.
- The `frontend-design` skill — UX treatment for any gap surfaced
  by the audit. The audit lists *what* must be visible and *what
  affordance* it must have; the skill picks how it looks.

## Outputs

This task produces three artifacts:

1. An audit report — a table mapping every failure mode to its
   current treatment and whether it meets the bar.
2. A small set of UI fixes for the gaps the audit surfaces.
3. A "Retry" / "Copy details" affordance pattern applied
   consistently to every error surface.

### Audit report

Write `docs/04-error-states-audit.md` with one row per failure mode.
Columns:

| Failure mode | Where it originates | Current UI treatment | Affordance | Gap | Resolution |

Populate by walking each row of the architecture doc's failure-mode
table plus the phase-3/4 surfaces (see "Failure-mode inventory"
below). The "Resolution" column is empty for rows that already meet
the bar and notes the fix for rows that don't. The doc is the
audit's permanent record; future phases can re-run it against
their own failure modes.

### Failure-mode inventory

The audit must cover at minimum the following — group them by
originating layer for clarity. This is not exhaustive in advance;
the writer adds rows surfaced during the walk-through.

**Worker / SDK lifecycle (phase 1–2):**

1. Worker crashes mid-run (uncaught throw, segfault).
2. Worker process exits with a non-zero code before the SDK loop
   completes (init payload malformed, etc.).
3. SDK returns a `result` message with `subtype !== "success"`.
4. SDK `query()` throws (auth failure, model unavailable).
5. Worker spawn itself fails (Node binary missing, init payload
   write to stdin fails).
6. Worker init payload schema rejects (Zod parse error in worker;
   worker exits before sending `ready`).

**Repo / git (phase 1, surfaced through phase 2-4):**

1. `repoPath` doesn't exist on disk.
2. `repoPath` exists but isn't a git repo.
3. `baseBranch` doesn't exist in the repo.
4. `git worktree add` fails (worktree already exists, dirty index,
    submodule rough edges).
5. `git push` rejected — no rights to remote (phase-4/task-02).
6. Diff capture fails after a successful run (phase-4/task-01).

**SSE / streaming (phase 2):**

1. Browser disconnects mid-run; reconnect replays from offset 0,
    then tails. (Already correct by design — verify.)
2. SSE stream hits an error before the run terminates (server
    closes the connection, client's network drops past reconnect
    budget).
3. NDJSON event-log file is missing or unreadable on reconnect
    (e.g. log rotated out of band).

**Concurrency / lifecycle (phase 1, 3):**

1. Two runs spawned for the same card (one-active-run-per-card
    invariant).
2. User cancels mid-run, cooperative cancel works (phase-3/task-05).
3. User cancels mid-run, cooperative cancel hangs and SIGTERM/
    SIGKILL escalation kicks in.
4. Cancel arrives during the post-SDK approval window
    (phase-4/task-02).

**Hooks / tracing (phase 4):**

1. Trace write fails mid-run (phase-4/task-03).
2. Trace file is missing for an old run (pre-task-03).

**PR creation (phase 4):**

1. `gh` not installed.
2. `gh` not authenticated.
3. `gh pr create` fails (rejected base branch, etc.).
4. `gh pr create` succeeds but stdout has no URL.
5. User clicks Open PR on a run that already has `prUrl` (409
    `already_open`).
6. User clicks Open PR on a run with no diff (409 `no_diff`).
7. User clicks Open PR on a not-done run (409 `run_not_done`).

**Skills (phase 4):**

1. Skill loading enabled but `<repoPath>/.claude/skills/` is
    missing.
2. User cancels at the per-session confirmation modal.

**API / store (phase 2-3):**

1. Form-level validation error (`400 invalid_body` from
    `POST /api/cards` or `PATCH /api/cards/:id`).
2. Cross-card conflict (`PATCH` on a deleted card returns 404).
3. Settings save fails (file-mode or path errors writing
    `~/.claude-kanban/settings.json`).
4. Settings load fails on startup (corrupt JSON, missing file
    handled by defaults).
5. Card list fetch fails (route handler crash, FS error reading
    `~/.claude-kanban/cards/`).

The writer adds any further rows surfaced during the walk-through.

### Visible-treatment specification

For every gap the audit identifies, the task specifies the visible
treatment before fixing the code. Each treatment row names:

- The component(s) that render the error.
- The exact text of the user-facing message (or the message
  template, if it interpolates).
- The affordance: Retry, Copy details, or both.
- Any next-step hint (e.g. "Run `gh auth login`", "Inspect the
  worktree at `~/.claude-kanban/work/<runId>/`").

### "Retry" and "Copy details" affordances

Two reusable surfaces, applied wherever an error is shown:

- **Retry** — a button that re-issues the failed request. Applies
  to anything where the user might fix the underlying issue between
  attempts (auth, network, transient FS error). Does not apply to
  hard validation errors (the user fixes the input, not the
  request).
- **Copy details** — copies the full error payload to clipboard:
  the user-facing message, the error code (if any), the originating
  request/route, and any worker stderr available. The point is
  giving the user something to paste into a bug report or a Slack
  message. Format the clipboard content as plain text with labeled
  fields, not JSON — this is for humans, not tools.

A small helper component (e.g. `src/components/error-card.tsx`)
hosts both affordances and is used by the gap-fix work. The
frontend-design skill picks the visual treatment.

### Code fixes

Apply the smallest possible fix per gap. If a gap reveals an
architectural issue (e.g. an error is silently swallowed in a
route handler), fix it at the source — don't paint over with a
toast. Document each fix in the audit report's "Resolution" column.

### Documentation updates

- `docs/04-error-states-audit.md` — the audit report itself
  (described above).
- `docs/01-architecture.md` — if any failure mode surfaces during
  the audit that's not in the table, add it. The architecture doc
  is the canonical list; the audit may extend it.
- `docs/CHANGELOG.md` — one entry per gap fixed (rolled up if
  there are many; one line each is fine if there are few).

## Acceptance

Acceptance for this task is "every failure mode in the audit
report renders the documented visible state, with the documented
affordance, when triggered." Walk through each. Many will be
"already correct, verified" rather than "fixed in this task" —
both outcomes are acceptable. The acceptance is the verification,
not the fix count.

The walkthrough should produce screenshots or a written transcript
for each row; the audit report's "Current UI treatment" column is
the artifact of that walkthrough.

The numbered list below mirrors the failure-mode inventory above.
For each, the acceptance line is "trigger the failure, observe the
documented state, confirm the documented affordance is present and
works." The triggering recipe is in the audit report's notes column.

1. Worker crashes mid-run — run is marked `failed`, last events
   visible, worktree still on disk per ADR-008 acceptance, drawer
   shows a clear "run failed" state with Copy details. (Phase
   1 originating; verify still correct.)
2. Worker exits with non-zero before SDK loop — same treatment as
   (1) but the failure event is the worker-init failure, not an
   SDK result.
3. SDK `result.subtype !== "success"` — run marked `failed`,
   error message from the result surfaced on the card. Copy
   details includes the subtype.
4. SDK `query()` throws — distinguishable from (3); the auth/model
   case in particular should hint at "check `~/.claude-kanban/
   settings.json`."
5. Worker spawn fails — UI shows a worker-level error chip on the
   card; Retry available. The supervisor must surface this; if it
   currently doesn't, fix it.
6. Init-payload schema rejection in worker — worker exits before
   `ready`, supervisor surfaces the parse error to the card. Copy
   details includes the rejected payload (with any secrets
   redacted; see Out of scope).
7. `repoPath` missing — surfaced inline at the card form level
   (validation), not after spawn. Verify the form treats this as
   a recoverable input error, not a server error.
8. `repoPath` not a git repo — same posture as (7), or surfaced
   on first run attempt; either is acceptable, but the message
   must be specific ("Not a git repository: <path>") not generic.
9. `baseBranch` doesn't exist — surfaced on run start; run
   transitions to `failed` quickly with a clear message.
10. `git worktree add` fails — run-level failure with the git
    stderr in Copy details.
11. `git push` rejected (PR flow) — phase-4/task-02 already
    documents this; verify the inline error fires and Retry works.
12. Diff capture fails — phase-4/task-01 documents the "diff
    unavailable" state; verify the worktree-pointer hint is
    present.
13. Browser disconnects mid-run; reconnect replays — verify the
    UI doesn't lose state; no error is shown because none
    occurred.
14. SSE stream errors — the run log shows a "stream
    interrupted; reconnecting…" affordance; if reconnect fails
    past N attempts, a "Reconnect" button appears. Define N as
    part of this task; phase-2 didn't pin it.
15. NDJSON log missing on reconnect — clear error in the run
    log: "event log not found." Copy details includes the
    expected path.
16. Two runs for same card — phase-1 returns `409`; the UI
    surfaces that state at the click site (drawer or board card).
    Verify; fix if currently silent.
17. Cancel happy path — already correct per phase-3/task-05.
    Verify.
18. Cancel escalation — the user gets feedback that the run is
    being force-stopped (SIGTERM phase, SIGKILL phase). Even
    "cancelling…" with a spinner is enough; silent waiting is not.
19. Cancel during PR approval window — verify; phase-4/task-02
    specifies behavior.
20. Trace write fails — phase-4/task-03 emits a single warn
    event; verify the event log surfaces it visibly, not just as
    a wire-protocol curiosity.
21. Old-run trace 404 — drawer trace pane shows "Tracing not
    enabled for this run." Already correct; verify.
22. `gh` not installed — PR affordance shows the GH_MISSING chip
    with an "Install GitHub CLI" hint; no Retry (the user must
    install `gh` first). Verify per phase-4/task-02.
23. `gh` not authenticated — PR affordance shows the GH_UNAUTH
    chip hinting `gh auth login`; Retry available so the user can
    re-attempt after authenticating. Verify per phase-4/task-02.
24. `git push` rejected (PR flow) — PR affordance shows the
    PUSH_FAILED chip with push stderr in Copy details; Retry
    available. Verify per phase-4/task-02.
25. `gh pr create` failed — PR affordance shows the
    PR_CREATE_FAILED chip with `gh` stderr in Copy details; Retry
    available. Verify per phase-4/task-02. (Note: when `gh pr
    create` succeeds but stdout has no URL, the affordance stays
    disabled with no Retry per task-02's "PR_URL_MISSING" path.)
26. PR 409 `already_open` — clicking Open PR on a run that already
    has `prUrl` surfaces an inline error pointing to the existing
    PR rather than a silent no-op. Verify.
27. PR 409 `no_diff` — clicking Open PR on a run with no diff
    surfaces an inline error explaining there's nothing to push.
    Verify.
28. PR 409 `run_not_done` — clicking Open PR on a not-done run
    surfaces an inline error explaining the run must finish first.
    Verify.
29. Skills directory missing — phase-4/task-04 specifies the
    "empty skills load" event. Verify the event log surfaces it.
30. Skill confirmation cancelled — no error; modal closes; no
    run starts. Verify.
31. Form validation error — already verified by phase-3/task-01
    acceptance; spot-check.
32. Cross-card 404 — the form / drawer surfaces "this card no
    longer exists" rather than crashing. Likely a gap; fix.
33. Settings save fails — surfaced inline on the settings page
    with the FS error. Likely already correct; verify.
34. Settings load fails — the app boots with defaults and
    surfaces a banner ("settings load error; using defaults").
    Likely a gap; fix.
35. Card list fetch fails — the home page shows an error state
    with Retry, not an empty list. Likely a gap; fix.

### "Retry" / "Copy details" universality check

After the gap fixes land, run a final pass: every error surface in
the app has at least one of the two affordances. No exceptions.
For surfaces where neither makes sense (e.g. a hard validation
error that the user must fix in the input), document the exception
in the audit report.

### Regression checks

- All phase-1..4 acceptance walkthroughs still pass. The audit
  surfaces gaps; fixing them must not regress the happy paths.
- `pnpm typecheck` and `pnpm lint` pass (the latter including the
  task-01 boundary rule).
- `node --test` across all existing test files still passes.

## Out of scope

- Adding error analytics, telemetry, or remote error reporting
  (Sentry, Datadog, etc.). v1 is a single-user local tool;
  errors are visible to the user, not shipped to a backend.
  Out of scope, and likely permanently — adding telemetry to a
  local tool would be a privacy regression, not a feature.
- A dedicated "errors" view that aggregates failures across
  cards. v1 keeps errors at the point of action; an aggregate
  view is a phase-6+ idea if it ever comes up.
- Internationalization of error messages. English-only is the
  v1 stance and isn't changing in phase 5.
- Rich error visualization (stack traces with source maps, in-
  browser interactive trace inspectors). Copy details into a text
  payload is enough; richer tooling belongs in dev tools, not in
  the kanban.
- Secret redaction in Copy details payloads. v1 documents the
  expectation that Copy details may include sensitive paths or
  partial command output; users running the tool locally already
  have full access to those secrets. A redaction pass is a
  separate concern that would deserve its own ADR if pursued.
- Retry budgets / exponential backoff for transient errors. The
  Retry button is a manual-only affordance; automatic retry would
  be a feature, not an audit fix.
- Live error correlation across the worker, supervisor, and UI
  (e.g. a unified error id that links a card-level error to its
  worker stderr and SSE event). Nice idea, real work, deferred to
  a phase-6+ proposal.
- The Managed Agents port's error surfaces. Different runtime,
  different failure modes. Phase-5/task-04 calls them out at the
  conceptual level; this task is about local mode.
