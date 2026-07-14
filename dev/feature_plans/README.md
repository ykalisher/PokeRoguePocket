# dev/feature_plans/ — how this directory works

Phased development plans for large feature work. The owner drafts the plan (often
with a planning model); each **phase** is then implemented in **one fresh session**
that reads only the batch overview + its own phase file. This file documents the
directory's conventions so they hold by rule, not by imitation — follow them when
adding a plan, and keep `status.sh` (below) working.

## File conventions

- **Naming:** `NN-slug.md`, where `NN` is a **zero-padded, two-digit**, monotonically
  increasing number (`00`, `01`, … `15`, …). Numbers are never reused; order is
  numeric. (`status.sh` also tolerates un-padded and 3-digit numbers, but keep the
  two-digit form for readability.)
- **Batch overview files** are named with **`overview` in the slug**
  (`00-overview.md`, `08-post-launch-overview.md`). One per batch. It holds the
  context, ground rules, locked spec, and — for the first batch — a "How to use this
  directory (read this first, always)" block that is **authoritative for behavior**.
  A batch overview has no task checkboxes of its own.
- **Phase / session files** (`01-…`, `09-…`, …) each scope **one** self-contained
  phase, implementable in a single session. The first `#` heading is the title; the
  body lists steps as checkboxes.

## Progress tracking

- Steps are markdown checkboxes: `- [ ]` (todo) → `- [x]` (done). **Tick each box as
  you finish its step.** A phase is complete when **all** its boxes are `[x]`.
- The "current phase" is, by definition, the **lowest-numbered phase file that still
  has an unchecked box.** Nothing else records status — keep the checkboxes honest.
- Phases run in numeric order unless a phase file's header names a narrower
  dependency.

## Viewing status — `status.sh`

Read-only viewer; writes nothing but stdout, so it's safe to run alongside a working
agent. It discovers files by globbing `NN-*.md`, treats any `*overview*` file as a
batch header, reads the checkboxes above, and reports the current phase. No hardcoded
phase list — new files following the conventions above appear automatically.

```bash
bash dev/feature_plans/status.sh            # full board: batches, phases, progress
bash dev/feature_plans/status.sh --current  # one line: the active phase
bash dev/feature_plans/status.sh 09         # print one phase file by number
```

If you change the naming/checkbox conventions, update `status.sh` and this file in the
same change.
