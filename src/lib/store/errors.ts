// Typed errors for the Store layer. Lives in its own file so the file/memory
// implementations can import them without creating a cycle through index.ts.

export class CardNotFoundError extends Error {
  constructor(public cardId: string) {
    super(`card not found: ${cardId}`);
    this.name = "CardNotFoundError";
  }
}

export class RunNotFoundError extends Error {
  constructor(
    public cardId: string,
    public runId: string,
  ) {
    super(`run not found: card=${cardId} run=${runId}`);
    this.name = "RunNotFoundError";
  }
}

// Thrown when a JSON file on disk fails to parse or fails schema validation.
// Distinct from "missing"; callers usually want to surface this loudly.
export class StoreReadError extends Error {
  constructor(
    public path: string,
    public reason: string,
  ) {
    super(`failed to read ${path}: ${reason}`);
    this.name = "StoreReadError";
  }
}
