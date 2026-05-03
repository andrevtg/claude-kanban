# phase-4 / task-04 — Skill loading toggle

## Goal

Add a per-card opt-in toggle that lets the agent load skills from the
target repo's `<repoPath>/.claude/skills/` directory. When enabled, the
worker passes `settingSources: ["project"]` to the SDK and adds `Skill`
to `allowedTools`; when disabled (the default), behavior matches v1
exactly. Because enabling this loads instructions written by whoever
owns the target repo, the toggle defaults to OFF, requires a per-card
confirmation on first enable per session, and surfaces a clear "this
loads skills from `<path>`; only enable if you trust the repo's
contents" message at the confirmation step. v1 trusts the user's
judgment; skill content is not sandboxed or vetted.

## Inputs

- `src/protocol/card.ts` — `Card` shape; needs a new field
  `loadSkills: boolean`
- `src/protocol/messages.ts` — `RunInitPayloadSchema` needs a
  `loadSkills` boolean so the worker knows whether to flip
  `settingSources`
- `src/lib/store/index.ts` — `NewCardInput` and the patch surface
  for edit; `loadSkills` defaults to `false` for new and existing
  cards
- `src/worker/run.ts` — the `query()` options block where
  `settingSources` and `allowedTools` are set
- `src/lib/supervisor/index.ts` — passes `loadSkills` through into
  `RunInitPayload`
- `src/components/card-form.tsx` — adds the toggle field
- `src/components/card-drawer.tsx` — surfaces the toggle's current
  state and the per-session confirmation flow before a run starts
  with skills enabled
- `docs/02-agent-sdk-usage.md` — flips the deferred skills bullet,
  documents the per-card opt-in and the security framing
- `docs/01-architecture.md` — Failure-modes table gains a row for
  "skills directory missing"; data-model section gains the
  `loadSkills` field
- `docs/05-relation-to-cursor-cookbook.md` — note: this is a
  divergence point because Managed Agents has its own model for
  skill provenance
- `tasks/phase-3/task-01-card-crud.md` — the form this toggle plugs
  into
- `tasks/phase-4/task-03-pretooluse-hook.md` — task-03's trace
  records every tool call including any new `Skill` fires; no extra
  work needed here, but mention it for cross-reference

## Outputs

### Card model: `src/protocol/card.ts`

Add `loadSkills: boolean` to `CardSchema`. Default `false`. Migration
note: existing cards on disk lack the field; the store's read path
should default to `false` when the field is absent (don't reject
older card files).

### Store updates (`src/lib/store/index.ts`)

- `NewCardInput` gains optional `loadSkills?: boolean` (default
  `false`). Tests cover create-with-true, create-without (defaults
  to false), and patch toggles.
- `Card` patch surface (`PATCH /api/cards/:id`) accepts
  `loadSkills`; tests cover both directions.

### Wire protocol (`src/protocol/messages.ts`)

`RunInitPayloadSchema` gains `loadSkills: z.boolean()`. Round-trip
test added in `messages.test.ts`.

### Supervisor wiring (`src/lib/supervisor/index.ts`)

When constructing `RunInitPayload`, copy `card.loadSkills` into the
init. No other supervisor change.

### Worker (`src/worker/run.ts`)

In the `query()` options block:

- If `init.loadSkills` is true:
  - `settingSources: ["project"]`
  - `allowedTools: [...init.allowedTools, "Skill"]` (de-dup)
- If false: behavior is exactly v1 (`settingSources: []`, no
  `Skill` in allowedTools).

Add a worker info event at the start of the run noting whether
skills were loaded and from which `cwd`. This makes the choice
visible in the event log and in the trace file (task-03 picks it up
too).

### UI: form toggle (`src/components/card-form.tsx`)

Add a "Load skills from `<repoPath>/.claude/skills/`" checkbox
below the existing fields. Label includes the resolved repo path.
Inline help text: "Off by default. When on, the agent loads
instructions from the repo. Only enable if you trust the repo's
contents." The help text is permanent, not hover-only — this is the
kind of choice the user should re-read every time.

