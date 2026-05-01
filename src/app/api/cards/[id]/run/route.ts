// POST /api/cards/:id/run -> spawn a worker for the card.
//
// 404 if the card does not exist.
// 400 if global settings are unconfigured (without settings the worker has
// no model or bash allowlist; failing fast here is clearer than waiting for
// the supervisor to crash).
// 409 if a run is already active for this card (DuplicateRunError).

import { getDeps } from "../../../_lib/deps.js";
import { badRequest, json, notFound, withErrorHandling } from "../../../_lib/respond.js";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: RouteCtx): Promise<Response> {
  return withErrorHandling(async () => {
    const { id } = await ctx.params;
    const { store, supervisor } = getDeps();

    const card = await store.getCard(id);
    if (!card) return notFound("card_not_found");

    const settings = await store.getSettings();
    if (!settings) {
      return badRequest("settings_missing", {
        message: "configure settings first via the settings page",
      });
    }

    const handle = await supervisor.startRun(card, settings);
    return json(handle);
  });
}
