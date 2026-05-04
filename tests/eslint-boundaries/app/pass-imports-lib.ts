// EXPECTED: 0 boundary violations — app may import lib and protocol.
import { x } from "../../../src/lib/paths.js";
import type { Card } from "../../../src/protocol/card.js";
export const a: Card | undefined = undefined;
export const b = x;
