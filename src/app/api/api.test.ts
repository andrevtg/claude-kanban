// Integration tests for route handlers. We import the exported HTTP method
// functions and call them directly with a Request — no real HTTP server.
// Deps (store + supervisor) are swapped via setDeps() in beforeEach.

import assert from "node:assert/strict";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { Card, GlobalSettings } from "../../protocol/index.js";
import { memoryStore, fileStore, type Store } from "../../lib/store/index.js";
import {
  DuplicateRunError,
  UnknownRunError,
  type RunHandle,
  type Supervisor,
} from "../../lib/supervisor/index.js";
import { resetDeps, setDeps } from "./_lib/deps.js";
import { GET as cardsGET, POST as cardsPOST } from "./cards/route.js";
import { PATCH as cardPATCH, DELETE as cardDELETE } from "./cards/[id]/route.js";
import { POST as runPOST } from "./cards/[id]/run/route.js";
import { POST as cancelPOST } from "./cards/[id]/runs/[runId]/cancel/route.js";
import { POST as approvePrPOST } from "./cards/[id]/runs/[runId]/approve-pr/route.js";

type SupervisorStub = Pick<Supervisor, "startRun" | "cancel" | "approvePr">;

function asSupervisor(stub: SupervisorStub): Supervisor {
  // reason: tests only exercise the three methods listed in SupervisorStub.
  // The Supervisor class also extends EventEmitter, but route handlers
  // never touch event APIs.
  return stub as unknown as Supervisor;
}

const settingsFixture: GlobalSettings = {
  apiKeyPath: "/dev/null",
  defaultModel: "claude-opus-4-7",
  bashAllowlist: [],
  prAutoApprove: false,
};

function ctx<T extends Record<string, string>>(params: T): { params: Promise<T> } {
  return { params: Promise.resolve(params) };
}

function jsonReq(method: string, body: unknown): Request {
  const init: RequestInit = {
    method,
    headers: { "content-type": "application/json" },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request("http://test.local", init);
}

async function withHome<T>(fn: () => Promise<T>): Promise<T> {
  const home = await mkdtemp(join(tmpdir(), "ck-api-"));
  const prev = process.env.CLAUDE_KANBAN_HOME;
  process.env.CLAUDE_KANBAN_HOME = home;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_KANBAN_HOME;
    else process.env.CLAUDE_KANBAN_HOME = prev;
    await rm(home, { recursive: true, force: true });
  }
}

