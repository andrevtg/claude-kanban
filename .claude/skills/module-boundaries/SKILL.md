---
name: module-boundaries
description: Use when adding a relative import in a file under src/worker/, src/lib/, src/app/, or src/types/; when moving a file between those top-level src/ subdirectories; or when creating a new file in any of them. Encodes the import rules that keep the worker subprocess boundary intact. Do NOT trigger on imports from external npm packages, or on edits inside src/protocol/ itself.
---

# Module boundaries — claude-kanban

`src/` is split into five top-level subdirectories with strict rules about which can import from which. This isn't a stylistic preference — the rules exist so the worker process boundary stays intact, which in turn is what makes the future port to Claude Managed Agents tractable.

This skill is the in-context reference for those rules. CLAUDE.md and `docs/01-architecture.md` have the canonical version; consult them only when changing a rule.

## The four directories

```pre
src/
├── app/         Next.js App Router (server + client)
├── components/  React components (server + client)
├── lib/         Server-side helpers: store, supervisor, sse, paths
├── worker/      Node subprocess that runs the SDK; spawned by lib/supervisor
├── protocol/    Shared types, schemas, and parsers
└── types/       Ambient type declarations for non-TS assets (no runtime code)
```

## The rules

### 1. `src/protocol/**` is the only shared surface

Both `src/worker/` and `src/lib/` import from it. **It imports from neither.** Allowed dependencies for `src/protocol/`: `zod`, `@anthropic-ai/claude-agent-sdk` (only for re-exporting `SDKMessage`), and other files inside `src/protocol/`. Nothing else from this repo.

### 2. `src/worker/**` must NEVER import from `src/lib/**` or `src/app/**`

The worker is a separate Node process. There is no shared memory, no shared module instance, no shared anything. An import from `src/lib/store/` into `src/worker/` would compile, would even run, and would silently load a *second copy* of the store on a *different process* with a *different file handle* — corrupting state.

Allowed for `src/worker/`: `src/protocol/`, external packages, Node built-ins.

### 3. `src/lib/**` must NEVER import from `src/worker/**` or `src/app/**`

`src/lib/` is the Next.js side of the seam. It spawns workers as subprocesses; it does not link against worker code. If you find yourself reaching into `src/worker/` for a helper or a type, the helper/type belongs in `src/protocol/`.

Allowed for `src/lib/`: `src/protocol/`, external packages, Node built-ins.

### 4. `src/app/**` and `src/components/**` may import from `src/lib/**` and `src/protocol/**`, never from `src/worker/**`

The web layer — both route handlers and entrypoints under `src/app/` and React components under `src/components/` — reaches the worker only through `src/lib/supervisor/`, which owns the spawn/IPC plumbing. Neither directory has any business knowing the worker exists as a module.

Allowed for `src/app/` and `src/components/`: `src/lib/`, `src/protocol/`, external packages, React, Next.js.

### 5. `src/types/**` is ambient-only and self-contained

`src/types/` holds ambient declarations for non-TS assets (e.g. `declare module "*.css"`). It has no runtime code. The compiler picks these declarations up globally, so any file in the repo "uses" them implicitly — there is nothing to import from `src/types/` and nothing should.

`src/types/` itself **must not import from `src/worker/`, `src/lib/`, `src/app/`, or `src/components/`**. It can technically import types from `src/protocol/`, but it shouldn't — ambient declarations should be self-contained. If an ambient module needs to reference a project type, that's a sign it isn't actually ambient and belongs somewhere else.

Allowed for `src/types/`: nothing from this repo. External package types (`/// <reference types="..." />` style) are fine.

### Type-only imports count

These rules apply to `import type { ... }` exactly as they apply to value imports. TypeScript's `verbatimModuleSyntax` will erase the import at build time, but the *coupling between modules* is still real: a refactor that removes the type-only import yesterday is the same refactor that adds a value import tomorrow. There is no "I'm only importing a type" exception to any of the four rules above.

