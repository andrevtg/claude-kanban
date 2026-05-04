"use client";

// Global error boundary for the App Router. Renders when a server component
// throws during render (e.g. listCards / getSettings fail catastrophically).
// Provides a Retry affordance via Next's reset() and a Copy details
// affordance via <ErrorCard /> so the user is never left looking at a
// blank page.

import { useEffect, type ReactElement } from "react";
import { ErrorCard } from "../components/error-card.js";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): ReactElement {
  useEffect(() => {
    // Surface to the dev console for the local-developer audience.
    // Not a telemetry hop — just helps when you're staring at the screen.
    console.error("[claude-kanban] route error:", error);
  }, [error]);

  return (
    <main className="mx-auto max-w-3xl p-6 font-sans">
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Something broke</h1>
      <p className="mb-4 text-sm text-slate-700">
        The page failed to render. The card store may be unreadable on disk, or a route handler
        threw. Use Retry to re-render; if it keeps failing, copy the details and inspect{" "}
        <code className="font-mono">~/.claude-kanban/</code>.
      </p>
      <ErrorCard
        {...(error.name && error.name !== "Error" ? { title: error.name } : {})}
        message={error.message || "Unknown error"}
        {...(error.digest ? { details: [{ label: "Digest", value: error.digest }] } : {})}
        onRetry={() => reset()}
      />
    </main>
  );
}
