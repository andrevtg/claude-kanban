// Parent-side supervisor for worker subprocesses. Owns the runtime lifecycle
// of every active run: spawns the worker, multiplexes its stdout into the
// store and an in-memory event bus, captures stderr to a per-run file,
// enforces the one-active-run-per-card invariant, and escalates a hung
// worker through cancel → SIGTERM → SIGKILL on a wall-clock timeout.
//
// The Next.js process owns exactly one Supervisor. Workers communicate via
// the wire protocol in src/protocol/messages.ts; the supervisor is the only
// place in the parent that touches child_process. See task-05 and ADR-001.

import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { ulid } from "ulid";
import {
  encodeWireMessage,
  parseWireMessage,
  type AgentEvent,
  type RunInitPayload,
  type WireMessage,
} from "../../protocol/messages.js";
import type { Card, EventLogEntry, GlobalSettings } from "../../protocol/index.js";
import { diffPath, logsDir, runDir } from "../paths.js";
import type { Store } from "../store/index.js";

export interface RunHandle {
  runId: string;
  cardId: string;
  pid: number;
  startedAt: string;
}

export interface PrApprovalPayload {
  title: string;
  body: string;
}

export interface SupervisorDeps {
  store: Store;
  // Path to the worker entry script. In production this is the compiled
  // worker; tests inject fixtures.
  workerEntry: string;
  // Defaults to the current Node binary. Tests can override.
  nodePath?: string;
  // Extra args to pass before the worker entry (e.g. ["--import", "tsx"]).
  nodeArgs?: string[];
  defaultTimeoutMs?: number;
  sigtermDelayMs?: number;
  sigkillDelayMs?: number;
  // Tools the worker is allowed to call. Will be embedded in the init payload.
  allowedTools?: string[];
  maxTurns?: number;
}

export interface StartRunOptions {
  timeoutMs?: number;
}

export class DuplicateRunError extends Error {
  constructor(
    public readonly cardId: string,
    public readonly runId: string,
  ) {
    super(`run already active for card ${cardId}`);
    this.name = "DuplicateRunError";
  }
}

export class UnknownRunError extends Error {
  constructor(public readonly runId: string) {
    super(`no active run ${runId}`);
    this.name = "UnknownRunError";
  }
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_SIGTERM_DELAY_MS = 5_000;
const DEFAULT_SIGKILL_DELAY_MS = 5_000;
const DEFAULT_ALLOWED_TOOLS: readonly string[] = [
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "Bash",
];
const DEFAULT_MAX_TURNS = 250;

interface ActiveRun {
  runId: string;
  cardId: string;
  startedAt: string;
  child: ChildProcess;
  stderrFile: WriteStream;
  timeoutTimer: NodeJS.Timeout;
  sigtermTimer?: NodeJS.Timeout;
  sigkillTimer?: NodeJS.Timeout;
  ready: boolean;
  finished: boolean;
  finishPromise: Promise<void>;
  resolveReady: (h: RunHandle) => void;
  rejectReady: (e: Error) => void;
}

export interface SupervisorEvents {
  "run-event": (runId: string, entry: EventLogEntry) => void;
  "run-done": (runId: string, exitCode: number) => void;
}

export class Supervisor extends EventEmitter {
  private readonly store: Store;
  private readonly workerEntry: string;
  private readonly nodePath: string;
  private readonly nodeArgs: readonly string[];
  private readonly defaultTimeoutMs: number;
  private readonly sigtermDelayMs: number;
  private readonly sigkillDelayMs: number;
  private readonly allowedTools: readonly string[];
  private readonly maxTurns: number;

  private readonly active = new Map<string, ActiveRun>();
  private readonly activeByCard = new Map<string, string>();

  constructor(deps: SupervisorDeps) {
    super();
    this.store = deps.store;
    this.workerEntry = deps.workerEntry;
    this.nodePath = deps.nodePath ?? process.execPath;
    this.nodeArgs = deps.nodeArgs ?? [];
    this.defaultTimeoutMs = deps.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.sigtermDelayMs = deps.sigtermDelayMs ?? DEFAULT_SIGTERM_DELAY_MS;
    this.sigkillDelayMs = deps.sigkillDelayMs ?? DEFAULT_SIGKILL_DELAY_MS;
    this.allowedTools = deps.allowedTools ?? DEFAULT_ALLOWED_TOOLS;
    this.maxTurns = deps.maxTurns ?? DEFAULT_MAX_TURNS;
  }

