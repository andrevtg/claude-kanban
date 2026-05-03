// Fake worker that emits a diff_ready message before done. Used by the
// supervisor test that asserts diffStat persistence.

import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin });
rl.once("line", () => {
  process.stdout.write(JSON.stringify({ type: "ready" }) + "\n");
  process.stdout.write(
    JSON.stringify({
      type: "diff_ready",
      stat: { files: 3, insertions: 7, deletions: 2 },
      patchPath: "/tmp/fake/run.patch",
      truncated: false,
      bytes: 4242,
    }) + "\n",
  );
  process.stdout.write(JSON.stringify({ type: "done", exitCode: 0 }) + "\n");
  rl.close();
  setImmediate(() => process.exit(0));
});
