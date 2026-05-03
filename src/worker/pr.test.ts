// Unit tests for pr.ts. Stubs the spawn surface via the `run` deps seam so no
// real `git` or `gh` calls happen.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checkGh,
  extractPrUrl,
  openPr,
  parseGhVersion,
  type OpenPrArgs,
  type RunFn,
  type RunResult,
} from "./pr.js";

interface Step {
  match: (file: string, args: readonly string[]) => boolean;
  result: RunResult;
}

function makeRun(steps: Step[]): {
  run: RunFn;
  calls: Array<{ file: string; args: readonly string[] }>;
} {
  const calls: Array<{ file: string; args: readonly string[] }> = [];
  let i = 0;
  const run: RunFn = async (file, args) => {
    calls.push({ file, args });
    const step = steps[i++];
    if (!step) throw new Error(`unexpected exec call ${i}: ${file} ${args.join(" ")}`);
    if (!step.match(file, args)) {
      throw new Error(`step ${i} mismatch: got ${file} ${args.join(" ")}`);
    }
    return step.result;
  };
  return { run, calls };
}

const ARGS: OpenPrArgs = {
  worktreePath: "/tmp/wt",
  baseBranch: "main",
  branchName: "claude-kanban/run_test",
  remote: "origin",
  title: "feat: x",
  body: "details",
};

function ok(stdout = ""): RunResult {
  return { ok: true, code: 0, signal: null, stdout, stderr: "" };
}
function fail(stderr: string, code = 1): RunResult {
  return { ok: false, code, signal: null, stdout: "", stderr };
}
function enoent(): RunResult {
  const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" }) as NodeJS.ErrnoException;
  return { ok: false, code: null, signal: null, stdout: "", stderr: "", spawnError: err };
}

describe("parseGhVersion", () => {
  it("extracts the version number", () => {
    assert.equal(parseGhVersion("gh version 2.55.0 (2024-09-09)\n"), "2.55.0");
  });
  it("falls back to the first line", () => {
    assert.equal(parseGhVersion("custom build\n"), "custom build");
  });
});

describe("extractPrUrl", () => {
  it("finds the URL among surrounding noise", () => {
    const out = "Creating pull request...\nhttps://github.com/o/r/pull/42\n";
    assert.equal(extractPrUrl(out), "https://github.com/o/r/pull/42");
  });
  it("returns null when stdout is empty", () => {
    assert.equal(extractPrUrl(""), null);
  });
  it("returns null when no URL line is present", () => {
    assert.equal(extractPrUrl("done\n"), null);
  });
});

describe("checkGh", () => {
  it("returns ok with version + account on success", async () => {
    const { run } = makeRun([
      { match: (_f, a) => a[0] === "--version", result: ok("gh version 2.55.0\n") },
      { match: (_f, a) => a[0] === "auth" && a[1] === "status", result: ok("logged in") },
      { match: (_f, a) => a[0] === "api", result: ok("octocat\n") },
    ]);
    const status = await checkGh({ run });
    assert.deepEqual(status, { state: "ok", version: "2.55.0", account: "octocat" });
  });

  it("returns missing when gh binary is not on PATH", async () => {
    const { run } = makeRun([{ match: () => true, result: enoent() }]);
    assert.deepEqual(await checkGh({ run }), { state: "missing" });
  });

  it("returns unauthenticated when gh auth status fails", async () => {
    const { run } = makeRun([
      { match: (_f, a) => a[0] === "--version", result: ok("gh version 2.55.0\n") },
      {
        match: (_f, a) => a[0] === "auth",
        result: fail("You are not logged into any GitHub hosts.\n"),
      },
    ]);
    const status = await checkGh({ run });
    assert.equal(status.state, "unauthenticated");
    if (status.state === "unauthenticated") {
      assert.match(status.message, /not logged in/i);
    }
  });
});

describe("openPr", () => {
  it("returns ok with the PR URL on the happy path", async () => {
    const { run, calls } = makeRun([
      { match: (f, a) => f === "git" && a.includes("push"), result: ok("") },
      {
        match: (f, a) => f === "gh" && a[0] === "pr",
        result: ok("https://github.com/o/r/pull/1\n"),
      },
    ]);
    const result = await openPr(ARGS, { run });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.url, "https://github.com/o/r/pull/1");
    assert.equal(calls.length, 2);
  });

  it("returns PUSH_FAILED with stderr when push is rejected", async () => {
    const { run } = makeRun([
      {
        match: (f) => f === "git",
        result: fail("remote: error: forbidden\nfatal: unable to access\n"),
      },
    ]);
    const result = await openPr(ARGS, { run });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "PUSH_FAILED");
      assert.match(result.stderr ?? "", /forbidden/);
    }
  });

  it("returns PUSH_FAILED when git is missing (ENOENT)", async () => {
    const { run } = makeRun([{ match: (f) => f === "git", result: enoent() }]);
    const result = await openPr(ARGS, { run });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "PUSH_FAILED");
      assert.match(result.message, /git executable not found/);
    }
  });

  it("returns GH_MISSING when gh is missing after a successful push", async () => {
    const { run } = makeRun([
      { match: (f) => f === "git", result: ok("") },
      { match: (f) => f === "gh", result: enoent() },
    ]);
    const result = await openPr(ARGS, { run });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "GH_MISSING");
  });

  it("returns GH_UNAUTH when gh stderr signals an auth issue", async () => {
    const { run } = makeRun([
      { match: (f) => f === "git", result: ok("") },
      {
        match: (f) => f === "gh",
        result: fail("error: not logged in to any GitHub host\n"),
      },
    ]);
    const result = await openPr(ARGS, { run });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "GH_UNAUTH");
      assert.match(result.stderr ?? "", /not logged in/);
    }
  });

  it("returns PR_CREATE_FAILED on a generic gh failure", async () => {
    const { run } = makeRun([
      { match: (f) => f === "git", result: ok("") },
      { match: (f) => f === "gh", result: fail("HTTP 422 Unprocessable Entity") },
    ]);
    const result = await openPr(ARGS, { run });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "PR_CREATE_FAILED");
  });

  it("returns PR_URL_MISSING when gh succeeds but stdout has no URL", async () => {
    const { run } = makeRun([
      { match: (f) => f === "git", result: ok("") },
      { match: (f) => f === "gh", result: ok("") },
    ]);
    const result = await openPr(ARGS, { run });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "PR_URL_MISSING");
  });
});
