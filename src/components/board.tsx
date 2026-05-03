// Board view replacing the flat card-list. Holds local card state so
// drag-and-drop, create, edit, and delete can update without a refetch.
//
// Drop into the `running` column triggers a `POST /api/cards/:id/run` in
// addition to the status patch. On 409 we keep the move and surface a
// notice with the active runId; on any other error we revert both the
// status patch and the column move. The new runId is recorded in this
// component's local state but the card's `runs[]` is only refreshed on
// the next page reload — task-04 can replace this with a fetch.

"use client";

import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useEffect, useState, type ReactElement } from "react";
import type { Card, CardStatus, Run } from "../protocol/index.js";
import { CardForm } from "./card-form.js";
import { BoardCard, type BoardCardAction } from "./board-card.js";
import { BoardColumn } from "./board-column.js";
import { CardDrawer } from "./card-drawer.js";
import { RunDoneWatcher } from "./run-done-watcher.js";

const STATUS_ORDER: CardStatus[] = ["backlog", "ready", "running", "review", "done", "failed"];

type ZodIssue = { path: (string | number)[]; message: string };

export function Board({
  initial,
  defaultRepoPath = null,
}: {
  initial: Card[];
  defaultRepoPath?: string | null;
}): ReactElement {
  const [cards, setCards] = useState<Card[]>(initial);
  const [creating, setCreating] = useState(false);
  const [actions, setActions] = useState<Record<string, BoardCardAction>>({});
  const [notices, setNotices] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // dnd-kit assigns sequential ids to its accessibility helpers (e.g.
  // `DndDescribedBy-N`); the counter advances per `useSortable` and is not
  // stable between SSR and client mount, producing a hydration mismatch on
  // every reload. Mount the DndContext only after hydration so the ids are
  // generated exactly once on the client.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  function setAction(id: string, action: BoardCardAction): void {
    setActions((prev) => ({ ...prev, [id]: action }));
  }

  function setNotice(id: string, msg: string | null): void {
    setNotices((prev) => {
      const next = { ...prev };
      if (msg) next[id] = msg;
      else delete next[id];
      return next;
    });
  }

  function setError(id: string, msg: string | null): void {
    setErrors((prev) => {
      const next = { ...prev };
      if (msg) next[id] = msg;
      else delete next[id];
      return next;
    });
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
    setNotice(id, null);
    setError(id, null);
    if (selectedCardId === id) setSelectedCardId(null);
  }

  async function refreshCard(cardId: string): Promise<void> {
    try {
      const res = await fetch(`/api/cards/${cardId}`);
      if (!res.ok) return;
      const updated = (await res.json()) as Card;
      setCards((prev) => prev.map((c) => (c.id === cardId ? updated : c)));
    } catch {
      // Best-effort: a refetch failure just leaves the existing state in
      // place; the watcher won't refire and the user can reload manually.
    }
  }

  function onRunStarted(cardId: string, run: Run): void {
    const now = new Date().toISOString();
    setCards((prev) =>
      prev.map((c) =>
        c.id === cardId
          ? { ...c, runs: [...c.runs, run], status: "running", updatedAt: now }
          : c,
      ),
    );
  }

  async function onDragEnd(event: DragEndEvent): Promise<void> {
    const { active, over } = event;
    if (!over) return;

    const cardId = String(active.id);
    const sourceCard = cards.find((c) => c.id === cardId);
    if (!sourceCard) return;

    const overId = String(over.id);
    let targetStatus: CardStatus | null = null;
    if ((STATUS_ORDER as string[]).includes(overId)) {
      targetStatus = overId as CardStatus;
    } else {
      const overCard = cards.find((c) => c.id === overId);
      if (overCard) targetStatus = overCard.status;
    }
    if (!targetStatus || targetStatus === sourceCard.status) return;

    const previousStatus = sourceCard.status;
    const now = new Date().toISOString();

    setCards((prev) =>
      prev.map((c) => (c.id === cardId ? { ...c, status: targetStatus, updatedAt: now } : c)),
    );
    setError(cardId, null);
    setNotice(cardId, null);

    let patchOk = false;
    try {
      const res = await fetch(`/api/cards/${cardId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: targetStatus }),
      });
      if (res.ok) {
        const updated = (await res.json()) as Card;
        setCards((prev) => prev.map((c) => (c.id === cardId ? updated : c)));
        patchOk = true;
      } else {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          issues?: ZodIssue[];
          message?: string;
        };
        const detail = body.message ?? body.error ?? `HTTP ${res.status}`;
        setCards((prev) =>
          prev.map((c) => (c.id === cardId ? { ...c, status: previousStatus } : c)),
        );
        setError(cardId, `Move failed: ${detail}`);
        return;
      }
    } catch (e) {
      setCards((prev) =>
        prev.map((c) => (c.id === cardId ? { ...c, status: previousStatus } : c)),
      );
      setError(cardId, e instanceof Error ? e.message : String(e));
      return;
    }

    if (!patchOk) return;
    if (targetStatus !== "running") return;
    if (previousStatus === "running") return;

    try {
      const runRes = await fetch(`/api/cards/${cardId}/run`, { method: "POST" });
      if (runRes.ok) {
        return;
      }
      if (runRes.status === 409) {
        const body = (await runRes.json().catch(() => ({}))) as {
          error?: string;
          runId?: string;
        };
        setNotice(
          cardId,
          `Run already active${body.runId ? ` (${body.runId})` : ""}.`,
        );
        return;
      }
      const body = (await runRes.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      const detail = body.message ?? body.error ?? `HTTP ${runRes.status}`;
      // Revert both the status patch and the column move.
      await fetch(`/api/cards/${cardId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: previousStatus }),
      }).catch(() => undefined);
      setCards((prev) =>
        prev.map((c) => (c.id === cardId ? { ...c, status: previousStatus } : c)),
      );
      setError(cardId, `Run failed to start: ${detail}`);
    } catch (e) {
      await fetch(`/api/cards/${cardId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: previousStatus }),
      }).catch(() => undefined);
      setCards((prev) =>
        prev.map((c) => (c.id === cardId ? { ...c, status: previousStatus } : c)),
      );
      setError(cardId, e instanceof Error ? e.message : String(e));
    }
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
            className="rounded-sm bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            New card
          </button>
        ) : null}
      </div>

      {creating ? (
        <CardForm
          mode="create"
          onSuccess={onCreated}
          onCancel={() => setCreating(false)}
          defaultRepoPath={defaultRepoPath}
        />
      ) : null}

      {cards.length === 0 && !creating ? (
        <div className="rounded-md border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No cards yet — click <span className="font-medium text-slate-700">New card</span> to start.
        </div>
      ) : null}

      {mounted ? (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {STATUS_ORDER.map((status) => {
              const rows = grouped[status] ?? [];
              return (
                <BoardColumn
                  key={status}
                  status={status}
                  count={rows.length}
                  cardIds={rows.map((c) => c.id)}
                >
                  {rows.map((card) => (
                    <BoardCard
                      key={card.id}
                      card={card}
                      action={actions[card.id] ?? null}
                      inlineNotice={notices[card.id] ?? null}
                      inlineError={errors[card.id] ?? null}
                      onAction={(a) => setAction(card.id, a)}
                      onEdited={onEdited}
                      onDeleted={onDeleted}
                      onSelect={setSelectedCardId}
                    />
                  ))}
                </BoardColumn>
              );
            })}
          </div>
        </DndContext>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {STATUS_ORDER.map((status) => {
            const rows = grouped[status] ?? [];
            return (
              <section
                key={status}
                className="flex flex-col rounded-md border border-slate-200 bg-slate-50 p-3"
              >
                <header className="mb-3 flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                    {status}
                  </h3>
                  <span className="text-xs text-slate-500">{rows.length}</span>
                </header>
              </section>
            );
          })}
        </div>
      )}

      <CardDrawer
        card={cards.find((c) => c.id === selectedCardId) ?? null}
        onClose={() => setSelectedCardId(null)}
        onEdited={onEdited}
        onDeleted={onDeleted}
        onRunStarted={onRunStarted}
      />

      {cards.flatMap((c) => {
        const last = c.runs[c.runs.length - 1];
        if (!last || last.endedAt) return [];
        return [
          <RunDoneWatcher
            key={`${c.id}:${last.id}`}
            cardId={c.id}
            runId={last.id}
            onDone={() => void refreshCard(c.id)}
          />,
        ];
      })}
    </div>
  );
}

function groupByStatus(cards: Card[]): Partial<Record<CardStatus, Card[]>> {
  const out: Partial<Record<CardStatus, Card[]>> = {};
  const sorted = [...cards].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  for (const c of sorted) {
    const list = out[c.status] ?? [];
    list.push(c);
    out[c.status] = list;
  }
  return out;
}
