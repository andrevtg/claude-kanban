// Dependency-injection seam for route handlers. Production resolves to the
// real fileStore + Supervisor singleton from src/lib/supervisor/instance.ts;
// tests swap in fakes via `setDeps` and reset in afterEach. Keeping this
// indirection out of the handlers avoids ESM module mocking entirely.

import { getStore, getSupervisor } from "../../../lib/supervisor/instance.js";
import { checkGh as defaultCheckGh, type GhStatus } from "../../../lib/gh/preflight.js";
import type { Store } from "../../../lib/store/index.js";
import type { Supervisor } from "../../../lib/supervisor/index.js";

export type CheckGhFn = () => Promise<GhStatus>;

export type RouteDeps = {
  supervisor: Supervisor;
  store: Store;
  checkGh: CheckGhFn;
};

let depsImpl: () => RouteDeps = () => ({
  supervisor: getSupervisor(),
  store: getStore(),
  checkGh: () => defaultCheckGh(),
});

export function getDeps(): RouteDeps {
  return depsImpl();
}

/** @internal — for tests only */
export function setDeps(impl: () => RouteDeps): void {
  depsImpl = impl;
}

/** @internal — for tests only */
export function resetDeps(): void {
  depsImpl = () => ({
    supervisor: getSupervisor(),
    store: getStore(),
    checkGh: () => defaultCheckGh(),
  });
}
