// EXPECTED: 1 boundary violation — types is ambient-only and must not import
// from any other src/* element.
import { paths } from "../../../src/lib/paths.js";
export const x = paths;
