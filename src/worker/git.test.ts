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
  captureDiff,
  cleanupWorktree,
  createWorktree,
  GitError,
  parseDiffStatLine,
} from "./git.js";
import { readFile } from "node:fs/promises";

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

describe("parseDiffStatLine", () => {
  it("returns zeros for empty output", () => {
    assert.deepStrictEqual(parseDiffStatLine(""), { files: 0, insertions: 0, deletions: 0 });
  });
  it("parses a typical mixed line", () => {
    const out =
      " a.txt | 2 +-\n b.txt | 1 +\n 2 files changed, 2 insertions(+), 1 deletion(-)\n";
    assert.deepStrictEqual(parseDiffStatLine(out), {
      files: 2,
      insertions: 2,
      deletions: 1,
    });
  });
  it("parses pure insertions", () => {
    const out = " a.txt | 5 +++++\n 1 file changed, 5 insertions(+)\n";
    assert.deepStrictEqual(parseDiffStatLine(out), { files: 1, insertions: 5, deletions: 0 });
  });
});

describe("captureDiff", () => {
  let repoPath = "";
  let scratch = "";
  before(async () => {
    repoPath = await makeRepo();
    scratch = await mkdtemp(join(tmpdir(), "ck-diff-"));
  });
  after(async () => {
    await rm(repoPath, { recursive: true, force: true });
    await rm(scratch, { recursive: true, force: true });
  });

  async function freshWorktree(name: string): Promise<string> {
    const wt = join(scratch, name);
    await createWorktree({
      repoPath,
      baseBranch: "main",
      worktreePath: wt,
      branchName: `claude-kanban/${name}`,
    });
    await execFileAsync("git", ["config", "user.email", "t@example.com"], { cwd: wt });
    await execFileAsync("git", ["config", "user.name", "Test"], { cwd: wt });
    await execFileAsync("git", ["config", "commit.gpgsign", "false"], { cwd: wt });
    return wt;
  }

  it("returns zero stat for an empty diff and writes no patch file", async () => {
    const wt = await freshWorktree("run_empty");
    const patchPath = join(scratch, "run_empty.patch");
    const r = await captureDiff({ worktreePath: wt, baseBranch: "main", patchPath });
    assert.deepStrictEqual(r.stat, { files: 0, insertions: 0, deletions: 0 });
    assert.equal(r.bytes, 0);
    assert.equal(r.truncated, false);
    await assert.rejects(readFile(patchPath));
  });

  it("captures a single-file diff", async () => {
    const wt = await freshWorktree("run_one");
    await writeFile(join(wt, "new.txt"), "hello\nworld\n", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: wt });
    await execFileAsync("git", ["commit", "-q", "-m", "add new.txt"], { cwd: wt });
    const patchPath = join(scratch, "run_one.patch");
    const r = await captureDiff({ worktreePath: wt, baseBranch: "main", patchPath });
    assert.equal(r.stat.files, 1);
    assert.equal(r.stat.insertions, 2);
    assert.equal(r.stat.deletions, 0);
    assert.equal(r.truncated, false);
    const patch = await readFile(patchPath, "utf8");
    assert.match(patch, /\+hello/);
    assert.match(patch, /\+world/);
  });

  it("captures a multi-file diff with a rename", async () => {
    const wt = await freshWorktree("run_multi");
    // edit existing README, rename README->README.txt? simpler: create a then rename.
    await writeFile(join(wt, "a.txt"), "alpha\n", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: wt });
    await execFileAsync("git", ["commit", "-q", "-m", "add a"], { cwd: wt });
    await execFileAsync("git", ["mv", "a.txt", "b.txt"], { cwd: wt });
    await writeFile(join(wt, "README.md"), "# test\nmore\n", "utf8");
    await execFileAsync("git", ["add", "-A"], { cwd: wt });
    await execFileAsync("git", ["commit", "-q", "-m", "rename + edit"], { cwd: wt });
    const patchPath = join(scratch, "run_multi.patch");
    const r = await captureDiff({ worktreePath: wt, baseBranch: "main", patchPath });
    assert.ok(r.stat.files >= 2, `expected >=2 files, got ${r.stat.files}`);
    const patch = await readFile(patchPath, "utf8");
    assert.match(patch, /b\.txt/);
    assert.match(patch, /README\.md/);
  });

  it("truncates diffs larger than maxBytes and appends a sentinel", async () => {
    const wt = await freshWorktree("run_big");
    const big = "x".repeat(50_000);
    await writeFile(join(wt, "big.txt"), `${big}\n`, "utf8");
    await execFileAsync("git", ["add", "."], { cwd: wt });
    await execFileAsync("git", ["commit", "-q", "-m", "big"], { cwd: wt });
    const patchPath = join(scratch, "run_big.patch");
    const r = await captureDiff({
      worktreePath: wt,
      baseBranch: "main",
      patchPath,
      maxBytes: 1024,
    });
    assert.equal(r.truncated, true);
    const patch = await readFile(patchPath, "utf8");
    assert.match(patch, /\*\*\* truncated at 1024 bytes \*\*\*/);
  });

  it("throws DIFF_FAILED when base branch is missing", async () => {
    const wt = await freshWorktree("run_missing_base");
    const patchPath = join(scratch, "run_missing_base.patch");
    await assert.rejects(
      captureDiff({ worktreePath: wt, baseBranch: "no-such-ref", patchPath }),
      (e: unknown) => e instanceof GitError && e.code === "DIFF_FAILED",
    );
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
