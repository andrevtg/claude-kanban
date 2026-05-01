// Phase-2 demo page: one hardcoded card backed by a real store entry.
// Repo path and base branch are taken from PHASE2_DEMO_REPO /
// PHASE2_DEMO_BRANCH so we never guess at a path that might not exist.

import { getStore } from "../lib/supervisor/instance.js";
import { RunCard } from "../components/run-card.js";
import type { Card } from "../protocol/index.js";
import type { Store } from "../lib/store/index.js";

const DEMO_TITLE = "[phase2-demo] read README and write SUMMARY.md";
const DEMO_PROMPT =
  "Read the README in this repo and write a one-line summary to a new file SUMMARY.md at the repo root.";

export const dynamic = "force-dynamic";

export default async function Page() {
  const repoPath = process.env.PHASE2_DEMO_REPO;
  const baseBranch = process.env.PHASE2_DEMO_BRANCH;

  if (!repoPath || !baseBranch) {
    return (
      <main className="mx-auto max-w-2xl p-8 font-sans">
        <h1 className="mb-4 text-2xl font-semibold">claude-kanban — phase 2</h1>
        <div className="rounded border border-amber-400 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="mb-2 font-medium">Demo not configured.</p>
          <p>
            Set <code className="rounded bg-amber-100 px-1">PHASE2_DEMO_REPO</code> and{" "}
            <code className="rounded bg-amber-100 px-1">PHASE2_DEMO_BRANCH</code> in the
            environment that starts <code>pnpm dev</code>, then reload.
          </p>
        </div>
      </main>
    );
  }

  const store = getStore();
  const card = await ensureDemoCard(store, repoPath, baseBranch);

  return (
    <main className="mx-auto max-w-3xl p-8 font-sans">
      <h1 className="mb-6 text-2xl font-semibold">claude-kanban — phase 2</h1>
      <RunCard card={card} />
    </main>
  );
}

async function ensureDemoCard(
  store: Store,
  repoPath: string,
  baseBranch: string,
): Promise<Card> {
  const cards = await store.listCards();
  const existing = cards.find((c) => c.title === DEMO_TITLE);
  if (existing) {
    if (existing.repoPath !== repoPath || existing.baseBranch !== baseBranch) {
      return store.updateCard(existing.id, { repoPath, baseBranch });
    }
    return existing;
  }
  return store.createCard({
    title: DEMO_TITLE,
    prompt: DEMO_PROMPT,
    repoPath,
    baseBranch,
    status: "ready",
  });
}
