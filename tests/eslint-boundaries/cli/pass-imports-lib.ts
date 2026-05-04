// EXPECTED: 0 boundary violations — cli may import lib and protocol.
import { paths } from "../../../src/lib/paths.js";
import type { Card } from "../../../src/protocol/card.js";
export const a: Card | undefined = undefined;
export const b = paths;
