// Drives a single Agent SDK run. Exact option shape is locked in by the
// agent-sdk skill / docs/02-agent-sdk-usage.md — change those first.
// Cancellation is task-05; this module only does happy-path streaming.

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { RunInitPayload } from "../protocol/messages.js";
import type { SendFn } from "./stdio.js";

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
  deps: RunAgentDeps = {},
): Promise<RunResult> {
  const queryImpl = deps.queryFn ?? query;

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
