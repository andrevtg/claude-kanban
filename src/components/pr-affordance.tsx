"use client";

// Open PR affordance for a finished, non-empty-diff run. Reads gh pre-flight
// state from /api/gh/status (cached client-side ~10s), shows a composer for
// title/body, and drives the request lifecycle from the SSE stream:
//   pr_opened → chip with the PR URL
//   error PUSH_FAILED / PR_CREATE_FAILED / GH_* → inline error, button re-enabled
//   error PR_URL_MISSING → inline warning, button stays disabled

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from "react";
import type { Card, EventLogEntry, Run } from "../protocol/index.js";

type GhStatus =
  | { state: "ok"; version: string; account: string }
  | { state: "missing" }
  | { state: "unauthenticated"; message: string };

type Phase =
  | { kind: "idle" }
  | { kind: "composing" }
  | { kind: "submitting" }
  | { kind: "waiting" }
  | { kind: "error"; code: string; message: string }
  | { kind: "warning"; message: string }
  | { kind: "done"; url: string };

const STATUS_TTL_MS = 10_000;
let statusCache: { status: GhStatus; at: number } | null = null;

async function fetchStatus(force = false): Promise<GhStatus> {
  const now = Date.now();
  if (!force && statusCache && now - statusCache.at < STATUS_TTL_MS) {
    return statusCache.status;
  }
  const res = await fetch("/api/gh/status");
  const body = (await res.json()) as GhStatus;
  statusCache = { status: body, at: now };
  return body;
}

export function PrAffordance({
  card,
  run,
  onPrOpened,
}: {
  card: Card;
  run: Run;
  onPrOpened: (cardId: string, runId: string, url: string) => void;
}): ReactElement | null {
  const [gh, setGh] = useState<GhStatus | null>(null);
  const [phase, setPhase] = useState<Phase>(() =>
    run.prUrl ? { kind: "done", url: run.prUrl } : { kind: "idle" },
  );
  const [title, setTitle] = useState(card.title);
  const [body, setBody] = useState(() => composeDefaultBody(card, run));

  // Reset phase when switching to a different run.
  useEffect(() => {
    setPhase(run.prUrl ? { kind: "done", url: run.prUrl } : { kind: "idle" });
  }, [run.id, run.prUrl]);

  // Pre-flight on mount + window focus.
  useEffect(() => {
    let cancelled = false;
    const refresh = (force: boolean): void => {
      void fetchStatus(force).then((s) => {
        if (!cancelled) setGh(s);
      });
    };
    refresh(false);
    const onFocus = (): void => refresh(true);
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const live = phase.kind === "waiting";
  const handleSseMessage = useCallback(
    (entry: EventLogEntry): void => {
      const m = entry.message;
      if (m.type === "pr_opened") {
        setPhase({ kind: "done", url: m.url });
        onPrOpened(card.id, run.id, m.url);
        return;
      }
      if (m.type === "error" && live) {
        if (m.code === "PR_URL_MISSING") {
          setPhase({
            kind: "warning",
            message:
              "PR may have been created but `gh` returned no URL. Check the remote manually.",
          });
          return;
        }
        if (
          m.code === "PUSH_FAILED" ||
          m.code === "PR_CREATE_FAILED" ||
          m.code === "GH_MISSING" ||
          m.code === "GH_UNAUTH"
        ) {
          setPhase({ kind: "error", code: m.code, message: m.message });
        }
      }
    },
    [card.id, run.id, live, onPrOpened],
  );

  // Listen to the run SSE stream while we're waiting for the worker reply.
  useEffect(() => {
    if (phase.kind !== "waiting") return;
    const es = new EventSource(`/api/cards/${card.id}/runs/${run.id}/events`);
    const onMsg = (e: MessageEvent<string>): void => {
      try {
        const entry = JSON.parse(e.data) as EventLogEntry;
        handleSseMessage(entry);
      } catch {
        // ignore parse errors; the run-log surface owns user-visible parse errors.
      }
    };
    es.addEventListener("message", onMsg);
    return () => {
      es.removeEventListener("message", onMsg);
      es.close();
    };
  }, [phase.kind, card.id, run.id, handleSseMessage]);

  // Done: render the chip.
  if (phase.kind === "done") {
    return (
      <div className="border-b border-slate-200 bg-emerald-50 px-4 py-2 text-xs">
        <span className="mr-2 font-semibold text-emerald-900">PR opened</span>
        <a
          href={phase.url}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-emerald-800 underline"
        >
          {phase.url}
        </a>
      </div>
    );
  }

  if (!gh) return null;

  const disabledReason: string | null =
    gh.state === "missing"
      ? "GitHub CLI (`gh`) is not installed."
      : gh.state === "unauthenticated"
        ? "Run `gh auth login` in your terminal, then refresh."
        : phase.kind === "warning"
          ? "PR may already exist on the remote."
          : null;
  const disabled = disabledReason !== null || phase.kind === "submitting" || phase.kind === "waiting";

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setPhase({ kind: "submitting" });
    try {
      const res = await fetch(`/api/cards/${card.id}/runs/${run.id}/approve-pr`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, body }),
      });
      if (res.status === 202) {
        setPhase({ kind: "waiting" });
        return;
      }
      if (res.status === 409) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          prUrl?: string;
        };
        if (data.error === "already_open" && data.prUrl) {
          setPhase({ kind: "done", url: data.prUrl });
          onPrOpened(card.id, run.id, data.prUrl);
          return;
        }
        setPhase({
          kind: "error",
          code: data.error ?? "conflict",
          message: data.error ?? `${res.status}`,
        });
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      setPhase({
        kind: "error",
        code: data.error ?? `http_${res.status}`,
        message: data.message ?? data.error ?? `request failed (${res.status})`,
      });
    } catch (err) {
      setPhase({
        kind: "error",
        code: "network",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-700">
          Pull request
        </div>
        {gh.state === "ok" && phase.kind === "idle" ? (
          <button
            type="button"
            onClick={() => setPhase({ kind: "composing" })}
            className="rounded-sm bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800"
          >
            Open PR
          </button>
        ) : null}
        {phase.kind === "idle" && disabledReason ? (
          <button
            type="button"
            disabled
            title={disabledReason}
            className="rounded-sm bg-slate-300 px-3 py-1 text-xs font-medium text-slate-600"
          >
            Open PR
          </button>
        ) : null}
      </div>

      {phase.kind === "idle" && disabledReason ? (
        <p className="mt-2 text-xs text-slate-600">
          {disabledReason}
          {gh.state === "missing" ? (
            <>
              {" "}
              <a
                href="https://cli.github.com"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Install `gh`
              </a>
              .
            </>
          ) : null}
        </p>
      ) : null}

      {phase.kind === "composing" ? (
        <PrComposer
          title={title}
          body={body}
          onTitleChange={setTitle}
          onBodyChange={setBody}
          onCancel={() => setPhase({ kind: "idle" })}
          onSubmit={onSubmit}
          disabled={disabled}
        />
      ) : null}

      {phase.kind === "submitting" || phase.kind === "waiting" ? (
        <p className="mt-2 text-xs text-slate-600" role="status">
          {phase.kind === "submitting" ? "Submitting…" : "Pushing branch and creating PR…"}
        </p>
      ) : null}

      {phase.kind === "error" ? (
        <div className="mt-2 rounded-sm border border-red-300 bg-red-50 p-2 text-xs text-red-800">
          <div className="font-semibold">{phase.code}</div>
          <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px]">{phase.message}</pre>
          <button
            type="button"
            onClick={() => setPhase({ kind: "composing" })}
            className="mt-2 rounded-sm border border-red-400 bg-white px-2 py-0.5 text-xs font-medium text-red-700 hover:bg-red-100"
          >
            Try again
          </button>
        </div>
      ) : null}

      {phase.kind === "warning" ? (
        <div className="mt-2 rounded-sm border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
          {phase.message}
        </div>
      ) : null}
    </div>
  );
}

