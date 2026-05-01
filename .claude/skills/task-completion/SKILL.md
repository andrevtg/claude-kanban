---
name: task-completion
description: Use ONLY when actually closing out a task in tasks/ — i.e. all acceptance criteria appear met and the user is ready to mark it done and commit. Triggers on phrases like "task done", "finished task NN", "ready to commit this", "let's close out task NN", or when re-reading a task file with intent to flip its status. Do NOT trigger on mid-work updates ("almost done", "still working", "halfway through"), on routine commits unrelated to a task, or on starting a task.
---

# Task completion ritual — claude-kanban

Tasks in `tasks/phase-N/task-NN-*.md` are designed to fit one Claude Code session each. Closing one out is a small ritual, not a quick `git commit`. This skill is the checklist. Follow it in order. Don't skip steps.

The ritual exists because a task isn't done when the code works — it's done when the next session can pick up cleanly without rereading what you did. The `STATUS: done` marker, the changelog line, and the conventional commit message are what make that handoff reliable.

## Checklist (in order)

### 1. Verify the Acceptance section

Open the task file. Re-read the **Acceptance** section. For each bullet, state explicitly whether it is met, with the evidence (a command output, a file that exists, a test that passes).

If any bullet is ambiguous or unverified, **stop and ask the user**. Do not approximate.

### 2. Verify Out of scope was respected

Re-read **Out of scope**. List anything you did that falls into it (or that wasn't in the task at all). If the list is non-empty, surface it to the user **before** committing — do not silently include scope creep. The user decides whether to keep it, revert it, or split it into a follow-up task file.

### 3. Run typecheck

```pre
pnpm typecheck
```

If `package.json` does not yet define `typecheck` (e.g. early phase 1, before task-01 of that phase), skip with a one-line note. If the script exists and fails, **stop**. Do not mark done.

### 4. Run lint

```pre
pnpm lint
```

Same rule: skip with a note if undefined; fix or stop if it fails.

### 5. Run any task-specific tests

The task file's Acceptance section may name tests (e.g. "round-trip test passes" for protocol work). Run them. If it doesn't, but the project has `pnpm test`, run that. Failure means the task is not done.

### 6. Append `STATUS: done` to the task file

Add this as the **first line** of the task file, above the `# phase-N / task-NN — ...` heading:

```pre
**STATUS: done**
```

A blank line after it, then the existing heading. CLAUDE.md specifies first-line placement; respect it.

### 7. Add a changelog entry

Open `docs/CHANGELOG.md`. Add **one** line at the top of the entry list (newest at top), in the exact format from the file's comment header:

```pre
- YYYY-MM-DD — phase-N/task-NN — short description (commit-sha-short)
```

- `YYYY-MM-DD` is today's actual date — not the date in the task file, not a placeholder.
- `short description` is one phrase, lowercased, imperative. Match the style of the existing line ("initial scaffold and planning docs").
- Leave `commit-sha-short` literally as `commit-sha-short` for now — step 9 fills it in.

### 8. Stage changes and propose a commit message

Run `git status` and `git diff --staged` (or stage what's relevant). Show the user a proposed commit message in the project's convention:

```pre
phase-N: <imperative summary>
```

(See CLAUDE.md → Conventions → "Commit messages: `phase-N: <imperative summary>`. One commit per task is fine.")

**Do not run `git commit` yourself unless the user explicitly delegated it.** Show the diff and the message; let the user run it. This keeps the user in the loop on what's actually entering history.

### 9. After the commit, update the changelog SHA

Once the user reports the commit landed (or you ran it with permission), get the short SHA:

```pre
git rev-parse --short HEAD
```

Edit the changelog line you added in step 7, replacing the literal `commit-sha-short` with the real value. Show the diff. The user can amend or make a follow-up commit per their preference; both are fine, since the changelog is informational.

## Failure modes

### Acceptance criteria not actually met

Do **not** mark done. Summarize which bullets are unmet, with evidence. Ask the user: "continue working on this task, or pause it and ship what's done as a partial?" If the answer is pause, don't write `STATUS: done` — write a note in the task file's body and update `docs/QUESTIONS.md` per the working rules in `tasks/README.md`.

### You went out of scope

List concretely what you did beyond the task's stated outputs. For each item, ask the user: keep, revert, or split into a new task file under the appropriate phase? Default to **split** for anything non-trivial — small task files are explicitly the project's preference (see `tasks/README.md` working rules).

### typecheck / lint / tests fail

Do **not** mark done. Show the failure. Either fix it in the same session (still part of this task) or surface to the user. A failing typecheck on `main` is exactly the kind of silent failure CLAUDE.md's "no silent failures" rule exists to prevent.

### The task file's Acceptance section is vague

Surface the ambiguity to the user. Don't invent your own pass criteria. The task file is the spec; if the spec is unclear, the spec gets fixed first, then the task is closed.

### A new dependency was added during the task

CLAUDE.md → Hard rules: "Do not pull in extra dependencies without updating `docs/01-architecture.md` first." Verify that doc was updated. If not, that's a step-2 scope issue — surface before committing.

## What this skill does NOT do

- Start tasks. Picking the next task is the user's call (or follows `tasks/README.md`'s "lowest-numbered unfinished task" rule).
- Trigger on mid-work check-ins. "How's it going" is not closeout.
- Replace the user's judgment on commit content. The diff, the message, and the moment of `git commit` belong to the user unless explicitly delegated.

## Where the rules came from

- Closeout steps (`STATUS: done`, changelog line): CLAUDE.md → "How to work in this repo".
- Commit message format: CLAUDE.md → Conventions.
- Changelog format: comment header in `docs/CHANGELOG.md`.
- One-task-per-session and task-file split rules: `tasks/README.md` → Working rules.

If any of those rules change, edit the source first, then mirror here, then add a CHANGELOG entry.
