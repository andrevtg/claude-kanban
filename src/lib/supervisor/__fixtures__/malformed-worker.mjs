// Fake worker that emits a malformed line between ready and done. The
// supervisor should surface a synthetic error and stay alive.

import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin });
rl.once("line", () => {
  process.stdout.write(JSON.stringify({ type: "ready" }) + "\n");
  process.stdout.write("{not json\n");
  process.stdout.write(JSON.stringify({ type: "done", exitCode: 0 }) + "\n");
  rl.close();
  setImmediate(() => process.exit(0));
});
