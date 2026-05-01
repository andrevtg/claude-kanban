// GET /api/cards   -> list
// POST /api/cards  -> create

import { getDeps } from "../_lib/deps.js";
import { NewCardBodySchema } from "../_lib/schemas.js";
import { json, readJsonBody, stripUndefined, withErrorHandling } from "../_lib/respond.js";
import type { NewCardInput } from "../../../lib/store/index.js";

export async function GET(): Promise<Response> {
  return withErrorHandling(async () => {
    const { store } = getDeps();
    const cards = await store.listCards();
    return json(cards);
  });
}

export async function POST(req: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const { store } = getDeps();
    const raw = await readJsonBody(req);
    const input = NewCardBodySchema.parse(raw);
    const card = await store.createCard(stripUndefined(input) as NewCardInput);
    return json(card, { status: 201 });
  });
}