### UI: per-session per-card confirmation

In `src/components/card-drawer.tsx` (and any other Run trigger):

- Track confirmed card IDs in `sessionStorage` under
  `claude-kanban:skills-confirmed`.
- When the user clicks Run on a `loadSkills: true` card whose id is
  not in the confirmed set, show a modal: "This run will load
  skills from `<repoPath>/.claude/skills/`. The agent will read and
  follow instructions from that directory. Continue?" Two buttons:
  Cancel / Run with skills.
- On confirm, add the card id to the set and proceed. The set is
  cleared by closing the tab — re-confirmation is required next
  session. Intentional: a one-time "I trust this repo" decision is
  the wrong shape for this kind of trust.

A card with `loadSkills: false` runs with no confirmation — the
default path is the cheap path.

Confirmation is invalidated when `loadSkills` is patched on the
card (in either direction). Toggling off and back on resets the
confirmed state for that card; the next Run shows the modal again.
Implementation: store the confirmation key as
`<cardId>:<loadSkills-state>` so toggling produces a different
key, or clear the card from sessionStorage on PATCH that
modifies loadSkills. Either approach is acceptable; document the
chosen one in `card-drawer.tsx`'s top comment.

### Documentation updates

`docs/02-agent-sdk-usage.md`:

- Move the skills bullet out of "Hooks and skills (deferred)" into a
  new "Skills" subsection. Document:
  - Default off, per-card opt-in, per-session re-confirmation.
  - When enabled: `settingSources: ["project"]`, `Skill` added to
    `allowedTools`.
  - Security framing: skills are instructions written by the repo
    owner; v1 trusts the user's judgment; no content sandboxing or
    vetting.
- Update the `settingSources: []` note in the entry-point example
  to "default; flipped to `['project']` per-card per
  phase-4/task-04."

`docs/01-architecture.md`:

- Failure-modes row: | Skill loading enabled but `<repoPath>/.claude/skills/` is missing | SDK loads from `["project"]` with no skills present; run proceeds normally; event log notes the empty skills load. |
- Data-model: add `loadSkills` to the `Card` shape sketch.

`docs/05-relation-to-cursor-cookbook.md`:

- Append a note: "Cursor doesn't expose a per-task skill-loading
  toggle — its cloud sandbox has a fixed environment. Local mode
  adds a per-card toggle so the user can opt into project-level
  skills from the target repo. In Managed Agents mode this becomes
  a per-Environment configuration, not a per-card choice."

## Acceptance

Manual acceptance — verify each visible state:

1. **Default off.** Create a new card via the form. The skills
   toggle is unchecked. The card's JSON on disk has
   `loadSkills: false`. Run the card; the worker info event reports
   skills were not loaded; `settingSources: []` (verify via the SDK
   debug log or by adding a temporary worker info event with the
   resolved option).
2. **Existing cards default off.** Cards on disk from before this
   task land are read with `loadSkills: false` even though their
   JSON lacks the field. No migration script required.
3. **Enable via form, run with empty `.claude/skills/`.** Edit a
   card; check the toggle; save. The card's JSON has
   `loadSkills: true`. Click Run. The confirmation modal appears.
   Confirm. The agent runs. With `<repoPath>/.claude/skills/`
   absent or empty, the run still completes successfully; the event
   log notes the empty skills load.
4. **Enable via form, run with populated `.claude/skills/`.** Same
   setup but with at least one skill file present in
   `<repoPath>/.claude/skills/`. Confirm; run. The agent uses the
   skill (verify by writing a skill that has a unique trigger
   phrase and prompting the agent to use it; observe the `Skill`
   tool call in the event log and in the trace file from task-03).
5. **Toggle on, but skills directory doesn't exist.** Same as (3)
   but with the skills directory not present at all. SDK loads
   with no skills; run proceeds; event log notes the empty load.
6. **Per-session confirmation required.** With a
   `loadSkills: true` card, click Run. Modal appears. Confirm. Run
   starts. Run again in the same browser tab — no modal, runs
   immediately. Close the tab and reopen the page. Click Run again
   — modal appears (proves `sessionStorage` was used, not
   `localStorage`).
