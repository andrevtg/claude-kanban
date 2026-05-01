// PATCH /api/cards/:id   -> update mutable fields (title, prompt, status,
//                           repoPath, baseBranch). Attempts to patch
//                           immutable fields (id, createdAt, updatedAt,
//                           runs) are REJECTED with 400 — the patch schema
//                           is strict to make the intent explicit.
// DELETE /api/cards/:id   -> 204 on success, 404 if missing.

import { getDeps } from "../../_lib/deps.js";
import { CardPatchSchema } from "../../_lib/schemas.js";
import type { Card } from "../../../../protocol/index.js";
import {
  json,
  noContent,
  readJsonBody,
  stripUndefined,
  withErrorHandling,
} from "../../_lib/respond.js";

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: RouteCtx): Promise<Response> {
  return withErrorHandling(async () => {
    const { id } = await ctx.params;
    const { store } = getDeps();
    const raw = await readJsonBody(req);
    const patch = CardPatchSchema.parse(raw);
    const card = await store.updateCard(id, stripUndefined(patch) as Partial<Card>);
    return json(card);
  });
}

export async function DELETE(_req: Request, ctx: RouteCtx): Promise<Response> {
  return withErrorHandling(async () => {
    const { id } = await ctx.params;
    const { store } = getDeps();
    await store.deleteCard(id);
    return noContent();
  });
}
