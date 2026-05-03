// Supervisor-side `gh` pre-flight. Re-implemented (rather than imported from
// src/worker/pr.ts) because the worker/lib boundary forbids cross-imports
// (CLAUDE.md hard rule). Both implementations shell out to `gh --version`
// and `gh auth status`; the parse logic is duplicated by convention. See
// phase-4/task-02 for the rationale (alternative was putting side-effecting
// shell calls in src/protocol/, which would mix protocol with execution).

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GhStatus =
  | { state: "ok"; version: string; account: string }
  | { state: "missing" }
  | { state: "unauthenticated"; message: string };

export interface CheckGhDeps {
  exec?: typeof execFileAsync;
}

export async function checkGh(deps: CheckGhDeps = {}): Promise<GhStatus> {
  const exec = deps.exec ?? execFileAsync;

  let version: string;
  try {
    const { stdout } = await exec("gh", ["--version"]);
    version = parseGhVersion(stdout);
  } catch (e) {
    if (isEnoent(e)) return { state: "missing" };
    return {
      state: "unauthenticated",
      message: `gh --version failed: ${errMessage(e)}`,
    };
  }

  try {
    await exec("gh", ["auth", "status"]);
  } catch (e) {
    if (isEnoent(e)) return { state: "missing" };
    const stderr = errStderr(e);
    return {
      state: "unauthenticated",
      message: stderr.trim() || errMessage(e),
    };
  }

  let account = "";
  try {
    const { stdout } = await exec("gh", ["api", "user", "-q", ".login"]);
    account = stdout.trim();
  } catch {
    account = "";
  }

  return { state: "ok", version, account };
}

export function parseGhVersion(stdout: string): string {
  const m = /gh version\s+(\S+)/.exec(stdout);
  return m?.[1] ?? stdout.trim().split("\n")[0] ?? "";
}

function isEnoent(e: unknown): boolean {
  return (
    e !== null &&
    typeof e === "object" &&
    "code" in e &&
    (e as { code?: unknown }).code === "ENOENT"
  );
}

function errStderr(e: unknown): string {
  if (e !== null && typeof e === "object" && "stderr" in e) {
    const v = (e as { stderr?: unknown }).stderr;
    if (typeof v === "string") return v;
    if (v instanceof Buffer) return v.toString("utf8");
  }
  return "";
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