7. **Per-card confirmation, not per-repo.** Two cards on the same
   `repoPath`, both with `loadSkills: true`. Confirming one does
   not auto-confirm the other; each needs its own confirmation in
   the session.
8. **Cancel from the confirmation modal.** Click Cancel. No run is
   started; the card's status is unchanged.
9. **Toggle off mid-life.** Edit a card from `loadSkills: true`
   back to `false`. The next Run does not show the modal and runs
   with `settingSources: []`. The card's confirmed-this-session
   set is irrelevant; the field on disk is what gates the SDK
   options.
10. **Confirmation invalidates on toggle.** With a card that's
    `loadSkills: true` and confirmed in this session, edit the
    card to set `loadSkills: false`, then back to `true`. Click
    Run. The confirmation modal appears again. The toggle-off-and-
    on cycle reset the trust state.
11. **Trace records `Skill` calls.** With task-03's trace active
    and skills loaded, any `Skill` tool calls appear in
    `~/.claude-kanban/traces/<runId>.jsonl` like any other tool.
12. **Protocol round-trip.** `node --test src/protocol/messages.test.ts`
    passes including the new `loadSkills` field on
    `RunInitPayload`.
13. **Store tests.** `node --test src/lib/store/*.test.ts` passes
    including create-with-true, create-without (defaults to
    false), patch-to-true, patch-to-false, and
    read-of-legacy-card-without-field.
14. **Worker test.** `node --test src/worker/run.test.ts` passes
    including a case that asserts `settingSources` and
    `allowedTools` are set correctly for both values of
    `loadSkills`.

### Regression checks

- Phase-2 run pipeline: drag a card to running, watch events stream
  end-to-end. Default-off cards behave identically to before.
- Phase-3/task-01 card CRUD: create, edit, delete still work; the
  new field is additive in the form.
- Phase-3/task-02 DnD: drag between columns still works.
- Phase-3/task-03 settings page: GET/PUT still work.
- Phase-3/task-04 drawer: opens, run history, log selection still
  work.
- Phase-3/task-05 cancel + sweep: cancel still cooperates within
  ~1s; sweep still runs on supervisor construction.
- Phase-4/task-01 diff capture still works for both toggle states.
- Phase-4/task-02 PR creation still works for both toggle states.
- Phase-4/task-03 trace still fires for every tool call, including
  `Skill` when enabled.
- `pnpm cli run …` still works (CLI doesn't gate on skills; the
  card's `loadSkills` field flows through normally).
- `pnpm typecheck` and `pnpm lint` pass.

## Note for phase-5/task-04 handoff

Managed Agents has its own model for skill provenance — skills are
attached at the Environment level, not the per-task level. The
per-card toggle becomes a per-Environment configuration in that
port; the per-session re-confirmation flow may dissolve entirely if
Environments themselves carry an "uses skills from this repo"
attribute that the cloud surfaces with its own consent UI. The
local default-off / per-session-confirm pattern documents the
security posture that the Managed Agents version should preserve in
spirit even if its mechanism differs.

## Out of scope

- Skill content sandboxing or static vetting. v1 trusts the user's
  judgment.
- A "review skills before loading" UI that reads
  `<repoPath>/.claude/skills/` and shows their contents inline.
  Phase 5 polish if it lands at all.
- Loading skills from `~/.claude/skills/` (user-level skills) via
  `settingSources: ["user"]`. Out of scope; the security story for
  user-level skills is different and deserves its own task if
  there's demand.
- Per-skill enable/disable. v1 is all-or-nothing per card.
- A persistent "I trust this repo" preference that survives session
  close. Deliberately rejected: re-confirmation is a feature.
- A "sticky" confirmation that survives toggling loadSkills off
  and back on. Deliberately rejected: a state change is a clear
  "I changed my mind" signal that should require fresh consent.
- MCP server configuration, the Managed Agents port itself,
  multi-repo per card, multi-PR per run, scheduled runs, watch
  mode, deployable form — deferred to phase 5+.
