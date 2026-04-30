# claude-kanban

A Linear-style kanban board for Claude Agent SDK runs. Each card represents a task the agent works on inside a local clone of a real git repository, optionally pushing a branch and opening a PR when done.

> **Origin.** This project is a port to the Claude Agent SDK of the [`agent-kanban`](https://github.com/cursor/cookbook/tree/main/sdk/agent-kanban) example from the [Cursor SDK cookbook](https://github.com/cursor/cookbook) (MIT). The UX, the kanban-of-agent-runs idea, and several architectural choices come from that project. The runtime, the process model, and the persistence layer are different — see [`docs/05-relation-to-cursor-cookbook.md`](docs/05-relation-to-cursor-cookbook.md) for a side-by-side.

This is a **scaffold**, not a working app. It contains:

- A complete plan and architecture (`docs/`)
- A phased roadmap of tasks (`tasks/`)
- An orientation document for Claude Code (`CLAUDE.md`)
- Stubs and TypeScript types for the core surfaces (`src/`)

The intended workflow is: open this directory in Claude Code, and have it work through `tasks/` in order. Each task file is sized to be a single Claude Code session.

## Why this exists

This is the local-runtime counterpart to a future port of the Cursor `agent-kanban` cookbook example onto Claude Managed Agents. The local version is the learning artifact: it gets the team fluent in the Agent SDK surface (`query`, streaming, `allowedTools`, `permissionMode`, MCP, hooks) before tackling the managed-runtime version.

See `docs/01-architecture.md` for the full design rationale.

## Quick orientation

| If you want to... | Read |
|---|---|
| Understand what we're building and why | `docs/00-overview.md` |
| Understand the architecture | `docs/01-architecture.md` |
| Know which Agent SDK surfaces we use | `docs/02-agent-sdk-usage.md` |
| See how this differs from the Cursor cookbook | `docs/05-relation-to-cursor-cookbook.md` |
| Run this in Claude Code | `CLAUDE.md` |
| See the phased plan | `tasks/README.md` |

## Stack

- **Frontend**: Next.js 15 (App Router), React, Tailwind, shadcn/ui, dnd-kit
- **Backend**: Next.js route handlers + a separate Node worker per run
- **Agent runtime**: `@anthropic-ai/claude-agent-sdk` (local mode)
- **IPC**: SSE from worker → Next.js → browser
- **Persistence**: JSON files under `~/.claude-kanban/`
- **Language**: TypeScript end-to-end

## Status

Scaffold only. Nothing runs yet. Phase 1 (`tasks/phase-1-*`) is the first executable milestone.
