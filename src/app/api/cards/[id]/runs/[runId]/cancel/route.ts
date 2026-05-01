// POST /api/cards/:id/runs/:runId/cancel -> request cancellation.
//
// Always 202: cancellation is escalation-based (Supervisor.cancel is a
// no-op on unknown runs and the worker may take up to 10s to actually
// exit). The cooperative-cancel work that surfaces sync state lands in
// phase-3/task-05.

import { getDeps } from "../../../../../_lib/deps.js";
import { accepted, withErrorHandling } from "../../../../../_lib/respond.js";

type RouteCtx = { params: Promise<{ id: string; runId: string }> };

export async function POST(_req: Request, ctx: RouteCtx): Promise<Response> {
  return withErrorHandling(async () => {
    const { runId } = await ctx.params;
    const { supervisor } = getDeps();
    await supervisor.cancel(runId);
    return accepted();
  });
}
