**STATUS: done**

# phase-3 / task-03 — Settings page

## Goal

Add `/settings` so the user can edit `GlobalSettings` from the browser
instead of hand-writing `~/.claude-kanban/settings.json`. After this
task, every field of `GlobalSettingsSchema` is editable, persists across
reloads, and is validated server-side. The card form's `repoPath` field
gets a sensible default from `defaultRepoPath`, and the supervisor's
`allowedTools` derivation can read `bashAllowlist` from the saved
settings.

## Inputs

- `src/protocol/settings.ts` — `GlobalSettingsSchema`,
  `DEFAULT_BASH_ALLOWLIST`, `DEFAULT_MODEL`
- `src/lib/store/index.ts` — `getSettings`, `saveSettings`
- `src/lib/paths.ts` — `claudeKanbanDir()`, `settingsFile()`
- `src/app/api/_lib/respond.ts`, `_lib/schemas.ts`, `_lib/deps.ts` —
  shared route patterns established in phase-2/task-02
- `docs/01-architecture.md` — auth section: API key lives in
  `~/.claude-kanban/` with `0600` mode; this is a single-user localhost tool

## Outputs

### `src/app/api/settings/route.ts`

- `GET` → `store.getSettings()`. Returns `GlobalSettings` or `null`.
  `null` is a valid response shape; the client renders the form with
  schema defaults pre-filled.
- `PUT` → validates body with `GlobalSettingsSchema`, calls
  `store.saveSettings(parsed)`, returns the saved object. Maps Zod
  failures to the existing `400 invalid_body` shape.

### API key handling

`apiKeyPath` stays a *path* in `GlobalSettings`. Two operating modes:

- **Path-only (preferred):** the user enters a path to an existing
  file. The route validates that the file exists and is mode `0600`
  (or chmods it on save if the user explicitly opts in via a
  `chmodApiKeyFile: true` body field — keep this server-side, not in
  the persisted settings).
- **Inline value (TODO from `settings.ts`):** if the user pastes the
  key value into a separate "API key value" field, the route writes
  it to `~/.claude-kanban/anthropic-key` with mode `0600` and stores
  *that path* as `apiKeyPath`. The raw key never appears in
  `settings.json` and is never returned by `GET`.

Document the chosen behavior in the route file's top comment. Either
mode is acceptable; both must keep the key out of the settings JSON.

### `src/app/settings/page.tsx`

Server component. Loads current settings via `getStore().getSettings()`
and renders `<SettingsForm initial={settings} />`.

### `src/components/settings-form.tsx`

Client component. Fields:

- `apiKeyPath` — file picker / path input. Shows the current path and
  a "Set new key" affordance for the inline-value flow.
- `defaultModel` — text input, prefills with `DEFAULT_MODEL`.
- `defaultRepoPath` — optional absolute path.
- `bashAllowlist` — editable list of glob strings. Add/remove rows;
  "Reset to defaults" restores `DEFAULT_BASH_ALLOWLIST`.
- `prAutoApprove` — boolean; phase-3 just saves it, phase-4 honors it.

On submit, `PUT /api/settings`. On `200`, show a saved-at timestamp
inline. On `400`, render per-field validation errors from the
response's `issues` array.

### Navigation

A link from `/` to `/settings` (header, sidebar — design skill's call).
A link from `/settings` back to `/`. No nested routing.

### Card form integration

`src/components/card-form.tsx` (from task-01) reads
`defaultRepoPath` and `defaultModel` from a server-side preload (or a
fetch in create mode) and uses them as initial values. Editing those
fields per-card is still allowed.

## Acceptance

Manual acceptance — verify each field round-trips:

1. **First-load defaults.** Wipe `~/.claude-kanban/settings.json`,
   navigate to `/settings`. The form renders with `defaultModel` =
   `claude-opus-4-7`, `bashAllowlist` populated with
   `DEFAULT_BASH_ALLOWLIST`, `prAutoApprove` unchecked, `apiKeyPath`
   empty (with a clear "no key configured" indicator). `apiKeyPath`
   is required by `GlobalSettingsSchema`, so a save attempt at this
   point fails validation until a path is provided — surface that
   inline rather than silently writing partial settings.
2. **`apiKeyPath` save and reload.** Enter a real path to a file you
   created with `chmod 600`. Submit. Reload `/settings` — the path is
   still there. `~/.claude-kanban/settings.json` on disk shows the
   path verbatim and *does not contain the key value*.
3. **Inline key value (if implemented).** Paste a fake key value into
   the "Set new key" field. Submit. Verify
   `~/.claude-kanban/anthropic-key` exists with mode `0600`,
   `settings.json` references that path, and the form doesn't echo the
   value back on reload.
4. **`defaultModel` save and reload.** Change the model to a different
   string. Submit. Reload — the new value sticks. `settings.json`
   contains it.
5. **`defaultRepoPath` save and reload.** Set it to a real local repo
   path. Submit, reload `/settings` — value persists. Open the card
   create form on `/` — the `repoPath` field is pre-filled with that
   value.
6. **`bashAllowlist` add/remove and reload.** Add a custom entry like
   `terraform plan`. Submit, reload `/settings` — the entry appears.
   Remove it, save, reload — it's gone. Click "Reset to defaults",
   save, reload — list matches `DEFAULT_BASH_ALLOWLIST` exactly.
7. **`prAutoApprove` toggle and reload.** Toggle it on, save, reload
   — checkbox stays on. Toggle off, save, reload — stays off.
8. **Validation error — bad path.** Set `apiKeyPath` to a path
   that doesn't exist (e.g. `/tmp/nonexistent-key-file`). Submit.
   The form surfaces an inline error like "file not found at
   <path>"; `settings.json` is unchanged.
9. **Phase-3 regressions.** From `/`, the board, card CRUD (task-01),
   and DnD (task-02) all still work. Triggering a run still succeeds.

## Out of scope

- Hooks configuration UI (PreToolUse, PostToolUse, etc.) — phase 4.
- Skills loading / discovery — phase 4.
- MCP server configuration — phase 4.
- Per-card model override (the card-level `model` field is not in
  `Card` yet; phase 4 may add it). v1 uses the global `defaultModel`
  for every run.
- Migration tooling for existing `settings.json` files written before
  this task. The schema hasn't changed in phase-3; if it does, that's
  a phase-5 concern.
- Multi-profile settings (per-project overrides). Single profile.
- Encrypting the API key file at rest. `0600` is the contract per
  ADR-005.
- A "test connection" button that calls the Anthropic API. Out of
  scope for the settings page; the next run is the real test.
