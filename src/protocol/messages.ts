// Wire protocol between the Next.js parent process and worker subprocesses.
// One JSON object per NDJSON line. See docs/01-architecture.md "Wire protocol".

import { z } from "zod";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export type { SDKMessage };

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export type ParseError = {
  kind: "invalid_json" | "schema_mismatch";
  message: string;
};

const DiffStatSchema = z.object({
  files: z.number().int().nonnegative(),
  insertions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});
export type DiffStat = z.infer<typeof DiffStatSchema>;

const RunInitPayloadSchema = z.object({
  runId: z.string().min(1),
  cardId: z.string().min(1),
  prompt: z.string(),
  repoPath: z.string().min(1),
  baseBranch: z.string().min(1),
  worktreePath: z.string().min(1),
  branchName: z.string().min(1),
  model: z.string().min(1),
  allowedTools: z.array(z.string()),
  bashAllowlist: z.array(z.string()),
  maxTurns: z.number().int().positive(),
  // Where the worker writes the post-run patch file. Supplied by the
  // supervisor so the worker doesn't import paths.ts (module-boundaries).
  diffPath: z.string().min(1),
  // How long the worker waits in the post-SDK approval window for an
  // approve_pr message before exiting. Defaults to 15 minutes when absent.
  // See phase-4/task-02 worker-lifecycle notes.
  approveTimeoutMs: z.number().int().positive().optional(),
});
export type RunInitPayload = z.infer<typeof RunInitPayloadSchema>;
export { RunInitPayloadSchema, DiffStatSchema };

// AgentEvent wraps both forwarded SDK messages and worker-internal events
// (git operations, lifecycle notes). The `sdk` variant is opaque at the
// protocol layer: validating the full SDKMessage union at runtime would
// duplicate the SDK's own contract and break on every minor SDK release.
const AgentEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("sdk"),
    message: z.custom<SDKMessage>(
      (val) => typeof val === "object" && val !== null && "type" in val,
      { message: "expected SDKMessage object" },
    ),
  }),
  z.object({
    kind: z.literal("worker"),
    level: z.enum(["info", "warn", "error"]),
    message: z.string(),
  }),
]);
export type AgentEvent = z.infer<typeof AgentEventSchema>;
export { AgentEventSchema };

// ---------- Parent → Worker ----------

const InitMessageSchema = z.object({
  type: z.literal("init"),
  run: RunInitPayloadSchema,
});

const ApprovePrMessageSchema = z.object({
  type: z.literal("approve_pr"),
  title: z.string().min(1),
  body: z.string(),
});

const CancelMessageSchema = z.object({
  type: z.literal("cancel"),
});

// ---------- Worker → Parent ----------

const ReadyMessageSchema = z.object({
  type: z.literal("ready"),
});

const EventMessageSchema = z.object({
  type: z.literal("event"),
  event: AgentEventSchema,
});

const DiffReadyMessageSchema = z.object({
  type: z.literal("diff_ready"),
  stat: DiffStatSchema,
  // Absolute path to the on-disk patch file under ~/.claude-kanban/diffs/.
  // Empty string when the diff is empty (no patch file written).
  patchPath: z.string(),
  truncated: z.boolean(),
  bytes: z.number().int().nonnegative(),
});

const PrOpenedMessageSchema = z.object({
  type: z.literal("pr_opened"),
  url: z.string().url(),
});

// `code` is a stable string the UI can branch on; we keep the schema permissive
// so new producers don't have to ship a schema bump. Documented codes:
//   PROTOCOL_PARSE_ERROR / PROTOCOL_UNEXPECTED / PROTOCOL_EOF (worker startup)
//   WORKTREE_FAILED / REPO_NOT_FOUND / BASE_BRANCH_MISSING / REPO_DIRTY
//   DIFF_FAILED                                       (phase-4/task-01)
//   SDK_RUNTIME_ERROR                                 (worker run.ts)
//   GH_MISSING / GH_UNAUTH                            (phase-4/task-02 preflight)
//   PUSH_FAILED / PR_CREATE_FAILED / PR_URL_MISSING   (phase-4/task-02 openPr)
const ErrorMessageSchema = z.object({
  type: z.literal("error"),
  code: z.string().min(1),
  message: z.string(),
});

const DoneMessageSchema = z.object({
  type: z.literal("done"),
  exitCode: z.number().int(),
});

export const WireMessageSchema = z.discriminatedUnion("type", [
  InitMessageSchema,
  ApprovePrMessageSchema,
  CancelMessageSchema,
  ReadyMessageSchema,
  EventMessageSchema,
  DiffReadyMessageSchema,
  PrOpenedMessageSchema,
  ErrorMessageSchema,
  DoneMessageSchema,
]);

export type WireMessage = z.infer<typeof WireMessageSchema>;

export type ParentToWorker = Extract<WireMessage, { type: "init" | "approve_pr" | "cancel" }>;
export type WorkerToParent = Exclude<WireMessage, ParentToWorker>;

export function encodeWireMessage(msg: WireMessage): string {
  return JSON.stringify(msg);
}

export function parseWireMessage(line: string): Result<WireMessage, ParseError> {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch (e) {
    return {
      ok: false,
      error: {
        kind: "invalid_json",
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }
  const parsed = WireMessageSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: { kind: "schema_mismatch", message: parsed.error.message },
    };
  }
  return { ok: true, value: parsed.data };
}
