// createWorktree against a real git repo. Each test gets a fresh tmp repo
// with one commit on the configured base branch.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  branchNameForRun,
  cleanupWorktree,
  createWorktree,
  GitError,
} from "./git.js";

const execFileAsync = promisify(execFile);

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ck-worker-git-"));
  await execFileAsync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  await execFileAsync("git", ["config", "user.email", "t@example.com"], { cwd: dir });
  await execFileAsync("git", ["config", "user.name", "Test"], { cwd: dir });
  await execFileAsync("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
  await writeFile(join(dir, "README.md"), "# test\n", "utf8");
  await execFileAsync("git", ["add", "."], { cwd: dir });
  await execFileAsync("git", ["commit", "-q", "-m", "initial"], { cwd: dir });
  return dir;
}

describe("createWorktree", () => {
  let repoPath = "";
  let scratch = "";
  before(async () => {
    repoPath = await makeRepo();
    scratch = await mkdtemp(join(tmpdir(), "ck-worker-wt-"));
  });
  after(async () => {
    await rm(repoPath, { recursive: true, force: true });
    await rm(scratch, { recursive: true, force: true });
  });

  it("creates a worktree on a new branch off the base", async () => {
    const runId = "run_test01";
    const branchName = branchNameForRun(runId);
    const worktreePath = join(scratch, runId);
    const r = await createWorktree({
      repoPath,
      baseBranch: "main",
      worktreePath,
      branchName,
    });
    assert.equal(r.worktreePath, worktreePath);
    assert.equal(r.branchName, branchName);
    const s = await stat(join(worktreePath, "README.md"));
    assert.ok(s.isFile());

    const cleaned = await cleanupWorktree(repoPath, worktreePath);
    assert.equal(cleaned.ok, true);
  });

  it("throws BASE_BRANCH_MISSING when base branch does not exist", async () => {
    const worktreePath = join(scratch, "run_missing");
    await assert.rejects(
      createWorktree({
        repoPath,
        baseBranch: "no-such-branch",
        worktreePath,
        branchName: "claude-kanban/run_missing",
      }),
      (e: unknown) => e instanceof GitError && e.code === "BASE_BRANCH_MISSING",
    );
  });

  it("throws REPO_NOT_FOUND for a non-git directory", async () => {
    const notRepo = await mkdtemp(join(tmpdir(), "ck-worker-notrepo-"));
    try {
      await assert.rejects(
        createWorktree({
          repoPath: notRepo,
          baseBranch: "main",
          worktreePath: join(scratch, "run_notrepo"),
          branchName: "claude-kanban/run_notrepo",
        }),
        (e: unknown) => e instanceof GitError && e.code === "REPO_NOT_FOUND",
      );
    } finally {
      await rm(notRepo, { recursive: true, force: true });
    }
  });
});

describe("cleanupWorktree", () => {
  it("returns ok even when the worktree is already gone", async () => {
    const repoPath = await makeRepo();
    try {
      const ghost = join(repoPath, ".not-a-worktree");
      const r = await cleanupWorktree(repoPath, ghost);
      assert.equal(r.ok, true);
    } finally {
      await rm(repoPath, { recursive: true, force: true });
    }
  });
});
