// EXPECTED: 1 boundary violation — protocol must not import from lib.
import { something } from "../../../src/lib/paths.js";
export const x = something;
