"use client";

import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import type { Card, CardStatus, Run } from "../protocol/index.js";
import { CardForm } from "./card-form.js";
import { CardDeleteConfirm } from "./card-delete-confirm.js";
import { RunLog } from "./run-log.js";
import { RunDiff } from "./run-diff.js";
import { CancelButton } from "./cancel-button.js";
import { PrAffordance } from "./pr-affordance.js";

type RunHandleResponse = {
  runId: string;
  cardId: string;
  pid: number;
  startedAt: string;
};

type RunActiveError = {
  error: "run_active";
  cardId: string;
  runId: string;
};

type Props = {
  card: Card | null;
  onClose: () => void;
  onEdited: (card: Card) => void;
  onDeleted: (id: string) => void;
  onRunStarted: (cardId: string, run: Run) => void;
  onPrOpened?: (cardId: string, runId: string, url: string) => void;
};

type Mode = { kind: "view" } | { kind: "edit" } | { kind: "delete" };
type Pane = "log" | "diff";

export function CardDrawer({
  card,
  onClose,
  onEdited,
  onDeleted,
  onRunStarted,
  onPrOpened,
}: Props): ReactElement | null {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [pane, setPane] = useState<Pane>("log");
  const [mode, setMode] = useState<Mode>({ kind: "view" });
  const [runStarting, setRunStarting] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);

  // Reset to latest run + view mode whenever the drawer opens for a
  // different card. Closing/reopening the same card also defaults back
  // to the latest run (acceptance #9).
  useEffect(() => {
    if (!card) return;
    const latest = card.runs[card.runs.length - 1];
    setSelectedRunId(latest?.id ?? null);
    setMode({ kind: "view" });
    setRunMessage(null);
  }, [card?.id]);

  // Close on Escape.
  useEffect(() => {
    if (!card) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [card, onClose]);

  if (!card) return null;

  const runs = card.runs;
  const selectedRun = runs.find((r) => r.id === selectedRunId) ?? null;

  async function onRun(): Promise<void> {
    if (!card) return;
    setRunMessage(null);
    setRunStarting(true);
    try {
      const res = await fetch(`/api/cards/${card.id}/run`, { method: "POST" });
      if (res.ok) {
        const handle = (await res.json()) as RunHandleResponse;
        const newRun: Run = { id: handle.runId, startedAt: handle.startedAt };
        onRunStarted(card.id, newRun);
        setSelectedRunId(handle.runId);
        return;
      }
      if (res.status === 409) {
        const body = (await res.json().catch(() => ({}))) as RunActiveError;
        if (body.runId) {
          setSelectedRunId(body.runId);
          setRunMessage(`A run is already active (${body.runId}).`);
        } else {
          setRunMessage("A run is already active.");
        }
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      setRunMessage(`Failed to start run (${res.status}): ${body.message ?? body.error ?? "unknown"}`);
    } catch (e) {
      setRunMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setRunStarting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-slate-900/30"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-label={`Card ${card.title}`}
        className="absolute right-0 top-0 flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-slate-300 bg-white shadow-xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 p-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <StatusBadge status={card.status} />
              <h2 className="truncate text-lg font-semibold text-slate-900">{card.title}</h2>
            </div>
            <p className="mt-1 line-clamp-3 text-sm text-slate-600 whitespace-pre-wrap">
              {card.prompt}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            className="rounded-sm border border-slate-300 px-2 py-1 text-sm text-slate-700 hover:bg-slate-100"
          >
            Close
          </button>
        </header>

        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2">
          <button
            type="button"
            onClick={onRun}
            disabled={runStarting || card.status === "running"}
            className="rounded-sm bg-slate-900 px-3 py-1 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {runStarting ? "Starting…" : "Run"}
          </button>
          <button
            type="button"
            onClick={() => setMode(mode.kind === "edit" ? { kind: "view" } : { kind: "edit" })}
            aria-pressed={mode.kind === "edit"}
            className="rounded-sm border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => setMode(mode.kind === "delete" ? { kind: "view" } : { kind: "delete" })}
            aria-pressed={mode.kind === "delete"}
            className="rounded-sm border border-red-300 px-3 py-1 text-sm font-medium text-red-700 hover:bg-red-50"
          >
            Delete
          </button>
          {runMessage ? (
            <span className="ml-2 truncate text-xs text-amber-700" role="status">
              {runMessage}
            </span>
          ) : null}
        </div>

        {mode.kind === "edit" ? (
          <div className="border-b border-slate-200 p-4">
            <CardForm
              mode="edit"
              initial={card}
              onSuccess={(c) => {
                onEdited(c);
                setMode({ kind: "view" });
              }}
              onCancel={() => setMode({ kind: "view" })}
            />
          </div>
        ) : null}

        {mode.kind === "delete" ? (
          <div className="border-b border-slate-200 p-4">
            <CardDeleteConfirm
              card={card}
              onDeleted={() => {
                onDeleted(card.id);
                onClose();
              }}
              onCancel={() => setMode({ kind: "view" })}
            />
          </div>
        ) : null}

        <section className="border-b border-slate-200 px-4 py-3 text-xs text-slate-600">
          <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
            <dt className="text-slate-500">repo</dt>
            <dd className="font-mono text-slate-800">{card.repoPath}</dd>
            <dt className="text-slate-500">branch</dt>
            <dd className="font-mono text-slate-800">{card.baseBranch}</dd>
            <dt className="text-slate-500">created</dt>
            <dd className="font-mono text-slate-800">{card.createdAt}</dd>
            <dt className="text-slate-500">updated</dt>
            <dd className="font-mono text-slate-800">{card.updatedAt}</dd>
          </dl>
        </section>

        <div className="grid flex-1 grid-rows-[auto_1fr] overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700">
              Runs ({runs.length})
            </h3>
            {runs.length === 0 ? (
              <p className="mt-2 text-xs text-slate-500">no runs yet</p>
            ) : (
              <ul className="mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto">
                {[...runs].reverse().map((r) => {
                  const active = r.id === selectedRunId;
                  const live = !r.endedAt;
                  return (
                    <li key={r.id} className="flex items-stretch gap-1">
                      <button
                        type="button"
                        onClick={() => setSelectedRunId(r.id)}
                        className={`flex flex-1 items-center justify-between gap-2 rounded-sm border px-2 py-1 text-left text-xs ${
                          active
                            ? "border-slate-700 bg-slate-100"
                            : "border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          {live ? (
                            <span
                              aria-label="live"
                              className="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500"
                            />
                          ) : null}
                          <span className="truncate font-mono">{r.id}</span>
                        </span>
                        <span className="shrink-0 text-slate-500">
                          {formatRunMeta(r)}
                        </span>
                      </button>
                      {live ? (
                        <CancelButton cardId={card.id} runId={r.id} condensed />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="grid grid-rows-[auto_1fr] overflow-hidden">
            {selectedRun ? (
              <>
                {selectedRun.endedAt &&
                selectedRun.exitCode === 0 &&
                selectedRun.diffStat &&
                selectedRun.diffStat.files > 0 ? (
                  <PrAffordance
                    card={card}
                    run={selectedRun}
                    onPrOpened={(cardId, runId, url) => onPrOpened?.(cardId, runId, url)}
                  />
                ) : null}
                <div className="flex border-b border-slate-200 bg-slate-50 px-4">
                  <PaneTab active={pane === "log"} onClick={() => setPane("log")}>
                    Events
                  </PaneTab>
                  <PaneTab active={pane === "diff"} onClick={() => setPane("diff")}>
                    Diff
                    {selectedRun.diffStat ? (
                      <span className="ml-1 font-mono text-[10px] text-slate-500">
                        +{selectedRun.diffStat.insertions} -{selectedRun.diffStat.deletions}
                      </span>
                    ) : null}
                  </PaneTab>
                </div>
                {pane === "log" ? (
                  <RunLog key={selectedRun.id} cardId={card.id} runId={selectedRun.id} />
                ) : (
                  <RunDiff
                    key={selectedRun.id}
                    cardId={card.id}
                    runId={selectedRun.id}
                    diffStat={selectedRun.diffStat}
                  />
                )}
              </>
            ) : (
              <div className="p-4 text-sm text-slate-500">
                {runs.length === 0
                  ? "Click Run to start the first run."
                  : "Select a run to view its events."}
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function PaneTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`-mb-px border-b-2 px-3 py-1.5 text-xs font-medium ${
        active
          ? "border-slate-900 text-slate-900"
          : "border-transparent text-slate-500 hover:text-slate-700"
      }`}
    >
      {children}
    </button>
  );
}

function StatusBadge({ status }: { status: CardStatus }): ReactElement {
  const tone: Record<CardStatus, string> = {
    backlog: "bg-slate-100 text-slate-700 border-slate-300",
    ready: "bg-blue-50 text-blue-800 border-blue-200",
    running: "bg-emerald-50 text-emerald-800 border-emerald-200",
    review: "bg-amber-50 text-amber-800 border-amber-200",
    done: "bg-emerald-100 text-emerald-900 border-emerald-300",
    failed: "bg-red-50 text-red-800 border-red-200",
  };
  return (
    <span
      className={`inline-block rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone[status]}`}
    >
      {status}
    </span>
  );
}

function formatRunMeta(run: Run): string {
  const parts: string[] = [];
  if (run.endedAt) {
    const ms = Date.parse(run.endedAt) - Date.parse(run.startedAt);
    if (Number.isFinite(ms) && ms >= 0) parts.push(formatDuration(ms));
    if (run.exitCode !== undefined) parts.push(`exit ${run.exitCode}`);
  } else {
    parts.push("active");
  }
  parts.push(formatTime(run.startedAt));
  return parts.join(" · ");
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return rs === 0 ? `${m}m` : `${m}m${rs}s`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString();
}
