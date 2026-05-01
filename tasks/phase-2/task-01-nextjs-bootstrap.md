**STATUS: done**

# phase-2 / task-01 — Next.js bootstrap

## Goal

Add Next.js 15 (App Router) + Tailwind to the existing repo so it coexists
with `src/cli/`, `src/lib/`, `src/worker/`, and `src/protocol/`. After
this task, `pnpm dev` boots a Next.js server that imports `src/lib/` cleanly,
and `tsx src/worker/index.ts` still runs as a standalone subprocess. No
routes, no UI beyond a placeholder page — just the integration plumbing.

## Inputs

- `docs/01-architecture.md` — module map (`src/app/`, `src/components/`)
- `docs/02-agent-sdk-usage.md` — confirms the SDK is worker-only; Next.js
  must not transitively pull `@anthropic-ai/claude-agent-sdk` into a
  client bundle
- `package.json` — existing scripts, packageManager pin
- `tsconfig.json` — existing strict config

## Outputs

### Dependencies

Add to `dependencies`:

- `next` (^15)
- `react`, `react-dom` (^19, matching Next 15)

Add to `devDependencies`:

- `@types/react`, `@types/react-dom`
- `tailwindcss`, `postcss`, `autoprefixer`
- `eslint-config-next`

Update `docs/01-architecture.md` "Dependencies" section if one exists, or
add a one-line note that Next.js 15 / React 19 / Tailwind landed in
phase-2/task-01. Per CLAUDE.md hard rule: dependency surface is part of
the architecture.

### `next.config.ts`

- `serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"]` (this option moved out of `experimental` in Next 15)
  must include `@anthropic-ai/claude-agent-sdk` so Next never tries to
  bundle it. The SDK is reached only via the worker subprocess; the
  Next.js process imports nothing from `src/worker/`.
- Configure path aliases consistent with existing `tsconfig.json` (`@/*`
  → `src/*`).

### `tsconfig.json` updates

- Add `"jsx": "preserve"` and the Next.js `plugins` entry.
- Add `"src/**/*.tsx"` to `include` if not already covered.
- Keep `strict: true`, `noUncheckedIndexedAccess: true`.

### `src/app/layout.tsx`

Minimal root layout: HTML shell, Tailwind `globals.css` import, no nav
chrome. Server component.

### `src/app/page.tsx`

A placeholder page that renders the string `"claude-kanban — phase 2"` and
nothing else. The real card UI lands in task-04.

### `src/app/globals.css`

Tailwind directives (`@tailwind base/components/utilities`).

### `tailwind.config.ts`, `postcss.config.mjs`

Standard Tailwind setup, `content: ["./src/**/*.{ts,tsx}"]`.

### `src/lib/supervisor/instance.ts` (new)

```ts
export function getSupervisor(): Supervisor;
```

A module-level singleton wrapping `new Supervisor({ store, workerEntry,
nodeArgs })`. The `workerEntry` resolves to `src/worker/index.ts` in dev
(spawn with `["--import", "tsx"]`) and to a built JS file in production
— for phase-2 it's acceptable to require dev mode (`tsx`) only and leave
a TODO for the production build path. Per the supervisor's task-05 design
note, "one supervisor per HMR cycle" is acceptable; do not try to survive
hot reload.

### `package.json` scripts

Add `"dev": "next dev"`, `"start": "next start"`. Keep `build` doing
`tsc -p tsconfig.json` for now (Next's own build is wired in task-02 if
needed; bootstrap can leave it).

### `.gitignore`

Add `.next/` (CLAUDE.md task-01 mentioned this; verify it's already there).

## Acceptance

- `pnpm install` succeeds.
- `pnpm typecheck` succeeds with the new files.
- `pnpm lint` succeeds.
- `pnpm dev` boots Next.js without error and `GET /` returns the
  placeholder string.
- `pnpm cli run ...` from phase-1/task-06 still works end-to-end (the
  worker subprocess is unaffected).
- `grep -r "from \"@anthropic-ai/claude-agent-sdk\"" src/app src/components`
  returns nothing — the SDK never enters the Next.js side.
- Importing `getSupervisor` from `src/app/page.tsx` (temporarily, then
  reverted) compiles. This proves the Next.js → `src/lib/` boundary works;
  remove the import before committing.

## Out of scope

- Route handlers (`/api/cards/*`) — task-02.
- SSE plumbing — task-03.
- Any card UI, event log, kanban columns, drag-and-drop — task-04 and
  phase 3.
- Settings page or any settings UI — phase 3.
- shadcn/ui setup. Defer to task-04 or phase 3 when the design skill
  weighs in on component patterns.
- A production build path for the worker (compiled JS instead of `tsx`).
  Acceptable as a TODO; phase-5 polishes this.
- Cleaning up the dev-server-reload duplicate-supervisor footgun. The
  task-05 design note already accepts this for v1.
