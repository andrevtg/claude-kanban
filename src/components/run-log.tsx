"use client";

import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import type { EventLogEntry, SDKMessage } from "../protocol/index.js";

type Row =
  | { kind: "init"; key: number; model: string; cwd: string }
  | { kind: "text"; key: number; text: string }
  | { kind: "tool_use"; key: number; name: string; args: string }
  | { kind: "tool_result"; key: number; preview: string; isError: boolean }
  | { kind: "compact"; key: number }
  | { kind: "result"; key: number; success: boolean; detail: string }
  | { kind: "worker"; key: number; level: "info" | "warn" | "error"; message: string }
  | { kind: "error"; key: number; code: string; message: string }
  | { kind: "diff"; key: number; files: number; insertions: number; deletions: number }
  | { kind: "pr"; key: number; url: string }
  | { kind: "done"; key: number; exitCode: number };

const TRUNCATE = 240;

export function RunLog({
  cardId,
  runId,
  onDone,
}: {
  cardId: string;
  runId: string;
  onDone?: (exitCode: number) => void;
}): ReactElement {
  const [rows, setRows] = useState<Row[]>([]);
  const [closed, setClosed] = useState(false);
  const counter = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);

  // Hold onDone in a ref so the EventSource effect doesn't tear down
  // every time the parent re-renders with a fresh callback identity.
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const es = new EventSource(`/api/cards/${cardId}/runs/${runId}/events`);
    let active = true;

    const append = (next: Row[]): void => {
      if (!active || next.length === 0) return;
      setRows((prev) => [...prev, ...next]);
    };

    const onMessage = (e: MessageEvent<string>): void => {
      try {
        const entry = JSON.parse(e.data) as EventLogEntry;
        const next = entryToRows(entry, counter);
        append(next);
      } catch {
        append([
          {
            kind: "error",
            key: counter.current++,
            code: "client_parse",
            message: "failed to parse SSE frame",
          },
        ]);
      }
    };

    const onDoneEvt = (e: MessageEvent<string>): void => {
      let exitCode = 0;
      try {
        const parsed = JSON.parse(e.data) as { exitCode: number };
        exitCode = parsed.exitCode;
      } catch {
        // best-effort; default to 0
      }
      append([{ kind: "done", key: counter.current++, exitCode }]);
      setClosed(true);
      es.close();
      onDoneRef.current?.(exitCode);
    };

    const onErr = (): void => {
      // EventSource auto-retries on transient error. Only surface a row
      // when the underlying connection is permanently gone.
      if (es.readyState === EventSource.CLOSED) {
        append([
          {
            kind: "error",
            key: counter.current++,
            code: "sse_closed",
            message: "stream closed",
          },
        ]);
        setClosed(true);
      }
    };

    es.addEventListener("message", onMessage);
    es.addEventListener("done", onDoneEvt as EventListener);
    es.addEventListener("error", onErr);

    return () => {
      active = false;
      es.removeEventListener("message", onMessage);
      es.removeEventListener("done", onDoneEvt as EventListener);
      es.removeEventListener("error", onErr);
      es.close();
    };
  }, [cardId, runId]);

  // Auto-scroll to bottom unless the user scrolled up.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickToBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [rows]);

  function onScroll(): void {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottom.current = distance < 24;
  }

  return (
    <div className="flex flex-col">
      <div className="border-b border-slate-200 px-4 py-2 text-xs text-slate-500">
        run <span className="font-mono">{runId}</span>
        {closed ? <span className="ml-2 text-slate-400">(closed)</span> : null}
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="h-112 overflow-y-auto bg-slate-50 p-3 font-mono text-xs leading-relaxed"
      >
        {rows.length === 0 ? (
          <div className="text-slate-400">waiting for events…</div>
        ) : (
          rows.map((r) => <LogRow key={r.key} row={r} />)
        )}
      </div>
    </div>
  );
}

function LogRow({ row }: { row: Row }): ReactElement {
  switch (row.kind) {
    case "init":
      return (
        <Line tag="init" tone="muted">
          model={row.model} cwd={row.cwd}
        </Line>
      );
    case "text":
      return (
        <Line tag="think" tone="default">
          {row.text}
        </Line>
      );
    case "tool_use":
      return (
        <Line tag="tool" tone="accent">
          {row.name}({row.args})
        </Line>
      );
    case "tool_result":
      return (
        <Line tag={row.isError ? "tool-err" : "tool-out"} tone={row.isError ? "error" : "muted"}>
          {row.preview}
        </Line>
      );
    case "compact":
      return (
        <Line tag="compact" tone="muted">
          context compacted
        </Line>
      );
    case "result":
      return (
        <Line tag="result" tone={row.success ? "success" : "error"}>
          {row.success ? "success" : `failure: ${row.detail}`}
        </Line>
      );
    case "worker":
      return (
        <Line tag="worker" tone={row.level === "error" ? "error" : "muted"}>
          {row.level}: {row.message}
        </Line>
      );
    case "error":
      return (
        <Line tag="error" tone="error">
          {row.code}: {row.message}
        </Line>
      );
    case "diff":
      return (
        <Line tag="diff" tone="muted">
          {row.files} files (+{row.insertions} -{row.deletions})
        </Line>
      );
    case "pr":
      return (
        <Line tag="pr" tone="accent">
          <a className="underline" href={row.url} target="_blank" rel="noreferrer">
            {row.url}
          </a>
        </Line>
      );
    case "done":
      return (
        <Line tag="done" tone={row.exitCode === 0 ? "success" : "error"}>
          exitCode={row.exitCode}
        </Line>
      );
  }
}

