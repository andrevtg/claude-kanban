"use client";

import { useState, type FormEvent, type ReactElement } from "react";
import type { Card, CardStatus } from "../protocol/index.js";

const STATUSES: CardStatus[] = ["backlog", "ready", "running", "review", "done", "failed"];

type FieldErrors = Partial<Record<"title" | "prompt" | "repoPath" | "baseBranch" | "status", string>>;

type ZodIssue = { path: (string | number)[]; message: string };

type Props =
  | {
      mode: "create";
      onSuccess: (card: Card) => void;
      onCancel: () => void;
      initial?: undefined;
      defaultRepoPath?: string | null;
    }
  | {
      mode: "edit";
      initial: Card;
      onSuccess: (card: Card) => void;
      onCancel: () => void;
      defaultRepoPath?: undefined;
    };

export function CardForm(props: Props): ReactElement {
  const { mode, onSuccess, onCancel } = props;
  const initial = mode === "edit" ? props.initial : undefined;
  const defaultRepoPath = mode === "create" ? props.defaultRepoPath ?? "" : "";

  const [title, setTitle] = useState(initial?.title ?? "");
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [repoPath, setRepoPath] = useState(initial?.repoPath ?? defaultRepoPath);
  const [baseBranch, setBaseBranch] = useState(initial?.baseBranch ?? "main");
  const [status, setStatus] = useState<CardStatus>(initial?.status ?? "backlog");

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function clientValidate(): FieldErrors {
    const errors: FieldErrors = {};
    if (!title.trim()) errors.title = "Title is required.";
    if (!prompt.trim()) errors.prompt = "Prompt is required.";
    if (!repoPath.trim()) errors.repoPath = "Repo path is required.";
    else if (!repoPath.startsWith("/")) errors.repoPath = "Repo path must be absolute (start with /).";
    if (!baseBranch.trim()) errors.baseBranch = "Base branch is required.";
    return errors;
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setFormError(null);
    setFieldErrors({});

    const clientErrors = clientValidate();
    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors);
      return;
    }

    setSubmitting(true);
    try {
      const res =
        mode === "create"
          ? await fetch("/api/cards", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ title, prompt, repoPath, baseBranch, status }),
            })
          : await fetch(`/api/cards/${initial!.id}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(diffPatch(initial!, { title, prompt, repoPath, baseBranch, status })),
            });

      if (res.ok) {
        const card = (await res.json()) as Card;
        onSuccess(card);
        return;
      }

      if (res.status === 400) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          issues?: ZodIssue[];
          message?: string;
        };
        if (body.issues && body.issues.length > 0) {
          const next: FieldErrors = {};
          for (const issue of body.issues) {
            const key = String(issue.path[0] ?? "");
            if (
              key === "title" ||
              key === "prompt" ||
              key === "repoPath" ||
              key === "baseBranch" ||
              key === "status"
            ) {
              next[key] = issue.message;
            }
          }
          setFieldErrors(next);
          if (Object.keys(next).length === 0) {
            setFormError(body.error ?? "invalid_body");
          }
        } else {
          setFormError(body.error ?? body.message ?? "Bad request.");
        }
        return;
      }

      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      setFormError(`Request failed (${res.status}): ${body.message ?? body.error ?? "unknown"}`);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-md border border-slate-300 bg-slate-50 p-4"
      noValidate
    >
      <h3 className="text-base font-semibold text-slate-900">
        {mode === "create" ? "New card" : "Edit card"}
      </h3>

      <Field label="Title" error={fieldErrors.title} htmlFor="card-title">
        <input
          id="card-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="block w-full rounded-sm border border-slate-300 px-2 py-1 text-sm"
        />
      </Field>

      <Field label="Prompt" error={fieldErrors.prompt} htmlFor="card-prompt">
        <textarea
          id="card-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={5}
          className="block w-full rounded-sm border border-slate-300 px-2 py-1 font-mono text-sm"
        />
      </Field>

      <Field label="Repo path" error={fieldErrors.repoPath} htmlFor="card-repo">
        <input
          id="card-repo"
          type="text"
          value={repoPath}
          onChange={(e) => setRepoPath(e.target.value)}
          placeholder="/Users/you/projects/example"
          className="block w-full rounded-sm border border-slate-300 px-2 py-1 font-mono text-sm"
        />
      </Field>

      <Field label="Base branch" error={fieldErrors.baseBranch} htmlFor="card-branch">
        <input
          id="card-branch"
          type="text"
          value={baseBranch}
          onChange={(e) => setBaseBranch(e.target.value)}
          className="block w-full rounded-sm border border-slate-300 px-2 py-1 font-mono text-sm"
        />
      </Field>

      {mode === "edit" ? (
        <Field label="Status" error={fieldErrors.status} htmlFor="card-status">
          <select
            id="card-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as CardStatus)}
            className="block rounded-sm border border-slate-300 px-2 py-1 text-sm"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      {formError ? (
        <p className="text-sm text-red-700" role="alert">
          {formError}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-sm bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {submitting ? "Saving…" : mode === "create" ? "Create card" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="rounded-sm border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  htmlFor,
  children,
}: {
  label: string;
  error: string | undefined;
  htmlFor: string;
  children: ReactElement;
}): ReactElement {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-slate-700">
        {label}
      </label>
      {children}
      {error ? (
        <p className="mt-1 text-xs text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function diffPatch(
  before: Card,
  after: { title: string; prompt: string; repoPath: string; baseBranch: string; status: CardStatus },
): Partial<Card> {
  const patch: Partial<Card> = {};
  if (after.title !== before.title) patch.title = after.title;
  if (after.prompt !== before.prompt) patch.prompt = after.prompt;
  if (after.repoPath !== before.repoPath) patch.repoPath = after.repoPath;
  if (after.baseBranch !== before.baseBranch) patch.baseBranch = after.baseBranch;
  if (after.status !== before.status) patch.status = after.status;
  return patch;
}
