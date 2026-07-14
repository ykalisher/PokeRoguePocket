# Battle mechanics, effect symbols & trainer roster — batch overview

Batch 3 (phases `19`–`24`). After play-testing, the owner filed a mix of small mechanics
tweaks, one missing-art item, one confirmed bug, and a larger data cleanup. Each is broken
into a **discrete, self-contained session** below. The owner made three binding decisions
during planning — see **Locked spec**.

## Ground rules (binding)

Every phase in this batch inherits these:

- **Never `git commit`** (or `git add`) unless the owner explicitly asks. Other git reads are fine.
- **Never run or extend `scripts/manage_*.js`** — those are the owner's interactive CLIs. Edit
  the JSON data files directly and validate with `node tests/run_all.js`.
- **Never act on `TODO.md`.**
- **No third-party deps / frameworks / CDNs / build step.** Plain JS/HTML/CSS the browser
  loads directly. `tests/` may use Node built-ins; `dev/verify/` may use Python+Playwright
  (both dev-only, already approved). New SVG icons are static assets, not dependencies — fine.
- **Run `node tests/run_all.js` after every change** (syntax-checks all tracked JS + runs the
  suite, ~3s). A PostToolUse hook also `node --check`s each edit.
- **Line numbers in these docs are hints captured 2026-07-14 and WILL drift.** Relocate every
  edit by the named function / quoted search string, then confirm the surrounding code before
  editing.

## What is being built (context)

1. **Dragon gems become one-time-use per battle** — a played gem is removed from play, not
   discarded (phase 19).
2. **A new standalone effect-boost item** — while active on a side, that side's attacks double
   their secondary-effect trigger chance and bias multi-hit toward more hits (phase 20).
3. **Sleep bug fix** — a Pokémon put to sleep must reliably miss at least its next turn
   (phase 21).
4. **Artificial-attack effect symbols** — the 4 iconless artificial effects get hand-authored
   SVG icons (phase 22).
5. **Trainer roster audit** — real gym leaders become bosses only; Ace/Elite ranks are
   backfilled with generic-class trainers (phases 23–24).

## Locked spec (owner decisions — do not relitigate)

- **Effect boost is a STANDALONE item, NOT a dragon gem.** It uses its own status marker and
  side-tracking; it is not part of the `DRAGON_GEM` family.
- **Trainer audit is FULL / all-ranks.** Move gym leaders to `Boss` wherever they currently
  sit (Ace *and* Elite), not just the Ace rank.
- **Effect symbols are HAND-AUTHORED SVG.** The implementing session writes simple monochrome
  SVGs matching the existing `assets/status-icons/*.svg` style — no external image-gen tool.
- Deck sizing rule (all trainers): **attacks = 4 × Pokémon count.** Standard 3pk/12at,
  Ace 4pk/16at, Boss 5pk/20at, Elite 6pk/24at. `cash`: Standard 200, Ace 300–320, Boss 500,
  Elite 750.

## Cross-phase architecture facts

Anchors captured 2026-07-14 — **hints, not addresses**; find by function name.

- **Status/effect model:** `arena/arena_model.js` — `STATUS_DEFINITIONS` map (~`:58-82`) maps
  a status token → `{ iconPath, label, showsToken, initialState? }`. `getStatusIconPath`
  (~`:1168`) returns `''` for tokens with no entry, which is why iconless effects render as a
  text badge. `applyStatus` (~`:980`) / `createStatusEntry` build per-Pokémon status entries.
  `removeCardFromPlay(player, card)` (~`:1739`) pushes to `player.removed[]` (the
  "one-time-use, gone for the battle" pile).
- **Battle resolution:** `arena/arena_controller.js` — `resolveQueuedAttack` (~`:1838`) drives
  an attack; `maybeApplyAttackStatuses` (~`:2287`) rolls `STATUS_TRIGGER_CHANCE`;
  `maybeApplyAttackStatChanges` (~`:2465`) rolls the stat-change chance;
  `getRandomMultiAttackHitCount` (~`:2188`) / `resolveMultiAttackDamage` (~`:2165`) handle
  multi-hit. Item play: `useDragonGemItemFromHand` (~`:615`), `applyItemCard`/`useOpponentItem`
  and the opponent item-plan path (~`:1297`). Sleep: `resolveSleepAttempt` (~`:1693`),
  `tickSleepTimersWithoutAttack` (~`:1724`).
- **Tunable constants:** `arena/arena_data.js` `arena.Constants` (~`:48-57`) —
  `MULTI_ATTACK_MIN_HITS=2`, `MULTI_ATTACK_MAX_HITS=6`, `STATUS_TRIGGER_CHANCE=1/3`,
  `STAT_CHANGE_TRIGGER_CHANCE=1/3`, `SLEEP_WAKE_CHANCE=0.5`, `SLEEP_GUARANTEED_WAKE_ATTEMPT=4`.
  The fallback item list (where the 6 gems live) is ~`:273`.
- **Effect-icon rendering:** `arena/arena_render.js` — `renderActionStatusIcons` (~`:629-670`)
  draws an attack's effect badge; when `getStatusIconPath` is `''` it falls back to a 2-letter
  text badge (~`:657-659`). `ACTION_EFFECT_REFERENCE` (~`:74-77`) is the on-screen effect
  glossary. Existing icon reference: `MULTI_ATTACK` (`arena/arena_model.js:74` →
  `assets/status-icons/MULTI_ATTACK.png`, `showsToken:false`).
- **Trainers:** `trainers.json` (44 entries): `{ name, sprite, cash, rank, typeSpecialization,
  pokemon[], attacks[], items[] }`. `rank ∈ {Standard, Ace, Special, Boss, Elite}`
  (`scripts/data_options.js` `Rank`). Sprite/name database = `arena/trainer_sprites.js`
  (**247 named sprites** — gym leaders, Elite Four, champions, and generic classes;
  `{name, source, file}`; the `sprite` field matches `name`). Rank → run-selection weights in
  `map/locations.js` (`battleRanks`/`bossRanks`). Deck decks are the **exact** JSON arrays (no
  copy multiplier). Validation: `tests/data_validation.test.js` — cross-refs all
  pokemon/attacks/items, unique names, `≥4 Elite` & `≥6 Ace` each with a valid
  `typeSpecialization` (~`:143-148`). Deck type-validity rules: see the `data` skill.
- **Verify skill:** serve `python3 -m http.server 8931 --bind 127.0.0.1` from repo root; drive
  with `dev/verify/`; `window.CardArena.state` exposes live battle state; stop with
  `pkill -f "http.server 8931"`.

## Phases

| File | What it does | Order / deps |
|------|--------------|--------------|
| `19-dragon-gem-no-discard.md` | Played Dragon Gems are removed from play, not discarded | independent |
| `20-effect-boost-item.md` | New standalone item doubles effect chance + biases multi-hit | independent |
| `21-sleep-guaranteed-turn-fix.md` | Slept Pokémon reliably miss ≥1 turn | independent |
| `22-artificial-attack-symbols.md` | Hand-authored SVG icons for the 4 artificial effects | independent |
| `23-trainer-roster-audit-boss-promotions.md` | Gym leaders → `Boss` with Boss-sized decks | before 24 |
| `24-trainer-roster-new-generic-tiers.md` | Backfill Ace ≥6 / Elite ≥4 with generic classes | after 23 |

**Suite stays green rule:** phases 23 and 24 together must leave `node tests/run_all.js` green
(the `≥6 Ace` / `≥4 Elite` minimums are only satisfied once 24 is done). Do **23 then 24**; do
not leave the roster in a red state between unrelated sessions.
