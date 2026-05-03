// Worker entrypoint. Lifecycle:
//   1. Read one `init` WireMessage from stdin.
//   2. Send `ready`.
//   3. Create the worktree via git.ts (exit 2 on git error).
//   4. Run the SDK via run.ts; forward every SDK message as an `event`.
//   5. If the SDK exited cleanly with a non-empty diff, capture the diff
//      (task-01) and enter the post-SDK approval window: wait up to
//      `init.approveTimeoutMs` (default 15 min) for an `approve_pr` wire
//      message, then run openPr() and emit `pr_opened` or `error`.
//   6. Send `done`, exit with the appropriate code.
//
// Worktrees persist on disk after the run terminates so they can be
// inspected and the PR step can push the branch.
//
// Two lifecycle phases (phase-4/task-02): SDK execution and the post-SDK
// approval window. `done` is emitted when the worker is about to exit, not
// when the SDK loop completes — `Run.endedAt` therefore reflects the full
// worker lifetime including any time spent waiting on approve_pr. The
// worker owns the single stdin reader (route by phase: cancel always
// triggers the run's AbortSignal; approve_pr only resolves the approval
// window).

import { EventEmitter } from "node:events";
import type { Readable } from "node:stream";
import { captureDiff, createWorktree, GitError } from "./git.js";
import { openPr } from "./pr.js";
import { runAgent as defaultRunAgent } from "./run.js";
import { makeSender, readWireMessages, type SendFn } from "./stdio.js";
import type { RunInitPayload, WireMessage } from "../protocol/messages.js";

export type RunAgentFn = typeof defaultRunAgent;

const EXIT_OK = 0;
const EXIT_SDK_ERROR = 1;
const EXIT_GIT_ERROR = 2;
const EXIT_PROTOCOL_ERROR = 3;

const DEFAULT_APPROVE_TIMEOUT_MS = 15 * 60 * 1000;

export interface WorkerDeps {
  openPr?: typeof openPr;
}

export async function main(
  send: SendFn = makeSender(),
  runAgentImpl: typeof defaultRunAgent = defaultRunAgent,
  input: Readable = process.stdin,
  deps: WorkerDeps = {},
): Promise<number> {
  const openPrImpl = deps.openPr ?? openPr;
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

  // Single stdin router started after readInit consumed the init line.
  // Cancel always aborts the SDK; approve_pr only resolves the approval
  // window. Both the SDK phase and the approval phase subscribe.
  const router = new MessageRouter();
  const cancelController = new AbortController();
  router.onCancel(() => cancelController.abort());

  const readerLoop = (async () => {
    for await (const result of readWireMessages(input)) {
      if (!result.ok) continue;
      router.dispatch(result.value);
    }
    router.emitEof();
  })();
  readerLoop.catch((e: unknown) => {
    send({
      type: "event",
      event: {
        kind: "worker",
        level: "warn",
        message: `stdin reader error: ${e instanceof Error ? e.message : String(e)}`,
      },
    });
  });

  const { exitCode: agentExit } = await runAgentImpl(init, send, input, {
    cancel: cancelController.signal,
  });

  send({
    type: "event",
    event: {
      kind: "worker",
      level: "info",
      message: `worktree retained at ${worktreePath} on branch ${init.branchName}`,
    },
  });

  let diffEmpty = true;
  if (agentExit === 0) {
    try {
      const result = await captureDiff({
        worktreePath,
        baseBranch: init.baseBranch,
        patchPath: init.diffPath,
      });
      diffEmpty = result.stat.files === 0;
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

  // Post-SDK approval window: skip on SDK error or empty diff.
  if (agentExit === 0 && !diffEmpty) {
    await awaitApproval({
      init,
      worktreePath,
      send,
      router,
      openPrImpl,
    });
  }

  router.close();

  const finalExit = agentExit === 0 ? EXIT_OK : EXIT_SDK_ERROR;
  send({ type: "done", exitCode: finalExit });
  return finalExit;
}

interface AwaitApprovalArgs {
  init: RunInitPayload;
  worktreePath: string;
  send: SendFn;
  router: MessageRouter;
  openPrImpl: typeof openPr;
}

async function awaitApproval(args: AwaitApprovalArgs): Promise<void> {
  const { init, worktreePath, send, router, openPrImpl } = args;
  const timeoutMs = init.approveTimeoutMs ?? DEFAULT_APPROVE_TIMEOUT_MS;

  send({
    type: "event",
    event: {
      kind: "worker",
      level: "info",
      message: `awaiting approve_pr (timeout ${Math.round(timeoutMs / 1000)}s)`,
    },
  });

  const outcome = await new Promise<"approve" | "cancel" | "timeout" | "eof">((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve("timeout");
    }, timeoutMs);

    const onApprove = (msg: { title: string; body: string }): void => {
      cleanup();
      void (async () => {
        const pr = await openPrImpl({
          worktreePath,
          baseBranch: init.baseBranch,
          branchName: init.branchName,
          remote: "origin",
          title: msg.title,
          body: msg.body,
        });
        if (pr.ok) {
          send({ type: "pr_opened", url: pr.url });
        } else {
          send({ type: "error", code: pr.code, message: pr.message });
        }
        resolve("approve");
      })();
    };
    const onCancel = (): void => {
      cleanup();
      resolve("cancel");
    };
    const onEof = (): void => {
      cleanup();
      resolve("eof");
    };

    function cleanup(): void {
      clearTimeout(timer);
      router.offApprove(onApprove);
      router.offCancel(onCancel);
      router.offEof(onEof);
    }

    router.onApprove(onApprove);
    router.onCancel(onCancel);
    router.onEof(onEof);
  });

  if (outcome === "timeout") {
    send({
      type: "event",
      event: { kind: "worker", level: "info", message: "approval window timed out" },
    });
  } else if (outcome === "cancel") {
    send({
      type: "event",
      event: { kind: "worker", level: "info", message: "approval window cancelled by user" },
    });
  }
}

