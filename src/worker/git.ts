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

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { rm } from "node:fs/promises";

const execFileAsync = promisify(execFile);

export type GitErrorCode =
  | "REPO_NOT_FOUND"
  | "BASE_BRANCH_MISSING"
  | "REPO_DIRTY"
  | "WORKTREE_FAILED";

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

function errStderr(e: unknown): string {
  if (e && typeof e === "object" && "stderr" in e) {
    const v = (e as { stderr?: unknown }).stderr;
    if (typeof v === "string") return v;
    if (v instanceof Buffer) return v.toString("utf8");
  }
  return e instanceof Error ? e.message : String(e);
}
