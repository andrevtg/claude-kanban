// Module-level supervisor singleton for the Next.js process. Imported by
// route handlers in phase-2/task-02. The phase-1 CLI has its own short-lived
// supervisor; this is the long-lived one for the web server.
//
// Dev-only path for now: spawns the worker via `node --import tsx
// src/worker/index.ts`. A production build path lands in phase-5.

import { fileURLToPath } from "node:url";
import { fileStore, type Store } from "../store/index.js";
import { Supervisor } from "./index.js";

let supervisor: Supervisor | null = null;
let store: Store | null = null;

export function getSupervisor(): Supervisor {
  if (supervisor) return supervisor;
  store = fileStore();
  // TODO(phase-5): swap to a compiled worker entrypoint when running under
  // `next start`. For now we always go through tsx.
  const workerEntry = fileURLToPath(new URL("../../worker/index.ts", import.meta.url));
  supervisor = new Supervisor({
    store,
    workerEntry,
    nodeArgs: ["--import", "tsx"],
  });
  return supervisor;
}

export function getStore(): Store {
  if (!store) {
    getSupervisor();
  }
  // getSupervisor() always assigns store; the non-null assertion is safe.
  return store as Store;
}
