# 06 — Managed Agents port plan

## 1. Frame and scope

This document is a **port plan**, not an implementation plan. No code
in this repo is changed by it. The goal is to give a reader who has
not seen the codebase before enough information to (a) decide whether
porting `claude-kanban` from the local Agent SDK to [Claude Managed
Agents][ma-overview] is worth committing to, and (b) form a defensible
estimate of the effort.

It is the conceptual descendant of
[`docs/05-relation-to-cursor-cookbook.md`](./05-relation-to-cursor-cookbook.md) —
that doc explains what local-mode kept and dropped versus the
Cursor cookbook this project was inspired by; this doc explains what
the cloud-mode port keeps and drops versus the local-mode codebase
that exists today. Together, the two docs document the full lineage
from cookbook → local → cloud.

The port is possible at all because of [ADR-001](./03-decisions.md#adr-001-worker-subprocess-per-run-not-in-process):
the worker subprocess is the architectural seam that the Managed Agents
session client slots into. ADR-001's stated rationale included
"building it now means the eventual port is a *substitution*, not a
*rewrite*." This doc tests that claim against the real code that
shipped through phases 1–5 and concludes it broadly holds, with
caveats called out below.

All Managed Agents API claims in this doc are cited inline with the
URL and the date the page was fetched. Readers verifying the doc
should re-fetch any citation with a stale-looking date — the API is
still in beta and surfaces shift.

## 2. What stays the same

The reusable surface is large because the local version was built
with the worker boundary as a deliberate abstraction. Listed by
top-level src/ subdirectory, with line-of-code counts from the
working tree on 2026-05-04:

| Area | LoC | Disposition |
| --- | ---: | --- |
| `src/app/` (Next.js routes + pages) | 1,361 | **Stays.** Browser-facing URLs unchanged. Route handlers' bodies flip from "talk to supervisor" to "talk to Managed Agents session," but the request/response shapes the browser sees do not move. |
| `src/components/` (React UI) | 3,371 | **Stays.** Card layout, board, drawer, DnD, settings page, run log, diff pane, trace pane, error surfaces (`<ErrorCard />`, `<LoadBanner />` from phase-5/task-02). Only the data sources flip. |
| `src/protocol/` (shared types + zod schemas) | 424 | **Stays in shape.** The discriminated union of wire messages stays; some variants flip from "worker emits" to "session SSE event maps to this variant." `Card` and `Run` field shapes unchanged. |
| `src/types/` (ambient) | 1 | **Stays.** |
| `src/lib/store/` (JSON persistence) | 763 | **Stays by default.** Cards and runs remain JSON on disk under `~/.claude-kanban/`. The store interface is narrow enough that a migration to the Managed Agents run/session list is viable later if persistence becomes a constraint — we describe both options in §6 and pick "keep JSON" as the v2 default in §4. |
| `src/lib/paths.ts` | 71 | **Stays** (with one deletion: the `work/` worktree path becomes unused once the cloud port lands). |
| `src/lib/sse/` (browser-facing SSE plumbing) | 406 | **Stays as a thin wrapper.** The SSE encoder layer between Next.js and the browser is unchanged; what changes is its upstream — instead of the supervisor's NDJSON-from-stdio, it consumes Managed Agents' session SSE. |

Total directly-reusable: roughly **6,397 lines of 10,084** total in
`src/`, or about **63%**. Add the supervisor-and-protocol restructuring
(see §3) at roughly 50% line-level reuse and the figure rises to
about **two-thirds reusable**. That number is consistent with the
"roughly 70%" claim already in `docs/05-relation-to-cursor-cookbook.md`
under "What stays the same in the Managed Agents port."

What stays *behaviorally* (independent of file boundaries):

- **The browser-facing API contract.** `GET /api/cards`, `POST /api/cards`,
  `PATCH /api/cards/:id`, `POST /api/cards/:id/run`, the events SSE,
  the diff route, the trace route, the PR-approval endpoint — all
  unchanged. A v2 reader who only knows the browser side cannot
  tell that the backend changed.
- **The card and run data model.** `Card` keeps its `id`, `title`,
  `prompt`, `repoPath`, `baseBranch`, `status`, `runs`, `loadSkills`,
  timestamps. `Run` keeps `id`, `startedAt`, `endedAt`, `exitCode`,
  `branchName`, `diffStat`, `prUrl`. The producers of these fields
  change; the consumers do not.
- **The "no silent failures" hard rule.** Every cloud failure mode
  surfaces on the card via the same `<ErrorCard />` and event-log
  surfaces phase-5/task-02 audited. The audit doc
  ([`docs/04-error-states-audit.md`](./04-error-states-audit.md)) is
  a portable artifact across the port.
- **Skills loading as opt-in.** The default-off / per-card-toggle
  posture stays in spirit even where the mechanism flips — see §3
  for details.

## 3. What changes

### 3.1 `src/worker/` is gutted

The worker subprocess is the largest chunk of code that stops being
relevant. Today it is 2,317 lines split across:

- `src/worker/index.ts` (373 lines) — stdio main loop, init payload
  parsing, query lifecycle, post-SDK PR-approval window.
- `src/worker/run.ts` (168 lines) — the `query()` invocation with
  `cwd`, `allowedTools`, `permissionMode`, `settingSources`, and the
  `PreToolUse` hook registration.
- `src/worker/git.ts` (255 lines) — worktree create/cleanup, `git diff`
  capture.
- `src/worker/pr.ts` (240 lines) — `git push` + `gh pr create` wrapper
  with the `PUSH_FAILED` / `PR_CREATE_FAILED` / `PR_URL_MISSING` error
  taxonomy from phase-4/task-02.
- `src/worker/trace.ts` (123 lines) — append-only NDJSON trace writer
  for the `PreToolUse` hook.
- `src/worker/stdio.ts` (37 lines) — line-delimited JSON read/write
  helpers.

In the cloud port:

- `query()` is replaced by a `POST /v1/sessions` call (Sessions API,
  fetched 2026-05-04: [Start a session][ma-sessions]) followed by
  `POST /v1/sessions/{id}/events` to deliver the user prompt and
  `GET /v1/sessions/{id}/stream` for the SSE response. The supervisor
  module — not the worker — owns this client.
- `git worktree` (ADR-003) is unnecessary because the cloud sandbox
  *is* the isolation. See §3.4 for the open question of how the user's
  repo arrives in that sandbox.
- `git push` + `gh pr create` move into either an MCP-attached GitHub
  server or a tool the agent calls directly; see §3.5.
- The `PreToolUse` hook becomes redundant for trace capture: the
  Managed Agents stream already emits `agent.tool_use` and
  `agent.tool_result` events ([Events and streaming][ma-events],
  fetched 2026-05-04). The trace pane re-points to those events; the
  separate trace file goes away as a producer artifact (the consumer
  shape — a JSONL list of tool calls — survives, possibly persisted
  by the supervisor as a side effect of the SSE consumer).
- Stdio framing and child-process supervision are gone. The
  supervisor speaks HTTP+SSE instead.

A handful of utility helpers (e.g. arg redaction in `redactArgs`,
the `branchName` derivation, the diff-stat parser) are pure functions
worth hoisting out of `src/worker/` into `src/lib/`. Net deletion is
roughly 1,800 lines once those helpers are saved.

### 3.2 `query()` → session endpoint

Today (`docs/02-agent-sdk-usage.md`):

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: card.prompt,
  options: {
    cwd: worktreePath,
    model: "claude-opus-4-7",
    allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
    permissionMode: "acceptEdits",
    settingSources: card.loadSkills ? ["project"] : [],
    maxTurns: 250,
  },
})) {
  forwardToParent(message);
}
```

Cloud equivalent (Sessions API quickstart, fetched 2026-05-04:
[Quickstart][ma-quickstart]; the SDK is the existing `@anthropic-ai/sdk`,
*not* `@anthropic-ai/claude-agent-sdk`):

```ts
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // sets the managed-agents-2026-04-01 beta header

