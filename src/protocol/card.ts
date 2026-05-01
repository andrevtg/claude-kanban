// Persisted card and run shapes. See docs/01-architecture.md "Data model".

import { z } from "zod";
import { DiffStatSchema, WireMessageSchema } from "./messages.js";

export const CardStatusSchema = z.enum(["backlog", "ready", "running", "review", "done", "failed"]);
export type CardStatus = z.infer<typeof CardStatusSchema>;

export const RunSchema = z.object({
  id: z.string().min(1),
  startedAt: z.string().min(1),
  endedAt: z.string().min(1).optional(),
  exitCode: z.number().int().optional(),
  branchName: z.string().min(1).optional(),
  diffStat: DiffStatSchema.optional(),
  prUrl: z.string().url().optional(),
});
export type Run = z.infer<typeof RunSchema>;

export const CardSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  prompt: z.string(),
  repoPath: z.string().min(1),
  baseBranch: z.string().min(1),
  status: CardStatusSchema,
  runs: z.array(RunSchema),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type Card = z.infer<typeof CardSchema>;

// One line in ~/.claude-kanban/logs/run_*.ndjson.
export const EventLogEntrySchema = z.object({
  timestamp: z.string().min(1),
  message: WireMessageSchema,
});
export type EventLogEntry = z.infer<typeof EventLogEntrySchema>;
