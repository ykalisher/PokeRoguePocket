# dev/feature_plans/ — how this directory works

Phased development plans for large feature work. The owner drafts the plan (often with a
planning model); each **phase** is then implemented in **one fresh session** that reads
only its batch overview + its own phase file. This file is the single source of truth for
the directory's conventions — the template, the writing mindset, and the progress
protocol — so they hold by rule, not by imitation. Follow them when adding a plan, and
keep `status.sh` (below) working.

## Doing the next step of a plan

When asked to "do the next step in the development plan" (or continue / resume it):

1. Run `bash dev/feature_plans/status.sh --current` → the lowest-numbered incomplete phase.
2. Read **that phase file** and the batch overview it names in its `Read first:` line.
3. Implement **exactly that one phase**. Do not run ahead into later phases.
4. Tick each `- [ ]` → `- [x]` as you finish it — **steps *and* verification items**.
5. Stop at the phase boundary. The phase is done only when every box is `[x]`.

If a phase file predates this standard (its work is written as prose subsections rather
than checkbox steps), first normalize it to the template below, then execute — it's cheap
and keeps the board honest.

## File conventions

- **Naming:** `NN-slug.md`, where `NN` is a **zero-padded, two-digit**, monotonically
  increasing number (`00`, `01`, … `15`, …). Numbers are never reused; order is numeric.
  (`status.sh` also tolerates un-padded and 3-digit numbers, but keep the two-digit form
  for readability.)
- **Batch overview files** are named with **`overview` in the slug** (`00-overview.md`,
  `08-post-launch-overview.md`). One per batch. It holds the context, ground rules, locked
  spec, and cross-phase facts shared by every phase in the batch. A batch overview has **no
  task checkboxes of its own.**
- **Phase files** (`01-…`, `09-…`, …) each scope **one** self-contained phase,
  implementable in a single session. The first `#` heading is the title; the body follows
  the canonical template below.

## Progress tracking

- Steps and verification items are markdown checkboxes: `- [ ]` (todo) → `- [x]` (done).
  **Both** the implementation steps **and** the verification items are checkboxes;
  `status.sh` counts them uniformly. A phase is complete only when **all** its boxes —
  including verify — are `[x]`. In other words, a phase is done only when it is both built
  **and** verified. **Tick each box as you finish its step.**
- The "current phase" is, by definition, the **lowest-numbered phase file that still has an
  unchecked box.** Nothing else records status — keep the checkboxes honest.
- Phases run in numeric order unless a phase file's header names a narrower dependency.

## Canonical phase-file template

Copy this skeleton for every new phase file. The section names and order are fixed — do
not rename or reorder them (`Verify`, `Facts you need`, `Out of scope`, `Session NN —`,
etc. are retired variants; use exactly the names below).

```
# Phase NN — <Title>

**Prereqs:** <phase deps, or "none">. **Read first:** `<NN>-overview.md`.
**Goal:** <the observable end state in 1–2 sentences, e.g. "Ends green + playable">.

## Context you need
<Everything the session needs so it never re-derives: exact file paths, the functions to
touch with ~line anchors (mark anchors as drift-prone hints, not gospel), key data shapes,
and page/code conventions to imitate.>

## Steps
- [ ] 1. **`path/to/file`** — <one concrete change; inline a small code snippet when the
  edit is fiddly>.
- [ ] 2. **`path/to/file`** — <…>

## Verification
- [ ] `node tests/run_all.js` green.
- [ ] <browser / `verify` skill check, stated as a concrete expected result>.

## Out of scope / do not touch
<Short fence naming what must NOT change — the scope-creep guard.>
```

`04-starter-picker.md` is the reference example (its verification is prose; new plans make
those checkboxes). Canonical elements: title prefix **`Phase NN —`**; **`Goal:` in the
header block** (never buried in Context); sections **`## Context you need`**,
**`## Steps`**, **`## Verification`**, **`## Out of scope / do not touch`**.

## Batch-overview template

A batch overview holds what every phase in the batch shares, so the phase files stay small.
Sections (model on `00-overview.md` / `08-post-launch-overview.md`):

```
# <Batch title> — batch overview

## Ground rules (binding)
## What is being built (context)
## Locked spec
## Cross-phase architecture facts
## Phases          <!-- table: file → what it does → order/dependency notes -->
```

**Ground rules** (never `git commit` unless asked, never run `scripts/manage_*`, never act
on `TODO.md`, no third-party deps/build step, run `node tests/run_all.js` after every
change) live in the overview and are inherited by every phase. A batch-less standalone plan
has no overview to inherit from, so it inlines those rules in its own `## Out of scope / do
not touch` fence.

## Writing mindset (for the plan author)

The point of a plan is to let a **fresh, possibly less-powerful** session execute a phase
correctly with the least effort spent *understanding* the task:

- **One phase = one self-contained session.** A session reading only the batch overview +
  that phase file must have everything it needs — no hunting through the repo to figure out
  what to do.
- **Write for a weaker implementing model.** Minimize parse effort: name exact files,
  functions, and commands; inline small code snippets when an edit is fiddly; give a
  concrete done-state, not a vague goal. Every step should say which file it touches.
- **Never trade correctness for brevity.** "Least effort" means least effort to *understand
  the task*, not least effort to *do it right*. If a step genuinely needs more
  investigation, more tests, or a `verify`-skill browser check, say so and **encourage**
  spending that effort.
- **Order the steps** so each builds on the last and the repo stays green between them where
  practical.
- **Fence the scope.** An explicit "do not touch" list is what keeps a session from drifting
  into unrelated changes.

## Viewing status — `status.sh`

Read-only viewer; writes nothing but stdout, so it's safe to run alongside a working agent.
It discovers files by globbing `NN-*.md`, treats any `*overview*` file as a batch header,
counts the checkboxes above, and reports the current phase. No hardcoded phase list — new
files following the conventions above appear automatically.

```bash
bash dev/feature_plans/status.sh            # full board: batches, phases, progress
bash dev/feature_plans/status.sh --current  # one line: the active phase
bash dev/feature_plans/status.sh 09         # print one phase file by number
```

If you change the naming/checkbox conventions, update `status.sh` and this file in the same
change.
