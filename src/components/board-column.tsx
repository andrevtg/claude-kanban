"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { ReactElement, ReactNode } from "react";
import type { CardStatus } from "../protocol/index.js";

const TITLES: Record<CardStatus, string> = {
  backlog: "Backlog",
  ready: "Ready",
  running: "Running",
  review: "Review",
  done: "Done",
  failed: "Failed",
};

type Props = {
  status: CardStatus;
  cardIds: string[];
  count: number;
  children: ReactNode;
};

export function BoardColumn({ status, cardIds, count, children }: Props): ReactElement {
  const { setNodeRef, isOver } = useDroppable({ id: status, data: { status } });

  return (
    <section
      ref={setNodeRef}
      className={`flex flex-col rounded-md border bg-slate-50 p-3 transition-colors ${
        isOver ? "border-slate-500 bg-slate-100" : "border-slate-200"
      }`}
    >
      <header className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700">
          {TITLES[status]}
        </h3>
        <span className="text-xs text-slate-500">{count}</span>
      </header>
      <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
        <ul className="flex min-h-24 flex-1 flex-col gap-2">
          {count === 0 ? (
            <li className="rounded-md border border-dashed border-slate-300 p-3 text-center text-[11px] text-slate-400">
              Drop cards here
            </li>
          ) : null}
          {children}
        </ul>
      </SortableContext>
    </section>
  );
}
