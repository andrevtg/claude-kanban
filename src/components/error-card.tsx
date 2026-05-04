"use client";

// Reusable error surface used by the error-states audit (phase-5/task-02).
// Two affordances:
//   - Retry: reissues the failed request when `onRetry` is provided.
//   - Copy details: copies a labeled, human-readable text payload to the
//     clipboard so the user can paste into a bug report.
//
// Per the audit: every visible error in the app gets at least one of the two.
// Hard validation errors (where the user must fix the input, not the request)
// are documented exceptions that opt out of both.

import { useState, type ReactElement, type ReactNode } from "react";

export type ErrorCardTone = "error" | "warning";

export type ErrorCardDetailField = {
  label: string;
  value: string;
};

export type ErrorCardProps = {
  /** Short, user-facing summary. Required. */
  message: string;
  /** Optional headline shown bolded above the message (e.g. an error code). */
  title?: string;
  /** Extra labeled fields to append to the Copy details payload. */
  details?: ErrorCardDetailField[];
  /** When provided, a Retry button is rendered; the handler reissues the request. */
  onRetry?: (() => void) | (() => Promise<void>);
  /** Optional next-step hint (rendered below the message). */
  hint?: ReactNode;
  /** "warning" softens the visual tone (amber) but keeps both affordances. */
  tone?: ErrorCardTone;
  /** Visual density. "inline" matches drawer/log surfaces. */
  size?: "default" | "inline";
};

export function ErrorCard({
  message,
  title,
  details,
  onRetry,
  hint,
  tone = "error",
  size = "default",
}: ErrorCardProps): ReactElement {
  const [copied, setCopied] = useState(false);
  const [retrying, setRetrying] = useState(false);

  async function onCopy(): Promise<void> {
    const payload = formatDetails({ title, message, details });
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail in insecure contexts or when the document
      // isn't focused. Fall back to a textarea-select approach so the user
      // can still grab the text manually.
      fallbackCopy(payload);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  }

  async function onClickRetry(): Promise<void> {
    if (!onRetry || retrying) return;
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  }

  const palette =
    tone === "warning"
      ? {
          box: "border-amber-300 bg-amber-50 text-amber-900",
          accent: "border-amber-400 bg-white text-amber-800 hover:bg-amber-100",
          mono: "text-amber-900",
        }
      : {
          box: "border-red-300 bg-red-50 text-red-900",
          accent: "border-red-400 bg-white text-red-700 hover:bg-red-100",
          mono: "text-red-900",
        };

  const padding = size === "inline" ? "p-2" : "p-3";
  const text = size === "inline" ? "text-xs" : "text-sm";

  return (
    <div
      role="alert"
      className={`rounded-sm border ${palette.box} ${padding} ${text}`}
      data-testid="error-card"
    >
      {title ? <div className="font-semibold">{title}</div> : null}
      <p className={`${title ? "mt-0.5" : ""} whitespace-pre-wrap break-words`}>{message}</p>
      {hint ? <div className="mt-1 text-xs opacity-90">{hint}</div> : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {onRetry ? (
          <button
            type="button"
            onClick={onClickRetry}
            disabled={retrying}
            className={`rounded-sm border px-2 py-0.5 text-xs font-medium ${palette.accent} disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {retrying ? "Retrying…" : "Retry"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onCopy}
          className={`rounded-sm border px-2 py-0.5 text-xs font-medium ${palette.accent}`}
        >
          {copied ? "Copied!" : "Copy details"}
        </button>
      </div>
    </div>
  );
}

function formatDetails(input: {
  title: string | undefined;
  message: string;
  details: ErrorCardDetailField[] | undefined;
}): string {
  const lines: string[] = [];
  if (input.title) lines.push(`Code: ${input.title}`);
  lines.push(`Message: ${input.message}`);
  if (input.details) {
    for (const f of input.details) {
      lines.push(`${f.label}: ${f.value}`);
    }
  }
  lines.push(`When: ${new Date().toISOString()}`);
  lines.push(`URL: ${typeof window === "undefined" ? "n/a" : window.location.href}`);
  return lines.join("\n");
}

function fallbackCopy(text: string): void {
  if (typeof document === "undefined") return;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    document.execCommand("copy");
  } catch {
    // last-resort: nothing else to do
  }
  document.body.removeChild(ta);
}
