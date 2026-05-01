// Zod schemas for request bodies. Defined here (not in src/protocol) because
// they describe the HTTP surface, not the persisted-card or wire-protocol
// shape — those live in src/protocol/.

import { z } from "zod";
import { CardStatusSchema } from "../../../protocol/card.js";

export const NewCardBodySchema = z.object({
  title: z.string().min(1),
  prompt: z.string(),
  repoPath: z.string().min(1),
  baseBranch: z.string().min(1),
  status: CardStatusSchema.optional(),
});
export type NewCardBody = z.infer<typeof NewCardBodySchema>;

// Strict so attempts to PATCH `id`, `createdAt`, `runs`, etc. are rejected
// with a 400 rather than silently dropped. Documented in the route file.
export const CardPatchSchema = z
  .object({
    title: z.string().min(1).optional(),
    prompt: z.string().optional(),
    status: CardStatusSchema.optional(),
    repoPath: z.string().min(1).optional(),
    baseBranch: z.string().min(1).optional(),
  })
  .strict();
export type CardPatch = z.infer<typeof CardPatchSchema>;

export const ApprovePrBodySchema = z.object({
  title: z.string().min(1),
  body: z.string(),
});
export type ApprovePrBody = z.infer<typeof ApprovePrBodySchema>;
