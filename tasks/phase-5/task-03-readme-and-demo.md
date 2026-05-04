**STATUS: done**

# phase-5 / task-03 — README and demo flow

## Goal

Replace the scaffold-era README with one that describes a working
project, and write a tight 2-minute demo flow document that someone
showing claude-kanban to a partner-network conversation can follow
end-to-end. The current README opens with "This is a **scaffold**,
not a working app" — that framing is obsolete now that all phases
are done. A first-time viewer should be able to clone, install, run,
and see the kanban work within ~10 minutes of the README, then
follow `docs/DEMO.md` to walk through the flow that makes the
project's value obvious in two minutes.

This is a writing task. No new code unless the install/demo
walkthrough surfaces a real bug — those get fixed at the source
(or filed) rather than papered over in the doc.

## Inputs

- `README.md` — the scaffold-era version, full of "nothing runs
  yet" framing that's now wrong. Audit and rewrite.
- `docs/00-overview.md` — short framing of what claude-kanban is;
  the README's elevator-pitch section should be consistent with
  this.
- `docs/01-architecture.md` — the full architecture doc; the
  README's "How it works" section links here rather than
  duplicating it.
- `docs/02-agent-sdk-usage.md` — the SDK surfaces in use; the
  README should mention "uses `@anthropic-ai/claude-agent-sdk`"
  but doesn't need to list every option.
- `docs/03-decisions.md` — ADRs; the README points at this for
  "why these choices" curiosity.
- `docs/05-relation-to-cursor-cookbook.md` — the cookbook
  attribution. README must credit Cursor prominently per the
  attribution note at the bottom of that doc.
- `docs/CHANGELOG.md` — the rolled-up history of what shipped per
  phase; useful for the "Status" section of the README.
- The existing `package.json` scripts (`pnpm dev`, `pnpm build`,
  `pnpm cli`, `pnpm typecheck`, `pnpm lint`, etc.) — the README's
  "Run it" section is a literal walkthrough of these commands.
- `tasks/phase-1` through `tasks/phase-4` — the phases the
  README's status section summarises in one sentence each.
- `CLAUDE.md` — for the "How to contribute / extend" section; the
  README should point new contributors at CLAUDE.md and `tasks/`
  rather than re-explaining the workflow.

## Outputs

This task produces three artifacts:

1. A rewritten `README.md`.
2. A new `docs/DEMO.md` with a timed 2-minute walkthrough.
3. A small drift-fix pass on `docs/05-relation-to-cursor-cookbook.md`
   if anything has shifted since it was last touched.

### Rewritten `README.md`

Sections, in order:

1. **Title + one-line elevator pitch.** "A Linear-style kanban
   board for Claude Agent SDK runs." Keep this consistent with
   the current opening sentence; it's already good.
2. **Origin / attribution.** Carry the existing "this is a port
   of the Cursor agent-kanban cookbook" callout forward. Do not
   bury it. The attribution note at the bottom of
   `docs/05-relation-to-cursor-cookbook.md` is explicit: when
   phase-5 produces the README, it must include this attribution
   prominently — not buried in a docs file.
3. **What it does** — three bullets, no more. "Create a card with
   a task → run an agent in an isolated worktree → review the
   diff and open a PR."
4. **Screenshot or animated GIF.** A single image (or short GIF)
   of the running kanban. Place under `docs/assets/` (or
   wherever; a new directory is fine — note in
   `docs/01-architecture.md` if so). The image is the README's
   single biggest credibility signal; without it, all the prose
   in the world doesn't convince anyone.
