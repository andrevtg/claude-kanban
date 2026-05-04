// Integration smoke test for runAgent. Skipped unless RUN_LIVE_SDK_TESTS=1
// is set, since it talks to the real Claude API and costs money.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { query } from "@anthropic-ai/claude-agent-sdk";
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
        tracePath: join(scratch, `${runId}.jsonl`),
        loadSkills: false,
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
      const hasAssistant = sdkMsgs.some((m) => (m as { type?: string }).type === "assistant");
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

// ---------- skills opt-in (non-live) ----------
//
// Uses a fake queryFn to capture the options the SDK would have received,
// so we can assert settingSources / allowedTools for both loadSkills states.

type CapturedOptions = {
  cwd?: string;
  settingSources?: ReadonlyArray<string>;
  allowedTools?: ReadonlyArray<string>;
};

function fakeQueryCapture(): {
  queryFn: typeof query;
  captured: { args?: { prompt: unknown; options: CapturedOptions } };
} {
  const captured: { args?: { prompt: unknown; options: CapturedOptions } } = {};
  async function* gen(): AsyncGenerator<unknown, void> {
    // immediately done
  }
  const queryFn = ((args: { prompt: unknown; options: CapturedOptions }) => {
    captured.args = args;
    const iter = gen();
    return Object.assign(iter, {
      interrupt: async () => {},
      setPermissionMode: async () => {},
      setModel: async () => {},
      supportedCommands: async () => [],
      supportedModels: async () => [],
      mcpServerStatus: async () => [],
      setSettingSources: async () => {},
    });
  }) as unknown as typeof query;
  return { queryFn, captured };
}

function baseInit(): RunInitPayload {
  return {
    runId: "run_skillstest",
    cardId: "card_skillstest",
    prompt: "noop",
    repoPath: "/tmp/repo",
    baseBranch: "main",
    worktreePath: "/tmp/wt",
    branchName: "claude-kanban/run_skillstest",
    model: "claude-opus-4-7",
    allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
    bashAllowlist: [],
    maxTurns: 1,
    diffPath: "/tmp/diffs/run.patch",
    tracePath: "/tmp/traces/run.jsonl",
    loadSkills: false,
  };
}

describe("runAgent loadSkills option wiring", () => {
  it("loadSkills: false → settingSources [] and allowedTools unchanged", async () => {
    const { queryFn, captured } = fakeQueryCapture();
    const collected: WireMessage[] = [];
    const { exitCode } = await runAgent(baseInit(), (m) => collected.push(m), Readable.from([]), {
      queryFn,
      cancel: new AbortController().signal,
    });
    assert.equal(exitCode, 0);
    assert.deepStrictEqual(captured.args?.options.settingSources, []);
    assert.deepStrictEqual(captured.args?.options.allowedTools, [
      "Read",
      "Write",
      "Edit",
      "Glob",
      "Grep",
      "Bash",
    ]);
    const info = collected.find(
      (m) =>
        m.type === "event" &&
        m.event.kind === "worker" &&
        m.event.message.startsWith("skills loading disabled"),
    );
    assert.ok(info, "expected disabled-skills info event");
  });

  it("loadSkills: true → settingSources ['project'] and Skill in allowedTools", async () => {
    const { queryFn, captured } = fakeQueryCapture();
    const collected: WireMessage[] = [];
    const init = { ...baseInit(), loadSkills: true };
    const { exitCode } = await runAgent(init, (m) => collected.push(m), Readable.from([]), {
      queryFn,
      cancel: new AbortController().signal,
    });
    assert.equal(exitCode, 0);
    assert.deepStrictEqual(captured.args?.options.settingSources, ["project"]);
    assert.ok(captured.args?.options.allowedTools?.includes("Skill"));
    // de-dup: passing Skill in init.allowedTools should not produce duplicates.
    const init2 = {
      ...baseInit(),
      loadSkills: true,
      allowedTools: ["Read", "Skill"],
    };
    const cap2 = fakeQueryCapture();
    await runAgent(init2, () => {}, Readable.from([]), {
      queryFn: cap2.queryFn,
      cancel: new AbortController().signal,
    });
    const tools = cap2.captured.args?.options.allowedTools ?? [];
    assert.equal(tools.filter((t) => t === "Skill").length, 1);

    const info = collected.find(
      (m) =>
        m.type === "event" &&
        m.event.kind === "worker" &&
        m.event.message.startsWith("skills loading enabled"),
    );
    assert.ok(info, "expected enabled-skills info event");
  });
});
