**STATUS: done**

# phase-5 / task-04 — Managed Agents handoff doc

## Goal

Produce `docs/06-managed-agents-port.md`: a credible, written plan
for porting claude-kanban from local Agent SDK mode to Claude
Managed Agents. The doc is the strategic keystone of phase 5 — it
is the artifact a partner-network conversation can point at when
"what does this look like in production?" comes up. A reader who
has never seen this codebase should finish the doc with a credible
answer to "could you actually port this and what would it cost?"

This is a writing + research task. The doc draws on shipped
project context (the architecture, ADRs, and especially the
"Note for phase-5/task-04 handoff" breadcrumbs left in the phase-4
task files) and on the live Anthropic Managed Agents documentation
(which must be fetched, not recalled — Managed Agents is in active
development and the surface may have moved since this task was
written). No code changes.

## Inputs

- The "Note for phase-5/task-04 handoff" subsections in every
  phase-4 task file. These are the breadcrumbs commissioned for
  exactly this moment:
  - `tasks/phase-4/task-01-git-diff.md` — diff capture in cloud
    mode (session-artifact fetch, not `git diff` shell-out).
  - `tasks/phase-4/task-02-gh-pr-create.md` — `gh` wrapper goes
    away, git auth bundled in sandbox, PR creation moves to a
    tool / GitHub MCP server.
  - `tasks/phase-4/task-03-pretooluse-hook.md` — hooks port
    cleanly; trace-file storage flips to session artifact.
  - `tasks/phase-4/task-04-skill-loading-toggle.md` — per-card
    skill toggle becomes per-Environment configuration; the
    per-session re-confirmation flow may dissolve.
- `docs/05-relation-to-cursor-cookbook.md` — already contains
  "What stays the same in the Managed Agents port" and "What
  changes" sketches; the new doc fleshes those into a full
  migration plan.
- `docs/01-architecture.md` — the current architecture; the
  port plan describes deltas against this.
- `docs/02-agent-sdk-usage.md` — the current SDK usage. The
  port replaces `query()` with the Managed Agents session
  endpoint; this file is the canonical "before."
- `docs/03-decisions.md` — the ADRs. ADR-001 (worker subprocess),
  ADR-003 (`git worktree`), and ADR-010 (`gh` hard dependency)
  are the load-bearing decisions that change in cloud mode.
  The port doc cross-references each.
- The current Anthropic Managed Agents documentation. The writer
  **must web-fetch and cite real URLs**, not work from training
  data. Managed Agents is in public beta and its surface
  shifts; recall is unreliable. Document the fetch dates next
  to each citation.
- `tasks/phase-4` task files generally — even outside the
  handoff subsections, the implementation choices made in
  phase 4 tell the reader what local-mode learned that the
  cloud port inherits.

## Outputs

A single new doc at `docs/06-managed-agents-port.md`. The
required sections, in order:

### 1. Frame and scope

One paragraph: this is a port plan, not an implementation plan;
no code is changed in this doc; the goal is to give a reader
enough to estimate effort and decide whether to commit. Cite
the doc's relationship to `docs/05-relation-to-cursor-cookbook.md`
(its conceptual ancestor) and to ADR-001 (the architectural
seam that makes the port possible at all).

### 2. What stays the same

The reusable surface area. Concrete list:

- **UI layer** — `src/app/`, `src/components/`. Card layout,
  drawer, board, DnD, settings page, run log, diff pane, trace
  pane all port unchanged. Their data sources flip; their
  rendering doesn't.
- **Store** — `src/lib/store/`. Card and run records remain
  JSON on disk (or migrate to a managed run store; both are
  viable — the port plan picks one).
- **Wire protocol** — `src/protocol/`. The discriminated
  union of messages stays; some variants flip from "worker
  emits" to "Managed Agents session emits." Field shapes
  unchanged where possible.
- **Card and Run model** — `src/protocol/card.ts`. Same fields.
  `branchName`, `diffStat`, `prUrl` all stay; their producers
  change.
- **Routes and SSE plumbing** — `src/app/api/`. The endpoints
  shift to consume Managed Agents SSE rather than worker SSE,
  but the browser-facing API surface doesn't change.

