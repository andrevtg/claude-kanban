// EXPECTED: 1 boundary violation — components must not import from worker.
import { foo } from "../../../src/worker/run.js";
export const x = foo;
