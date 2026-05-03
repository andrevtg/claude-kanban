// Worker entrypoint. Lifecycle:
//   1. Read one `init` WireMessage from stdin.
//   2. Send `ready`.
//   3. Create the worktree via git.ts (exit 2 on git error).
//   4. Run the SDK via run.ts; forward every SDK message as an `event`.
//   5. Send `done`, exit with the appropriate code.
//
// Worktrees persist on disk after the run terminates (success or SDK error)
// so they can be inspected and so the phase-4 PR flow can push the branch.
// Cleanup is reserved for the createWorktree-failure path, future cancel
// (task-05), and the deferred stale-run sweep.
//
// Cancellation, PR creation, and diff capture are out of scope (task-05 /
// phase-4). This module is the smallest thing that proves the wire protocol
// and the worktree boundary actually work.

import type { Readable } from "node:stream";
import { captureDiff, createWorktree, GitError } from "./git.js";
import { runAgent as defaultRunAgent } from "./run.js";
import { makeSender, readWireMessages, type SendFn } from "./stdio.js";
import type { RunInitPayload, WireMessage } from "../protocol/messages.js";

export type RunAgentFn = typeof defaultRunAgent;

const EXIT_OK = 0;
const EXIT_SDK_ERROR = 1;
const EXIT_GIT_ERROR = 2;
const EXIT_PROTOCOL_ERROR = 3;

export async function main(
  send: SendFn = makeSender(),
  runAgent: RunAgentFn = defaultRunAgent,
  input: Readable = process.stdin,
): Promise<number> {
  const init = await readInit(send, input);
  if (!init) return EXIT_PROTOCOL_ERROR;

  send({ type: "ready" });

  let worktreePath: string;
  try {
    const r = await createWorktree({
      repoPath: init.repoPath,
      baseBranch: init.baseBranch,
      worktreePath: init.worktreePath,
      branchName: init.branchName,
    });
    worktreePath = r.worktreePath;
    send({
      type: "event",
      event: {
        kind: "worker",
        level: "info",
        message: `worktree created at ${r.worktreePath} on branch ${r.branchName}`,
      },
    });
  } catch (e) {
    if (e instanceof GitError) {
      send({ type: "error", code: e.code, message: e.message });
    } else {
      send({
        type: "error",
        code: "WORKTREE_FAILED",
        message: e instanceof Error ? e.message : String(e),
      });
    }
    send({ type: "done", exitCode: EXIT_GIT_ERROR });
    return EXIT_GIT_ERROR;
  }

  const { exitCode: agentExit } = await runAgent(init, send, input);

  send({
    type: "event",
    event: {
      kind: "worker",
      level: "info",
      message: `worktree retained at ${worktreePath} on branch ${init.branchName}`,
    },
  });

  if (agentExit === 0) {
    try {
      const result = await captureDiff({
        worktreePath,
        baseBranch: init.baseBranch,
        patchPath: init.diffPath,
      });
      send({
        type: "diff_ready",
        stat: result.stat,
        patchPath: result.stat.files === 0 ? "" : init.diffPath,
        truncated: result.truncated,
        bytes: result.bytes,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const code = e instanceof GitError ? e.code : "DIFF_FAILED";
      send({ type: "error", code, message });
      send({
        type: "event",
        event: {
          kind: "worker",
          level: "error",
          message: `diff capture failed: ${message}`,
        },
      });
    }
  } else {
    send({
      type: "event",
      event: {
        kind: "worker",
        level: "info",
        message: `skipping diff capture (agent exited with code ${agentExit})`,
      },
    });
  }

  const finalExit = agentExit === 0 ? EXIT_OK : EXIT_SDK_ERROR;
  send({ type: "done", exitCode: finalExit });
  return finalExit;
}

async function readInit(send: SendFn, input: Readable): Promise<RunInitPayload | null> {
  for await (const result of readWireMessages(input)) {
    if (!result.ok) {
      send({
        type: "error",
        code: "PROTOCOL_PARSE_ERROR",
        message: `${result.error.kind}: ${result.error.message}`,
      });
      send({ type: "done", exitCode: EXIT_PROTOCOL_ERROR });
      return null;
    }
    const msg: WireMessage = result.value;
    if (msg.type !== "init") {
      send({
        type: "error",
        code: "PROTOCOL_UNEXPECTED",
        message: `expected init message, got ${msg.type}`,
      });
      send({ type: "done", exitCode: EXIT_PROTOCOL_ERROR });
      return null;
    }
    return msg.run;
  }
  // EOF before init.
  send({
    type: "error",
    code: "PROTOCOL_EOF",
    message: "stdin closed before init message",
  });
  send({ type: "done", exitCode: EXIT_PROTOCOL_ERROR });
  return null;
}

// Run only when invoked directly (node/tsx src/worker/index.ts), not when
// imported by tests.
const isDirect =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("worker/index.ts") ||
    process.argv[1].endsWith("worker/index.js"));
if (isDirect) {
  main()
    .then((code) => process.exit(code))
    .catch((e: unknown) => {
      // Last-resort: protocol violation if we reach here, since main() catches.
      const msg = e instanceof Error ? e.stack ?? e.message : String(e);
      process.stderr.write(`worker fatal: ${msg}\n`);
      process.exit(EXIT_PROTOCOL_ERROR);
    });
}
