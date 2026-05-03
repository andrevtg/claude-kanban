"use client";

import { useState, type ReactElement } from "react";

export function CancelButton({
  cardId,
  runId,
  condensed = false,
}: {
  cardId: string;
  runId: string;
  condensed?: boolean;
}): ReactElement {
  const [cancelling, setCancelling] = useState(false);

  async function onClick(): Promise<void> {
    if (cancelling) return;
    setCancelling(true);
    // Endpoint is always 202; the run's end is signalled via the SSE
    // `done` event, after which the parent stops rendering this button.
    try {
      await fetch(`/api/cards/${cardId}/runs/${runId}/cancel`, { method: "POST" });
    } catch {
      // Network blip: leave the button in cancelling state. The
      // supervisor's wall-clock escalation is still the backstop.
    }
  }

  const label = cancelling ? "Cancelling…" : "Cancel";
  const cls = condensed
    ? "rounded-sm border border-amber-400 px-2 py-0.5 text-[11px] font-medium text-amber-800 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
    : "rounded-sm border border-amber-400 px-3 py-1 text-sm font-medium text-amber-800 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <button
      type="button"
      disabled={cancelling}
      onClick={(e) => {
        e.stopPropagation();
        void onClick();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className={cls}
    >
      {label}
    </button>
  );
}
