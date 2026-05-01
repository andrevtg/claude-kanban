// Fake worker for supervisor tests. Reads a single init line from stdin,
// emits ready + a synthetic event + done, then exits 0.

import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin });
rl.once("line", () => {
  process.stdout.write(JSON.stringify({ type: "ready" }) + "\n");
  process.stdout.write(
    JSON.stringify({
      type: "event",
      event: { kind: "worker", level: "info", message: "hello from fake" },
    }) + "\n",
  );
  process.stdout.write(JSON.stringify({ type: "done", exitCode: 0 }) + "\n");
  rl.close();
  // Give the parent a tick to drain stdout, then exit.
  setImmediate(() => process.exit(0));
});
