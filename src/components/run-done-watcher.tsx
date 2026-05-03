"use client";

// Invisible component that opens an EventSource for a single active run and
// fires `onDone` exactly once when the run terminates. Used by the board to
// know when to refetch a card (so e.g. a Cancel button can disappear once
// the run actually ends, even if the user never opened the drawer).

import { useEffect, useRef } from "react";

export function RunDoneWatcher({
  cardId,
  runId,
  onDone,
}: {
  cardId: string;
  runId: string;
  onDone: () => void;
}): null {
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const es = new EventSource(`/api/cards/${cardId}/runs/${runId}/events`);
    let fired = false;
    const handler = (): void => {
      if (fired) return;
      fired = true;
      onDoneRef.current();
      es.close();
    };
    es.addEventListener("done", handler);
    return () => {
      es.removeEventListener("done", handler);
      es.close();
    };
  }, [cardId, runId]);
  return null;
}
