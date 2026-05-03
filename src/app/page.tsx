import { getStore } from "../lib/supervisor/instance.js";
import { Board } from "../components/board.js";

export const dynamic = "force-dynamic";

export default async function Page() {
  const store = getStore();
  const [cards, settings] = await Promise.all([store.listCards(), store.getSettings()]);

  return (
    <main className="mx-auto max-w-7xl p-6 font-sans">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">claude-kanban</h1>
        <a href="/settings" className="text-sm text-slate-700 hover:underline">
          Settings
        </a>
      </div>
      <Board initial={cards} defaultRepoPath={settings?.defaultRepoPath ?? null} />
    </main>
  );
}