  override on<E extends keyof SupervisorEvents>(event: E, listener: SupervisorEvents[E]): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  override emit<E extends keyof SupervisorEvents>(
    event: E,
    ...args: Parameters<SupervisorEvents[E]>
  ): boolean {
    return super.emit(event, ...args);
  }

  async startRun(
    card: Card,
    settings: GlobalSettings,
    opts: StartRunOptions = {},
  ): Promise<RunHandle> {
    const existingRunId = this.activeByCard.get(card.id);
    if (existingRunId !== undefined) {
      throw new DuplicateRunError(card.id, existingRunId);
    }

    const runId = `run_${ulid()}`;
    const startedAt = new Date().toISOString();
    const branchName = `claude-kanban/${runId}`;
    const worktreePath = runDir(runId);

    await this.store.appendRun(card.id, { id: runId, startedAt, branchName });

    await mkdir(logsDir(), { recursive: true });
    const stderrFile = createWriteStream(join(logsDir(), `${runId}.stderr`), { flags: "a" });

    const child = spawn(this.nodePath, [...this.nodeArgs, this.workerEntry], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const timeoutMs = opts.timeoutMs ?? this.defaultTimeoutMs;

    let resolveReady!: (h: RunHandle) => void;
    let rejectReady!: (e: Error) => void;
    const readyPromise = new Promise<RunHandle>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });

    let resolveFinish!: () => void;
    const finishPromise = new Promise<void>((resolve) => {
      resolveFinish = resolve;
    });

    const active: ActiveRun = {
      runId,
      cardId: card.id,
      startedAt,
      child,
      stderrFile,
      timeoutTimer: setTimeout(() => this.escalate(runId), timeoutMs),
      ready: false,
      finished: false,
      finishPromise,
      resolveReady,
      rejectReady,
    };
    this.active.set(runId, active);
    this.activeByCard.set(card.id, runId);

    this.attachStdout(active);
    this.attachStderr(active);
    this.attachLifecycle(active, resolveFinish);

    const initPayload: RunInitPayload = {
      runId,
      cardId: card.id,
      prompt: card.prompt,
      repoPath: card.repoPath,
      baseBranch: card.baseBranch,
      worktreePath,
      branchName,
      model: settings.defaultModel,
      allowedTools: [...this.allowedTools],
      bashAllowlist: [...settings.bashAllowlist],
      maxTurns: this.maxTurns,
      diffPath: diffPath(runId),
    };
    this.sendToWorker(active, { type: "init", run: initPayload });

    return readyPromise;
  }

  isActive(runId: string): boolean {
    return this.active.has(runId);
  }

  async cancel(runId: string): Promise<void> {
    const active = this.active.get(runId);
    if (!active) return;
    this.sendToWorker(active, { type: "cancel" });
  }

  async approvePr(runId: string, pr: PrApprovalPayload): Promise<void> {
    const active = this.active.get(runId);
    if (!active) throw new UnknownRunError(runId);
    this.sendToWorker(active, { type: "approve_pr", title: pr.title, body: pr.body });
  }

  // For tests / shutdown: await the run's finalize step.
  waitForDone(runId: string): Promise<void> {
    const active = this.active.get(runId);
    if (!active) return Promise.resolve();
    return active.finishPromise;
  }

  private attachStdout(active: ActiveRun): void {
    const stdout = active.child.stdout;
    if (!stdout) {
      this.recordSyntheticError(active, "spawn returned no stdout");
      return;
    }
    const rl = createInterface({ input: stdout, crlfDelay: Infinity });
    rl.on("line", (line) => {
      if (line.length === 0) return;
      const result = parseWireMessage(line);
      if (!result.ok) {
        this.recordSyntheticError(
          active,
          `parse error: ${result.error.kind}: ${result.error.message}`,
        );
        return;
      }
      this.handleWorkerMessage(active, result.value);
    });
  }

  private attachStderr(active: ActiveRun): void {
    const stderr = active.child.stderr;
    if (!stderr) return;
    stderr.on("data", (chunk: Buffer) => {
      active.stderrFile.write(chunk);
      const text = chunk.toString("utf8");
      for (const line of text.split("\n")) {
        if (line.length === 0) continue;
        process.stderr.write(`[${active.runId}] ${line}\n`);
      }
    });
  }

