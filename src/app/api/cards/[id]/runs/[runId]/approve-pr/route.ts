// POST /api/cards/:id/runs/:runId/approve-pr -> relay PR approval to the
// worker. 202 because the actual `git push` + `gh pr create` happens async
// inside the worker (phase-4 wires that side); this endpoint just hands off
// the title and body. UnknownRunError -> 404.

import { getDeps } from "../../../../../_lib/deps.js";
import { ApprovePrBodySchema } from "../../../../../_lib/schemas.js";
import { accepted, readJsonBody, withErrorHandling } from "../../../../../_lib/respond.js";

type RouteCtx = { params: Promise<{ id: string; runId: string }> };

export async function POST(req: Request, ctx: RouteCtx): Promise<Response> {
  return withErrorHandling(async () => {
    const { runId } = await ctx.params;
    const { supervisor } = getDeps();
    const raw = await readJsonBody(req);
    const body = ApprovePrBodySchema.parse(raw);
    await supervisor.approvePr(runId, body);
    return accepted();
  });
}
