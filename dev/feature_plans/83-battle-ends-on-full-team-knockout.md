# Phase 83 — A battle ends only when a side's whole team is knocked out

**Recommended agent:** Sonnet · low effort.
**Prereqs:** none — independent of 77–82. **Read first:**
`76-map-and-encounter-overhaul-overview.md`.
**Goal:** A side loses when **every** Pokemon it brought has been knocked out, not after a flat
4. The KO pill reads `KO 2/6` for a six-Pokemon team, and a side with an empty Pokemon deck but
a healthy Pokemon still on the board fights on instead of instantly losing.

## Context you need

**Today's rule** — `arena/arena_model.js`:

```js
    function getEffectiveKnockoutLimit(player) {
        return Math.min(getInitialPokemonCount(player), KNOCKOUT_LIMIT);   // ~431
    }

    function isPlayerDefeated(player) {                                     // ~459
        const countedKnockouts = (Number(player.knockoutCount) || 0) - countPendingFossilRevivals(player);
        const knockoutDefeat = countedKnockouts >= getEffectiveKnockoutLimit(player);
        const deckEmptyDefeat = getInitialPokemonCount(player) > KNOCKOUT_LIMIT && Boolean(player.lostByPokemonDeck);

        return knockoutDefeat || deckEmptyDefeat;
    }
```

`KNOCKOUT_LIMIT` is `4` (`arena/arena_data.js` ~47), destructured into the model at ~20.
`initialPokemonCount` is set to the starting Pokemon-deck size at `createPlayer` (~139) and
recomputed on save-restore as `countTotalPokemon(board, pokemonDeck, knockout)` (~379–381), so
it is always the real team size.

**Why this matters more than it looks.** Team sizes in `trainers.json`: 10 trainers have 1
Pokemon, 19 have 3, 26 have 4, **28 have 5, 23 have 6**. So 51 of 106 trainers currently go
down after 4 KOs while still holding 1–2 unused Pokemon. The player likewise runs up to 6
active Pokemon (`ACTIVE_POKEMON_LIMIT`, `map/run_state.js` ~14). This change makes over half
of all battles longer on both sides. That is the owner's intent — do not soften it.

**Both clauses have to go, not just the first.** `deckEmptyDefeat` ends the battle the moment
a team larger than 4 cannot draw a replacement, **even while another board slot still holds a
healthy Pokemon** (`BOARD_SLOT_COUNT` is 2, `arena/arena_data.js` ~17). That directly
contradicts "ends when all Pokemon have been knocked out", so it must be dropped from the
defeat check. Keep the `player.lostByPokemonDeck = true` assignment and its log line in
`drawReplacementPokemon` (`arena/arena_controller.js` ~2905) — the flag and the
"had no Pokemon left to draw." message are still useful; they just no longer decide the game.

**No stalemate is possible after the change.** Every Pokemon is always on the board, in the
Pokemon deck, or in the knockout pile, so board-empty + deck-empty implies
`knockoutCount === initialPokemonCount`. Fossil revival decrements `knockoutCount` *and*
returns the Fossil to the board, so it keeps that invariant.

**The Fossil deferral is unaffected** and must stay: `countPendingFossilRevivals` still
refunds knockouts so the battle never ends while an eligible Fossil could revive at end of
turn (`arena/arena_render.js` ~52 documents this to the player, and the text stays correct).

**Already verified during planning:** this exact edit was applied to the working tree and
`node tests/run_all.js` stayed green at 230/230, because both existing defeat tests read the
limit dynamically via `Model.getEffectiveKnockoutLimit(player)` rather than hardcoding 4
(`tests/arena_model.test.js` ~272, `tests/arena_controller.test.js` ~318). Spot checks with
the real model after the edit: default player → limit 6; a 6-team at 4 KOs with an empty deck
and one Pokemon alive → **not** defeated; the same team at 6 KOs → defeated; a 3-team at 3 KOs
→ defeated, at 2 KOs → not.

`KNOCKOUT_LIMIT` stays in `arena_data.js` — after this change it survives only as the
defensive fallback inside `getInitialPokemonCount` (~421–425) for a player whose count is
missing or non-positive. Do not delete the constant.

## Steps

- [x] 1. **`arena/arena_model.js`** — replace `getEffectiveKnockoutLimit` (~428–433),
  doc comment included:

  ```js
      /**
       * Knockouts needed to defeat a player: every Pokemon on the team. A side
       * fights until its whole team is down, so team size is the only input.
       */
      function getEffectiveKnockoutLimit(player) {
          return getInitialPokemonCount(player);
      }
  ```

- [x] 2. **`arena/arena_model.js`** — replace `isPlayerDefeated` (~453–468), doc comment
  included, dropping the `deckEmptyDefeat` clause entirely:

  ```js
      /**
       * Defeat check shared by the controller, render, and page flow. A side is
       * beaten only once every Pokemon it brought has been knocked out. Knockouts
       * that a pending Fossil revival can refund do not count, so the battle never
       * ends while an eligible Fossil could still revive at end of turn. An empty
       * Pokemon deck is no longer a loss on its own - a side with a Pokemon still
       * standing keeps fighting.
       */
      function isPlayerDefeated(player) {
          if (!player) return false;

          const countedKnockouts = (Number(player.knockoutCount) || 0) - countPendingFossilRevivals(player);

          return countedKnockouts >= getEffectiveKnockoutLimit(player);
      }
  ```

