// Fake worker that emits ready then hangs forever, ignoring cancel and
// SIGTERM. Used to exercise the supervisor's SIGTERM → SIGKILL escalation.

import { createInterface } from "node:readline";

process.on("SIGTERM", () => {
  // Swallow SIGTERM so the supervisor must escalate to SIGKILL.
});

const rl = createInterface({ input: process.stdin });
rl.on("line", () => {
  // Ignore all parent messages, including cancel.
});

process.stdout.write(JSON.stringify({ type: "ready" }) + "\n");

// Keep the event loop alive forever.
setInterval(() => {}, 1_000_000);
