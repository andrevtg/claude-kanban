// EXPECTED: 1 boundary violation — lib must not import from worker.
import { runWorker } from "../../../src/worker/index.js";
export const x = runWorker;
