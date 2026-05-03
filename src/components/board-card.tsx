"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReactElement } from "react";
import type { Card } from "../protocol/index.js";
import { CardForm } from "./card-form.js";
import { CardDeleteConfirm } from "./card-delete-confirm.js";
import { RunCard } from "./run-card.js";

export type BoardCardAction = { kind: "edit" } | { kind: "delete" } | { kind: "run" } | null;

type Props = {
  card: Card;
  action: BoardCardAction;
  inlineNotice: string | null;
  inlineError: string | null;
  onAction: (action: BoardCardAction) => void;
  onEdited: (card: Card) => void;
  onDeleted: (id: string) => void;
  onSelect: (id: string) => void;
};

export function BoardCard({
  card,
  action,
  inlineNotice,
  inlineError,
  onAction,
  onEdited,
  onDeleted,
  onSelect,
}: Props): ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { status: card.status },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onSelect(card.id)}
      className="cursor-grab touch-none rounded-md border border-slate-300 bg-white p-3 shadow-xs active:cursor-grabbing"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {card.status === "running" ? (
              <span
                aria-label="running"
                className="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-500"
              />
            ) : null}
            <h4 className="truncate text-sm font-semibold text-slate-900">{card.title}</h4>
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-slate-600">{card.prompt}</p>
          <p className="mt-1.5 truncate font-mono text-[10px] text-slate-500">
            {card.repoPath} · {card.baseBranch}
          </p>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-1">
        <RowButton
          active={action?.kind === "run"}
          onClick={() => onAction(action?.kind === "run" ? null : { kind: "run" })}
          label={action?.kind === "run" ? "Hide" : "Run"}
        />
        <RowButton
          active={action?.kind === "edit"}
          onClick={() => onAction(action?.kind === "edit" ? null : { kind: "edit" })}
          label="Edit"
        />
        <RowButton
          active={action?.kind === "delete"}
          onClick={() => onAction(action?.kind === "delete" ? null : { kind: "delete" })}
          label="Delete"
          danger
        />
      </div>

      {inlineNotice ? (
        <p className="mt-2 text-xs text-amber-700" role="status">
          {inlineNotice}
        </p>
      ) : null}
      {inlineError ? (
        <p className="mt-2 text-xs text-red-700" role="alert">
          {inlineError}
        </p>
      ) : null}

      {action?.kind === "edit" ? (
        <div className="mt-3" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <CardForm
            mode="edit"
            initial={card}
            onSuccess={onEdited}
            onCancel={() => onAction(null)}
          />
        </div>
      ) : null}

      {action?.kind === "delete" ? (
        <div className="mt-3" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <CardDeleteConfirm
            card={card}
            onDeleted={() => onDeleted(card.id)}
            onCancel={() => onAction(null)}
          />
        </div>
      ) : null}

      {action?.kind === "run" ? (
        <div className="mt-3" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          <RunCard card={card} />
        </div>
      ) : null}
    </li>
  );
}

function RowButton({
  active,
  onClick,
  label,
  danger,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  danger?: boolean;
}): ReactElement {
  const base =
    "rounded-sm border px-2 py-0.5 text-[11px] font-medium transition-colors";
  const cls = danger
    ? `${base} border-red-300 text-red-700 hover:bg-red-50`
    : `${base} border-slate-300 text-slate-700 hover:bg-slate-100`;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      aria-pressed={active}
      className={cls}
    >
      {label}
    </button>
  );
}
