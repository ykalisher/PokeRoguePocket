# Phase 62 — Portable devplan skill: author, execute, and bootstrap dev plans in any repo

**Recommended agent:** Sonnet · high effort.
(High because the README genericization takes judgment — not for a low-effort pass.)
**Prereqs:** none (docs/tooling only; independent of 58–61). **Read first:**
`57-bugfix-perf-overview.md` (Locked spec → "Phase 62 skill") **and**
`dev/feature_plans/README.md` in full — you will be genericizing it.
**Goal:** A **user-level** skill at `~/.claude/skills/devplan/` that works in every repo on
this machine: it can (a) bootstrap a new repo with this directory's structure (vendored
README + status.sh + CLAUDE.md pointer), (b) author plans with the weakest-model-possible
doctrine, and (c) execute/review plans ("do the next development phase"). Owner request,
2026-07-19: they want to keep using this structure outside PokeRoguePocket.

## Context you need

- **Why user-level, and why vendoring.** User skills (`~/.claude/skills/<name>/SKILL.md`)
  are available in all projects on this machine, unlike `.claude/skills/` project skills.
  But the skill must NOT be the source of truth at run time: on every bootstrap it **copies**
  its bundled template README and status.sh INTO the target repo's `dev/feature_plans/`.
  Vendoring keeps each repo self-sufficient — any agent without the skill can still execute
  plans via that repo's CLAUDE.md pointer + README, and conventions version together with
  the plans in git. The skill is the installer and the workflow muscle-memory, nothing more.
- Skills may ship supporting files in their directory; reference them from SKILL.md by
  relative path. Frontmatter model: `.claude/skills/data/SKILL.md` (`name:` +
  `description:`; the description drives auto-invocation, so it must contain the phrases
  the owner actually says — both authoring and "do the next development phase" phrasings).
- `dev/feature_plans/status.sh` is already generic except **one line** (~line 62):
  `echo "${B}PokeRoguePocket — feature plan status${RST}"`.
