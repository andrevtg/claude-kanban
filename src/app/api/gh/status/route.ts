// GET /api/gh/status -> the `gh` CLI pre-flight result. The drawer fetches
// this on mount + window-focus to render the Open PR button's enabled/
// disabled state without making the user click first. Cache-Control prevents
// the route from being statically captured at build time.

import { getDeps } from "../../_lib/deps.js";
import { json, withErrorHandling } from "../../_lib/respond.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return withErrorHandling(async () => {
    const { checkGh } = getDeps();
    const status = await checkGh();
    return json(status, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  });
}
