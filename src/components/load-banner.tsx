"use client";

// Page-level load banner for failures during server-side data fetch (cards
// list, settings). Wraps <ErrorCard /> with a "load failure" framing so the
// home/settings pages can render alongside the banner instead of falling
// through to the global error boundary.

import type { ReactElement, ReactNode } from "react";
import { ErrorCard } from "./error-card.js";

export function LoadBanner({
  title,
  message,
  hint,
  tone = "error",
}: {
  title: string;
  message: string;
  hint?: ReactNode;
  tone?: "error" | "warning";
}): ReactElement {
  return (
    <div className="mb-4">
      <ErrorCard title={title} message={message} hint={hint} tone={tone} />
    </div>
  );
}
