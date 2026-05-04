// EXPECTED: 0 boundary violations — protocol may import zod and other protocol files.
import { z } from "zod";
import type { Foo } from "./other.js";
export const schema = z.object({});
export type T = Foo;
