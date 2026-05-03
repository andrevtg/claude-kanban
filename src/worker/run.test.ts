// Integration smoke test for runAgent. Skipped unless RUN_LIVE_SDK_TESTS=1
// is set, since it talks to the real Claude API and costs money.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgent } from "./run.js";
import { branchNameForRun, cleanupWorktree, createWorktree } from "./git.js";
import type { RunInitPayload, WireMessage } from "../protocol/messages.js";

const execFileAsync = promisify(execFile);
const live = process.env.RUN_LIVE_SDK_TESTS === "1";

describe("runAgent (live SDK)", { skip: !live }, () => {
  it("emits at least one assistant message and a result", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "ck-worker-live-"));
    const scratch = await mkdtemp(join(tmpdir(), "ck-worker-live-wt-"));
    try {
      await execFileAsync("git", ["init", "-q", "-b", "main"], { cwd: repoPath });
      await execFileAsync("git", ["config", "user.email", "t@example.com"], { cwd: repoPath });
      await execFileAsync("git", ["config", "user.name", "Test"], { cwd: repoPath });
      await execFileAsync("git", ["config", "commit.gpgsign", "false"], { cwd: repoPath });
      await writeFile(join(repoPath, "README.md"), "# fixture\nhello world\n", "utf8");
      await execFileAsync("git", ["add", "."], { cwd: repoPath });
      await execFileAsync("git", ["commit", "-q", "-m", "initial"], { cwd: repoPath });

      const runId = "run_livesmoke";
      const worktreePath = join(scratch, runId);
      const branchName = branchNameForRun(runId);
      await createWorktree({ repoPath, baseBranch: "main", worktreePath, branchName });

      const init: RunInitPayload = {
        runId,
        cardId: "card_livesmoke",
        prompt: "Reply with the single word: pong",
        repoPath,
        baseBranch: "main",
        worktreePath,
        branchName,
        model: "claude-opus-4-7",
        allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
        bashAllowlist: [],
        maxTurns: 4,
        diffPath: join(scratch, `${runId}.patch`),
      };

      const collected: WireMessage[] = [];
      const send = (m: WireMessage): void => {
        collected.push(m);
      };

      const { exitCode } = await runAgent(init, send);
      assert.equal(exitCode, 0);

      const sdkMsgs = collected.flatMap((m) =>
        m.type === "event" && m.event.kind === "sdk" ? [m.event.message] : [],
      );
      const hasAssistant = sdkMsgs.some(
        (m) => (m as { type?: string }).type === "assistant",
      );
      const hasResult = sdkMsgs.some((m) => (m as { type?: string }).type === "result");
      assert.ok(hasAssistant, "expected at least one assistant message");
      assert.ok(hasResult, "expected a result message");

      await cleanupWorktree(repoPath, worktreePath);
    } finally {
      await rm(repoPath, { recursive: true, force: true });
      await rm(scratch, { recursive: true, force: true });
    }
  });
});
