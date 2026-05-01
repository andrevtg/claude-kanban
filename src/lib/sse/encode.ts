// SSE wire-format helpers. Pure functions: no Next.js, no Node streams,
// no module-level state. Route handlers compose these into a stream and
// the encoders own the only decisions about frame shape.
//
// Frame conventions for this codebase:
// - Live events use named frame `event: message` with the EventLogEntry as JSON.
// - Terminal frame uses named event `done` so the browser EventSource can
//   distinguish "stream ended cleanly" from "connection dropped".
// - Heartbeats are SSE comment lines (`: hb`) — not delivered to the
//   `EventSource.onmessage` handler, just keeps proxies from idling out.

import type { EventLogEntry } from "../../protocol/index.js";

export function encodeEvent(entry: EventLogEntry): string {
  return `event: message\ndata: ${JSON.stringify(entry)}\n\n`;
}

export function encodeHeartbeat(): string {
  return `: hb\n\n`;
}

export function encodeDone(exitCode: number): string {
  return `event: done\ndata: ${JSON.stringify({ exitCode })}\n\n`;
}
