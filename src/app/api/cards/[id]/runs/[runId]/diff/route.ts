// GET /api/cards/:id/runs/:runId/diff -> stream the on-disk patch file for
// a finished run. Metadata travels in X-Diff-* response headers so the
// client can render the truncation banner without re-parsing the patch.
//
// Returns 404 with `diff_not_ready` when the run has no diffStat persisted
// yet (run still active, diff capture skipped, or pre-task-01 legacy run).

import { createReadStream } from "node:fs";
import { open, stat as fsStat } from "node:fs/promises";
import { Readable } from "node:stream";
import { diffPath } from "../../../../../../../lib/paths.js";
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
    if (!run.diffStat) {
      return json({ error: "diff_not_ready" }, { status: 404 });
    }

    const headers: Record<string, string> = {
      "X-Diff-Files": String(run.diffStat.files),
      "X-Diff-Insertions": String(run.diffStat.insertions),
      "X-Diff-Deletions": String(run.diffStat.deletions),
      "Cache-Control": "no-store",
    };

    if (run.diffStat.files === 0) {
      headers["X-Diff-Truncated"] = "false";
      headers["X-Diff-Bytes"] = "0";
      return new Response("", {
        status: 200,
        headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const path = diffPath(runId);
    let bytes = 0;
    try {
      const s = await fsStat(path);
      bytes = s.size;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return json({ error: "diff_not_ready" }, { status: 404 });
      }
      throw e;
    }

    headers["X-Diff-Bytes"] = String(bytes);
    headers["X-Diff-Truncated"] = String(await endsWithTruncationSentinel(path, bytes));

    const nodeStream = createReadStream(path);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
    return new Response(webStream, {
      status: 200,
      headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
    });
  });
}

async function endsWithTruncationSentinel(path: string, size: number): Promise<boolean> {
  const tailSize = Math.min(size, 128);
  if (tailSize === 0) return false;
  const fh = await open(path, "r");
  try {
    const buf = Buffer.alloc(tailSize);
    await fh.read(buf, 0, tailSize, size - tailSize);
    return /\*\*\* truncated at \d+ bytes \*\*\*/.test(buf.toString("utf8"));
  } finally {
    await fh.close();
  }
}
