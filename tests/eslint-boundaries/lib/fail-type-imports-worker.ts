// EXPECTED: 1 boundary violation — type-only imports cross boundaries too.
import type { Trace } from "../../../src/worker/trace.js";
export type X = Trace;
