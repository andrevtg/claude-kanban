// Drives a single Agent SDK run. Exact option shape is locked in by the
// agent-sdk skill / docs/02-agent-sdk-usage.md — change those first.
//
// Cooperative cancellation: runAgent does NOT read stdin itself. The worker
// (src/worker/index.ts) owns the single stdin reader so that the post-SDK
// approval window (phase-4/task-02) and the cancel signal can cohabit on
// the same stream. Callers register a cancel hook via the AbortSignal in
// `deps.cancel`. When that signal aborts, runAgent calls q.interrupt() and
// lets the SDK loop drain naturally to a terminal `result` message.

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Readable } from "node:stream";
import type { RunInitPayload } from "../protocol/messages.js";
import { readWireMessages, type SendFn } from "./stdio.js";
import { redactArgs, type TraceWriter } from "./trace.js";

export interface RunResult {
  exitCode: number;
}

export interface RunAgentDeps {
  // Injection seam for tests; real callers omit and get the real SDK.
  queryFn?: typeof query;
  // External cancel signal owned by the worker. When aborted, runAgent
  // calls q.interrupt() once. Re-aborts are no-ops.
  cancel?: AbortSignal;
  // Optional trace writer for the PreToolUse hook. When omitted, the hook
  // is not registered.
  trace?: TraceWriter;
}

// Legacy signature kept for tests that pass a stdin Readable: when `deps.cancel`
// is absent and `input` is provided, runAgent installs an internal cancel
// reader for backwards compat.
export async function runAgent(
  init: RunInitPayload,
  send: SendFn,
  input: Readable = process.stdin,
  deps: RunAgentDeps = {},
): Promise<RunResult> {
  const queryImpl = deps.queryFn ?? query;
  let cancelled = false;

  const triggerCancel = async (q: ReturnType<typeof query>): Promise<void> => {
    if (cancelled) return;
    cancelled = true;
    send({
      type: "event",
      event: {
        kind: "worker",
        level: "info",
        message: "cancelling: interrupt requested",
      },
    });
    try {
      await q.interrupt();
    } catch (e) {
      send({
        type: "event",
        event: {
          kind: "worker",
          level: "warn",
          message: `interrupt failed: ${e instanceof Error ? e.message : String(e)}`,
        },
      });
    }
  };

  try {
    const traceWriter = deps.trace;
    // Skills opt-in (phase-4/task-04): when init.loadSkills is true the SDK
    // loads project-level skills from <cwd>/.claude/skills/. The supervisor
    // sets cwd to the worktree, but the .claude/ directory is checked in to
    // the user's repo and inherited by the worktree, so this is equivalent
    // to loading skills from <repoPath>/.claude/skills/. The worker info
    // event below makes the choice visible in the event log and trace.
    const settingSources: Array<"project"> = init.loadSkills ? ["project"] : [];
    const allowedTools = init.loadSkills
      ? Array.from(new Set([...init.allowedTools, "Skill"]))
      : init.allowedTools;
    send({
      type: "event",
      event: {
        kind: "worker",
        level: "info",
        message: init.loadSkills
          ? `skills loading enabled; settingSources=["project"], cwd=${init.worktreePath}`
          : `skills loading disabled; settingSources=[]`,
      },
    });
    const q = queryImpl({
      prompt: init.prompt,
      options: {
        cwd: init.worktreePath,
        model: init.model,
        allowedTools,
        permissionMode: "acceptEdits",
        settingSources,
        maxTurns: init.maxTurns,
        ...(traceWriter
          ? {
              hooks: {
                PreToolUse: [
                  {
                    hooks: [
                      async (input) => {
                        if (input.hook_event_name === "PreToolUse") {
                          // Fire-and-forget: never block tool execution. The
                          // writer queues writes internally and reports its
                          // own failures via the injected onError.
                          void traceWriter.append({
                            ts: new Date().toISOString(),
                            tool: input.tool_name,
                            args: redactArgs(input.tool_input),
                          });
                        }
                        return { continue: true };
                      },
                    ],
                  },
                ],
              },
            }
          : {}),
      },
    });

    if (deps.cancel) {
      // Worker-owned cancel: a single AbortSignal wired in by index.ts.
      if (deps.cancel.aborted) {
        void triggerCancel(q);
      } else {
        deps.cancel.addEventListener("abort", () => void triggerCancel(q), { once: true });
      }
    } else {
      // Legacy in-process cancel reader (used by run.cancel.test.ts).
      const cancelLoop = (async () => {
        for await (const result of readWireMessages(input)) {
          if (!result.ok) continue;
          if (result.value.type !== "cancel") continue;
          await triggerCancel(q);
        }
      })();
      cancelLoop.catch((e: unknown) => {
        send({
          type: "event",
          event: {
            kind: "worker",
            level: "warn",
            message: `cancel reader error: ${e instanceof Error ? e.message : String(e)}`,
          },
        });
      });
    }

    for await (const message of q) {
      send({ type: "event", event: { kind: "sdk", message } });
    }
    return { exitCode: 0 };
  } catch (e) {
    send({
      type: "error",
      code: "SDK_RUNTIME_ERROR",
      message: e instanceof Error ? e.message : String(e),
    });
    return { exitCode: 1 };
  }
}
