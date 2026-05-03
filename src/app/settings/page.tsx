import { getStore } from "../../lib/supervisor/instance.js";
import { SettingsForm } from "../../components/settings-form.js";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = await getStore().getSettings();

  return (
    <main className="mx-auto max-w-3xl p-6 font-sans">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <a href="/" className="text-sm text-slate-700 hover:underline">
          ← Back to board
        </a>
      </div>
      <SettingsForm initial={settings} />
    </main>
  );
}
