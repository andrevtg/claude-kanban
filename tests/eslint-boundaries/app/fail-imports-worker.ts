// EXPECTED: 1 boundary violation — app must not import from worker.
import { x } from "../../../src/worker/index.js";
export const y = x;
