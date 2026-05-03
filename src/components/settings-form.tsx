"use client";

import { useState, type FormEvent, type ReactElement } from "react";
import {
  DEFAULT_BASH_ALLOWLIST,
  DEFAULT_MODEL,
  type GlobalSettings,
} from "../protocol/index.js";

type ZodIssue = { path: (string | number)[]; message: string };

type FieldErrors = Partial<
  Record<"apiKeyPath" | "apiKeyValue" | "defaultModel" | "defaultRepoPath" | "bashAllowlist", string>
>;

export function SettingsForm({ initial }: { initial: GlobalSettings | null }): ReactElement {
  const [apiKeyPath, setApiKeyPath] = useState(initial?.apiKeyPath ?? "");
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [showInlineKey, setShowInlineKey] = useState(false);
  const [chmodApiKeyFile, setChmodApiKeyFile] = useState(false);
  const [defaultModel, setDefaultModel] = useState(initial?.defaultModel ?? DEFAULT_MODEL);
  const [defaultRepoPath, setDefaultRepoPath] = useState(initial?.defaultRepoPath ?? "");
  const [bashAllowlist, setBashAllowlist] = useState<string[]>(
    initial?.bashAllowlist ?? [...DEFAULT_BASH_ALLOWLIST],
  );
  const [prAutoApprove, setPrAutoApprove] = useState(initial?.prAutoApprove ?? false);

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function setAllowlistAt(idx: number, value: string): void {
    setBashAllowlist((prev) => prev.map((v, i) => (i === idx ? value : v)));
  }

  function addAllowlistRow(): void {
    setBashAllowlist((prev) => [...prev, ""]);
  }

  function removeAllowlistAt(idx: number): void {
    setBashAllowlist((prev) => prev.filter((_, i) => i !== idx));
  }

  function resetAllowlist(): void {
    setBashAllowlist([...DEFAULT_BASH_ALLOWLIST]);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setFormError(null);
    setFieldErrors({});
    setSavedAt(null);

    const cleanedAllowlist = bashAllowlist.map((s) => s.trim()).filter((s) => s.length > 0);

    const inlineKey = showInlineKey ? apiKeyValue.trim() : "";
    const errs: FieldErrors = {};
    if (inlineKey.length === 0 && apiKeyPath.trim().length === 0) {
      errs.apiKeyPath = "Provide either an API key file path or paste a key value.";
    }
    if (defaultModel.trim().length === 0) {
      errs.defaultModel = "Default model is required.";
    }
    if (defaultRepoPath.length > 0 && !defaultRepoPath.startsWith("/")) {
      errs.defaultRepoPath = "Default repo path must be absolute (start with /).";
    }
    if (apiKeyPath.length > 0 && !inlineKey && !apiKeyPath.startsWith("/")) {
      errs.apiKeyPath = "API key path must be absolute (start with /).";
    }
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }

    const body: Record<string, unknown> = {
      defaultModel: defaultModel.trim(),
      bashAllowlist: cleanedAllowlist,
      prAutoApprove,
    };
    if (defaultRepoPath.trim().length > 0) body.defaultRepoPath = defaultRepoPath.trim();
    if (inlineKey.length > 0) {
      body.apiKeyValue = inlineKey;
    } else {
      body.apiKeyPath = apiKeyPath.trim();
      if (chmodApiKeyFile) body.chmodApiKeyFile = true;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const saved = (await res.json()) as GlobalSettings;
        setApiKeyPath(saved.apiKeyPath);
        setApiKeyValue("");
        setShowInlineKey(false);
        setChmodApiKeyFile(false);
        setDefaultModel(saved.defaultModel);
        setDefaultRepoPath(saved.defaultRepoPath ?? "");
        setBashAllowlist(saved.bashAllowlist);
        setPrAutoApprove(saved.prAutoApprove);
        setSavedAt(new Date().toLocaleTimeString());
        return;
      }
      if (res.status === 400) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
          issues?: ZodIssue[];
          message?: string;
        };
        if (payload.issues && payload.issues.length > 0) {
          const next: FieldErrors = {};
          for (const issue of payload.issues) {
            const key = String(issue.path[0] ?? "");
            if (
              key === "apiKeyPath" ||
              key === "apiKeyValue" ||
              key === "defaultModel" ||
              key === "defaultRepoPath" ||
              key === "bashAllowlist"
            ) {
              next[key] = issue.message;
            }
          }
          setFieldErrors(next);
          if (Object.keys(next).length === 0) {
            setFormError(payload.error ?? "invalid_body");
          }
          return;
        }
        setFormError(payload.error ?? payload.message ?? "Bad request.");
        return;
      }
      const payload = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      setFormError(`Request failed (${res.status}): ${payload.message ?? payload.error ?? "unknown"}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const hasKey = apiKeyPath.length > 0;

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="space-y-6 rounded-md border border-slate-300 bg-slate-50 p-6"
    >
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">Anthropic API key</h2>
        <p className="text-xs text-slate-600">
          The key is stored in a 0600-mode file on disk; settings.json only references the path.
        </p>
        <div>
          <label htmlFor="apiKeyPath" className="mb-1 block text-xs font-medium text-slate-700">
            Key file path
          </label>
          <input
            id="apiKeyPath"
            type="text"
            value={apiKeyPath}
            onChange={(e) => setApiKeyPath(e.target.value)}
            placeholder="/Users/you/.claude-kanban/anthropic-key"
            disabled={showInlineKey}
            className="block w-full rounded-sm border border-slate-300 px-2 py-1 font-mono text-sm disabled:bg-slate-100"
          />
          {!hasKey && !showInlineKey ? (
            <p className="mt-1 text-xs text-amber-700">No key configured yet.</p>
          ) : null}
          {fieldErrors.apiKeyPath ? (
            <p className="mt-1 text-xs text-red-700" role="alert">
              {fieldErrors.apiKeyPath}
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <input
            id="chmodApiKeyFile"
            type="checkbox"
            checked={chmodApiKeyFile}
            onChange={(e) => setChmodApiKeyFile(e.target.checked)}
            disabled={showInlineKey}
          />
          <label htmlFor="chmodApiKeyFile" className="text-xs text-slate-700">
            Chmod the file to 0600 if it isn&apos;t already.
          </label>
        </div>

        <div>
          {!showInlineKey ? (
            <button
              type="button"
              onClick={() => setShowInlineKey(true)}
              className="text-xs text-slate-700 underline"
            >
              Set new key (paste value instead)
            </button>
          ) : (
            <div className="space-y-2 rounded-sm border border-slate-300 bg-white p-3">
              <label htmlFor="apiKeyValue" className="block text-xs font-medium text-slate-700">
                Paste API key value
              </label>
              <input
                id="apiKeyValue"
                type="password"
                value={apiKeyValue}
                onChange={(e) => setApiKeyValue(e.target.value)}
                autoComplete="off"
                className="block w-full rounded-sm border border-slate-300 px-2 py-1 font-mono text-sm"
              />
              <p className="text-xs text-slate-600">
                Will be written to <span className="font-mono">~/.claude-kanban/anthropic-key</span>{" "}
                with mode 0600. Settings will reference that path.
              </p>
              <button
                type="button"
                onClick={() => {
                  setShowInlineKey(false);
                  setApiKeyValue("");
                }}
                className="text-xs text-slate-700 underline"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">Defaults</h2>
        <div>
          <label htmlFor="defaultModel" className="mb-1 block text-xs font-medium text-slate-700">
            Default model
          </label>
          <input
            id="defaultModel"
            type="text"
            value={defaultModel}
            onChange={(e) => setDefaultModel(e.target.value)}
            className="block w-full rounded-sm border border-slate-300 px-2 py-1 font-mono text-sm"
          />
          {fieldErrors.defaultModel ? (
            <p className="mt-1 text-xs text-red-700" role="alert">
              {fieldErrors.defaultModel}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor="defaultRepoPath" className="mb-1 block text-xs font-medium text-slate-700">
            Default repo path (optional)
          </label>
          <input
            id="defaultRepoPath"
            type="text"
            value={defaultRepoPath}
            onChange={(e) => setDefaultRepoPath(e.target.value)}
            placeholder="/Users/you/projects/example"
            className="block w-full rounded-sm border border-slate-300 px-2 py-1 font-mono text-sm"
          />
          {fieldErrors.defaultRepoPath ? (
            <p className="mt-1 text-xs text-red-700" role="alert">
              {fieldErrors.defaultRepoPath}
            </p>
          ) : null}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Bash allowlist</h2>
          <button
            type="button"
            onClick={resetAllowlist}
            className="text-xs text-slate-700 underline"
          >
            Reset to defaults
          </button>
        </div>
        <p className="text-xs text-slate-600">
          Glob patterns the worker pre-approves for the agent. Anything not matching falls through
          to deny.
        </p>
        <ul className="space-y-1">
          {bashAllowlist.map((entry, idx) => (
            <li key={idx} className="flex items-center gap-2">
              <input
                type="text"
                value={entry}
                onChange={(e) => setAllowlistAt(idx, e.target.value)}
                className="block flex-1 rounded-sm border border-slate-300 px-2 py-1 font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => removeAllowlistAt(idx)}
                aria-label={`Remove ${entry || "row"}`}
                className="rounded-sm border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={addAllowlistRow}
          className="rounded-sm border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
        >
          Add entry
        </button>
        {fieldErrors.bashAllowlist ? (
          <p className="text-xs text-red-700" role="alert">
            {fieldErrors.bashAllowlist}
          </p>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">PR flow</h2>
        <div className="flex items-center gap-2">
          <input
            id="prAutoApprove"
            type="checkbox"
            checked={prAutoApprove}
            onChange={(e) => setPrAutoApprove(e.target.checked)}
          />
          <label htmlFor="prAutoApprove" className="text-xs text-slate-700">
            Auto-approve PR creation when a successful run produces a diff (honored in phase 4).
          </label>
        </div>
      </section>

      {formError ? (
        <p className="text-sm text-red-700" role="alert">
          {formError}
        </p>
      ) : null}
      {savedAt ? (
        <p className="text-sm text-emerald-700" role="status">
          Saved at {savedAt}.
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-sm bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {submitting ? "Saving…" : "Save settings"}
        </button>
      </div>
    </form>
  );
}
