// GET /api/cards/:id/runs/:runId/trace -> stream the per-run JSONL trace
// file (phase-4/task-03). Returns 404 with `trace_not_found` for runs that
// completed before tracing landed (no file on disk).

import { createReadStream } from "node:fs";
import { stat as fsStat } from "node:fs/promises";
import { Readable } from "node:stream";
import { tracePath } from "../../../../../../../lib/paths.js";
import { getDeps } from "../../../../../_lib/deps.js";
import { json, notFound, withErrorHandling } from "../../../../../_lib/respond.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string; runId: string }> };

export async function GET(_req: Request, ctx: RouteCtx): Promise<Response> {
  return withErrorHandling(async () => {
    const { id, runId } = await ctx.params;
    const { store } = getDeps();

    const card = await store.getCard(id);
    if (!card) return notFound("card_not_found");
    const run = card.runs.find((r) => r.id === runId);
    if (!run) return notFound("run_not_found");

    const path = tracePath(runId);
    let bytes = 0;
    try {
      const s = await fsStat(path);
      bytes = s.size;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return json({ error: "trace_not_found" }, { status: 404 });
      }
      throw e;
    }

    if (bytes === 0) {
      return new Response("", {
        status: 200,
        headers: {
          "Content-Type": "application/x-ndjson",
          "X-Trace-Bytes": "0",
          "Cache-Control": "no-store",
        },
      });
    }

    const nodeStream = createReadStream(path);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
    return new Response(webStream, {
      status: 200,
      headers: {
        "Content-Type": "application/x-ndjson",
        "X-Trace-Bytes": String(bytes),
        "Cache-Control": "no-store",
      },
    });
  });
}
