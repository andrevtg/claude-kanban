import { getStore } from "../lib/supervisor/instance.js";
import { CardList } from "../components/card-list.js";

export const dynamic = "force-dynamic";

export default async function Page() {
  const cards = await getStore().listCards();

  return (
    <main className="mx-auto max-w-4xl p-8 font-sans">
      <h1 className="mb-6 text-2xl font-semibold">claude-kanban</h1>
      <CardList initial={cards} />
    </main>
  );
}
