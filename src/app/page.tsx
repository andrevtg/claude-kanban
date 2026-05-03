import { getStore } from "../lib/supervisor/instance.js";
import { Board } from "../components/board.js";

export const dynamic = "force-dynamic";

export default async function Page() {
  const cards = await getStore().listCards();

  return (
    <main className="mx-auto max-w-7xl p-6 font-sans">
      <h1 className="mb-6 text-2xl font-semibold">claude-kanban</h1>
      <Board initial={cards} />
    </main>
  );
}
