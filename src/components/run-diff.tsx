"use client";

import { useEffect, useState, type ReactElement } from "react";
import type { DiffStat } from "../protocol/index.js";

type FileSection = {
  header: string;
  oldPath: string;
  newPath: string;
  lines: string[];
};

type Fetched = {
  truncated: boolean;
  bytes: number;
  files: FileSection[];
};

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; data: Fetched }
  | { kind: "error"; message: string };

export function RunDiff({
  cardId,
  runId,
  diffStat,
}: {
  cardId: string;
  runId: string;
  diffStat: DiffStat | undefined;
}): ReactElement {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [reloadKey, setReloadKey] = useState(0);

  const hasFiles = !!diffStat && diffStat.files > 0;

  useEffect(() => {
    if (!hasFiles) {
      setState({ kind: "idle" });
      return;
    }
    let cancelled = false;
    setState({ kind: "loading" });
    fetch(`/api/cards/${cardId}/runs/${runId}/diff`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          const message = `Failed to load diff (${res.status})`;
          setState({ kind: "error", message });
          return;
        }
        const truncated = res.headers.get("X-Diff-Truncated") === "true";
        const bytes = Number.parseInt(res.headers.get("X-Diff-Bytes") ?? "0", 10);
        const text = await res.text();
        if (cancelled) return;
        setState({
          kind: "ready",
          data: { truncated, bytes, files: parseUnifiedDiff(text) },
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [cardId, runId, hasFiles, reloadKey]);

  if (!diffStat) {
    return (
      <div className="p-4 text-xs text-slate-500">
        Diff not available yet. It appears after a successful run finishes.
      </div>
    );
  }

  if (diffStat.files === 0) {
    return (
      <div className="p-4 text-xs text-slate-600">Agent made no changes.</div>
    );
  }

  if (state.kind === "loading" || state.kind === "idle") {
    return <div className="p-4 text-xs text-slate-500">Loading diff…</div>;
  }

  if (state.kind === "error") {
    return (
      <div className="p-4 text-xs text-red-700">
        <p>{state.message}</p>
        <button
          type="button"
          onClick={() => setReloadKey((n) => n + 1)}
          className="mt-2 rounded-sm border border-red-300 px-2 py-0.5 text-xs hover:bg-red-50"
        >
          Retry
        </button>
      </div>
    );
  }

  const { data } = state;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-2 text-xs">
        <span className="font-semibold text-slate-700">
          {diffStat.files} file{diffStat.files === 1 ? "" : "s"}
        </span>
        <span className="text-emerald-700">+{diffStat.insertions}</span>
        <span className="text-red-700">-{diffStat.deletions}</span>
        <span className="ml-auto font-mono text-slate-500">
          {formatBytes(data.bytes)}
        </span>
      </div>
      {data.truncated ? (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          Patch exceeded the size cap; showing the first {formatBytes(data.bytes)}. Inspect{" "}
          <code className="font-mono">~/.claude-kanban/work/{runId}/</code> for the full diff.
        </div>
      ) : null}
      <div className="flex-1 overflow-auto">
        {data.files.length === 0 ? (
          <pre className="whitespace-pre-wrap p-4 font-mono text-xs text-slate-600">
            (patch is empty or unparseable)
          </pre>
        ) : (
          data.files.map((f, i) => <FileDiff key={`${f.newPath}-${i}`} file={f} />)
        )}
      </div>
    </div>
  );
}

function FileDiff({ file }: { file: FileSection }): ReactElement {
  const [open, setOpen] = useState(true);
  const counts = countLines(file.lines);
  const label = file.oldPath === file.newPath ? file.newPath : `${file.oldPath} → ${file.newPath}`;
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      className="border-b border-slate-200"
    >
      <summary className="flex cursor-pointer items-center gap-3 bg-slate-50 px-4 py-1.5 text-xs hover:bg-slate-100">
        <span className="truncate font-mono text-slate-800">{label}</span>
        <span className="ml-auto shrink-0 font-mono text-emerald-700">+{counts.add}</span>
        <span className="shrink-0 font-mono text-red-700">-{counts.del}</span>
      </summary>
      <pre className="overflow-x-auto px-4 py-2 font-mono text-[11px] leading-snug">
        {file.lines.map((line, i) => (
          <span key={i} className={lineClass(line)}>
            {line}
            {"\n"}
          </span>
        ))}
      </pre>
    </details>
  );
}

function lineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "text-slate-500";
  if (line.startsWith("@@")) return "text-indigo-700";
  if (line.startsWith("+")) return "bg-emerald-50 text-emerald-900";
  if (line.startsWith("-")) return "bg-red-50 text-red-900";
  return "text-slate-700";
}

function countLines(lines: string[]): { add: number; del: number } {
  let add = 0;
  let del = 0;
  for (const l of lines) {
    if (l.startsWith("+++") || l.startsWith("---")) continue;
    if (l.startsWith("+")) add++;
    else if (l.startsWith("-")) del++;
  }
  return { add, del };
}

function parseUnifiedDiff(text: string): FileSection[] {
  const lines = text.split("\n");
  const files: FileSection[] = [];
  let cur: FileSection | null = null;
  let oldPath = "";
  let newPath = "";

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (cur) files.push(cur);
      const m = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      oldPath = m?.[1] ?? "";
      newPath = m?.[2] ?? "";
      cur = { header: line, oldPath, newPath, lines: [line] };
      continue;
    }
    if (!cur) continue;
    if (line.startsWith("--- a/")) {
      cur.oldPath = line.slice(6);
    } else if (line.startsWith("+++ b/")) {
      cur.newPath = line.slice(6);
    }
    cur.lines.push(line);
  }
  if (cur) files.push(cur);
  return files;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MiB`;
}