If two sides need to agree on a type, the type belongs in `src/protocol/`.

## Why these rules exist

The architectural goal is a clean port to **Claude Managed Agents** later. In that world, `src/worker/` mostly disappears and is replaced by an HTTP client that talks to `/v1/sessions` and consumes SSE. The rest of the app — UI, store, supervisor's interface, protocol types, card model — is unchanged.

That port is only tractable because the worker is reachable from one place (`src/lib/supervisor/`) through one contract (`src/protocol/`). Every cross-import we tolerate is one more thing to untangle on port day. ADR-001 in `docs/03-decisions.md` and the "Module boundaries" section of `docs/01-architecture.md` are the long-form versions.

A phase-5 ESLint rule (`eslint-plugin-boundaries`, see `tasks/phase-5/README.md` task-01) will mechanically enforce all of this. Until then, the rules are on you.

## What to do when you think you need to break the rule

You don't.

- If a worker file needs data that lives in `src/lib/`: pass it across the wire in the `init` message. The init payload is for exactly this.
- If two sides need to agree on a type: the type lives in `src/protocol/`. Move it there and have both sides import it.
- If `src/lib/` needs a helper from the worker: the helper isn't a worker helper — it's a shared helper. Move it into `src/protocol/` (if it's pure) or `src/lib/` (if it's Next.js-side).
- If none of the above fit: stop. Write the question into `docs/QUESTIONS.md` with the date and the task number. Do not paper over a boundary violation.

The compiler does not know about these rules yet. "It compiles" is not a defense.

## Concrete examples

### BAD — worker importing from lib

```ts
// src/worker/run.ts
import { getSettings } from "../lib/store/settings"; // crosses the boundary
const settings = getSettings();
```

This loads a second copy of the store in a different process. Behavior is undefined; bugs are silent.

### GOOD — settings arrive via the init message

```ts
// src/worker/run.ts
import type { InitMessage } from "../protocol/messages";

async function main(init: InitMessage) {
  const { settings } = init.run; // sent across stdio by the supervisor
  // ...
}
```

The Next.js process reads settings, includes them in the `init` payload, and sends them once. The worker has no notion of where they came from.

### BAD — supervisor importing a type from the worker

```ts
// src/lib/supervisor/index.ts
import type { WorkerStartedEvent } from "../../worker/run"; // wrong direction
```

A type-only import still encodes the boundary in the wrong direction. It also tends to drag value imports along behind it the next time someone refactors.

### GOOD — that type lives in the protocol

```ts
// src/protocol/messages.ts  (the one place both sides import from)
export const ReadyMsgSchema = z.object({ type: z.literal("ready") });
export type ReadyMsg = z.infer<typeof ReadyMsgSchema>;
```

```ts
// src/lib/supervisor/index.ts
import type { ReadyMsg } from "../../protocol/messages";
```

```ts
// src/worker/run.ts
import type { ReadyMsg } from "../protocol/messages";
```

Both processes agree on the shape; neither depends on the other's module.

### BAD — app importing the worker

```ts
// src/app/api/cards/[id]/run/route.ts
import { startRun } from "../../../../worker/run"; // never
```

Route handlers must not link against worker code. They reach the worker via the supervisor.

### GOOD — app goes through the supervisor

```ts
// src/app/api/cards/[id]/run/route.ts
import { Supervisor } from "@/lib/supervisor";

// Supervisor is constructed once at app startup; route handlers reuse it.
await supervisor.startRun(card, settings);
```

The supervisor encapsulates the spawn-and-IPC details; the route handler stays oblivious to the worker as a module.

## What this skill does NOT cover

- Imports inside `src/protocol/` (the protocol module's internal organization is up to that module's own rules — see the `wire-protocol` skill).
- Imports from external npm packages, Node built-ins, or Next.js framework imports — those are unconstrained.
- Style of import paths (`@/lib/...` vs relative). That's a tsconfig/eslint concern, not a boundary one.