// 1. Create the agent once, version it, reference by id thereafter.
const agent = await client.beta.agents.create({
  name: "claude-kanban runner",
  model: "claude-opus-4-7",
  system: "...",
  tools: [{ type: "agent_toolset_20260401" }],
  // skills: [{ type: "custom", skill_id: "...", version: "latest" }],
});

// 2. Create the environment once per repo (or per project) — see §3.4.
const env = await client.beta.environments.create({
  name: `claude-kanban:${repoSlug}`,
  config: {
    type: "cloud",
    networking: { type: "limited", allowed_hosts: ["github.com"], allow_mcp_servers: true },
  },
});

// 3. Per card run: create a session, attach the stream, send the prompt.
const session = await client.beta.sessions.create({
  agent: agent.id,
  environment_id: env.id,
  title: card.title,
});

const stream = await client.beta.sessions.events.stream(session.id);
await client.beta.sessions.events.send(session.id, {
  events: [{ type: "user.message", content: [{ type: "text", text: card.prompt }] }],
});

for await (const event of stream) {
  forwardToBrowser(event);
}
```

Three things to note:

- **Three resources, not one call.** Local mode has a single function
  call that owns the entire run. Cloud mode separates *agent*
  (versioned config — model, tools, skills, MCP servers) from
  *environment* (container template — packages, networking) from
  *session* (one execution against an agent + environment). The port
  decides what lives where: see §3.7 (skills) and §3.4 (repo mounting).
- **Session does not auto-start on create.** Per [Start a
  session][ma-sessions] (fetched 2026-05-04), creating a session
  provisions the container and agent but executes nothing until the
  first `user.message` event arrives. The browser-facing semantics
  ("Run this card") map to the **send-events** call, not the
  **create-session** call.
- **Beta header is mandatory.** All Managed Agents endpoints require
  `anthropic-beta: managed-agents-2026-04-01` (the SDK sets it
  automatically; raw HTTP callers must set it themselves)
  ([Overview][ma-overview], fetched 2026-05-04). The port pins this
  beta header in one place and surfaces the version in `/api/health`
  so a future beta-version bump is a one-file change.

### 3.3 SSE consumption shape

Today the path is:

```pre
worker → NDJSON over stdio → src/lib/supervisor → src/lib/sse → browser
```

Tomorrow it is:

```pre
Managed Agents → SSE → src/lib/supervisor → src/lib/sse → browser
```

The browser-facing half (`src/lib/sse/`, the events SSE route under
`src/app/api/cards/.../events`) does not change. The supervisor's
`handleWorkerMessage` becomes a Managed Agents stream consumer that
subscribes to `GET /v1/sessions/{id}/stream` (fetched 2026-05-04 from
[Quickstart][ma-quickstart]) and translates the cloud event types
into the project's existing wire-protocol variants:

| Managed Agents event | Maps to local wire variant |
| --- | --- |
| `agent.message` | `event` with assistant text content block |
| `agent.thinking` | new `event` variant (separate from message text — local mode does not yet split these) |
| `agent.tool_use` | `event` with tool-use content block |
| `agent.tool_result` | `event` with tool-result content block |
| `agent.mcp_tool_use` / `agent.mcp_tool_result` | same as above; UI does not need to distinguish in v2 |
| `session.status_idle` | `done` (treat as the "agent has nothing more to do" terminal signal) |
| `session.status_running` / `rescheduling` | informational events; surfaced in the event log |

User-event names from [Events and streaming][ma-events] (fetched
2026-05-04) — `user.message`, `user.interrupt`, `user.custom_tool_result`,
`user.tool_confirmation`, `user.define_outcome` — replace the
parent→worker direction of the local protocol. The local protocol's
`cancel` becomes `user.interrupt`. The local protocol's `approve_pr`
becomes either a `user.message` continuation ("now push and open the
PR") or a structured `user.custom_tool_result` if PR creation runs
through a custom tool (see §3.5).

The wire-protocol module gains a new variant — call it
`session_status` — to carry the cloud's status transitions
(`idle` ↔ `running` ↔ `rescheduling` ↔ `terminated`,
fetched 2026-05-04 from [Start a session][ma-sessions]). The "no silent
failures" rule extends to this: every transition into `terminated`
needs a card-level rendering. See risks §8.

### 3.4 Repo handling and the mount gap

Local mode uses `git worktree` ([ADR-003](./03-decisions.md#adr-003-local-repo--git-worktree-for-isolation))
because the agent must edit a real on-disk checkout that the user can
inspect, push, and PR. The cloud sandbox solves the isolation problem
on its own — but the user's repo still has to *get into the sandbox*.

The Managed Agents documentation we fetched (2026-05-04) describes
environment configuration as `packages`, `networking`, and pre-installed
runtimes ([Cloud environment setup][ma-environments]). It does **not**
document a first-class "mount this local git repository" or "clone
from this git URL with these credentials" surface that we could find.
*(unverified — re-check before committing)* — there may be a "files"
or "mounted files" surface mentioned in the overview that the
environments page does not yet detail; the port plan must verify
before the v2 implementer commits.

Three plausible v2 paths, in increasing order of self-sufficiency:

1. **Agent runs `git clone` in bash on first turn.** The card prompt
   leads with `git clone <url>`; the agent uses the `agent_toolset_20260401`
   bash tool to clone. Auth: a vault (see [Authenticate with
   vaults][ma-sessions]'s `vault_ids` reference, fetched 2026-05-04)
   carries the GitHub token. Pros: zero new infrastructure; works
   today. Cons: pollutes the prompt with mechanics; fails if the
   clone is large enough to blow the session-runtime budget.
2. **GitHub MCP server attached to the environment.** The MCP server
   exposes "clone repo" / "open PR" / "list files" as tools the agent
   discovers. Pros: cleaner prompt; the same MCP server handles PR
   creation (see §3.5). Cons: adds a second managed component; needs
   verification of what file-system access the MCP server gives the
   container *(unverified — re-check before committing)*.
3. **First-class repo-mount surface in environments.** If/when
   Anthropic ships one, the port becomes "set
   `environment.config.repo = { url, ref, credentials }`." Today this
   does not appear to exist in the public docs. Track via the open
   questions section.

The port plan in §4 picks option 1 as the v2 starting default
(unblocked, even if ugly) with option 2 as a planned improvement
once a GitHub MCP server is wired up.

### 3.5 PR creation

Local mode shells out to `gh push` + `gh pr create`
([ADR-010](./03-decisions.md#adr-010-gh-cli-as-a-hard-dependency-for-pr-creation)).
That ADR explicitly anticipates this section: "Managed Agents bundles
git auth into the sandbox; PR creation moves into a tool the agent
calls (or the GitHub MCP server) rather than a worker-level wrapper
around `gh`. The local-mode dependency on `gh` does not port forward."

Two cloud options, both viable:

- **A. GitHub MCP server attached to the agent.** The agent invokes
  `pr.create` (or whatever the MCP server names it) via the
  `agent.mcp_tool_use` / `agent.mcp_tool_result` event channel
  ([Events and streaming][ma-events], fetched 2026-05-04). The
  approval flow becomes: when the run reaches `session.status_idle`
  with a non-empty diff, the user clicks **Open PR** in the drawer;
  the supervisor sends `user.message` ("push and open a PR titled
  …, body …") and the agent uses the MCP tool. The PR URL surfaces in
  the next `agent.message`.
- **B. A custom tool defined on the agent.** Same flow, but with a
  custom tool we author and a `user.custom_tool_result` to deliver
  the URL back. More code we own; less external dependency surface.

The port plan picks **A** as the v2 default — fewer custom tools to
maintain and the GitHub MCP server is a published Anthropic-supported
component (assuming the MCP catalog still lists it on port day —
*(unverified — re-check before committing)*). The local-mode
`/api/gh/status` route, the `gh --version` / `gh auth status`
pre-flight, and the `<PrAffordance />` component's missing-`gh`
disabled-state all become unnecessary; the affordance remains, but
its enable/disable hinges on session-state (is the run idle? is the
diff non-empty?) instead of local CLI availability.

The phase-4/task-02 error taxonomy (`PUSH_FAILED`, `PR_CREATE_FAILED`,
`PR_URL_MISSING`) re-maps to MCP error responses; the UI surfaces are
unchanged.

### 3.6 Trace and diff storage

Today both live on the user's disk:

- `~/.claude-kanban/traces/<runId>.jsonl` — one line per `PreToolUse`
  hook fire, written by `src/worker/trace.ts`.
- `~/.claude-kanban/diffs/<runId>.patch` — `git diff base..HEAD`
  output captured at run end by `src/worker/git.ts`.

Per the phase-4/task-03 handoff note: "Hooks are an Agent SDK concept
that applies identically in both local and Managed Agents modes; the
hook callback itself ports cleanly. What changes is the trace-file
storage." That note assumed Managed Agents would expose a
`PreToolUse` hook surface. As of 2026-05-04 the public Managed
Agents docs do not expose hooks as a configuration; instead, **the
SSE event stream itself emits `agent.tool_use` and `agent.tool_result`
events** ([Events and streaming][ma-events], fetched 2026-05-04). For
the project's purposes — recording what tools the agent invoked —
this is a strict superset of `PreToolUse`. The port replaces the hook
with a supervisor-side consumer that, as the SSE arrives, persists
the (redacted) tool-use events to `~/.claude-kanban/traces/<runId>.jsonl`.
The on-disk trace file format does not change; its producer flips
from "worker hook" to "supervisor SSE consumer."

Per the phase-4/task-01 handoff note: diff information moves to a
session-artifact fetch. As of 2026-05-04 the public docs we fetched
do not document a diff-artifact endpoint as such; the diff is recoverable
by the agent running `git diff` inside the container and emitting the
output via a tool result, or — once a GitHub MCP server is attached —
by reading the PR's diff via the GitHub API after creation. The port
plan picks "agent emits diff via bash tool result, supervisor parses
the `agent.tool_result` event" as the v2 path. The on-disk
`<runId>.patch` cache stays as a UI optimization.

### 3.7 Skill loading

Per the phase-4/task-04 handoff note: "the per-card toggle becomes a
per-Environment configuration in that port; the per-session
re-confirmation flow may dissolve entirely if Environments themselves
carry an 'uses skills from this repo' attribute that the cloud
surfaces with its own consent UI."

The current Managed Agents docs (fetched 2026-05-04 from
[Skills][ma-skills]) attach skills to **the agent**, not the environment:

```json
{
  "skills": [
    { "type": "anthropic", "skill_id": "xlsx" },
    { "type": "custom", "skill_id": "skill_abc123", "version": "latest" }
  ]
}
```

Skills are organization-wide resources; a maximum of 20 attach to a
session. There is no documented "load skills from a folder in the
cloned repo" surface. So the literal local behavior (`<repoPath>/.claude/skills/`
auto-loading via `settingSources: ["project"]`) does not have a
direct cloud equivalent. The closest port is:

- **Custom skills uploaded once per repo.** A pre-step (manual or via
  a small tool we ship) walks `<repoPath>/.claude/skills/` and creates
  a custom skill resource for each entry. The agent referenced by
  cards for that repo is configured with those skill IDs.
- **Per-card opt-in becomes per-agent or per-session-via-agent-version.**
  Either we maintain two agent versions per repo ("with skills" and
  "without") and select based on `card.loadSkills`; or we run the
  same agent and the prompt explicitly tells it whether to consult
  skills.

Default-off and the per-session re-confirmation pattern stay
*conceptually* — the v2 implementer should preserve "skills are
opt-in and require fresh consent when their source repo could have
changed." The mechanism is whatever fits the agent/skills surface as
it stands on port day.

### 3.8 Auth model

Today: `~/.claude-kanban/settings.json` (file mode 0600) holds either
the literal `ANTHROPIC_API_KEY` (`apiKeyInline`) or a path to a file
containing it (`apiKeyPath`). The settings page validates that one
of these is set; the supervisor reads it and passes it to the worker
via env-var injection at spawn.

In cloud mode the key still has to live somewhere — the SDK reads
`ANTHROPIC_API_KEY` from the environment by default ([Quickstart][ma-quickstart],
fetched 2026-05-04). The settings file stays. What's new is:

- **Vaults** ([Authenticate with vaults][ma-sessions], fetched 2026-05-04)
  hold *additional* credentials — for MCP servers' OAuth, for git
  remotes, for any third-party auth the agent needs. These are not a
  replacement for `ANTHROPIC_API_KEY`; they are extra. The settings
  page grows a "vaults" section if/when the v2 implementer attaches
  a GitHub MCP server (see §3.5).
- **Per-Environment networking** ([Cloud environment setup][ma-environments],
  fetched 2026-05-04) is a new auth-adjacent surface: `limited`
  networking with `allowed_hosts` is the cloud equivalent of "what
  outbound URLs is the agent allowed to reach." The port plan picks
  `limited` with explicit hosts as the v2 default; the local-mode
  bash allowlist does not have a direct cloud equivalent (the
  container runs whatever bash the agent issues, gated by network
  policy rather than command pattern).

### 3.9 Pricing and the disclosure layer

Local mode bills the user nothing beyond their existing Claude API
quota for tokens consumed by `query()`. Managed Agents bills on **two
dimensions** ([Pricing — Claude Managed Agents pricing][pricing],
fetched 2026-05-04):

- **Tokens** at standard model rates (Opus 4.7: $5/MTok input,
  $25/MTok output; cache reads $0.50/MTok). Web search inside a
  session: standard $10 per 1,000 searches. Prompt caching multipliers
  apply identically.
- **Session runtime** at **$0.08 per session-hour**, metered to the
  millisecond and accruing only while the session's status is
  `running`. Time spent `idle`, `rescheduling`, or `terminated` is
  not billed.

A worked example from the same page: a one-hour Opus 4.7 session
consuming 50K input + 15K output tokens costs $0.705 — $0.625 in
tokens, $0.08 in runtime. Most claude-kanban runs will be shorter
and cheaper than this; the runtime line item will dominate only on
very long, low-token sessions.

Notable non-applies: Batch-API discount, Fast-mode premium,
data-residency multiplier, and third-party platform pricing all
**do not apply** to Managed Agents sessions (same source, fetched
2026-05-04).

Implication for the port: the README (`docs/DEMO.md` too) needs a
new **disclosure layer** that local mode does not need. "Each run
costs roughly $X per minute of agent time, plus token costs." The
`<CardDrawer />` (or the `<BoardCard />` pulse area) could surface a
running cost estimate from the session's reported usage if the SSE
stream emits it; the public docs
do not (yet) document a `usage` field on session events at the
granularity of the Messages API's `usage` block — verify before
committing *(unverified — re-check before committing)*.

## 4. Migration plan

Six phases. Each phase ends in a parity-verification step against
the local-mode codebase before the next begins. The premise behind
the phasing: ADR-001's worker seam means we can land the cloud
backend incrementally without taking down local mode, and parity
checks catch regressions early while the local implementation is
still available as a reference.

### Phase A — Cloud supervisor behind the existing interface

Stand up `src/lib/supervisor/cloud.ts` implementing the same
`Supervisor` interface as today's child-process supervisor. New
methods all proxy through `@anthropic-ai/sdk`'s
`client.beta.sessions.*` surface. A `KANBAN_BACKEND=cloud|local`
env-var selects between them at process start; default stays
`local` until phase F.

**Parity check.** A small integration test runs the same card
fixture (a "list files in /tmp" prompt) against both backends and
asserts the `Card.runs[0]` document is structurally equivalent —
matching `branchName` may not exist yet (that's phase D), but
`startedAt`, `endedAt`, terminal status, and event count must agree.

### Phase B — One full lifecycle on a small test repo

Create a real card against a tiny test repo, run it cloud-side
end-to-end, watch the events stream into the existing UI. Goal: the
event-log component renders cloud `agent.message` / `agent.tool_use` /
`agent.tool_result` events identically to today's worker output. Diff
capture and PR creation are deliberately deferred.

**Parity check.** Side-by-side: local-mode card and cloud-mode card,
same prompt, same repo. Visual diff of the run-log panes. Differences
should be limited to (a) latency (cloud is slower to first token; ok)
and (b) the new `agent.thinking` channel (which local mode never
had to render).

### Phase C — Trace persistence via SSE consumer

Move trace writing out of the now-deleted `src/worker/trace.ts` into
a supervisor-side SSE consumer that persists `agent.tool_use` events
to `~/.claude-kanban/traces/<runId>.jsonl`. The on-disk file format
is byte-identical to today's; only the producer changes.

**Parity check.** Run the same card on both backends. The trace files
should differ only in the cloud's additional event types (e.g.
`agent.thinking`) which the consumer either includes (with an
explicit reason) or filters (with an explicit reason).

### Phase D — Diff capture and the repo-mount question

Decide: agent-runs-`git clone`-in-bash (option 1 in §3.4), or attach
a GitHub MCP server (option 2). Implement the chosen path. Capture
the resulting diff via either an `agent.tool_result` of `git diff`
or the GitHub MCP server's read-PR-diff tool. Persist as
`<runId>.patch` for the diff pane.

**Parity check.** Same card on both backends; diffStat (files /
insertions / deletions) must match. The actual patch text may differ
in trailing newlines or hunk-context lines; the *shape* should agree.

### Phase E — PR creation via GitHub MCP server

Wire `approve_pr` (the local protocol's parent→worker message) to a
session-side flow that asks the agent to push and open the PR via
the GitHub MCP server's tools. The `<PrAffordance />` component's
disabled-state predicate flips from "is `gh` installed and
authenticated?" to "is the session idle and is the diff non-empty?"

**Parity check.** Manually open a PR via each backend against a test
repo. PR title, body, and branch name should be byte-identical (we
control all three on the local side; we instruct the agent to match
them on the cloud side via the prompt body).

### Phase F — Skill loading and local-mode disposition

Decide whether to:

- **Deprecate local mode.** Delete `src/worker/`, the worker-supervisor,
  the worktree sweep (ADR-008 retires alongside ADR-003), the
  `gh` pre-flight. Smallest steady-state codebase.
- **Keep local mode as a self-hosted option.** `KANBAN_BACKEND=local`
  stays supported; the README documents both flows; CI runs both
  backends' integration suites. Largest steady-state codebase but
  preserves the "no API key, no money" demo path.
- **Hybrid.** Cloud is the default; local is gated behind a feature
  flag and an explicit support-disclaimer. Middle of the road.

Skill loading lands here because it is the most cloud-specific
surface (per-agent, max-20-per-session, no folder-of-skills surface)
and shipping it earlier locks in design choices that depend on
disposition.

**Parity check.** Two agents (with-skills and without-skills) per
test repo; running a card with `loadSkills: true` produces an event
stream that names a skill in `agent.message` content; running without
does not. The per-session consent modal is preserved (or
deliberately dropped with a written rationale).

The phasing is stage-gated: a Managed Agents API change between
phases B and C, for example, invalidates phase C planning but not
phases A or B. Each phase's parity check is the gate; if a phase
ends without the parity check passing, the v2 implementer either
fixes forward or rolls back to the previous gate.

## 5. What we learned in local mode that informs the cloud port

These are load-bearing observations from the local build, not generic
software-engineering platitudes. The partner-network reader is the
audience.

- **The worker-subprocess seam (ADR-001) was the right architectural
  boundary**, and the cloud port is its payoff. The port reuses the
  `Supervisor` interface verbatim; the SDK call is just one of two
  backends behind that interface. ADR-001's claim that the boundary
  enables substitution rather than rewrite tested true — see §2's
  reuse number.
- **The trace file separate from the event log was the right call**
  (phase-4/task-03). Two artifacts, two consumers, two retention
  stories. In cloud mode the producer flips (SSE consumer instead of
  hook) but the consumer split survives. Folding the trace into the
  event log would have made this port harder.
- **"No silent failures" is portable.** Every cloud failure mode —
  session terminates with no diff, MCP tool returns an error, network
  policy blocks an outbound the agent expects — needs a card-level
  surface. The phase-5/task-02 error-state audit
  (`docs/04-error-states-audit.md`) is the v1 inventory; the port
  extends each row with a "cloud equivalent" column rather than
  starting from zero.
- **The wire protocol as a discriminated union (phase-1/task-02)
  scaled cleanly across phases.** Adding `diff_ready`, `pr_opened`,
  `tracePath`-bearing variants over phases 2–4 was always a single
  variant addition, never a refactor. The cloud port adds a
  `session_status` variant rather than overloading `event`; the
  partner-network reader can read the protocol diff and see what
  changed at a glance.
- **The per-session skill confirmation pattern (phase-4/task-04)
  documents a security posture worth preserving in spirit.** Even
  where the cloud mechanism differs (skills are agent-attached, max
  20, no folder semantics), the user-facing posture — "skills are
  instructions written by whoever owns the target repo; opt in
  fresh each session" — translates. The v2 UX implementer should
  not weaken it.
- **Settings stayed narrow on purpose.** `~/.claude-kanban/settings.json`
  has six fields. Adding a vault list and a per-environment networking
  preference is one PR, not a settings overhaul. Local-mode discipline
  paid off.

## 6. What we'd do differently if starting cloud-first

Honest list. Several local-mode decisions exist *because we had no
sandbox*. Cloud-first would not adopt them.

- **No `git worktree` mental model** (ADR-003 retires). The cloud
  sandbox is the isolation; the user's local checkout never has to
  be touched and there is no scratch path under `~/.claude-kanban/work/`.
  About 255 lines of `src/worker/git.ts` plus the entire
  worktree-sweep ADR (ADR-008) dissolve.
- **No `gh` hard dependency** (ADR-010 retires). Cloud-first attaches
  the GitHub MCP server (or a custom PR tool) at agent-creation time
  and never asks the user to install a CLI. The
  `/api/gh/status` route, the `<PrAffordance />` missing-`gh`
  disabled-state, and the install-hint copy all do not exist.
- **Possibly no `src/lib/store/` JSON layer.** The Managed Agents
  side already knows about agents, environments, sessions, and event
  history; the kanban app could lean on `client.beta.sessions.list()`
  ([Start a session][ma-sessions], fetched 2026-05-04) as the source
  of truth for run history and persist only the *kanban-specific*
  metadata (column position, title, prompt) locally. Trade-off: less
  inspectable, less replayable. ADR-002 is local-mode-specific; a
  cloud-first ADR-002 would either pick a managed run store or pick
  a much smaller JSON surface.
- **Worker subprocess goes away entirely** (ADR-001 retires in its
  current form). The sandbox boundary lives elsewhere, so `query()`
  could run in the Next.js process directly. The supervisor module
  shrinks to a thin wrapper around the SDK's `client.beta.sessions.events.stream()`.
  About 1,500 lines of supervisor + worker collapse to maybe 300.
- **No bash allowlist** (the per-tool, regex-based `permissionMode`
  / pre-approved commands in `docs/02-agent-sdk-usage.md` § Permissions).
  Network policy plus the agent's own discretion is the cloud security
  story; per-command allowlists are a local-mode workaround for the
  fact that the agent has full shell access on the user's machine.
- **`maxTurns: 250` is not a knob we'd reach for.** Cloud sessions
  have their own runtime billing meter (§3.9); the cost of an
  un-bounded run is now visible to the user as $/hour rather than
  hidden behind "your laptop is slow today." Wall-clock timeouts
  become preferable, anchored to budget rather than turn count.

The point of this section: the local version is a credible
implementation of the kanban-of-agent-runs UX, but it is not the
**only** credible implementation. The cloud-first version is shorter,
has fewer load-bearing ADRs, and ships less code. We did not build
that version because we wanted Agent SDK fluency first; that is
ADR-territory in its own right (it is not currently an ADR — adding
it would be a reasonable phase-5 follow-up).

## 7. Effort estimate

For a developer who has worked in this codebase, with a small test
repo and assuming the Managed Agents API surface is stable through
the port (see Risks §8.1):

| Phase | Estimate | Notes |
| --- | --- | --- |
| A — Cloud supervisor scaffold | 1–2 days | Mechanical: implement `Supervisor` interface against `client.beta.sessions.*`. |
| B — One full lifecycle | 1–2 days | Most time spent on SSE-event ↔ wire-variant mapping and on the agent/environment-creation bootstrap (one-time per project). |
| C — Trace persistence | 0.5–1 day | Move trace writer; align JSONL format. |
| D — Diff capture & repo mount | 2–3 days | Larger because of the §3.4 mount-question; budget for an MCP server attachment if option 2 is chosen. |
| E — PR creation via MCP | 1–2 days | Assumes the GitHub MCP server's tool surface is documented and stable on port day. |
| F — Skills + local-mode disposition | 1–3 days | Range driven by which disposition is chosen. Deprecating local mode is a half-day; keeping both is a week of CI work. |
| **Total** | **6.5–13 days** | Roughly **2–3 weeks wall-clock** for a familiar dev. |

Caveats baked into the range:

- Assumes the `managed-agents-2026-04-01` beta header (and its SDK
  surface) holds through the port. A breaking change between
  phases adds days, not hours.
- Assumes the test repo is small (~10 MB). A large repo turns
  `git clone` in §3.4-option-1 into its own performance problem.
- Assumes someone other than the v2 implementer can review each
  phase's parity check; running cloud against a real Anthropic
  account costs real money (§3.9) and burns clock.
- **Excludes** writing-it-up time: a v2 README, a new DEMO.md, an
  updated CLAUDE.md, an ADR or two for the cloud-mode decisions.
  Add 1–2 days.

The estimate is defensible, not optimistic. If the v2 implementer's
gut says "two weeks for someone who knows the codebase," that is the
number. Two-week handoffs that ship in three weeks are normal; one-
week handoffs are not.

## 8. Risks

For each risk: a concrete description and either a mitigation or an
"accept and document" stance. No risk goes unaddressed.

### 8.1 Managed Agents API surface shifts mid-port

The `managed-agents-2026-04-01` beta header is a public-beta marker.
Field renames, endpoint moves, or removed event types between phases
A and F are plausible. The port is staged so a surface change between
phases B and C invalidates only phase C's work; phases A and B keep
working against the committed beta.

**Mitigation.** Pin the SDK version in `package.json` exactly. The
beta header lives in one config object. Each phase's parity check
re-runs against the pinned SDK so a silent drift is loud.

### 8.2 Pricing model changes the user posture

Local mode is free if the user already has an API key. Managed Agents
adds a $0.08/session-hour line item plus the same token costs. For
a developer running ten small cards a day, that is dollars per day
of session-runtime; for a heavier user it is more. The `<DemoBanner />`
("this costs money") is a v2-only surface that local mode never
needed.

**Mitigation.** Add a per-card cost estimate to the run log if/when
session events expose `usage` deltas. Surface a daily-spend number
on the home page. The README's "this costs money" disclosure goes
above the fold, like the Cursor-cookbook attribution did per
phase-5/task-03.

### 8.3 Auth model differences for git operations

Local `gh` assumes the user owns the auth state. Cloud mode hands
git auth to either a vault (`vault_ids` on session creation,
[Start a session][ma-sessions], fetched 2026-05-04) or an MCP server's
own credential surface. If the auth model for git is in flux during
the port, the PR step may need a transitional approach (e.g. agent
runs `git push` via a fine-scoped vault token, MCP integration lands
in a follow-up).

**Mitigation.** Phase E is explicitly the last functional phase
before phase F; if auth surface is unstable, ship phases A–D and
hold E. Cards can still produce diffs; PR creation falls back to
"copy the patch and run `gh pr create` manually," which is an
acceptable degraded state.

### 8.4 Latency

Local SDK calls have local-network latency; Managed Agents adds
internet RTT plus session-startup cost. The streaming UX feels
different even with identical wire shapes — first-token-time is
longer, and an idle session may take ten seconds to wake up on the
next user event.

**Mitigation.** Surface the session's `idle` ↔ `running` transitions
in the event log so "we're waking the agent" is a visible state, not
a hung UI. The local-mode `<RunLog />` already renders status changes;
this is the same surface, more populated.

### 8.5 Feature lag between Agent SDK and Managed Agents

Hooks (PreToolUse), specific permission modes (`acceptEdits`), the
exact `allowedTools` enumeration we use — these may land in Managed
Agents on a different schedule. As of 2026-05-04, hooks are not in
the Managed Agents docs we fetched; the SSE event stream is the
substitute (see §3.6).

**Mitigation.** The port plan does not block on hook parity —
SSE events are an acceptable substitute. If a future feature lands
only in the local SDK and is load-bearing for claude-kanban, that
is a "stay on the local backend" signal in phase F's disposition
decision, not a port blocker.

### 8.6 Data residency / compliance

Local mode keeps everything on the user's machine: card prompts,
diffs, source code edits, trace files. Cloud mode ships task
descriptions, file contents, and tool inputs/outputs to Anthropic's
infrastructure. Some users — enterprise pilots, security-conscious
solo devs — care.

**Mitigation.** Document the data-flow change above the fold in the
v2 README. Surface the environment's `networking` policy
([Cloud environment setup][ma-environments], fetched 2026-05-04 —
`limited` with explicit `allowed_hosts`) in the settings page so a
user can see exactly what outbound their sessions can reach. Where
possible, default to `limited` rather than `unrestricted` networking;
the cloud-environments doc itself recommends this for production.

### 8.7 The repo-mount gap

§3.4 documents that we could not find a first-class "mount this git
repo" surface in the public docs. Option 1 (agent runs `git clone`
in bash) is the v2 default and is unblocked, but it is uglier than
the local-mode `git worktree` flow.

**Mitigation.** Pick option 1, ship it, and re-evaluate at phase F.
If a first-class surface lands later, swap to it — the diff is
contained in the environment-creation call.

## 9. Open questions

Surfaced for the v2 implementer (and partner-network readers) to
push back on. The doc's authority comes partly from being honest
about what it does not yet know.

1. **Local-mode disposition.** Deprecate, keep as self-hosted, or
   hybrid? Each choice has a real cost; the port plan picks "default
   cloud, local stays as feature flag" as a starting point but does
   not pre-commit.
2. **Where does the user's `ANTHROPIC_API_KEY` go in cloud mode?**
   Keeping `~/.claude-kanban/settings.json` is the smallest change.
   Moving to OS keychain is a phase-5 follow-up that local mode
   should arguably also do.
3. **Does Managed Agents emit a `usage` block per session event?**
   Needed for accurate per-card cost estimation. Not visible in the
   2026-05-04 docs we fetched; *(unverified — re-check before
   committing)*.
4. **Does the GitHub MCP server expose a stable PR-creation tool**
   on port day, or do we author a custom tool? The latter is more
   code we own; the former is faster but lock-in to one MCP server's
   surface.
5. **What is the right shape for the per-repo agent/environment
   bootstrap?** A one-shot "set up this repo for cloud runs" wizard
   on first card creation? An on-demand creation per card? An
   organization-wide singleton with environment overrides per card?
   The port plan defers to the v2 UX implementer.
6. **Skills loading mechanics in cloud mode.** Concretely: do we
   ship a tool that walks `<repoPath>/.claude/skills/` and uploads
   each as a custom skill, or do we punt to the user to upload via
   the API/console? The first is more work; the second is friction.
   See §3.7.
7. **Wall-clock timeout vs runtime budget.** Local mode has a 30-min
   wall-clock cap per run. Cloud mode meters by `running` status
   only; an `idle` session does not bill. Should the v2 cap a card
   at 1 session-hour of cumulative `running` time? A dollar amount?
   Both? The port plan picks "cumulative running-time, configurable
   per card, default 30 minutes" but flags it for review.

## Citations

All Managed Agents URLs were fetched on **2026-05-04**. Re-fetch
before committing to a port if more than a few weeks have passed —
the API is in beta and surfaces shift.

[ma-overview]: https://platform.claude.com/docs/en/managed-agents/overview
[ma-quickstart]: https://platform.claude.com/docs/en/managed-agents/quickstart
[ma-sessions]: https://platform.claude.com/docs/en/managed-agents/sessions
[ma-events]: https://platform.claude.com/docs/en/managed-agents/events-and-streaming
[ma-environments]: https://platform.claude.com/docs/en/managed-agents/environments
[ma-skills]: https://platform.claude.com/docs/en/managed-agents/skills
[pricing]: https://platform.claude.com/docs/en/docs/about-claude/pricing

- Managed Agents overview, fetched 2026-05-04 — `<https://platform.claude.com/docs/en/managed-agents/overview>`
- Quickstart (agent + environment + session bootstrap, SDK package
  names, beta header), fetched 2026-05-04 — `<https://platform.claude.com/docs/en/managed-agents/quickstart>`
