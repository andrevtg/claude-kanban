// Git worktree management for a single run.
//
// We use `git worktree add` to give the agent an isolated checkout that
// shares the user's object store. The branch is created off baseBranch and
// named claude-kanban/<runId>. Cleanup runs best-effort: if it fails the
// worktree is left on disk for forensics, which is the documented behavior
// in docs/01-architecture.md (worker-crash failure mode).
//
// This module deliberately does not import paths.ts from src/lib/ — that
// would cross the worker/lib boundary. The supervisor populates worktreePath
// in the init payload via the shared paths helper.

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat as fsStat, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import type { DiffStat } from "../protocol/messages.js";

const execFileAsync = promisify(execFile);

export type GitErrorCode =
  | "REPO_NOT_FOUND"
  | "BASE_BRANCH_MISSING"
  | "REPO_DIRTY"
  | "WORKTREE_FAILED"
  | "DIFF_FAILED";

export class GitError extends Error {
  readonly code: GitErrorCode;
  readonly stderr: string;
  constructor(code: GitErrorCode, message: string, stderr = "") {
    super(message);
    this.name = "GitError";
    this.code = code;
    this.stderr = stderr;
  }
}

export function branchNameForRun(runId: string): string {
  return `claude-kanban/${runId}`;
}

async function git(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", args, { cwd, maxBuffer: 8 * 1024 * 1024 });
}

export interface CreateWorktreeArgs {
  repoPath: string;
  baseBranch: string;
  worktreePath: string;
  branchName: string;
}

export interface CreateWorktreeResult {
  worktreePath: string;
  branchName: string;
}

export async function createWorktree(
  args: CreateWorktreeArgs,
): Promise<CreateWorktreeResult> {
  const { repoPath, baseBranch, worktreePath, branchName } = args;

  try {
    await git(repoPath, ["rev-parse", "--git-dir"]);
  } catch (e) {
    const stderr = errStderr(e);
    throw new GitError("REPO_NOT_FOUND", `not a git repository: ${repoPath}`, stderr);
  }

  try {
    await git(repoPath, ["rev-parse", "--verify", `${baseBranch}^{commit}`]);
  } catch (e) {
    const stderr = errStderr(e);
    throw new GitError(
      "BASE_BRANCH_MISSING",
      `base branch '${baseBranch}' does not exist in ${repoPath}`,
      stderr,
    );
  }

  try {
    await git(repoPath, [
      "worktree",
      "add",
      "-b",
      branchName,
      worktreePath,
      baseBranch,
    ]);
  } catch (e) {
    const stderr = errStderr(e);
    const code: GitErrorCode = /uncommitted|dirty|locked/i.test(stderr)
      ? "REPO_DIRTY"
      : "WORKTREE_FAILED";
    throw new GitError(code, `git worktree add failed: ${stderr.trim() || String(e)}`, stderr);
  }

  return { worktreePath, branchName };
}

export async function cleanupWorktree(
  repoPath: string,
  worktreePath: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await git(repoPath, ["worktree", "remove", "--force", worktreePath]);
    return { ok: true };
  } catch {
    // best-effort fallback: rm -rf the directory so we don't leak disk on
    // every failed run. Branch ref may be left dangling; that's acceptable.
    try {
      await rm(worktreePath, { recursive: true, force: true });
      return { ok: true };
    } catch (e2) {
      return {
        ok: false,
        error: e2 instanceof Error ? e2.message : String(e2),
      };
    }
  }
}

// ---------- captureDiff ----------

export interface CaptureDiffArgs {
  worktreePath: string;
  baseBranch: string;
  patchPath: string;
  maxBytes?: number;
}

export interface CaptureDiffResult {
  stat: DiffStat;
  bytes: number;
  truncated: boolean;
}

const DEFAULT_DIFF_MAX_BYTES = 1024 * 1024;

// Last line of `git diff --stat` is e.g. " 3 files changed, 10 insertions(+), 3 deletions(-)".
// Either insertions or deletions may be absent (pure deletes / pure inserts).
const STAT_RE =
  /(\d+)\s+files?\s+changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?/;

