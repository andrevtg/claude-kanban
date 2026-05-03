// Asserts that main() retains the worktree on disk after a run terminates
// — for both success (exit 0) and SDK-error (exit non-zero) paths. Locks
// in the contract documented in docs/01-architecture.md "Failure modes".

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { main, type RunAgentFn } from "./index.js";
import { branchNameForRun, cleanupWorktree } from "./git.js";
import type { RunInitPayload, WireMessage } from "../protocol/messages.js";

const execFileAsync = promisify(execFile);

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ck-worker-main-"));
  await execFileAsync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  await execFileAsync("git", ["config", "user.email", "t@example.com"], { cwd: dir });
  await execFileAsync("git", ["config", "user.name", "Test"], { cwd: dir });
  await execFileAsync("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
  await writeFile(join(dir, "README.md"), "# fixture\n", "utf8");
  await execFileAsync("git", ["add", "."], { cwd: dir });
  await execFileAsync("git", ["commit", "-q", "-m", "initial"], { cwd: dir });
  return dir;
}

interface Harness {
  repoPath: string;
  scratch: string;
  worktreePath: string;
  branchName: string;
  init: RunInitPayload;
  collected: WireMessage[];
  send: (m: WireMessage) => void;
  input: Readable;
  cleanup: () => Promise<void>;
}

async function setupHarness(runId: string): Promise<Harness> {
  const repoPath = await makeRepo();
  const scratch = await mkdtemp(join(tmpdir(), "ck-worker-main-wt-"));
  const worktreePath = join(scratch, runId);
  const branchName = branchNameForRun(runId);
  const init: RunInitPayload = {
    runId,
    cardId: `card_${runId}`,
    prompt: "noop",
    repoPath,
    baseBranch: "main",
    worktreePath,
    branchName,
    model: "claude-opus-4-7",
    allowedTools: ["Read"],
    bashAllowlist: [],
    maxTurns: 1,
    diffPath: join(scratch, `${runId}.patch`),
  };
  const collected: WireMessage[] = [];
  const send = (m: WireMessage): void => {
    collected.push(m);
  };
  const input = Readable.from([`${JSON.stringify({ type: "init", run: init })}\n`]);
  const cleanup = async (): Promise<void> => {
    await cleanupWorktree(repoPath, worktreePath);
    await rm(repoPath, { recursive: true, force: true });
    await rm(scratch, { recursive: true, force: true });
  };
  return { repoPath, scratch, worktreePath, branchName, init, collected, send, input, cleanup };
}

async function branchExists(repoPath: string, branchName: string): Promise<boolean> {
  const { stdout } = await execFileAsync(
    "git",
    ["branch", "--list", branchName],
    { cwd: repoPath },
  );
  return stdout.trim().length > 0;
}

describe("worker main()", () => {
  it("retains the worktree directory and branch after a successful run", async () => {
    const h = await setupHarness("run_maintest_ok");
    try {
      const fakeRun: RunAgentFn = async () => ({ exitCode: 0 });
      const code = await main(h.send, fakeRun, h.input);
      assert.equal(code, 0);

      const s = await stat(h.worktreePath);
      assert.ok(s.isDirectory(), "worktree directory should still exist");
      const readme = await stat(join(h.worktreePath, "README.md"));
      assert.ok(readme.isFile(), "worktree contents should still exist");
      assert.equal(await branchExists(h.repoPath, h.branchName), true);

      const retained = h.collected.some(
        (m) =>
          m.type === "event" &&
          m.event.kind === "worker" &&
          m.event.message.includes("worktree retained"),
      );
      assert.ok(retained, "expected worker event announcing retention");
    } finally {
      await h.cleanup();
    }
  });

  it("retains the worktree even when the SDK exits non-zero", async () => {
    const h = await setupHarness("run_maintest_err");
    try {
      const fakeRun: RunAgentFn = async () => ({ exitCode: 1 });
      const code = await main(h.send, fakeRun, h.input);
      assert.equal(code, 1);

      const s = await stat(h.worktreePath);
      assert.ok(s.isDirectory());
      assert.equal(await branchExists(h.repoPath, h.branchName), true);
    } finally {
      await h.cleanup();
    }
  });
});
