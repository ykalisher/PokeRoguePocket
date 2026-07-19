# dev/owner_tasks/ — the owner's task board

A short list of coarse features that **only the owner implements** (they hold the design
vision) and **only the owner marks complete**. It is the owner-facing counterpart to
`dev/feature_plans/` (which holds agent-executed phase plans): same "nothing is deleted,
finished items stay visible as history" model, but this one you drive — and mutate — from
the command line.

- `tasks.md` — the single source of truth (one canonical line per task).
- `tasks.sh` — the CLI: view the board and mark tasks done/added/reopened.
- This `README.md` — the conventions, so the format holds by rule, not imitation.

## Who may do what

- **Owner:** everything — `done`, `reopen`, `add`, and free-hand editing of `tasks.md`.
- **Agents:** may run `tasks.sh add` **only when the owner explicitly asks** for a task to
  be added. Agents must **never** mark a task `done`, `reopen` one, or otherwise act on the
  contents of this board — same rule as `TODO.md`. Adding a task is not permission to start
  working on it.

## Using it

```bash
bash dev/owner_tasks/tasks.sh                 # open tasks — what's left (default)
bash dev/owner_tasks/tasks.sh list --area X   # open tasks in one area
bash dev/owner_tasks/tasks.sh all             # full board (open + done)
bash dev/owner_tasks/tasks.sh log             # completed tasks — history
bash dev/owner_tasks/tasks.sh show 5          # one task with its notes
bash dev/owner_tasks/tasks.sh done 5          # mark #005 complete      (owner only)
bash dev/owner_tasks/tasks.sh reopen 5        # undo a completion       (owner only)
bash dev/owner_tasks/tasks.sh add "Title" --area X --needs 6   # append a task
bash dev/owner_tasks/tasks.sh help            # usage
```

Ids accept any form: `5`, `05`, `005`, `#5`. Marks in the output: `○` open, `⊘` blocked
(a dependency isn't done yet), `✔` done.

## Data format (`tasks.md`)

Each task is **one canonical line**, optionally followed by indented note lines:

```
- [<box>] #<NNN> [area:<tag>] added:<YYYY-MM-DD> [done:<YYYY-MM-DD>] needs:<-|NNN[,NNN...]> :: <title>
   > free-text note (owner's vision), any number of "> " lines, preserved untouched
```

- **`<box>`** — a space for open, `x` for done. `tasks.sh done` flips it and stamps
  `done:<date>` in place; nothing is ever deleted, so completed tasks remain as history.
- **`#<NNN>`** — a stable, zero-padded, never-reused id (min 3 digits). Ordering is numeric.
- **`area:`** — optional one-word tag for `--area` filtering (`pokemon`, `events`, …).
- **`added:` / `done:`** — ISO dates. `added:` is always present; `done:` only once complete.
- **`needs:`** — `-` for none, else one or more dependency ids (`001` or `001,003`). A task
  with an unfinished dependency shows as blocked in `list`/`all`.
- **` :: `** — separates the metadata from the free-text title. The title is everything
  after it and may contain any characters (so it must never itself contain the string
  ` :: `; `add` rejects that).
- **Notes** — indented lines beginning `> ` immediately below a task line. `show` prints
  them; every mutation leaves them untouched.

Hand-editing `tasks.md` directly is fine — keep to the grammar above and the ids unique.

## The viewer/editor (`tasks.sh`)

Plain bash + POSIX awk, no dependencies (same spirit as `feature_plans/status.sh`). All
mutations rewrite the file through a temp file and `mv` it into place, so notes and layout
survive and a failed write can't corrupt the board. If you change the grammar or the
checkbox convention, update **both** `tasks.sh` and this file in the same change.
