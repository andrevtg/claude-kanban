import { getStore } from "../lib/supervisor/instance.js";
import { StoreReadError } from "../lib/store/index.js";
import type { Card } from "../protocol/index.js";
import { Board } from "../components/board.js";
import { LoadBanner } from "../components/load-banner.js";

export const dynamic = "force-dynamic";

export default async function Page() {
  const store = getStore();

  let cards: Card[] = [];
  let cardsError: string | null = null;
  try {
    cards = await store.listCards();
  } catch (e) {
    cardsError =
      e instanceof StoreReadError ? `${e.message}` : e instanceof Error ? e.message : String(e);
  }

  let defaultRepoPath: string | null = null;
  let settingsError: string | null = null;
  try {
    const settings = await store.getSettings();
    defaultRepoPath = settings?.defaultRepoPath ?? null;
  } catch (e) {
    settingsError =
      e instanceof StoreReadError ? `${e.message}` : e instanceof Error ? e.message : String(e);
  }

  return (
    <main className="mx-auto max-w-7xl p-6 font-sans">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">claude-kanban</h1>
        <a href="/settings" className="text-sm text-slate-700 hover:underline">
          Settings
        </a>
      </div>
      {cardsError ? (
        <LoadBanner
          tone="error"
          title="Card list failed to load"
          message={cardsError}
          hint="Cards on disk may be corrupt or unreadable. Inspect ~/.claude-kanban/cards/."
        />
      ) : null}
      {settingsError ? (
        <LoadBanner
          tone="warning"
          title="Settings load error; using defaults"
          message={settingsError}
          hint="The settings page can rewrite ~/.claude-kanban/settings.json."
        />
      ) : null}
      <Board initial={cards} defaultRepoPath={defaultRepoPath} />
    </main>
  );
}