  private attachLifecycle(active: ActiveRun, resolveFinish: () => void): void {
    active.child.on("error", (err) => {
      this.recordSyntheticError(active, `child process error: ${err.message}`);
    });
    active.child.on("exit", (code, signal) => {
      if (active.finished) {
        resolveFinish();
        return;
      }
      // Worker died without sending `done`. Manufacture an exit code.
      const exitCode = code ?? (signal ? 128 : 1);
      if (!active.ready) {
        active.rejectReady(
          new Error(`worker for run ${active.runId} exited before ready (signal=${signal ?? "none"}, code=${code ?? "none"})`),
        );
      }
      this.finalize(active, exitCode).finally(resolveFinish);
    });
  }

  private handleWorkerMessage(active: ActiveRun, msg: WireMessage): void {
    switch (msg.type) {
      case "ready": {
        if (!active.ready) {
          active.ready = true;
          active.resolveReady({
            runId: active.runId,
            cardId: active.cardId,
            pid: active.child.pid ?? -1,
            startedAt: active.startedAt,
          });
        }
        return;
      }
      case "done": {
        if (!active.finished) {
          void this.finalize(active, msg.exitCode);
        }
        return;
      }
      case "init":
      case "approve_pr":
      case "cancel": {
        // Parent→worker types should never appear on the worker→parent
        // channel. Surface as a synthetic error and keep going.
        this.recordSyntheticError(
          active,
          `worker emitted unexpected parent-bound message type: ${msg.type}`,
        );
        return;
      }
      case "diff_ready": {
        const entry: EventLogEntry = {
          timestamp: new Date().toISOString(),
          message: msg,
        };
        this.dispatchEvent(active.runId, entry);
        this.store
          .updateRun(active.cardId, active.runId, { diffStat: msg.stat })
          .catch((e: unknown) => {
            const errMsg = e instanceof Error ? e.message : String(e);
            process.stderr.write(
              `[${active.runId}] supervisor updateRun(diffStat) error: ${errMsg}\n`,
            );
          });
        return;
      }
      case "event":
      case "pr_opened":
      case "error": {
        const entry: EventLogEntry = {
          timestamp: new Date().toISOString(),
          message: msg,
        };
        this.dispatchEvent(active.runId, entry);
        return;
      }
    }
  }

  private recordSyntheticError(active: ActiveRun, message: string): void {
    const event: AgentEvent = {
      kind: "worker",
      level: "error",
      message: `supervisor: ${message}`,
    };
    const entry: EventLogEntry = {
      timestamp: new Date().toISOString(),
      message: { type: "event", event },
    };
    this.dispatchEvent(active.runId, entry);
  }

  private dispatchEvent(runId: string, entry: EventLogEntry): void {
    this.emit("run-event", runId, entry);
    this.store.appendEvent(runId, entry).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`[${runId}] supervisor appendEvent error: ${msg}\n`);
    });
  }

  private async finalize(active: ActiveRun, exitCode: number): Promise<void> {
    if (active.finished) return;
    active.finished = true;
    clearTimeout(active.timeoutTimer);
    if (active.sigtermTimer) clearTimeout(active.sigtermTimer);
    if (active.sigkillTimer) clearTimeout(active.sigkillTimer);
    active.stderrFile.end();

    if (!active.ready) {
      active.rejectReady(
        new Error(`worker for run ${active.runId} exited (code=${exitCode}) before ready`),
      );
    }

    try {
      await this.store.updateRun(active.cardId, active.runId, {
        endedAt: new Date().toISOString(),
        exitCode,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`[${active.runId}] supervisor updateRun error: ${msg}\n`);
    }

    this.active.delete(active.runId);
    if (this.activeByCard.get(active.cardId) === active.runId) {
      this.activeByCard.delete(active.cardId);
    }

    this.emit("run-done", active.runId, exitCode);
  }

  private sendToWorker(active: ActiveRun, msg: WireMessage): void {
    const stdin = active.child.stdin;
    if (!stdin || stdin.destroyed || !stdin.writable) return;
    stdin.write(`${encodeWireMessage(msg)}\n`);
  }

  private escalate(runId: string): void {
    const active = this.active.get(runId);
    if (!active || active.finished) return;
    this.recordSyntheticError(active, "wall-clock timeout reached; escalating");
    this.sendToWorker(active, { type: "cancel" });
    active.sigtermTimer = setTimeout(() => {
      const a = this.active.get(runId);
      if (!a || a.finished) return;
      try {
        a.child.kill("SIGTERM");
      } catch {
        // process may already be gone; ignored intentionally.
      }
      a.sigkillTimer = setTimeout(() => {
        const a2 = this.active.get(runId);
        if (!a2 || a2.finished) return;
        try {
          a2.child.kill("SIGKILL");
        } catch {
          // already gone
        }
      }, this.sigkillDelayMs);
    }, this.sigtermDelayMs);
  }
}
