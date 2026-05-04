import { getStore } from "../../lib/supervisor/instance.js";
import { StoreReadError } from "../../lib/store/index.js";
import type { GlobalSettings } from "../../protocol/index.js";
import { SettingsForm } from "../../components/settings-form.js";
import { LoadBanner } from "../../components/load-banner.js";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  let settings: GlobalSettings | null = null;
  let settingsError: string | null = null;
  try {
    settings = await getStore().getSettings();
  } catch (e) {
    settingsError =
      e instanceof StoreReadError ? `${e.message}` : e instanceof Error ? e.message : String(e);
  }

  return (
    <main className="mx-auto max-w-3xl p-6 font-sans">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <a href="/" className="text-sm text-slate-700 hover:underline">
          ← Back to board
        </a>
      </div>
      {settingsError ? (
        <LoadBanner
          tone="warning"
          title="Settings load error; using defaults"
          message={settingsError}
          hint="Saving below will overwrite ~/.claude-kanban/settings.json with valid values."
        />
      ) : null}
      <SettingsForm initial={settings} />
    </main>
  );
}
