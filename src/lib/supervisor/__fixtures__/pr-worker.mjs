// Fake worker that emits pr_opened then done. Used by the supervisor test
// that asserts prUrl persistence.

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
        type: "pr_opened",
        url: "https://github.com/example/repo/pull/42",
      }) + "\n",
    );
    process.stdout.write(JSON.stringify({ type: "done", exitCode: 0 }) + "\n");
    rl.close();
    setImmediate(() => process.exit(0));
  }
});
