// Fake worker that emits an error with a PR-related code, then done. Used
// by the supervisor test that asserts prUrl is NOT persisted on error.

import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin });
let initSeen = false;

rl.on("line", (line) => {
  if (line.length === 0) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (!initSeen && msg.type === "init") {
    initSeen = true;
    process.stdout.write(JSON.stringify({ type: "ready" }) + "\n");
    process.stdout.write(
      JSON.stringify({
        type: "error",
        code: "PUSH_FAILED",
        message: "remote rejected push",
      }) + "\n",
    );
    process.stdout.write(JSON.stringify({ type: "done", exitCode: 0 }) + "\n");
    rl.close();
    setImmediate(() => process.exit(0));
  }
});
