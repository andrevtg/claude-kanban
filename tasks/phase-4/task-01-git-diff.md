# phase-4 / task-01 — Git diff capture

## Goal

After a successful Agent SDK run, the worker captures the full set of
changes the agent made on its branch and ships them to the UI: a
`git diff --stat` summary plus the full unified patch. The card detail
drawer renders the patch as a read-only file-by-file view, and
`card.runs[].diffStat` is persisted by the parent so the board can show
change-size hints without refetching the patch. Empty diffs (the agent
did nothing material) and large diffs (the patch exceeds a sensible cap)
are visible states with their own treatment.

## Inputs

- `src/worker/index.ts` — the post-`runAgent` block where the diff step
  lands, between the worktree-retained event and the `done` message
- `src/worker/git.ts` — existing `git()` wrapper, `branchNameForRun`;
  new `captureDiff` lives here
- `src/protocol/messages.ts` — `DiffReadyMessageSchema` already declares
  `{ type: "diff_ready", stat }`. This task expands the schema to carry
  the on-disk patch pointer (see Outputs)
- `src/lib/supervisor/index.ts` — `handleWorkerMessage` already routes
  `diff_ready` into the event log; this task adds the persistence side
  (write `diffStat` onto the run record)
- `src/protocol/card.ts` — `Run.diffStat` already exists; confirm shape
  matches
- `src/components/card-drawer.tsx` — host for the new diff pane
- `src/components/run-log.tsx` — reference for SSE consumption pattern
- `src/lib/store/index.ts` — needs an `updateRun` method
- `src/lib/supervisor/cleanup.ts` — extend the stale-run sweep to cover
  `~/.claude-kanban/diffs/`
- `docs/01-architecture.md` — "Failure modes" table gets a new row
- `docs/02-agent-sdk-usage.md` — cross-reference: this task sits *after*
  the SDK loop terminates, not as a hook
- `tasks/phase-3/task-04-card-detail-drawer.md` "Out of scope": "Diff
  rendering for a finished run — phase 4." This task fulfils that.

## Outputs

### Wire protocol additions (`src/protocol/messages.ts`)

Expand `DiffReadyMessageSchema`:

```ts
{
  type: "diff_ready",
  stat: DiffStat,
  patchPath: string,        // absolute path under ~/.claude-kanban/diffs/<runId>.patch
  truncated: boolean,       // true if patch was capped
  bytes: number,            // size of the on-disk patch file
}
```

Streaming a multi-megabyte patch through the wire protocol bloats the
NDJSON event log and blocks the SSE consumer. Writing the patch to a
sibling file under `~/.claude-kanban/diffs/<runId>.patch` keeps the
protocol message small and reuses the "files on disk are forensic gold"
pattern from NDJSON logs. Round-trip test added in
`src/protocol/messages.test.ts`.

Add `diffPath` and `diffsDir` fields as needed to `RunInitPayloadSchema`
so the worker knows where to write without importing `paths.ts`.

### Worker-side diff capture (`src/worker/git.ts`)

New exports:

```ts
export interface CaptureDiffArgs {
  worktreePath: string;
  baseBranch: string;
  patchPath: string;        // where to write the full patch
  maxBytes?: number;        // default 1 MiB
}

export interface CaptureDiffResult {
  stat: DiffStat;
  bytes: number;
  truncated: boolean;
}

export async function captureDiff(args: CaptureDiffArgs): Promise<CaptureDiffResult>;
```

Behavior:

- `git diff --stat <baseBranch>..HEAD` (run in `worktreePath`) → parse
  the summary line into `{ files, insertions, deletions }`. If no
  changes, return zeroes; the caller still emits `diff_ready` with a
  zero stat and no patch file.
- `git diff <baseBranch>..HEAD` → write to `patchPath` via a streamed
  pipeline. Cap at `maxBytes`; if hit, append a sentinel line
  `*** truncated at N bytes ***` and set `truncated: true`.
- Failures throw a typed `GitError` with code `DIFF_FAILED`. The caller
  surfaces a worker error event and skips `diff_ready` — the run still
  completes successfully if the agent's actual work succeeded.

