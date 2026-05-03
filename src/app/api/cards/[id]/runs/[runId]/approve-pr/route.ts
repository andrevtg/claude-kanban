// POST /api/cards/:id/runs/:runId/approve-pr -> relay PR approval to the
// worker. 202 because the actual `git push` + `gh pr create` happens async
// inside the worker; the actual outcome arrives via SSE (`pr_opened` or
// `error`).
//
// Pre-conditions surface as 409 / 503 so failure is visible state rather
// than a runtime crash mid-click:
//   404 card_not_found / run_not_found
//   409 already_open       — the run already has a prUrl
//   409 no_diff            — the run produced an empty diff (or has no diffStat)
//   409 run_not_done       — run still active or exited non-zero
//   503 gh_unavailable     — `gh` not installed / not authenticated

import { getDeps } from "../../../../../_lib/deps.js";
import { ApprovePrBodySchema } from "../../../../../_lib/schemas.js";
import {
  accepted,
  conflict,
  json,
  notFound,
  readJsonBody,
  withErrorHandling,
} from "../../../../../_lib/respond.js";

type RouteCtx = { params: Promise<{ id: string; runId: string }> };

export async function POST(req: Request, ctx: RouteCtx): Promise<Response> {
  return withErrorHandling(async () => {
    const { id, runId } = await ctx.params;
    const { store, supervisor, checkGh } = getDeps();

    const card = await store.getCard(id);
    if (!card) return notFound("card_not_found");
    const run = card.runs.find((r) => r.id === runId);
    if (!run) return notFound("run_not_found");

    if (run.prUrl) return conflict("already_open", { prUrl: run.prUrl });

    if (!run.endedAt || run.exitCode !== 0) {
      return conflict("run_not_done");
    }

    const stat = run.diffStat;
    if (!stat || stat.files === 0) {
      return conflict("no_diff");
    }

    const gh = await checkGh();
    if (gh.state !== "ok") {
      const body =
        gh.state === "missing"
          ? { state: gh.state, message: "gh CLI is not installed" }
          : { state: gh.state, message: gh.message };
      return json({ error: "gh_unavailable", ...body }, { status: 503 });
    }

    const raw = await readJsonBody(req);
    const body = ApprovePrBodySchema.parse(raw);
    await supervisor.approvePr(runId, body);
    return accepted();
  });
}
