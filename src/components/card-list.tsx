"use client";

import { useState, type ReactElement } from "react";
import type { Card, CardStatus } from "../protocol/index.js";
import { CardForm } from "./card-form.js";
import { CardDeleteConfirm } from "./card-delete-confirm.js";
import { RunCard } from "./run-card.js";

const STATUS_ORDER: CardStatus[] = ["backlog", "ready", "running", "review", "done", "failed"];

type RowAction = { kind: "edit" } | { kind: "delete" } | { kind: "run" } | null;

export function CardList({ initial }: { initial: Card[] }): ReactElement {
  const [cards, setCards] = useState<Card[]>(initial);
  const [creating, setCreating] = useState(false);
  const [actions, setActions] = useState<Record<string, RowAction>>({});

  function setAction(id: string, action: RowAction): void {
    setActions((prev) => ({ ...prev, [id]: action }));
  }

  function onCreated(card: Card): void {
    setCards((prev) => [...prev, card]);
    setCreating(false);
  }

  function onEdited(card: Card): void {
    setCards((prev) => prev.map((c) => (c.id === card.id ? card : c)));
    setAction(card.id, null);
  }

  function onDeleted(id: string): void {
    setCards((prev) => prev.filter((c) => c.id !== id));
    setAction(id, null);
  }

  const grouped = groupByStatus(cards);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Cards ({cards.length})</h2>
        {!creating ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            New card
          </button>
        ) : null}
      </div>

      {creating ? (
        <CardForm mode="create" onSuccess={onCreated} onCancel={() => setCreating(false)} />
      ) : null}

      {cards.length === 0 && !creating ? (
        <div className="rounded-md border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No cards yet — click <span className="font-medium text-slate-700">New card</span> to start.
        </div>
      ) : null}

      {STATUS_ORDER.map((status) => {
        const rows = grouped[status];
        if (!rows || rows.length === 0) return null;
        return (
          <section key={status} className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {status} ({rows.length})
            </h3>
            <ul className="space-y-3">
              {rows.map((card) => {
                const action = actions[card.id] ?? null;
                return (
                  <li key={card.id} className="rounded-md border border-slate-300 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <h4 className="truncate text-sm font-semibold text-slate-900">{card.title}</h4>
                        <p className="mt-1 line-clamp-2 text-xs text-slate-600">{card.prompt}</p>
                        <p className="mt-2 font-mono text-[11px] text-slate-500">
                          {card.repoPath} · {card.baseBranch}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setAction(card.id, action?.kind === "run" ? null : { kind: "run" })
                          }
                          className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          {action?.kind === "run" ? "Hide" : "Run"}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setAction(card.id, action?.kind === "edit" ? null : { kind: "edit" })
                          }
                          className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setAction(card.id, action?.kind === "delete" ? null : { kind: "delete" })
                          }
                          className="rounded border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    {action?.kind === "edit" ? (
                      <div className="mt-4">
                        <CardForm
                          mode="edit"
                          initial={card}
                          onSuccess={onEdited}
                          onCancel={() => setAction(card.id, null)}
                        />
                      </div>
                    ) : null}

                    {action?.kind === "delete" ? (
                      <div className="mt-4">
                        <CardDeleteConfirm
                          card={card}
                          onDeleted={() => onDeleted(card.id)}
                          onCancel={() => setAction(card.id, null)}
                        />
                      </div>
                    ) : null}

                    {action?.kind === "run" ? (
                      <div className="mt-4">
                        <RunCard card={card} />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function groupByStatus(cards: Card[]): Partial<Record<CardStatus, Card[]>> {
  const out: Partial<Record<CardStatus, Card[]>> = {};
  for (const c of cards) {
    const list = out[c.status] ?? [];
    list.push(c);
    out[c.status] = list;
  }
  return out;
}