5. **Requirements.** Node 22+, pnpm, git, optionally `gh` (with
   a one-liner explaining what the optionality means: PR creation
   needs it, runs themselves don't).
6. **Install + run.** A literal command sequence. `pnpm install`,
   `pnpm dev`, navigate to `localhost:3000`, click New card,
   paste a prompt, point at a local repo, click Run. End the
   section with "you should see…" so the reader knows what
   success looks like.
7. **Configuration.** A short paragraph + pointer to
   `~/.claude-kanban/settings.json`. Mention the `ANTHROPIC_API_KEY`
   handling (the settings page wires it in); don't over-specify.
8. **Architecture, in one paragraph.** Process topology summary
   ("one Next.js process, zero-or-one worker subprocess per
   active run, NDJSON over stdio") with a pointer to
   `docs/01-architecture.md` for the full thing.
9. **Status.** Replace the existing "Scaffold only" section with
   a roll-up of what's actually shipped: phases 1-4 done, phase 5
   is polish (this task is part of it). One sentence per phase
   pulled from `tasks/README.md`'s "Done when" lines.
10. **Cursor cookbook side-by-side.** A pointer to
    `docs/05-relation-to-cursor-cookbook.md` and a one-liner
    summarising the relationship: same UX idea, different
    runtime, deliberately so.
11. **Contributing / extending.** Pointer to `CLAUDE.md`, the
    `tasks/` directory, and the phased workflow. Mention that
    the project is built to be developed *with* Claude Code,
    which is itself a meta-feature of the artifact.
12. **License.** State explicitly. The Cursor cookbook is MIT;
    this project's license should be in the repo. If
    `LICENSE` is missing, **flag it** as a follow-up rather
    than silently inserting a guess; ask the user.
13. **Acknowledgments.** The Cursor team again, since they get
    pride of place; Anthropic for the Agent SDK; anyone else
    materially relevant.

The tone is matter-of-fact, not breathless. No "🚀 Welcome to
the future of agent UIs." This is a tool that does a thing.

### `docs/DEMO.md`

A timed walkthrough document. The audience is someone — likely the
project author or a partner-network team member — who is about to
share their screen with a colleague and walk through the artifact
in two minutes. The doc gives them the script and the timing.

Structure:

```pre
# Demo: claude-kanban in 2 minutes

## Setup (do this before the call)

- pnpm install
- pnpm dev
- Pre-create one card in `backlog` so you don't burn time on the
  form during the demo. Title: "Add a hello world test." Prompt:
  short and concrete. RepoPath: a small sandbox repo. Base
  branch: main.
- Have ~/.claude-kanban/settings.json populated and a working
  `gh auth status`.

## The demo (2 minutes target, 3 minutes hard cap)

### 0:00 – 0:15 — Frame the problem
"Imagine I have ten small tasks I'd punt to an agent. Where's
the place I track them? Not in a chat. Not in a TODO file. Here."

### 0:15 – 0:30 — Show the board
Open localhost:3000. Point at the columns. "Backlog, ready,
running, review, done, failed."

### 0:30 – 0:45 — Drag the prepared card to running
Drag the pre-staged card from backlog to running. The agent
starts. Point at the live event log. "That's the SDK streaming."

### 0:45 – 1:30 — Watch the agent work
Wait. The agent is doing actual work. Don't fill the silence
with talk; let the demo breathe. ~30-45 seconds for a small
task. If a tool call is interesting, point at it.

### 1:30 – 1:45 — Review the diff
The card moved to review. Open the drawer. Point at the diff
pane. Show the file-by-file view.

### 1:45 – 2:00 — Open the PR
Click Open PR. Confirm the title. Click. The PR URL appears as
a chip. Click the chip. GitHub opens with the PR.

## Timing notes

- The agent run is the longest single segment; budget 30-45s
  for "small task" prompts, 60-90s for "fix this bug" prompts.
- If the run is taking too long, talk over it. The point is the
  shape of the artifact, not the model speed.
- If the demo breaks live, the trace file at
  `~/.claude-kanban/traces/<runId>.jsonl` and the event log at
  `~/.claude-kanban/logs/<runId>.ndjson` are forensic gold.
  Pivot to "let me show you what the agent did" rather than
  pretending it didn't break.

## Backup script (when something breaks)

If `gh` auth has lapsed: skip the PR step; talk through what
*would* happen and point at ADR-010.

If the agent run fails: open the failed card's drawer, show
the event log, show the trace. The "no silent failures"
property is itself demo-able.

If the dev server is hot-reloading at the wrong moment:
restart `pnpm dev` and skip to 1:30.
```

The DEMO.md doc lives next to the architecture docs and is the
project's "how to show this" cheat sheet. Future demo-ers can
edit it as the project changes; the timing notes are the value.

### Drift fix on `docs/05-relation-to-cursor-cookbook.md`

Re-read the cookbook side-by-side. If anything has drifted since it
was last touched (e.g. the doc references "phase 4 may add a 'recent
repos' list" but phase 4 didn't), update those lines to reflect
shipped reality. Light touch; not a rewrite.

### Optional: a screenshot/asset directory

If the README needs a screenshot or GIF, place it under
`docs/assets/` (create the directory). Note the directory in
`docs/01-architecture.md`'s tree if it's a permanent fixture.
Image asset choice: a static screenshot is cheaper than a GIF and
most of the value; a GIF that shows the run streaming is genuinely
better but requires a recording. Either is acceptable for this
task — pick whichever ships in one session.

## Acceptance

This task's acceptance is "someone unfamiliar can use the README
to reach a running app, then use DEMO.md to do the demo." The
verification requires a willing target audience — note this
explicitly because acceptance is otherwise underspecified.

If a willing target is unavailable, the writer self-tests by:

1. Opening a fresh shell on a fresh checkout (or a fresh clone
   into `/tmp`).
2. Following the README install steps verbatim, in order.
3. Reaching a working app within 10 minutes wall-clock.
4. Following DEMO.md verbatim and completing the demo end-to-end
   within 3 minutes wall-clock (the 2-minute target is aspirational;
   3 minutes is the bar).

Numbered acceptance:

1. **README compiles.** No broken links. No references to
   "scaffold," "nothing runs yet," or "phase N (in progress)" —
   the README describes a shipped artifact, not a planned one.
2. **README install path works on a fresh clone.** Following the
   commands in order produces a running localhost:3000 within
   10 minutes (less if `pnpm install` is cached).
3. **README screenshot or GIF is present** (or, if deferred for
   asset reasons, the deferral is documented in the README with
   a follow-up flag — not silently absent).
4. **README attribution to the Cursor cookbook is in the first
   half of the doc**, not in a footnote.
5. **DEMO.md walks the full flow.** Create / drag-to-running /
   diff / Open PR. The timing notes are present and reasonable.
6. **DEMO.md has a backup script section** for the common failure
   modes (`gh` lapsed, agent run fails, dev server hiccup).
7. **`docs/05-relation-to-cursor-cookbook.md` reflects shipped
   reality.** Any "will" or "may" sentences referring to past
   phases are updated to "did" / "didn't."
8. **`pnpm typecheck` and `pnpm lint` pass.** No code changes are
   expected, but the boundary rule (task-01) and the existing
   pipelines should still be green after any drift-fix.
9. **`pnpm build` succeeds on a fresh clone.** Doc changes
   shouldn't break the build, but verify.

### Regression checks

- All phase-1..4 acceptance walkthroughs still work — the install
  path the README documents is the same path the existing tasks
  rely on, so any drift surfaces both places.

## Out of scope

- A marketing landing page or hosted website. The README is the
  marketing surface for v1.
- Video recordings of the demo. A GIF in the README is enough;
  a polished video is a follow-up if the project gets traction.
- Translations of the README. English-only.
- A FAQ section in the README. If a FAQ becomes necessary, it
  signals the README is unclear; rewrite the README rather than
  bolt on a FAQ.
- A roadmap of features beyond phase 5. Phase 5 is the last
  formal phase; future work is captured in
  `docs/06-managed-agents-port.md` (task-04) and in any GitHub
  issues, not in the README.
- Auto-generated changelog or release-notes machinery. The
  manually-curated `docs/CHANGELOG.md` is the project's history;
  release-notes for tagged versions are a separate concern that
  hasn't surfaced yet.
- Containerization / Dockerfile. v1 is a local dev tool;
  containerization is a phase-6+ concern that lives in the
  Managed Agents port doc, not here.
- "Try it online" via Vercel, Netlify, or a hosted demo. The
  app is local-first by design (ADR-002 / ADR-003 / settings
  storage in `~/.claude-kanban/`); a hosted version is a
  fundamentally different product.
- Polish on the existing inline docs in `tasks/`. They served
  their purpose during the build; they aren't user-facing
  documentation.
