"use client";

import { useState, type ReactElement } from "react";
import type { Card } from "../protocol/index.js";

export function CardDeleteConfirm({
  card,
  onDeleted,
  onCancel,
}: {
  card: Card;
  onDeleted: () => void;
  onCancel: () => void;
}): ReactElement {
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function onConfirm(): Promise<void> {
    setError(null);
    setDeleting(true);
    try {
      const res = await fetch(`/api/cards/${card.id}`, { method: "DELETE" });
      if (res.status === 204) {
        onDeleted();
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      setError(`Delete failed (${res.status}): ${body.message ?? body.error ?? "unknown"}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      role="alertdialog"
      aria-label="Confirm delete"
      className="rounded-md border border-red-300 bg-red-50 p-4"
    >
      <p className="text-sm text-red-900">
        Delete <span className="font-semibold">{card.title}</span>? This removes the card and its
        run history.
      </p>
      {error ? (
        <p className="mt-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={deleting}
          className="rounded-sm bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:bg-red-400"
        >
          {deleting ? "Deleting…" : "Confirm delete"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={deleting}
          className="rounded-sm border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
