// Shared response helpers. Per CLAUDE.md "no silent failures": every catch
// block in a route handler funnels through one of these so errors land in a
// structured shape and unexpected ones are still logged.

import { z } from "zod";
import { CardNotFoundError, RunNotFoundError } from "../../../lib/store/index.js";
import { DuplicateRunError, UnknownRunError } from "../../../lib/supervisor/index.js";

export function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

export function noContent(status = 204): Response {
  return new Response(null, { status });
}

export function badRequest(error: string, extra?: Record<string, unknown>): Response {
  return json({ error, ...(extra ?? {}) }, { status: 400 });
}

export function notFound(error = "not_found"): Response {
  return json({ error }, { status: 404 });
}

export function conflict(error: string, extra?: Record<string, unknown>): Response {
  return json({ error, ...(extra ?? {}) }, { status: 409 });
}

export function accepted(body?: unknown): Response {
  return body === undefined ? new Response(null, { status: 202 }) : json(body, { status: 202 });
}

export function fromZodError(err: z.ZodError): Response {
  return badRequest("invalid_body", { issues: err.issues });
}

export async function readJsonBody(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.length === 0) return undefined;
  return JSON.parse(text);
}

// Drops keys whose value is `undefined`. Necessary under
// `exactOptionalPropertyTypes`: Zod parses an absent optional as `key:
// undefined`, but downstream stores type those fields as truly absent.
export function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(obj) as Array<keyof T>) {
    const v = obj[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// Catches every expected store/supervisor error and the inevitable
// JSON.parse / Zod failure path. Anything else bubbles to a 500 with the
// message logged to stderr — the moral equivalent of throwing in a route.
export async function withErrorHandling(
  handler: () => Promise<Response>,
): Promise<Response> {
  try {
    return await handler();
  } catch (e) {
    if (e instanceof z.ZodError) return fromZodError(e);
    if (e instanceof SyntaxError) return badRequest("invalid_json", { message: e.message });
    if (e instanceof CardNotFoundError) return notFound("card_not_found");
    if (e instanceof RunNotFoundError) return notFound("run_not_found");
    if (e instanceof UnknownRunError) return notFound("run_not_found");
    if (e instanceof DuplicateRunError) {
      return conflict("run_active", { cardId: e.cardId });
    }
    const message = e instanceof Error ? e.message : String(e);
    process.stderr.write(`[api] unhandled error: ${message}\n`);
    return json({ error: "internal", message }, { status: 500 });
  }
}
