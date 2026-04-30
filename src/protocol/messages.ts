// Skeleton — to be implemented in phase-1/task-02.
// Read tasks/phase-1/task-02-protocol-types.md before editing.

// Reminder of the wire protocol shape (see docs/01-architecture.md):
//
// Parent → Worker:
//   { type: "init", run: RunInitPayload }
//   { type: "approve_pr", title, body }
//   { type: "cancel" }
//
// Worker → Parent:
//   { type: "ready" }
//   { type: "event", event: AgentEvent }
//   { type: "diff_ready", stat }
//   { type: "pr_opened", url }
//   { type: "error", code, message }
//   { type: "done", exitCode }

// TODO(phase-1/task-02): Zod discriminated union + parseWireMessage
export type WireMessage = unknown;
