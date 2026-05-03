// Round-trip and rejection tests for the wire protocol.
// Run with: pnpm test:protocol

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  encodeWireMessage,
  parseWireMessage,
  type SDKMessage,
  type WireMessage,
} from "./messages.js";

const samples: WireMessage[] = [
  {
    type: "init",
    run: {
      runId: "run_01HABC",
      cardId: "card_01HXYZ",
      prompt: "summarize the README",
      repoPath: "/tmp/repo",
      baseBranch: "main",
      worktreePath: "/tmp/work/run_01HABC",
      branchName: "claude-kanban/run_01HABC",
      model: "claude-opus-4-7",
      allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
      bashAllowlist: ["git status", "ls"],
      maxTurns: 250,
      diffPath: "/tmp/diffs/run_01HABC.patch",
    },
  },
  {
    type: "init",
    run: {
      runId: "run_01HABC",
      cardId: "card_01HXYZ",
      prompt: "with timeout",
      repoPath: "/tmp/repo",
      baseBranch: "main",
      worktreePath: "/tmp/work/run_01HABC",
      branchName: "claude-kanban/run_01HABC",
      model: "claude-opus-4-7",
      allowedTools: ["Read"],
      bashAllowlist: [],
      maxTurns: 10,
      diffPath: "/tmp/diffs/run_01HABC.patch",
      approveTimeoutMs: 60_000,
    },
  },
  { type: "approve_pr", title: "Fix auth", body: "details" },
  { type: "cancel" },
  { type: "ready" },
  // The test only round-trips JSON; faking a full SDKMessage variant would
  // duplicate the SDK type. Cast through unknown for this fixture.
  {
    type: "event",
    event: {
      kind: "sdk",
      message: { type: "system", subtype: "init", session_id: "s" } as unknown as SDKMessage,
    },
  },
  {
    type: "event",
    event: { kind: "worker", level: "info", message: "worktree created" },
  },
  {
    type: "diff_ready",
    stat: { files: 2, insertions: 10, deletions: 3 },
    patchPath: "/tmp/diffs/run_01HABC.patch",
    truncated: false,
    bytes: 1234,
  },
  {
    type: "diff_ready",
    stat: { files: 0, insertions: 0, deletions: 0 },
    patchPath: "",
    truncated: false,
    bytes: 0,
  },
  {
    type: "diff_ready",
    stat: { files: 5, insertions: 999, deletions: 999 },
    patchPath: "/tmp/diffs/run_BIG.patch",
    truncated: true,
    bytes: 1048576,
  },
  { type: "pr_opened", url: "https://github.com/o/r/pull/1" },
  { type: "error", code: "GH_NOT_FOUND", message: "gh not installed" },
  { type: "error", code: "GH_MISSING", message: "gh binary not found" },
  { type: "error", code: "GH_UNAUTH", message: "gh auth status failed" },
  { type: "error", code: "PUSH_FAILED", message: "git push rejected" },
  { type: "error", code: "PR_CREATE_FAILED", message: "gh pr create failed" },
  { type: "error", code: "PR_URL_MISSING", message: "gh pr create produced no url" },
  { type: "done", exitCode: 0 },
];

describe("WireMessage round-trip", () => {
  for (const msg of samples) {
    it(`round-trips ${msg.type}`, () => {
      const encoded = encodeWireMessage(msg);
      const parsed = parseWireMessage(encoded);
      assert.equal(parsed.ok, true);
      if (parsed.ok) {
        assert.deepStrictEqual(parsed.value, msg);
      }
    });
  }
});

describe("parseWireMessage rejection", () => {
  it("rejects invalid JSON without throwing", () => {
    const r = parseWireMessage("{not json");
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.kind, "invalid_json");
  });

  it("rejects unknown discriminant", () => {
    const r = parseWireMessage(JSON.stringify({ type: "nope" }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.kind, "schema_mismatch");
  });

  it("rejects missing required fields", () => {
    const r = parseWireMessage(JSON.stringify({ type: "error" }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.kind, "schema_mismatch");
  });

  it("rejects wrong type for nested field", () => {
    const r = parseWireMessage(JSON.stringify({ type: "diff_ready", stat: { files: "x" } }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.kind, "schema_mismatch");
  });
});
