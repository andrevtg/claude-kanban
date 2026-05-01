// GET /api/cards/:id/runs/:runId/events -> Server-Sent Events stream for
// one run. Replays the persisted NDJSON log, then tails live supervisor
// events. Disconnecting from this endpoint never cancels the run — that's
// what POST .../cancel is for. See docs/01-architecture.md "browser
// disconnects from SSE".

import { openRunStream } from "../../../../../../../lib/sse/runStream.js";
import { getDeps } from "../../../../../_lib/deps.js";
import { notFound, withErrorHandling } from "../../../../../_lib/respond.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string; runId: string }> };

export async function GET(req: Request, ctx: RouteCtx): Promise<Response> {
  return withErrorHandling(async () => {
    const { id, runId } = await ctx.params;
    const { store, supervisor } = getDeps();

    const card = await store.getCard(id);
    if (!card) return notFound("card_not_found");
    if (!card.runs.some((r) => r.id === runId)) return notFound("run_not_found");

    const stream = openRunStream(runId, supervisor, store, req.signal);
    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  });
}
