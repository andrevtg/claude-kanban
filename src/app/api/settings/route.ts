// GET /api/settings  -> current GlobalSettings or null
// PUT /api/settings  -> validate body and persist via store.saveSettings.
//
// API key handling — path-only with optional inline write:
//
// - The persisted shape always has `apiKeyPath` pointing at a 0600 file on
//   disk. The raw key value is never stored in settings.json.
// - Default flow: client sends `apiKeyPath` to an existing file. The route
//   stat()s it; if mode is not 0600, the request is rejected unless the
//   caller also sets `chmodApiKeyFile: true` (server-side flag, not
//   persisted), in which case we chmod the file to 0600 before saving.
// - Inline-value flow: if the client sends an `apiKeyValue` string, the
//   route writes it to ~/.claude-kanban/anthropic-key with mode 0600 and
//   stores that path in settings. The raw value is never echoed back by
//   GET. `apiKeyValue` and `chmodApiKeyFile` live in the request body
//   only — they are stripped before validating against GlobalSettingsSchema.

import { chmod, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { GlobalSettingsSchema } from "../../../protocol/index.js";
import { claudeKanbanDir, ensureDirs } from "../../../lib/paths.js";
import { getDeps } from "../_lib/deps.js";
import { badRequest, json, readJsonBody, withErrorHandling } from "../_lib/respond.js";

const SettingsPutBodySchema = z
  .object({
    apiKeyPath: z.string().min(1).optional(),
    apiKeyValue: z.string().min(1).optional(),
    chmodApiKeyFile: z.boolean().optional(),
    defaultModel: z.string().min(1).optional(),
    defaultRepoPath: z.string().min(1).optional(),
    bashAllowlist: z.array(z.string().min(1)).optional(),
    prAutoApprove: z.boolean().optional(),
  })
  .strict();

export async function GET(): Promise<Response> {
  return withErrorHandling(async () => {
    const { store } = getDeps();
    const settings = await store.getSettings();
    return json(settings);
  });
}

export async function PUT(req: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const { store } = getDeps();
    const raw = await readJsonBody(req);
    const body = SettingsPutBodySchema.parse(raw);

    let apiKeyPath = body.apiKeyPath;

    if (body.apiKeyValue !== undefined) {
      await ensureDirs();
      const target = join(claudeKanbanDir(), "anthropic-key");
      await writeFile(target, body.apiKeyValue, { encoding: "utf8", mode: 0o600 });
      // writeFile honors mode only on file creation; chmod on every write
      // so an existing file gets tightened too.
      await chmod(target, 0o600);
      apiKeyPath = target;
    }

    if (apiKeyPath === undefined) {
      return badRequest("invalid_body", {
        issues: [{ path: ["apiKeyPath"], message: "apiKeyPath or apiKeyValue is required" }],
      });
    }

    let st;
    try {
      st = await stat(apiKeyPath);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return badRequest("invalid_body", {
          issues: [{ path: ["apiKeyPath"], message: `file not found at ${apiKeyPath}` }],
        });
      }
      throw e;
    }
    if (!st.isFile()) {
      return badRequest("invalid_body", {
        issues: [{ path: ["apiKeyPath"], message: `not a regular file: ${apiKeyPath}` }],
      });
    }
    const mode = st.mode & 0o777;
    if (mode !== 0o600) {
      if (body.chmodApiKeyFile === true) {
        await chmod(apiKeyPath, 0o600);
      } else {
        return badRequest("invalid_body", {
          issues: [
            {
              path: ["apiKeyPath"],
              message: `file mode is ${mode.toString(8).padStart(3, "0")}, expected 600 (set chmodApiKeyFile to fix)`,
            },
          ],
        });
      }
    }

    const toSave: Record<string, unknown> = { apiKeyPath };
    if (body.defaultModel !== undefined) toSave.defaultModel = body.defaultModel;
    if (body.defaultRepoPath !== undefined) toSave.defaultRepoPath = body.defaultRepoPath;
    if (body.bashAllowlist !== undefined) toSave.bashAllowlist = body.bashAllowlist;
    if (body.prAutoApprove !== undefined) toSave.prAutoApprove = body.prAutoApprove;

    const validated = GlobalSettingsSchema.parse(toSave);
    await store.saveSettings(validated);
    return json(validated);
  });
}