Quantify. The phase-2/3/4 codebase is roughly N% reusable
(read the actual file/line counts and report the number;
don't guess). The doc's reader needs the number.

### 3. What changes

The non-reusable surface. Section-by-section:

- **`src/worker/` is gutted.** The worker subprocess goes away.
  `query()` becomes a `POST` to the Managed Agents session
  endpoint (cite the actual route), and the SSE consumer
  consumes Anthropic's session SSE rather than the worker's.
  `src/worker/git.ts`, `src/worker/pr.ts`, and `src/worker/run.ts`
  are largely deleted; the few utility helpers may be hoisted.
- **`query()` → session endpoint.** Cite the current Managed
  Agents API surface. The session create call's shape, the SSE
  message envelope, the session lifecycle (create / stream /
  terminate) are the new mental model. Fetch and cite real
  URLs.
- **SSE consumption shape.** The wire-protocol mapping changes.
  Today: worker → NDJSON over stdio → supervisor → SSE → browser.
  Tomorrow: Managed Agents → SSE → Next.js → SSE → browser.
  The supervisor's `handleWorkerMessage` becomes a Managed
  Agents stream consumer.
- **PR creation.** The `gh` wrapper deletes; PR creation moves
  into either a tool the agent calls or the GitHub MCP server
  attached to the Environment. ADR-010 explicitly anticipates
  this. Cite both options; pick one as the v2 default.
- **Trace storage.** `~/.claude-kanban/traces/<runId>.jsonl`
  becomes a session artifact. The hook itself ports cleanly
  (per phase-4/task-03 handoff note); only the storage backend
  flips.
- **Diff storage.** Same shape: `~/.claude-kanban/diffs/<runId>.patch`
  becomes a session artifact. The on-disk patch goes away;
  the API route fetches the artifact instead.
- **Skill loading.** Per-card `loadSkills` toggle becomes a
  per-Environment configuration. The per-session re-confirmation
  flow may dissolve if Environments themselves carry consent
  semantics; the port plan calls this out as a UX choice the
  v2 implementer makes, not a forced one.
- **Auth.** `~/.claude-kanban/settings.json` housing the
  `ANTHROPIC_API_KEY` may move to per-Environment auth or stay
  per-user; depends on the Managed Agents auth model. Cite the
  current docs.
- **Pricing model.** Local mode is "your API quota for whatever
  the SDK calls." Managed Agents bills per session-hour
  (verify against current docs). The README and demo doc would
  need a "this costs money" disclosure that local mode doesn't.

### 4. Migration plan

A phased step list. The exact phasing is the writer's call; the
task does not pre-decide. Likely shape (illustrative, not
prescriptive):

1. Stand up a Managed Agents session client behind the existing
   `Supervisor` interface — same shape, different backend. The
   wire-protocol seam (ADR-001's payoff) makes this a swap, not
   a rewrite.
2. Verify parity for one full card lifecycle (create → run →
   diff → PR) against a small test repo.
3. Migrate trace and diff storage to session artifacts.
4. Migrate PR creation to the GitHub MCP server (or chosen tool).
5. Migrate skill loading to per-Environment configuration.
6. Decide local-mode disposition: deprecate, keep as a
   "self-hosted" option, or maintain both behind a flag. Each
   choice has a real cost; the v2 implementer commits to one.

The writer makes the actual phasing choice and explains why
those steps and not others. The illustrative list above is
*illustrative*, not prescriptive; the doc's value is in the
reasoning, not the bullet count.

### 5. What we learned in local mode that informs the cloud port

This is where the value lives. Specific lessons from building
the local version that the cloud port benefits from. Examples
the writer should include if true (each is a real claim, not a
template):

- The worker-subprocess seam (ADR-001) is the right
  architectural boundary. The port plan reuses it; the SDK call
  is just one of two backends behind the same `Supervisor`.
- The trace file separate from the event log was the right
  call. Two artifact types, two consumers, two retention
  stories. Cloud mode preserves the separation as two distinct
  session artifacts.
- "No silent failures" (CLAUDE.md hard rule) translates to
  Managed Agents directly: every cloud failure mode needs a
  visible card-level rendering, just like local. The
  task-02 audit report is a portable artifact for this.
- The per-session skill confirmation pattern (phase-4/task-04)
  documents a security posture the cloud port should preserve
  *in spirit* even if the mechanism differs.
- The wire-protocol-as-discriminated-union shape (phase-1/task-02)
  scaled cleanly across phases. Adding a session-artifact-id
  field to existing variants is a smaller change than adding a
  new variant; the cloud port should follow the same discipline.

These are the "informed by experience" observations a partner-
network reader will care about. Don't list every trivial pattern;
list the load-bearing ones.

### 6. What we'd do differently if starting cloud-first

Be honest. If there are decisions the local version forced that
wouldn't apply in cloud, name them. Examples to consider:

- Local mode required `git worktree` (ADR-003) for isolation.
  Cloud-first doesn't; the sandbox is the isolation. The whole
  worktree mental model dissolves.
- Local mode required the `gh` hard dependency (ADR-010).
  Cloud-first uses the GitHub MCP server or a managed PR tool;
  no `gh` install dance.
- Local mode kept JSON-on-disk persistence (ADR-002). Cloud-
  first might lean on the Managed Agents run store and shed
  much of `src/lib/store/`.
- The worker subprocess (ADR-001) was about isolation in a
  non-sandboxed runtime. Cloud-first might run `query()` in
  the Next.js process — the sandbox boundary is already
  elsewhere.

The point of this section is intellectual honesty: "we built it
this way because we had to, not because it's the only way."
The partner-network reader will trust the rest of the doc more
if this section is candid.

### 7. Effort estimate

A rough, order-of-magnitude figure. Not a commitment. The
partner-network reader needs this kind of number to decide
whether to commit to the work.

Format: a short table with one row per migration phase, each
with a wall-clock estimate range ("rough days for a familiar
dev"). Total at the bottom. Caveats called out: "assumes
Managed Agents API surface is stable through the port"; "assumes
the test repo is small"; etc.

The estimate should be defensible, not optimistic. If the
writer's gut says "two weeks for someone who knows the
codebase," that's the number — don't deflate to make it sound
faster.

### 8. Risks

What could go wrong with the port that didn't go wrong locally.
At minimum:

- **Managed Agents API surface shifts mid-port.** Public beta
  means breaking changes. The port should be staged so a
  surface change doesn't invalidate completed phases.
- **Pricing model differences.** Per-session-hour billing
  changes the user-facing posture from "free if you have an
  API key" to "this costs money per use." The README and demo
  flow need a disclosure layer they don't currently need.
- **Auth model differences for git operations.** The local
  `gh` wrapper assumes the user owns the auth state; cloud
  mode hands that to the sandbox. If the Managed Agents auth
  model for git is in flux, the PR step may need a transitional
  approach.
- **Latency.** Local SDK calls have local-network latency;
  Managed Agents has internet latency plus session-startup
  cost. The streaming UX may feel different even when the
  protocol is identical.
- **Feature lag.** Hooks, skills, and other SDK features may
  land in Managed Agents on a different schedule than in the
  SDK. The port may have to live without one for a window.
- **Data residency / compliance.** Local mode keeps everything
  on the user's machine. Cloud mode ships task descriptions,
  diffs, and possibly source code to Anthropic's infrastructure.
  Some users care; the port must surface this.

For each risk, the doc names a mitigation or an "accept and
explain to users" stance. No risk goes unaddressed.

### 9. Open questions

A short list of unresolved questions the v2 implementer will
have to answer. Example: "Do we keep local mode as a fallback
or fully deprecate?" "Where does the user's `ANTHROPIC_API_KEY`
go in cloud mode?" These are surfaced for the partner-network
reader to push back on with their own answers — the doc's
authority comes partly from being honest about what it doesn't
yet know.

### Citations

Every reference to the Managed Agents API surface includes a URL
and the date the URL was fetched. If the writer can't verify a
claim by reading current docs, the claim is flagged with
`*(unverified — re-check before committing)*`. The doc's
credibility depends on this discipline; partner-network readers
will catch fabricated API surfaces immediately.

## Acceptance

The doc's acceptance is "a reader unfamiliar with this project
finishes it with a credible answer to 'could you actually port
this and what would it cost?'" That's hard to verify without a
test reader; the writer's self-acceptance is the next-best thing.

Numbered acceptance:

1. **`docs/06-managed-agents-port.md` exists** at the documented
   path.
2. **All required sections are present:** Frame, What stays,
   What changes, Migration plan, Lessons, What we'd do
   differently, Effort estimate, Risks, Open questions.
3. **The "What stays the same" section quantifies reuse** with
   a real number from the current codebase, not a guess.
4. **The "What changes" section cites real Anthropic docs by
   URL** with fetch dates. No claim about the Managed Agents
   surface is made from training data alone.
5. **The migration plan is phased** with at least one explicit
   parity-verification step before each migration.
6. **The lessons section names specific load-bearing patterns**
   from local mode (worker seam, trace separation, no-silent-
   failures, etc.) — not generic platitudes.
7. **The "what we'd do differently" section is honest.** At
   minimum, it acknowledges that ADR-001 / ADR-003 / ADR-010
   are local-mode-specific decisions that don't carry forward.
8. **The effort estimate is a real range,** not a single
   number. Caveats called out.
9. **The risks section lists at least the API-surface,
   pricing, auth-model, latency, feature-lag, and data-
   residency risks,** each with a mitigation or stance.
10. **The doc is internally consistent.** Cross-references
    between sections (e.g. "see Risks #3 for the auth-model
    discussion") resolve.
11. **`tasks/phase-4` handoff notes are reflected.** Each of
    the four phase-4 task files' "Note for phase-5/task-04
    handoff" subsections has at least one corresponding
    paragraph in the new doc.
12. **The doc reads end-to-end** without requiring the reader
    to bounce between other files. References to other docs
    are pointers, not prerequisites — the doc stands alone.
13. **`pnpm typecheck` and `pnpm lint` pass.** No code changes
    expected; verify anyway.

### A specific reader test

If the writer can find a willing reviewer who has not seen this
project, hand them the doc cold and ask: "Based only on this,
could you port this to Managed Agents, and roughly how long
would it take?" If the reviewer can answer both questions
without asking for the codebase, the doc has hit its bar. If
not, revise — the gaps the reviewer hits are the gaps the
partner-network conversation will hit.

This reader test is a stretch goal, not a hard acceptance gate;
the writer's self-test against the numbered acceptance above is
the floor.

### Regression checks

- `docs/05-relation-to-cursor-cookbook.md`'s "What stays the
  same in the Managed Agents port" section should be consistent
  with the new doc. If task-03 has already drift-fixed it, this
  task verifies; if not, this task may add a single line
  pointing at the new doc and trusting the new doc as canonical.
- All phase-1..4 acceptance walkthroughs still work. (The doc
  changes nothing in code.)

## Out of scope

- **Implementing the port.** This is the deliberate keystone:
  the doc is the artifact, not the work. The port itself is a
  separate project that the doc enables but does not undertake.
- **Choosing v2's persistence strategy.** The doc describes
  options (keep JSON, swap to managed run store, hybrid) and
  surfaces the trade-offs; the v2 implementer commits.
- **Deprecation timeline for local mode.** The doc names the
  question and the options; it does not pre-commit to a
  deprecation. Reasonable people will land on different answers
  here depending on their goals (developer-tool fluency vs
  production deployment).
- **Pricing analysis for end users.** The doc surfaces "this
  costs money per session-hour" as a risk; it doesn't try to
  model dollar amounts for a hypothetical user's workload.
- **Multi-host abstraction (GitLab/Bitbucket via Managed
  Agents).** ADR-010 already deferred this for local mode; the
  port doc inherits the deferral.
- **Multi-user, deployable, or hosted form of the kanban
  itself.** Even with Managed Agents handling agent execution,
  the kanban app is still single-user local-first. Multi-user
  is a separate product — out of scope, indefinitely.
- **A working v2 reference implementation, even a sketch.**
  The doc describes the port; it does not ship code. A future
  task or project may build the reference; this is not it.
- **Speculation about Managed Agents features that aren't
  documented yet.** If the current docs don't cover a surface,
  the doc says so and notes the gap; it doesn't guess.
- **Updating CLAUDE.md to reference cloud mode.** CLAUDE.md is
  oriented to working on local mode; if v2 ever lands, the new
  CLAUDE.md is part of *that* project's setup, not this doc's
  output.
