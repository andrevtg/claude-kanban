// EXPECTED: 1 boundary violation — worker must not import from lib.
import { paths } from "../../../src/lib/paths.js";
export const x = paths;