export function parseDiffStatLine(output: string): DiffStat {
  const trimmed = output.trimEnd();
  if (trimmed.length === 0) return { files: 0, insertions: 0, deletions: 0 };
  const lines = trimmed.split("\n");
  const last = lines[lines.length - 1] ?? "";
  const m = STAT_RE.exec(last);
  if (!m) return { files: 0, insertions: 0, deletions: 0 };
  return {
    files: Number.parseInt(m[1] ?? "0", 10),
    insertions: Number.parseInt(m[2] ?? "0", 10),
    deletions: Number.parseInt(m[3] ?? "0", 10),
  };
}

export async function captureDiff(args: CaptureDiffArgs): Promise<CaptureDiffResult> {
  const { worktreePath, baseBranch, patchPath } = args;
  const maxBytes = args.maxBytes ?? DEFAULT_DIFF_MAX_BYTES;

  let statText: string;
  try {
    const r = await git(worktreePath, ["diff", "--stat", `${baseBranch}..HEAD`]);
    statText = r.stdout;
  } catch (e) {
    const stderr = errStderr(e);
    throw new GitError("DIFF_FAILED", `git diff --stat failed: ${stderr.trim() || String(e)}`, stderr);
  }

  const stat = parseDiffStatLine(statText);
  if (stat.files === 0) {
    return { stat, bytes: 0, truncated: false };
  }

  await mkdir(dirname(patchPath), { recursive: true });
  const result = await writeFullDiff(worktreePath, baseBranch, patchPath, maxBytes);
  return { stat, bytes: result.bytes, truncated: result.truncated };
}

async function writeFullDiff(
  cwd: string,
  baseBranch: string,
  outPath: string,
  maxBytes: number,
): Promise<{ bytes: number; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["diff", `${baseBranch}..HEAD`], { cwd });
    const out = createWriteStream(outPath);
    let bytes = 0;
    let truncated = false;
    let stderrBuf = "";
    let killed = false;

    out.on("error", (err) => {
      if (!child.killed) child.kill("SIGTERM");
      reject(new GitError("DIFF_FAILED", `failed to write patch: ${err.message}`));
    });

    child.stderr.on("data", (b: Buffer) => {
      stderrBuf += b.toString("utf8");
    });

    child.stdout.on("data", (chunk: Buffer) => {
      if (truncated) return;
      const remaining = maxBytes - bytes;
      if (chunk.length <= remaining) {
        out.write(chunk);
        bytes += chunk.length;
      } else {
        if (remaining > 0) {
          out.write(chunk.subarray(0, remaining));
          bytes += remaining;
        }
        truncated = true;
        out.write(`\n*** truncated at ${maxBytes} bytes ***\n`);
        killed = true;
        child.kill("SIGTERM");
      }
    });

    child.on("error", (err) => {
      out.destroy();
      reject(new GitError("DIFF_FAILED", `git diff spawn failed: ${err.message}`));
    });

    child.on("close", (code, signal) => {
      out.end(() => {
        if (!truncated && code !== 0 && !(killed && signal !== null)) {
          unlink(outPath).catch(() => {});
          reject(
            new GitError(
              "DIFF_FAILED",
              `git diff exited ${code ?? "?"}: ${stderrBuf.trim() || "(no stderr)"}`,
              stderrBuf,
            ),
          );
          return;
        }
        fsStat(outPath)
          .then((s) => resolve({ bytes: s.size, truncated }))
          .catch((e) => reject(new GitError("DIFF_FAILED", `stat patch failed: ${(e as Error).message}`)));
      });
    });
  });
}

function errStderr(e: unknown): string {
  if (e && typeof e === "object" && "stderr" in e) {
    const v = (e as { stderr?: unknown }).stderr;
    if (typeof v === "string") return v;
    if (v instanceof Buffer) return v.toString("utf8");
  }
  return e instanceof Error ? e.message : String(e);
}
