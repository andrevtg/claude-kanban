// Drives a single Agent SDK run. Exact option shape is locked in by the
// agent-sdk skill / docs/02-agent-sdk-usage.md — change those first.
//
// Cooperative cancellation: a stdin reader runs concurrently with the SDK
// iterator and calls q.interrupt() on a `{ type: "cancel" }` wire message.
// The two coroutines race only on the cancel side: we never short-circuit
// the SDK loop ourselves — q.interrupt() lets the SDK emit its terminal
// `result` message and the for-await drains naturally. Re-entrant cancels
// are no-ops.

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Readable } from "node:stream";
import type { RunInitPayload } from "../protocol/messages.js";
import { readWireMessages, type SendFn } from "./stdio.js";

export interface RunResult {
  exitCode: number;
}

export interface RunAgentDeps {
  // Injection seam for tests; real callers omit and get the real SDK.
  queryFn?: typeof query;
}

export async function runAgent(
  init: RunInitPayload,
  send: SendFn,
  input: Readable = process.stdin,
  deps: RunAgentDeps = {},
): Promise<RunResult> {
  const queryImpl = deps.queryFn ?? query;
  let cancelRequested = false;

  try {
    const q = queryImpl({
      prompt: init.prompt,
      options: {
        cwd: init.worktreePath,
        model: init.model,
        allowedTools: init.allowedTools,
        permissionMode: "acceptEdits",
        settingSources: [],
        maxTurns: init.maxTurns,
      },
    });

    const cancelLoop = (async () => {
      for await (const result of readWireMessages(input)) {
        if (!result.ok) continue;
        if (result.value.type !== "cancel") continue;
        if (cancelRequested) continue;
        cancelRequested = true;
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
      }
    })();
    // Defensive: stdin reader should never throw, but if it does, surface it
    // and keep the SDK loop running so the run can still terminate cleanly.
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
