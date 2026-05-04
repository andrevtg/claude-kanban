"use client";

import { useEffect, useState, type ReactElement } from "react";

type TraceEntry = {
  ts: string;
  tool: string;
  args: unknown;
};

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; entries: TraceEntry[] }
  | { kind: "empty" }
  | { kind: "missing" }
  | { kind: "error"; message: string };

export function RunTrace({
  cardId,
  runId,
  runDone,
}: {
  cardId: string;
  runId: string;
  runDone: boolean;
}): ReactElement {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    fetch(`/api/cards/${cardId}/runs/${runId}/trace`)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) {
          setState({ kind: "missing" });
          return;
        }
        if (!res.ok) {
          setState({ kind: "error", message: `Failed to load trace (${res.status})` });
          return;
        }
        const text = await res.text();
        if (cancelled) return;
        const lines = text.split("\n").filter((l) => l.length > 0);
        if (lines.length === 0) {
          setState({ kind: "empty" });
          return;
        }
        const entries: TraceEntry[] = [];
        for (const line of lines) {
          try {
            entries.push(JSON.parse(line) as TraceEntry);
          } catch {
            // skip unparseable lines silently — the trace is best-effort.
          }
        }
        setState({ kind: "ready", entries });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [cardId, runId, runDone, reloadKey]);

  if (state.kind === "idle" || state.kind === "loading") {
    return <div className="p-4 text-xs text-slate-500">Loading trace…</div>;
  }
  if (state.kind === "missing") {
    return (
      <div className="p-4 text-xs text-slate-500">Tracing not enabled for this run.</div>
    );
  }
  if (state.kind === "empty") {
    return (
      <div className="p-4 text-xs text-slate-500">No tool calls recorded for this run.</div>
    );
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

  return (
    <ol className="flex h-full flex-col overflow-auto">
      {state.entries.map((entry, i) => (
        <TraceRow key={i} entry={entry} />
      ))}
    </ol>
  );
}

function TraceRow({ entry }: { entry: TraceEntry }): ReactElement {
  const [open, setOpen] = useState(false);
  const preview = previewArgs(entry.args);
  return (
    <li className="border-b border-slate-100 px-4 py-2 text-xs">
      <div className="flex items-center gap-3">
        <span className="font-mono text-[10px] text-slate-500">
          {formatTime(entry.ts)}
        </span>
        <span className="rounded-sm border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-700">
          {entry.tool}
        </span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="ml-auto truncate text-left font-mono text-[11px] text-slate-600 hover:text-slate-900"
        >
          {open ? "hide" : preview}
        </button>
      </div>
      {open ? (
        <pre className="mt-1 max-h-64 overflow-auto rounded-sm bg-slate-50 p-2 font-mono text-[11px] text-slate-800">
          {safeStringify(entry.args)}
        </pre>
      ) : null}
    </li>
  );
}

function previewArgs(args: unknown): string {
  const text = safeStringify(args);
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString();
}