function PrComposer({
  title,
  body,
  onTitleChange,
  onBodyChange,
  onCancel,
  onSubmit,
  disabled,
}: {
  title: string;
  body: string;
  onTitleChange: (v: string) => void;
  onBodyChange: (v: string) => void;
  onCancel: () => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void | Promise<void>;
  disabled: boolean;
}): ReactElement {
  const titleRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    titleRef.current?.focus();
  }, []);
  return (
    <form onSubmit={onSubmit} className="mt-2 flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-xs text-slate-700">
        <span className="font-medium">Title</span>
        <input
          ref={titleRef}
          type="text"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          required
          className="rounded-sm border border-slate-300 px-2 py-1 text-xs font-mono"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-700">
        <span className="font-medium">Body</span>
        <textarea
          value={body}
          onChange={(e) => onBodyChange(e.target.value)}
          rows={5}
          className="rounded-sm border border-slate-300 px-2 py-1 text-xs font-mono"
        />
      </label>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={disabled || title.trim().length === 0}
          className="rounded-sm bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          Submit
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-sm border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function composeDefaultBody(card: Card, run: Run): string {
  const lines: string[] = [];
  lines.push(card.prompt.trim());
  lines.push("");
  if (run.diffStat) {
    lines.push(
      `Diff: ${run.diffStat.files} files (+${run.diffStat.insertions} -${run.diffStat.deletions})`,
    );
  }
  lines.push("");
  lines.push(`Generated by claude-kanban — run \`${run.id}\``);
  return lines.join("\n");
}