describe("api routes", () => {
  let store: Store;

  afterEach(() => {
    resetDeps();
  });

  describe("POST /api/cards", () => {
    beforeEach(() => {
      store = memoryStore();
      setDeps(() => ({ store, supervisor: asSupervisor({} as SupervisorStub) }));
    });

    it("creates a card with a valid body", async () => {
      const res = await cardsPOST(
        jsonReq("POST", {
          title: "fix tests",
          prompt: "do the thing",
          repoPath: "/tmp/repo",
          baseBranch: "main",
        }),
      );
      assert.equal(res.status, 201);
      const body = (await res.json()) as Card;
      assert.match(body.id, /^card_/);
      assert.equal(body.title, "fix tests");
      assert.equal(body.status, "backlog");
      assert.deepEqual(body.runs, []);

      const list = await store.listCards();
      assert.equal(list.length, 1);
    });

    it("creates a card on disk under CLAUDE_KANBAN_HOME", async () => {
      await withHome(async () => {
        const fileBacked = fileStore();
        setDeps(() => ({ store: fileBacked, supervisor: asSupervisor({} as SupervisorStub) }));
        const res = await cardsPOST(
          jsonReq("POST", {
            title: "fs",
            prompt: "p",
            repoPath: "/tmp/r",
            baseBranch: "main",
          }),
        );
        assert.equal(res.status, 201);
        const cardsHome = process.env.CLAUDE_KANBAN_HOME;
        assert.ok(cardsHome);
        const files = await readdir(join(cardsHome, "cards"));
        assert.equal(files.length, 1);
        const f = files[0]!;
        assert.match(f, /^card_.+\.json$/);
      });
    });

    it("returns 400 on a malformed body and does not create the card", async () => {
      const res = await cardsPOST(jsonReq("POST", { title: "" }));
      assert.equal(res.status, 400);
      const body = (await res.json()) as { error: string };
      assert.equal(body.error, "invalid_body");
      assert.equal((await store.listCards()).length, 0);
    });

    it("returns 400 on invalid JSON", async () => {
      const req = new Request("http://test.local", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      });
      const res = await cardsPOST(req);
      assert.equal(res.status, 400);
      const body = (await res.json()) as { error: string };
      assert.equal(body.error, "invalid_json");
    });
  });

  describe("GET /api/cards", () => {
    beforeEach(() => {
      store = memoryStore();
      setDeps(() => ({ store, supervisor: asSupervisor({} as SupervisorStub) }));
    });

    it("lists cards", async () => {
      await store.createCard({ title: "a", prompt: "", repoPath: "/r", baseBranch: "main" });
      await store.createCard({ title: "b", prompt: "", repoPath: "/r", baseBranch: "main" });
      const res = await cardsGET();
      assert.equal(res.status, 200);
      const body = (await res.json()) as Card[];
      assert.equal(body.length, 2);
    });
  });

  describe("PATCH /api/cards/:id", () => {
    let card: Card;
    beforeEach(async () => {
      store = memoryStore();
      setDeps(() => ({ store, supervisor: asSupervisor({} as SupervisorStub) }));
      card = await store.createCard({
        title: "t",
        prompt: "p",
        repoPath: "/r",
        baseBranch: "main",
      });
    });

    it("updates allowed fields", async () => {
      const res = await cardPATCH(jsonReq("PATCH", { title: "renamed", status: "ready" }), ctx({ id: card.id }));
      assert.equal(res.status, 200);
      const body = (await res.json()) as Card;
      assert.equal(body.title, "renamed");
      assert.equal(body.status, "ready");
    });

    it("rejects an attempt to patch immutable fields with 400", async () => {
      const res = await cardPATCH(
        jsonReq("PATCH", { id: "card_other", createdAt: "2020-01-01" }),
        ctx({ id: card.id }),
      );
      assert.equal(res.status, 400);
      const fresh = await store.getCard(card.id);
      assert.equal(fresh?.id, card.id);
    });

    it("returns 404 for an unknown card", async () => {
      const res = await cardPATCH(jsonReq("PATCH", { title: "x" }), ctx({ id: "card_missing" }));
      assert.equal(res.status, 404);
    });
  });

  describe("DELETE /api/cards/:id", () => {
    beforeEach(() => {
      store = memoryStore();
      setDeps(() => ({ store, supervisor: asSupervisor({} as SupervisorStub) }));
    });

    it("returns 204 on success and 404 if missing", async () => {
      const c = await store.createCard({ title: "t", prompt: "", repoPath: "/r", baseBranch: "main" });
      const res = await cardDELETE(jsonReq("DELETE", undefined), ctx({ id: c.id }));
      assert.equal(res.status, 204);
      const res2 = await cardDELETE(jsonReq("DELETE", undefined), ctx({ id: c.id }));
      assert.equal(res2.status, 404);
    });
  });

  describe("POST /api/cards/:id/run", () => {
    let card: Card;
    let startCalls = 0;

    beforeEach(async () => {
      store = memoryStore();
      await store.saveSettings(settingsFixture);
      card = await store.createCard({
        title: "t",
        prompt: "p",
        repoPath: "/r",
        baseBranch: "main",
      });
      startCalls = 0;
    });

    it("returns a RunHandle on success", async () => {
      const handle: RunHandle = {
        runId: "run_TEST",
        cardId: card.id,
        pid: 12345,
        startedAt: new Date().toISOString(),
      };
      const sup: SupervisorStub = {
        startRun: async () => {
          startCalls++;
          return handle;
        },
        cancel: async () => {},
        approvePr: async () => {},
      };
      setDeps(() => ({ store, supervisor: asSupervisor(sup) }));

      const res = await runPOST(jsonReq("POST", undefined), ctx({ id: card.id }));
      assert.equal(res.status, 200);
      const body = (await res.json()) as RunHandle;
      assert.deepEqual(body, handle);
      assert.equal(startCalls, 1);
    });

    it("returns 409 when a run is already active for the card", async () => {
      const sup: SupervisorStub = {
        startRun: async () => {
          throw new DuplicateRunError(card.id, "run_existing");
        },
        cancel: async () => {},
        approvePr: async () => {},
      };
      setDeps(() => ({ store, supervisor: asSupervisor(sup) }));
      const res = await runPOST(jsonReq("POST", undefined), ctx({ id: card.id }));
      assert.equal(res.status, 409);
      const body = (await res.json()) as { error: string; cardId: string; runId: string };
      assert.equal(body.error, "run_active");
      assert.equal(body.cardId, card.id);
      assert.equal(body.runId, "run_existing");
    });

    it("returns 404 when the card does not exist", async () => {
      setDeps(() => ({
        store,
        supervisor: asSupervisor({
          startRun: async () => {
            throw new Error("should not be called");
          },
          cancel: async () => {},
          approvePr: async () => {},
        }),
      }));
      const res = await runPOST(jsonReq("POST", undefined), ctx({ id: "card_missing" }));
      assert.equal(res.status, 404);
    });

    it("returns 400 when settings are missing", async () => {
      const blankStore = memoryStore();
      const c = await blankStore.createCard({
        title: "t",
        prompt: "",
        repoPath: "/r",
        baseBranch: "main",
      });
      setDeps(() => ({
        store: blankStore,
        supervisor: asSupervisor({
          startRun: async () => {
            throw new Error("should not be called");
          },
          cancel: async () => {},
          approvePr: async () => {},
        }),
      }));
      const res = await runPOST(jsonReq("POST", undefined), ctx({ id: c.id }));
      assert.equal(res.status, 400);
      const body = (await res.json()) as { error: string };
      assert.equal(body.error, "settings_missing");
    });
  });

  describe("POST /api/cards/:id/runs/:runId/cancel", () => {
    beforeEach(() => {
      store = memoryStore();
    });

    it("returns 202 even when the run is unknown (cancel is idempotent)", async () => {
      let cancelArg: string | null = null;
      setDeps(() => ({
        store,
        supervisor: asSupervisor({
          startRun: async () => {
            throw new Error("nope");
          },
          cancel: async (runId: string) => {
            cancelArg = runId;
          },
          approvePr: async () => {},
        }),
      }));
      const res = await cancelPOST(
        jsonReq("POST", undefined),
        ctx({ id: "card_x", runId: "run_unknown" }),
      );
      assert.equal(res.status, 202);
      assert.equal(cancelArg, "run_unknown");
    });
  });

  describe("POST /api/cards/:id/runs/:runId/approve-pr", () => {
    beforeEach(() => {
      store = memoryStore();
    });

    it("returns 202 on success", async () => {
      let approveCalls = 0;
      setDeps(() => ({
        store,
        supervisor: asSupervisor({
          startRun: async () => {
            throw new Error("nope");
          },
          cancel: async () => {},
          approvePr: async () => {
            approveCalls++;
          },
        }),
      }));
      const res = await approvePrPOST(
        jsonReq("POST", { title: "feat: x", body: "details" }),
        ctx({ id: "card_x", runId: "run_y" }),
      );
      assert.equal(res.status, 202);
      assert.equal(approveCalls, 1);
    });

    it("returns 404 when the run is unknown", async () => {
      setDeps(() => ({
        store,
        supervisor: asSupervisor({
          startRun: async () => {
            throw new Error("nope");
          },
          cancel: async () => {},
          approvePr: async () => {
            throw new UnknownRunError("run_y");
          },
        }),
      }));
      const res = await approvePrPOST(
        jsonReq("POST", { title: "t", body: "b" }),
        ctx({ id: "card_x", runId: "run_y" }),
      );
      assert.equal(res.status, 404);
    });

    it("returns 400 when the body is malformed", async () => {
      setDeps(() => ({
        store,
        supervisor: asSupervisor({
          startRun: async () => {
            throw new Error("nope");
          },
          cancel: async () => {},
          approvePr: async () => {},
        }),
      }));
      const res = await approvePrPOST(
        jsonReq("POST", { title: "" }),
        ctx({ id: "card_x", runId: "run_y" }),
      );
      assert.equal(res.status, 400);
    });
  });
});