- [x] 3. **`arena/arena_controller.js`** — update the `checkGameOver` doc comment (~2962–2965):
  it currently says the battle ends "when either side reaches the knockout limit or cannot
  replace a KO". The second half is no longer true. Say it ends when either side's whole team
  has been knocked out. **Do not change any code in this file** — `drawReplacementPokemon`
  (~2898–2913) keeps setting `lostByPokemonDeck` and logging.

- [x] 4. **`README.md`** — line ~46 reads "The game ends when either player reaches 4
  knockouts, or when a player needs to …". Rewrite it for the new rule: a side loses once its
  whole team has been knocked out. Read the surrounding paragraph and keep its voice.

- [x] 5. **`.claude/skills/data/SKILL.md`** — line ~137 says "hand size 6 and knockout limit
  4". Correct it: the knockout limit is the team's Pokemon count. **This file already has an
  uncommitted edit from earlier work; leave that hunk alone and touch only this line.**

- [x] 6. **`tests/arena_model.test.js`** — add a test next to the existing Fossil-deferral one
  (~270) pinning the new rule directly, so a future regression to `Math.min(…, 4)` fails
  loudly:

  ```js
  test('a player is defeated only after every Pokemon on the team is knocked out', () => {
      const player = Model.createPlayer('player', 'You');

      [1, 3, 4, 5, 6].forEach(teamSize => {
          player.initialPokemonCount = teamSize;
          player.knockout = [];
          player.lostByPokemonDeck = false;

          assert.equal(Model.getEffectiveKnockoutLimit(player), teamSize);

          player.knockoutCount = teamSize - 1;
          assert.equal(Model.isPlayerDefeated(player), false, `team of ${teamSize} at ${teamSize - 1} KOs`);

          player.knockoutCount = teamSize;
          assert.equal(Model.isPlayerDefeated(player), true, `team of ${teamSize} at ${teamSize} KOs`);
      });
  });

  test('an empty Pokemon deck is not a defeat while a Pokemon is still standing', () => {
      const player = Model.createPlayer('player', 'You');

      player.initialPokemonCount = 6;
      player.knockout = [];
      player.knockoutCount = 4;
      player.lostByPokemonDeck = true;

      assert.equal(Model.isPlayerDefeated(player), false);

      player.knockoutCount = 6;
      assert.equal(Model.isPlayerDefeated(player), true);
  });
  ```

  Note `Model.createPlayer` builds a 6-Pokemon default deck, so always set
  `initialPokemonCount` explicitly rather than relying on the default.

## Verification

- [x] `node --check arena/arena_model.js` and `node --check arena/arena_controller.js` pass.
- [x] `node tests/run_all.js` green. The two pre-existing defeat tests read the limit
  dynamically and were confirmed during planning to survive this change unmodified — if either
  now fails, step 1 or 2 drifted from the snippets above.
- [x] `grep -rn "KNOCKOUT_LIMIT" arena/` shows it only in `arena_data.js`, the model's
  destructuring, and the `getInitialPokemonCount` fallback — nowhere in a defeat decision.
- [x] `grep -rniE "4 knockouts|knockout limit 4" . --include=*.md` returns nothing outside
  `dev/feature_plans/`.
- [x] Browser proof with the `verify` skill (`dev/verify/lib.py` `serving()` on 8931, driver
  modeled on `dev/verify/autoplay_arena.py`): start a battle against a trainer with **6**
  Pokemon (pick one from `trainers.json` — 23 have six) and confirm
  - the opponent's KO pill reads `KO 0/6`, not `KO 0/4`;
  - the battle does **not** end at 4 knockouts;
  - it ends exactly when the sixth Pokemon goes down, with the normal win popup and the run
    advancing as usual.
  Save the screenshot as `dev/verify/phase83_full_team_knockout.png`.

  Done via `dev/verify/phase83_full_team_knockout.py`: relabels the next reachable area node
  to `'boss'` and pre-seeds its `battleEncounters` entry with Lorelei (a real Elite-rank,
  6-Pokemon trainer from `trainers.json`; `run.level` forced to 3 so Elite rank is allowed at a
  boss node), then plays a real battle. Confirms `initialPokemonCount === 6`, the `KO 0/6` pill,
  that forcing the opponent to 4/6 knockouts and ending the turn leaves `state.finished` false,
  that forcing it to 6/6 does finish the battle with the "You won" popup, and that Continue
  returns to `area.html` with the boss node's encounter marked `completed`. All checks pass
  (screenshot confirms `KO 6/6` for Lorelei / `KO 4/6` for the player at the win screen).
- [x] Same driver, the mirror case: let the player side reach 4 knockouts with a Pokemon still
  on the board and confirm play continues.

  Same script: forces the player's `initialPokemonCount` to 6 and `knockoutCount` to 4
  mid-battle, ends the turn, and confirms `state.finished` stays false.

## Out of scope / do not touch

Do not change `KNOCKOUT_LIMIT`'s value or delete the constant, and do not touch
`BOARD_SLOT_COUNT`, hand size, or `ACTIVE_POKEMON_LIMIT`. Do not remove
`player.lostByPokemonDeck` or its assignment/log in `drawReplacementPokemon` — only its role
in the defeat check goes away. Do not touch the Fossil revival rules
(`countPendingFossilRevivals`, `reviveFossilPokemonFromKnockout`, or the FOSSIL reference text
at `arena/arena_render.js` ~52). Do not rebalance trainer teams in `trainers.json` to
compensate for longer battles — if the owner wants that, it is a separate task. Nothing in
`map/`, `main.js`, `static/`, or any other JSON data file.
