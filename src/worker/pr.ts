// PR creation flow for a finished run. Called from the worker's post-SDK
// approval window after the user clicks "Open PR" in the drawer.
//
// Two responsibilities, both worker-side because the worker is the only
// process allowed to shell out for run-bound side effects:
//   1. checkGh()  — pre-flight `gh --version` and `gh auth status`.
//   2. openPr()   — `git push -u <remote> <branch>` then `gh pr create`.
//
// Note: src/lib/gh/preflight.ts re-implements `checkGh()` because the
// worker/lib boundary forbids cross-imports (CLAUDE.md hard rule). The two
// implementations share the same parse logic by convention only; both shell
// out to `gh` and follow the same `GhStatus` shape.

import { spawn } from "node:child_process";

export type GhStatus =
  | { state: "ok"; version: string; account: string }
  | { state: "missing" }
  | { state: "unauthenticated"; message: string };

export interface RunOpts {
  cwd?: string;
  stdin?: string;
}

export interface RunResult {
  ok: boolean;
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  // ENOENT etc — set when spawn itself failed.
  spawnError?: NodeJS.ErrnoException;
}

export type RunFn = (file: string, args: readonly string[], opts?: RunOpts) => Promise<RunResult>;

export const defaultRun: RunFn = (file, args, opts = {}) =>
  new Promise<RunResult>((resolve) => {
    const child = spawn(file, args as string[], {
      cwd: opts.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let spawnError: NodeJS.ErrnoException | undefined;

    child.stdout.on("data", (b: Buffer) => {
      stdout += b.toString("utf8");
    });
    child.stderr.on("data", (b: Buffer) => {
      stderr += b.toString("utf8");
    });
    child.on("error", (err) => {
      spawnError = err as NodeJS.ErrnoException;
    });
    child.on("close", (code, signal) => {
      const result: RunResult = {
        ok: !spawnError && code === 0,
        code,
        signal,
        stdout,
        stderr,
      };
      if (spawnError) result.spawnError = spawnError;
      resolve(result);
    });

    if (opts.stdin !== undefined) {
      child.stdin.end(opts.stdin);
    } else {
      child.stdin.end();
    }
  });

// ---------- checkGh ----------

export interface CheckGhDeps {
  run?: RunFn;
}

export async function checkGh(deps: CheckGhDeps = {}): Promise<GhStatus> {
  const run = deps.run ?? defaultRun;

  const versionResult = await run("gh", ["--version"]);
  if (isEnoent(versionResult)) return { state: "missing" };
  if (!versionResult.ok) {
    return {
      state: "unauthenticated",
      message: `gh --version failed: ${versionResult.stderr.trim() || `exit ${versionResult.code}`}`,
    };
  }
  const version = parseGhVersion(versionResult.stdout);

  const auth = await run("gh", ["auth", "status"]);
  if (isEnoent(auth)) return { state: "missing" };
  if (!auth.ok) {
    return {
      state: "unauthenticated",
      message: (auth.stderr || auth.stdout).trim() || `gh auth status exited ${auth.code}`,
    };
  }

  let account = "";
  const me = await run("gh", ["api", "user", "-q", ".login"]);
  if (me.ok) account = me.stdout.trim();

  return { state: "ok", version, account };
}

export function parseGhVersion(stdout: string): string {
  const m = /gh version\s+(\S+)/.exec(stdout);
  return m?.[1] ?? stdout.trim().split("\n")[0] ?? "";
}

// ---------- openPr ----------

export interface OpenPrArgs {
  worktreePath: string;
  baseBranch: string;
  branchName: string;
  remote: string;
  title: string;
  body: string;
}

export type PrErrorCode =
  | "GH_MISSING"
  | "GH_UNAUTH"
  | "PUSH_FAILED"
  | "PR_CREATE_FAILED"
  | "PR_URL_MISSING";

export type OpenPrResult =
  | { ok: true; url: string }
  | { ok: false; code: PrErrorCode; message: string; stderr?: string };

export interface OpenPrDeps {
  run?: RunFn;
}

export async function openPr(
  args: OpenPrArgs,
  deps: OpenPrDeps = {},
): Promise<OpenPrResult> {
  const run = deps.run ?? defaultRun;

  // 1. push.
  const push = await run(
    "git",
    ["-C", args.worktreePath, "push", "-u", args.remote, args.branchName],
  );
  if (isEnoent(push)) {
    return { ok: false, code: "PUSH_FAILED", message: "git executable not found" };
  }
  if (!push.ok) {
    const stderr = push.stderr;
    return {
      ok: false,
      code: "PUSH_FAILED",
      message: `git push failed: ${stderr.trim() || `exit ${push.code}`}`,
      ...(stderr ? { stderr } : {}),
    };
  }

  // 2. gh pr create.
  const gh = await run(
    "gh",
    [
      "pr",
      "create",
      "--title",
      args.title,
      "--body-file",
      "-",
      "--base",
      args.baseBranch,
      "--head",
      args.branchName,
    ],
    { cwd: args.worktreePath, stdin: args.body },
  );
  if (isEnoent(gh)) {
    return { ok: false, code: "GH_MISSING", message: "gh executable not found" };
  }
  if (!gh.ok) {
    const stderr = gh.stderr;
    if (/auth|login|logged in|logged out|unauthenticated/i.test(stderr)) {
      return {
        ok: false,
        code: "GH_UNAUTH",
        message: stderr.trim() || `gh exited ${gh.code}`,
        ...(stderr ? { stderr } : {}),
      };
    }
    return {
      ok: false,
      code: "PR_CREATE_FAILED",
      message: `gh pr create failed: ${stderr.trim() || `exit ${gh.code}`}`,
      ...(stderr ? { stderr } : {}),
    };
  }

  // 3. parse URL.
  const url = extractPrUrl(gh.stdout);
  if (!url) {
    return {
      ok: false,
      code: "PR_URL_MISSING",
      message: "gh pr create succeeded but produced no parseable URL",
    };
  }
  return { ok: true, url };
}

export function extractPrUrl(stdout: string): string | null {
  const lines = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  for (const line of lines) {
    if (/^https?:\/\//i.test(line)) {
      try {
        // reason: URL constructor validates the value cheaply.
        new URL(line);
        return line;
      } catch {
        continue;
      }
    }
  }
  return null;
}

// ---------- helpers ----------

function isEnoent(r: RunResult): boolean {
  return r.spawnError?.code === "ENOENT";
}