- `dev/feature_plans/README.md` is the conventions source. Repo-specific parts you must
  factor out when building the template: the `node tests/run_all.js` command (appears in the
  canonical phase template's Verification and in the ground-rules list), the ground rules
  themselves (`scripts/manage_*`, `TODO.md`, no-third-party-deps), and references to
  specific phase files (`04-starter-picker.md`, `14-ios-drag-touch-reliability.md`).
  Everything else (naming, overview-vs-phase split, checkbox protocol, canonical templates,
  `**Recommended agent:**` contract, writing mindset, status.sh docs) is already generic —
  keep it near-verbatim.
- This repo needs no bootstrap (it already has README + status.sh, and CLAUDE.md already
  routes "do the next step of a plan" through `status.sh --current`). The only in-repo edit
  is one CLAUDE.md bullet routing plan **authoring** to the skill.
- `~/.claude/skills/` may not exist yet — create directories as needed. Nothing under `~/`
  is part of the git repo; the no-commit rule is about the repo.

## Steps

- [x] 1. **`~/.claude/skills/devplan/assets/status.sh`** (new) — copy
  `dev/feature_plans/status.sh` byte-for-byte, then replace the title line
  `echo "${B}PokeRoguePocket — feature plan status${RST}"` with:
  ```bash
  repo="$(basename "$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null || echo "$DIR/../..")")"
  echo "${B}${repo} — feature plan status${RST}"
  ```
  No other changes. Check it with `bash -n`.
- [x] 2. **`~/.claude/skills/devplan/assets/plan-README.template.md`** (new) — start from a
  copy of `dev/feature_plans/README.md` and apply exactly these transformations:
  - Keep near-verbatim: "Doing the next step of a plan", "File conventions",
    "Progress tracking", the canonical phase-file template, the `**Recommended agent:**`
    section, the batch-overview template, "Writing mindset", and the `status.sh` section.
  - In the canonical phase template's Verification example, replace
    `node tests/run_all.js green.` with `<repo test/lint command> green.`.
  - Replace the concrete ground-rules sentence in the batch-overview section with a pointer
    to a new final section `## Repo specifics (filled in at bootstrap)` containing three
    labeled TODO slots: **Test command** (`TODO: the command every phase runs after each
    change`), **Ground rules** (`TODO: repo-specific bindings — e.g. never commit unless
    asked, files/tools agents must not touch, dependency policy`), **Recommended-agent
    calibration** (`TODO: optional notes on which model tiers this repo's owner uses`).
  - Drop the sentences naming `04-starter-picker.md` / `14-ios-drag-touch-reliability.md`
    and the "phase files predating this standard" normalization note (new repos have no
    legacy files) — the rest of those paragraphs stays.
  - Do not invent new conventions. If a sentence is neither repo-specific nor listed above,
    keep it.
- [x] 3. **`~/.claude/skills/devplan/SKILL.md`** (new) — create with exactly this content:
  ```markdown
  ---
  name: devplan
  description: Phased development plans (dev/feature_plans/ structure with status.sh). Use when the user asks to write a development plan, dev plan, or phased plan; to break a feature or fix list into steps; to set up / install dev plans in a repo; to check plan status; or to do / continue the next development phase.
  ---

  # Phased development plans

  One structure, three jobs. A repo using it has `dev/feature_plans/` containing
  a vendored `README.md` (the conventions — ALWAYS the source of truth for that
  repo), a vendored `status.sh` viewer, and numbered plan files. Decide which
  mode the user's request is, then follow it.

  ## Mode: bootstrap ("set this up here"; or author mode finds no dev/feature_plans/)

  1. Create `dev/feature_plans/` at the repo root. Copy `assets/status.sh` and
     `assets/plan-README.template.md` (renamed to `README.md`) from this skill
     directory into it.
  2. Fill the template's `## Repo specifics` section by inspecting the repo:
     the test/lint command every phase must run (from package.json, Makefile,
     CI config, or existing docs — ask if genuinely ambiguous), and the repo's
     binding ground rules (commit policy, owner-only files, dependency policy;
     inherit from the repo's CLAUDE.md/AGENTS.md when they exist).
  3. Wire discovery so future sessions need no skill: append a short block to
     the repo's CLAUDE.md (or AGENTS.md if that is the convention there;
     create a minimal CLAUDE.md if neither exists):
     - To do or continue the next step of a plan: run
       `bash dev/feature_plans/status.sh --current`, then implement exactly
       that one phase per `dev/feature_plans/README.md`, ticking each checkbox.
     - To write a new development plan: use the `devplan` skill.
  4. Verify: `bash dev/feature_plans/status.sh` prints an empty board
     ("All phases complete."), and the README's Repo specifics section has no
     remaining TODO markers.

  ## Mode: author ("write a development plan for X")

  You are the PLAN AUTHOR. The plan will be executed later, one phase per fresh
  session, possibly by much weaker models. Your effort budget is inverted from
  normal coding: spend heavily on investigation and writing so each executor
  spends almost nothing on understanding.

  1. Bootstrap first if `dev/feature_plans/` is missing (mode above).
  2. **Read the repo's `dev/feature_plans/README.md` in full.** It is that
     repo's single source of truth for naming, templates, and the checkbox
     protocol; this skill never overrides it.
  3. Number the batch: `bash dev/feature_plans/status.sh`; new files take the
     next unused numbers (zero-padded, never reused) — one
     `NN-<slug>-overview.md` batch overview plus one `NN-<slug>.md` per phase
     (a trivial standalone task may be a single phase file, per the README).
  4. **Investigate until the plan writes itself.** Read the actual code.
     Verify every claim a phase will make in THIS session: run the failing
     test, measure the slow path, execute the candidate fix snippet. A step
     may only name files and functions you have looked at, with ~line anchors
     marked as drift-prone hints.
  5. Split into one-session phases, ordered so the repo stays green between
     phases where practical. Hoist shared context and the repo's ground rules
     into the batch overview; fence every phase with
     "Out of scope / do not touch".
  6. **Size each phase for the weakest model that can safely execute it** and
     record that as the required `**Recommended agent:**` line (tier ·
     effort). Prefer more, smaller phases for cheaper models over fewer big
     ones; inline the exact code for any fiddly edit. Reserve strong models +
     high effort for genuinely open-ended or subtle work — and say why in that
     phase's header. Never trade correctness for brevity: when a step needs
     real investigation, extra tests, or a browser/manual check, say so and
     encourage it.
  7. Verify your output: `status.sh` parses the new batch (all boxes
     unchecked, per-phase Recommended agent shown, `--current` pointing at
     your first phase), and the plan-writing session changed no code beyond
     the plan files themselves.

  ## Mode: execute / review ("do the next development phase", "plan status")

  1. Run `bash dev/feature_plans/status.sh --current` → the lowest-numbered
     phase with an unchecked box. (For a status question: run without
     `--current`, report the board, stop.)
  2. Read that phase file and the batch overview named in its `Read first:`
     line — nothing else is required reading.
  3. Implement **exactly that one phase**. Honor its "Out of scope / do not
     touch" fence; do not run ahead into later phases.
  4. Tick each `- [ ]` → `- [x]` as you finish it — steps AND verification
     items. The phase is done only when every box is checked, meaning built
     AND verified.
  5. Stop at the phase boundary and report what was done and what
     `--current` says is next.
  ```
- [x] 4. **`CLAUDE.md`** (this repo) — in "## Task pointers", insert directly after the
  existing "Phased feature plans live in `dev/feature_plans/`…" bullet:
  ```markdown
  - **To write a NEW development plan** ("make a development plan", "plan this feature"):
    `devplan` skill (user-level) — investigate first, then emit a numbered batch
    (overview + one-session phases) per `dev/feature_plans/README.md`, each phase sized
    for the weakest capable model.
  ```

## Verification

- [x] `~/.claude/skills/devplan/` contains exactly `SKILL.md`, `assets/status.sh`,
  `assets/plan-README.template.md`; frontmatter has only `name:` + `description:` keys.
- [x] `bash -n ~/.claude/skills/devplan/assets/status.sh` — syntax OK.
- [x] Dry-run the bootstrap in the session scratchpad (NOT in this repo): make a temp dir,
  `git init`, copy the two assets in as `dev/feature_plans/status.sh` + `README.md`, then
  `bash dev/feature_plans/status.sh` there → prints the temp repo's directory name in the
  title and "All phases complete." Delete the temp dir afterwards.
- [x] In THIS repo, `bash dev/feature_plans/status.sh` output is unchanged (the repo's own
  status.sh was not touched).
- [x] Read the finished template README against `dev/feature_plans/README.md`: no dropped
  conventions other than the three listed repo-specific items, no invented ones.
- [x] `node tests/run_all.js` green (docs/tooling-only phase — proves nothing else moved).

## Out of scope / do not touch

Do not modify this repo's `dev/feature_plans/README.md` or `status.sh` (the repo keeps its
own vendored copies as-is). Do not create a project-level `.claude/skills/devplan/` in this
repo — the skill is user-level only. Do not restructure CLAUDE.md beyond the single inserted
bullet; do not touch AGENTS.md or `.claude/skills/data|verify/`. Do not `git commit` (the
CLAUDE.md edit stays uncommitted for the owner to review).
