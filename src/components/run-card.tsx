"use client";

import { useState, type ReactElement } from "react";
import type { Card } from "../protocol/index.js";
import { RunLog } from "./run-log.js";

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

type ApiError = {
  error: string;
  message?: string;
};

type StartError = {
  message: string;
  activeRunId?: string;
};

export function RunCard({ card }: { card: Card }): ReactElement {
  const [runId, setRunId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [startError, setStartError] = useState<StartError | null>(null);

  async function onRun(): Promise<void> {
    setStartError(null);
    setRunning(true);
    try {
      const res = await fetch(`/api/cards/${card.id}/run`, { method: "POST" });
      if (res.ok) {
        const handle = (await res.json()) as RunHandleResponse;
        setRunId(handle.runId);
        return;
      }
      if (res.status === 409) {
        const body = (await res.json()) as RunActiveError;
        setStartError({
          message: `A run is already active for this card.`,
          activeRunId: body.runId,
        });
        setRunId(body.runId);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as Partial<ApiError>;
      setStartError({
        message: `Failed to start run (${res.status}): ${body.message ?? body.error ?? "unknown"}`,
      });
      setRunning(false);
    } catch (e) {
      setStartError({ message: e instanceof Error ? e.message : String(e) });
      setRunning(false);
    }
  }

  function onRunDone(): void {
    setRunning(false);
  }

  return (
    <section className="rounded-lg border border-slate-300 bg-white shadow-sm">
      <header className="border-b border-slate-200 p-4">
        <h2 className="text-lg font-semibold text-slate-900">{card.title}</h2>
        <p className="mt-1 text-sm text-slate-600">{card.prompt}</p>
        <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs text-slate-500">
          <dt>repo</dt>
          <dd className="font-mono">{card.repoPath}</dd>
          <dt>branch</dt>
          <dd className="font-mono">{card.baseBranch}</dd>
        </dl>
      </header>
      <div className="flex items-center gap-3 border-b border-slate-200 p-4">
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {running ? "Running…" : "Run"}
        </button>
        {startError ? (
          <span className="text-sm text-red-700">
            {startError.message}
            {startError.activeRunId ? (
              <>
                {" "}
                <span className="font-mono">({startError.activeRunId})</span>
              </>
            ) : null}
          </span>
        ) : null}
      </div>
      {runId ? (
        <RunLog cardId={card.id} runId={runId} onDone={onRunDone} />
      ) : (
        <div className="p-4 text-sm text-slate-500">No run yet. Click Run to start.</div>
      )}
    </section>
  );
}