Tests in `src/worker/git.test.ts`: empty diff, single-file diff,
multi-file with a rename, truncation at a tiny `maxBytes`, base-branch
missing.

### Worker integration (`src/worker/index.ts`)

After `runAgent` returns with `agentExit === 0`, before the final `done`:

1. Compute `patchPath` from `init.diffPath` (passed in by the
   supervisor; worker doesn't import `paths.ts` from `lib/`).
2. Call `captureDiff`. On success, send
   `{ type: "diff_ready", stat, patchPath, truncated, bytes }`.
3. On `GitError`, send a worker error event and proceed to `done` with
   the same exit code as before. Diff capture is best-effort.

Skip diff capture entirely when `agentExit !== 0`. Add a worker info
event explaining the skip.

### Supervisor persistence (`src/lib/supervisor/index.ts`)

In `handleWorkerMessage`, on `diff_ready`: in addition to the existing
event-log dispatch, call `Store.updateRun(cardId, runId, { diffStat })`
to persist `diffStat` onto `card.runs[].diffStat`. Also populate
`init.diffPath` when constructing `RunInitPayload` (path comes from a
new `paths.ts` helper `diffPath(runId)`).

### Store (`src/lib/store/index.ts`)

New method:

```ts
updateRun(cardId: string, runId: string, patch: Partial<Run>): Promise<Run>;
```

Atomic read-modify-write of the card JSON; throws if card or run is not
found. Tests confirm round-trip for `diffStat`, `prUrl` (used by
task-02), and `endedAt`.

### `src/lib/paths.ts`

Add `diffsDir()` returning `~/.claude-kanban/diffs/` and
`diffPath(runId)` returning the per-run patch path. Ensure the directory
exists at supervisor construction time.

### New API route: `GET /api/cards/:id/runs/:runId/diff`

Streams the patch file with `Content-Type: text/plain; charset=utf-8`.
Returns metadata in response headers (`X-Diff-Files`, `X-Diff-Insertions`,
`X-Diff-Deletions`, `X-Diff-Truncated`, `X-Diff-Bytes`) so the client
can render the truncation banner without re-parsing. If `card.runs[]`
has no `diffStat` yet, return `404 diff_not_ready`.

### UI: `src/components/run-diff.tsx`

Client component. Props: `{ cardId, runId, diffStat }`. Visible states:

1. **No diff yet.** Run still active or `diffStat` not persisted: empty
   placeholder.
2. **Empty diff.** `diffStat.files === 0`: "Agent made no changes." No
   fetch.
3. **Patch available.** Fetches `/api/cards/:id/runs/:runId/diff`,
   parses with a minimal unified-diff tokenizer, renders file-by-file
   with collapsible hunks. Header line per file shows `+N -M`.
4. **Truncated.** Banner: "Patch exceeded 1 MiB; showing the first N
   bytes. Inspect the worktree at `~/.claude-kanban/work/<runId>/` for
   the full diff."
5. **Fetch error.** Inline error with retry.

Mounted inside `<CardDrawer>` as a sibling of the run-log pane, gated by
the same selected-run state. Visual treatment is the
frontend-design / shadcn skills' call.

### Dependencies

Likely add: a small unified-diff parser. Candidates: `parse-diff` (~5 KB,
MIT, no transitive deps) or `diff` (heavier). **Flag for review:**
`parse-diff` is the lean choice; if you'd rather hand-roll a tokenizer
to keep the dependency surface frozen, the UI pane becomes a `<pre>`
with file boundaries highlighted by regex. Either choice updates
`docs/01-architecture.md` "Dependencies" before installation, per
CLAUDE.md.

### Stale-run sweep extension

`src/lib/supervisor/cleanup.ts`: extend `sweepStaleWorktrees` (or add a
parallel `sweepStaleDiffs`) so `~/.claude-kanban/diffs/<runId>.patch`
is removed alongside its worktree. Same age threshold, same orphan
semantics. Tests added.

### Failure-mode row

Append to `docs/01-architecture.md` "Failure modes worth designing for":

| Diff capture fails after a successful run | Run still marked `done`; worker emits an error event and skips `diff_ready`. UI shows "diff unavailable" with a pointer to the worktree. |

## Acceptance

Manual acceptance — verify each visible state:

1. **Empty diff.** Create a card whose prompt is "do nothing." Run it
   to completion. Open the drawer. Diff pane shows "Agent made no
   changes." `card.runs[].diffStat = { files: 0, insertions: 0, deletions: 0 }`
   persists (`cat ~/.claude-kanban/cards/<id>.json | jq`). No patch
   file is written.
2. **Single-file diff.** Run a prompt that creates one small file. On
   completion, the drawer's diff pane renders one file with `+N -0`.
   The patch file at `~/.claude-kanban/diffs/<runId>.patch` matches
   `git -C ~/.claude-kanban/work/<runId> diff <baseBranch>..HEAD`
   byte-for-byte.
3. **Multi-file diff with rename.** Run a prompt that renames a file
   and edits another. Drawer renders both files; the rename header is
   preserved.
4. **Large diff truncation.** Run a prompt that creates a >1 MiB file
   (or set `maxBytes` to a small value via env override during the
   test). Diff pane shows the truncation banner; the on-disk patch
   ends with the sentinel line.
5. **Diff capture failure does not fail the run.** Force `git diff` to
   fail (e.g., remove the base-branch ref between agent completion and
   diff capture). Run still ends with `exitCode: 0`; event log shows
   a worker-level error; drawer diff pane shows "diff unavailable"
   with the inspection hint.
6. **Failed agent run skips diff.** Cause the SDK to fail (e.g., set
   an invalid model). Run ends with `exitCode: 1`. Drawer diff pane
   shows the empty placeholder; no patch file exists.
7. **Stale-run sweep removes patches.** Manually create a 25h-old run
   record; restart `pnpm dev`; both the worktree and the matching
   `diffs/<runId>.patch` are removed; stderr logs both removals.
8. **Protocol round-trip.** `node --test src/protocol/messages.test.ts`
   passes including the new `diff_ready` shape.
9. **Worker tests.** `node --test src/worker/git.test.ts` passes
   including all `captureDiff` cases.
10. **Store test.** `node --test src/lib/store/*.test.ts` passes
    including the `updateRun(diffStat)` case.
11. **Supervisor test.** A new test covers "supervisor persists
    diffStat on diff_ready."

### Regression checks

- Phase-2 run pipeline: drag a card to running, watch events stream
  end-to-end.
- Phase-3/task-01 card CRUD: create, edit, delete still work.
- Phase-3/task-02 DnD: drag between columns still works.
- Phase-3/task-03 settings page: GET/PUT still work.
- Phase-3/task-04 drawer: opens, run history, log selection still
  work; the new diff pane is additive.
- Phase-3/task-05 cancel + sweep: cancel still cooperates within ~1s;
  sweep still runs on supervisor construction.
- `pnpm cli run …` still works.
- `pnpm typecheck` and `pnpm lint` pass.

## Note for phase-5/task-04 handoff

In Managed Agents mode, diff information is part of the session
lifecycle: the sandbox emits diff metadata as a session artifact
rather than the worker shelling out to `git diff`. The on-disk patch
file is replaced by a session-artifact fetch; the wire protocol's
`diff_ready` stays, but `patchPath` becomes a managed-run artifact id.
`<RunDiff>` is unchanged — only its data source flips.

## Out of scope

- Inline-comment-on-diff UI. Phase 5 at the earliest.
- Side-by-side diff view. Phase 5 / nice-to-have.
- Re-running diff capture against an old run that has no patch file
  (legacy runs from before this task). The worktree is still on disk;
  the CLI is the manual path.
- A "download patch" button. Trivial to add later; not in v1.
- Diff capture for *failed* runs (partial agent edits). Out of scope:
  the worktree is still inspectable; v1 doesn't need a partial-diff
  story.
- MCP server configuration, the Managed Agents port itself, multi-repo
  per card, multi-PR per run, scheduled runs, watch mode, deployable
  form — all deferred to phase 5+.
