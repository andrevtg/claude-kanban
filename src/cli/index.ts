// Phase-1 smoke-test CLI. Wires the store, supervisor, and worker together
// without a UI: creates a one-off card, spawns a worker, and pretty-prints
// agent activity to stdout. See tasks/phase-1/task-06-cli-smoke-test.md.
//
// This is the parent-side of the worker boundary, so it imports from
// src/lib but never from src/worker.

import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { fileStore } from "../lib/store/index.js";
import { Supervisor } from "../lib/supervisor/index.js";
import { ensureDirs } from "../lib/paths.js";
import type { GlobalSettings, SDKMessage, WireMessage } from "../protocol/index.js";

const USAGE =
  'usage: pnpm cli run --repo <path> --base <branch> --prompt "<text>" [--model <model>]';

async function main(): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      options: {
        repo: { type: "string" },
        base: { type: "string" },
        prompt: { type: "string" },
        model: { type: "string" },
      },
    });
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n${USAGE}\n`);
    return 1;
  }

  const sub = parsed.positionals[0];
  if (sub !== "run") {
    process.stderr.write(`${USAGE}\n`);
    return 1;
  }

  const { repo, base, prompt, model } = parsed.values;
  if (!repo || !base || !prompt) {
    process.stderr.write(`missing required flag (--repo, --base, --prompt)\n${USAGE}\n`);
    return 1;
  }

  const store = fileStore();
  let settings: GlobalSettings | null;
  try {
    settings = await store.getSettings();
  } catch (e) {
    process.stderr.write(
      `failed to read settings: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return 1;
  }
  if (!settings) {
    process.stderr.write(
      "no settings found at ~/.claude-kanban/settings.json. " +
        'Create one with at least {"apiKeyPath":"<path>"} (see docs/02-agent-sdk-usage.md).\n',
    );
    return 1;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    process.stderr.write("ANTHROPIC_API_KEY is not set in the environment.\n");
    return 1;
  }

  const effective: GlobalSettings = {
    ...settings,
    defaultModel: model ?? settings.defaultModel,
  };

  await ensureDirs();

  const card = await store.createCard({
    title: prompt.length > 60 ? prompt.slice(0, 57) + "..." : prompt,
    prompt,
    repoPath: repo,
    baseBranch: base,
    status: "running",
  });

  const workerEntry = fileURLToPath(new URL("../worker/index.ts", import.meta.url));
  const supervisor = new Supervisor({
    store,
    workerEntry,
    nodeArgs: ["--import", "tsx"],
  });

  supervisor.on("run-event", (_runId, entry) => {
    printWireMessage(entry.message);
  });

  let exitCode = 0;
  const done = new Promise<void>((resolve) => {
    supervisor.on("run-done", (_id, code) => {
      exitCode = code;
      resolve();
    });
  });

  try {
    await supervisor.startRun(card, effective);
  } catch (e) {
    process.stderr.write(
      `failed to start run: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return 1;
  }
  await done;
  return exitCode;
}

function printWireMessage(msg: WireMessage): void {
  switch (msg.type) {
    case "event": {
      if (msg.event.kind === "worker") {
        process.stdout.write(`[worker] ${msg.event.level}: ${msg.event.message}\n`);
        return;
      }
      printSdk(msg.event.message);
      return;
    }
    case "error": {
      process.stdout.write(`[error]  ${msg.code}: ${msg.message}\n`);
      return;
    }
    case "diff_ready": {
      const { files, insertions, deletions } = msg.stat;
      process.stdout.write(`[diff]   ${files} files (+${insertions} -${deletions})\n`);
      return;
    }
    case "pr_opened": {
      process.stdout.write(`[pr]     ${msg.url}\n`);
      return;
    }
    default:
      return;
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}...` : s;
}

function printSdk(message: SDKMessage): void {
  const m = message as unknown as Record<string, unknown>;
  if (m.type === "system" && m.subtype === "init") {
    const model = typeof m.model === "string" ? m.model : "?";
    const cwd = typeof m.cwd === "string" ? m.cwd : "?";
    process.stdout.write(`[init]   model=${model} cwd=${cwd}\n`);
    return;
  }
  if (m.type === "assistant") {
    const inner = m.message as { content?: unknown } | undefined;
    const content = inner?.content;
    if (!Array.isArray(content)) return;
    for (const raw of content) {
      const block = raw as Record<string, unknown>;
      if (block.type === "text" && typeof block.text === "string") {
        const text = block.text.replace(/\s+/g, " ").trim();
        if (text.length === 0) continue;
        process.stdout.write(`[think]  ${truncate(text, 80)}\n`);
      } else if (block.type === "tool_use" && typeof block.name === "string") {
        let args = "";
        try {
          args = truncate(JSON.stringify(block.input ?? {}), 60);
        } catch {
          args = "<unprintable>";
        }
        process.stdout.write(`[tool]   ${block.name}(${args})\n`);
      }
    }
    return;
  }
  if (m.type === "result") {
    if (m.subtype === "success") {
      process.stdout.write(`[result] success\n`);
      return;
    }
    const detail =
      typeof m.result === "string"
        ? m.result
        : typeof m.subtype === "string"
          ? m.subtype
          : "failure";
    process.stdout.write(`[result] failure: ${detail}\n`);
    return;
  }
  // Unhandled SDK types (compact_boundary, user/tool_result, etc.) are silent
  // by design — the full event log is in ~/.claude-kanban/logs/<run>.ndjson.
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
    process.stderr.write(`cli fatal: ${msg}\n`);
    process.exit(1);
  });