function Line({
  tag,
  tone,
  children,
}: {
  tag: string;
  tone: "default" | "muted" | "accent" | "success" | "error";
  children: ReactNode;
}): ReactElement {
  const toneClass = {
    default: "text-slate-800",
    muted: "text-slate-500",
    accent: "text-indigo-700",
    success: "text-emerald-700",
    error: "text-red-700",
  }[tone];
  return (
    <div className={`whitespace-pre-wrap wrap-break-word ${toneClass}`}>
      <span className="mr-2 inline-block w-16 shrink-0 text-slate-400">[{tag}]</span>
      <span>{children}</span>
    </div>
  );
}

function entryToRows(entry: EventLogEntry, counter: { current: number }): Row[] {
  const msg = entry.message;
  switch (msg.type) {
    case "event": {
      if (msg.event.kind === "worker") {
        return [
          {
            kind: "worker",
            key: counter.current++,
            level: msg.event.level,
            message: msg.event.message,
          },
        ];
      }
      return sdkRows(msg.event.message, counter);
    }
    case "error":
      return [{ kind: "error", key: counter.current++, code: msg.code, message: msg.message }];
    case "diff_ready":
      return [
        {
          kind: "diff",
          key: counter.current++,
          files: msg.stat.files,
          insertions: msg.stat.insertions,
          deletions: msg.stat.deletions,
        },
      ];
    case "pr_opened":
      return [{ kind: "pr", key: counter.current++, url: msg.url }];
    case "ready":
    case "init":
    case "approve_pr":
    case "cancel":
    case "done":
      return [];
    default:
      return [];
  }
}

function sdkRows(message: SDKMessage, counter: { current: number }): Row[] {
  const m = message as unknown as Record<string, unknown>;
  if (m.type === "system" && m.subtype === "init") {
    const model = typeof m.model === "string" ? m.model : "?";
    const cwd = typeof m.cwd === "string" ? m.cwd : "?";
    return [{ kind: "init", key: counter.current++, model, cwd }];
  }
  if (m.type === "system" && m.subtype === "compact_boundary") {
    return [{ kind: "compact", key: counter.current++ }];
  }
  if (m.type === "assistant") {
    const inner = m.message as { content?: unknown } | undefined;
    const content = inner?.content;
    if (!Array.isArray(content)) return [];
    const rows: Row[] = [];
    for (const raw of content) {
      const block = raw as Record<string, unknown>;
      if (block.type === "text" && typeof block.text === "string") {
        const text = block.text.trim();
        if (text.length > 0) {
          rows.push({ kind: "text", key: counter.current++, text: truncate(text, TRUNCATE) });
        }
      } else if (block.type === "tool_use" && typeof block.name === "string") {
        let args = "";
        try {
          args = truncate(JSON.stringify(block.input ?? {}), TRUNCATE);
        } catch {
          args = "<unprintable>";
        }
        rows.push({ kind: "tool_use", key: counter.current++, name: block.name, args });
      }
    }
    return rows;
  }
  if (m.type === "user") {
    const inner = m.message as { content?: unknown } | undefined;
    const content = inner?.content;
    if (!Array.isArray(content)) return [];
    const rows: Row[] = [];
    for (const raw of content) {
      const block = raw as Record<string, unknown>;
      if (block.type === "tool_result") {
        const isError = block.is_error === true;
        const preview = previewToolResult(block.content);
        rows.push({
          kind: "tool_result",
          key: counter.current++,
          preview: truncate(preview, TRUNCATE),
          isError,
        });
      }
    }
    return rows;
  }
  if (m.type === "result") {
    if (m.subtype === "success") {
      return [{ kind: "result", key: counter.current++, success: true, detail: "success" }];
    }
    const detail =
      typeof m.result === "string"
        ? m.result
        : typeof m.subtype === "string"
          ? m.subtype
          : "failure";
    return [{ kind: "result", key: counter.current++, success: false, detail }];
  }
  return [];
}

function previewToolResult(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const raw of content) {
    const block = raw as Record<string, unknown>;
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    }
  }
  return parts.join("\n");
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}...` : s;
}