- Start a session (endpoint paths, lifecycle states, `vault_ids`),
  fetched 2026-05-04 — `<https://platform.claude.com/docs/en/managed-agents/sessions>`
- Events and streaming (event-type names, interrupt event), fetched
  2026-05-04 — `<https://platform.claude.com/docs/en/managed-agents/events-and-streaming>`
- Cloud environment setup (packages, networking, lifecycle), fetched
  2026-05-04 — `<https://platform.claude.com/docs/en/managed-agents/environments>`
- Skills (agent-attached skills, 20-per-session limit), fetched
  2026-05-04 — `<https://platform.claude.com/docs/en/managed-agents/skills>`
- Pricing — Claude Managed Agents pricing section (per-token rates,
  $0.08/session-hour), fetched 2026-05-04 — `<https://platform.claude.com/docs/en/docs/about-claude/pricing>`

Internal cross-references:

- ADR-001 (worker subprocess), ADR-002 (JSON persistence), ADR-003
  (`git worktree`), ADR-008 (worktree sweep), ADR-010 (`gh` hard
  dependency) — all in [`docs/03-decisions.md`](./03-decisions.md).
- "What stays the same in the Managed Agents port" — section in
  [`docs/05-relation-to-cursor-cookbook.md`](./05-relation-to-cursor-cookbook.md);
  this doc is the canonical expansion.
- Phase-4 handoff notes — see the four
  `tasks/phase-4/task-NN-*.md` files, each with a "Note for
  phase-5/task-04 handoff" section. §3.4 (diff), §3.5 (PR), §3.6
  (trace), and §3.7 (skills) each address the corresponding note.
- Error-state inventory — [`docs/04-error-states-audit.md`](./04-error-states-audit.md),
  referenced by §5 and §8.6 as a portable artifact.