// Routes wire messages from the single stdin reader to per-phase listeners.
// Cancel handlers always fire (multiple subscribers OK so the SDK abort and
// the approval-window cancel can both observe the same signal).
class MessageRouter {
  private readonly bus = new EventEmitter();
  private closed = false;

  dispatch(msg: WireMessage): void {
    if (this.closed) return;
    if (msg.type === "cancel") {
      this.bus.emit("cancel");
      return;
    }
    if (msg.type === "approve_pr") {
      this.bus.emit("approve", { title: msg.title, body: msg.body });
      return;
    }
    // init / worker→parent variants on the parent→worker channel: ignore.
  }

  emitEof(): void {
    if (this.closed) return;
    this.bus.emit("eof");
  }

  onCancel(fn: () => void): void {
    this.bus.on("cancel", fn);
  }
  offCancel(fn: () => void): void {
    this.bus.off("cancel", fn);
  }
  onApprove(fn: (msg: { title: string; body: string }) => void): void {
    this.bus.on("approve", fn);
  }
  offApprove(fn: (msg: { title: string; body: string }) => void): void {
    this.bus.off("approve", fn);
  }
  onEof(fn: () => void): void {
    this.bus.on("eof", fn);
  }
  offEof(fn: () => void): void {
    this.bus.off("eof", fn);
  }

  close(): void {
    this.closed = true;
    this.bus.removeAllListeners();
  }
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
  send({
    type: "error",
    code: "PROTOCOL_EOF",
    message: "stdin closed before init message",
  });
  send({ type: "done", exitCode: EXIT_PROTOCOL_ERROR });
  return null;
}

const isDirect =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("worker/index.ts") ||
    process.argv[1].endsWith("worker/index.js"));
if (isDirect) {
  main()
    .then((code) => process.exit(code))
    .catch((e: unknown) => {
      const msg = e instanceof Error ? e.stack ?? e.message : String(e);
      process.stderr.write(`worker fatal: ${msg}\n`);
      process.exit(EXIT_PROTOCOL_ERROR);
    });
}
