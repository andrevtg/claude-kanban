// Global settings persisted to ~/.claude-kanban/settings.json.
// See docs/02-agent-sdk-usage.md for the bash allowlist defaults.

import { z } from "zod";

export const DEFAULT_BASH_ALLOWLIST: readonly string[] = [
  "git status",
  "git diff",
  "git log",
  "git add",
  "git commit",
  "npm test",
  "npm run *",
  "pnpm *",
  "yarn *",
  "pytest",
  "jest",
  "vitest",
  "go test",
  "mvn test",
  "cargo test",
  "cat",
  "ls",
  "head",
  "tail",
  "wc",
  "find",
  "rg",
  "grep",
];

export const DEFAULT_MODEL = "claude-opus-4-7";

// TODO(ADR-005): apiKeyPath should point at a 0600-mode file. v1 may keep
// the key inline in settings.json; revisit before phase 5.
export const GlobalSettingsSchema = z.object({
  apiKeyPath: z.string().min(1),
  defaultModel: z.string().min(1).default(DEFAULT_MODEL),
  defaultRepoPath: z.string().min(1).optional(),
  bashAllowlist: z.array(z.string().min(1)).default(() => [...DEFAULT_BASH_ALLOWLIST]),
  prAutoApprove: z.boolean().default(false),
});

export type GlobalSettings = z.infer<typeof GlobalSettingsSchema>;
