// EXPECTED: 1 boundary violation — cli must not import from worker.
import { run } from "../../../src/worker/index.js";
export const x = run;
