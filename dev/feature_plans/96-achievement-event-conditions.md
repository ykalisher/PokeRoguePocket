# Phase 96 — Achievements as event conditions

**Recommended agent:** Sonnet · medium effort.
**Prereqs:** phase 94 (`achievements.json` must load and the profile must be live).
Independent of phase 95. **Read first:** `92-achievements-overview.md`.
**Goal:** An event or one of its actions can be gated on an achievement being unlocked (or
not), authored from the data editor and validated. A condition without `subject` behaves
exactly as it does today. Ends green, with `events.json` byte-identical.

## Context you need

The card-conditions feature already exists end to end (batch 70–75). This phase widens the
condition object with one optional field. Read `dev/feature_plans/70-event-card-conditions-overview.md`
if you need the original spec; the shape you are extending is in the
`92-achievements-overview.md` locked spec.

**`map/event_effects.js`** (970 lines, `global.PokeEvents`). The exact code you touch:

```js
    function normalizeConditions(conditions) {                                   // ~891
        return (Array.isArray(conditions) ? conditions : [])
            .filter(condition => condition && typeof condition.name === 'string' && condition.name.trim() !== '')
            .map(condition => ({
                cardKind: normalizeCardKind(condition.cardKind || condition.kind),
                mode: condition.mode === 'lacks' ? 'lacks' : 'has',
                name: condition.name.trim(),
                text: typeof condition.text === 'string' ? condition.text : ''
            }));
    }

    function getUnmetConditionReason(run, action) {                              // ~219
        for (const condition of getActionConditions(action)) {
            const owned = runHasCardNamed(run, condition.cardKind, condition.name);
            if (condition.mode === 'lacks' && owned) return condition.text || `You already have ${condition.name}.`;
            if (condition.mode === 'has' && !owned) return condition.text || `Requires ${condition.name}.`;
        }
        return '';
    }
```

`normalizeConditions` builds a **new** normalized object each call — it never writes back to
the record — so adding a `subject` field here cannot dirty `events.json`. The
round-trip risk lives entirely in the editor (step 7).

**Call chain and where `gameData` already is:**

- `getBlockedReason(run, action, selections, context = {})` (~269) — note the fourth
  parameter is named **`context`**, not `options`, and `context.gameData` is already passed
  by every caller (`map/event.js:404`, `:621`, and the tests).
- `getUnmetConditionReason(run, action)` (~219) — called by `getBlockedReason` (its very
  first statement), by `eventConditionsMet(run, eventRecord)`, and directly by
  `map/event.js:606`.
- `eventConditionsMet` is called only from `chooseEvent(gameData, run)` (~57), which has
  `gameData` as its **first** parameter.

So threading an optional third `gameData` argument through is a small, backward-compatible
change: it is only needed to turn an achievement **id** into a display **name** for the
default message. Satisfaction itself reads `window.PokeProfile.isUnlocked(id)`.

**Guard for `PokeProfile` being absent.** `map/event_effects.js` is required by Node tests
that do not load `map/profile.js`. Reach it the way the file already reaches
`PokeLocations` (~140):

```js
        return global.PokeLocations && typeof global.PokeLocations.getBabyPokemonPool === 'function'
            ? …
            : [];
```

Copy that defensive shape. With no profile module, an achievement condition must be treated
as **not unlocked** (fail closed), so a `has` gate blocks and a `lacks` gate passes.

**`map/event.js`** (699 lines): `getActionAvailabilityReason` (~606) calls
`eventSystem.getUnmetConditionReason(state.run, action)` and renders the string into
`.event-action-note` (~362). Only the argument list changes.

**`dev/editor/validate.js`** (930 lines): the condition rules are inside `validateEvents`,
in the `collectEventConditions(event).forEach(…)` block (~467–493). Codes in use:
`events.bad-condition`, `events.bad-condition-mode`, `events.bad-condition-kind`,
`events.unknown-condition-card`. The card-name check is
`const names = cardNames && cardNames[condition.cardKind];` — for achievement conditions
that whole branch must be skipped and replaced with an id lookup.

**`dev/editor/tab_events.js`** (1335 lines): `conditionRowHtml` (~780) renders
Rule / Card kind / Card / Remove plus a "Locked text" row; `conditionsEditorHtml` (~799)
wraps the rows. Handler scopes are `cond` (input), `cond-mode` / `cond-cardkind` (change),
`add-cond` / `remove-cond` (click). Helpers available: `optionTags(values, current)`,
`textField(label, scopeAttrs, value)`, `datalistForStore(store)`, `unknownBadge(store, name)`,
`STORE_FOR_KIND`, `CARD_KINDS_UI`, `setOrDelete(obj, key, value)`, `newCondition()` (~199),
`conditionsPreviewHtml` (~403).

**Round-trip fidelity is binding** (`tab_events.js` header): mutate the `structuredClone`
draft in place, set only what the user edits, `delete` a field the user clears. A condition
the author leaves as a card condition must **not** gain `"subject": "card"`.

## Steps

- [ ] 1. **`map/event_effects.js`** — `normalizeConditions` (~891): carry `subject` through,
  defaulting to `'card'`:

  ```js
                subject: condition.subject === 'achievement' ? 'achievement' : 'card',
  ```

  Keep the object's keys alphabetical (`cardKind`, `mode`, `name`, `subject`, `text`).

- [ ] 2. **`map/event_effects.js`** — add the two achievement helpers directly above
  `getUnmetConditionReason` (~219):

  ```js
    // Achievement gates read the persistent profile, not the run. With no
    // profile module loaded (Node tests), nothing is unlocked — fail closed.
    function achievementUnlocked(id) {
        return Boolean(global.PokeProfile &&
            typeof global.PokeProfile.isUnlocked === 'function' &&
            global.PokeProfile.isUnlocked(id));
    }

    function getAchievementLabel(gameData, id) {
        const records = gameData && Array.isArray(gameData.achievements) ? gameData.achievements : [];
        const record = records.find(entry => entry && entry.id === id);

        return record && record.name ? record.name : id;
    }
  ```

- [ ] 3. **`map/event_effects.js`** — rewrite `getUnmetConditionReason` to branch on
  `subject`, taking the new optional third argument:

  ```js
    function getUnmetConditionReason(run, action, gameData) {
        for (const condition of getActionConditions(action)) {
            if (condition.subject === 'achievement') {
                const unlocked = achievementUnlocked(condition.name);
                const label = getAchievementLabel(gameData, condition.name);

                if (condition.mode === 'lacks' && unlocked) {
                    return condition.text || `Only before earning "${label}".`;
                }

                if (condition.mode === 'has' && !unlocked) {
                    return condition.text || `Requires the "${label}" achievement.`;
                }

                continue;
            }

            const owned = runHasCardNamed(run, condition.cardKind, condition.name);

            if (condition.mode === 'lacks' && owned) {
                return condition.text || `You already have ${condition.name}.`;
            }

            if (condition.mode === 'has' && !owned) {
                return condition.text || `Requires ${condition.name}.`;
            }
        }

        return '';
    }
  ```

- [ ] 4. **`map/event_effects.js`** — thread `gameData` through the two internal callers:
  - `eventConditionsMet(run, eventRecord)` → `eventConditionsMet(run, eventRecord, gameData)`,
    forwarding to `getUnmetConditionReason(run, eventRecord, gameData)`. Its only caller is
    `chooseEvent(gameData, run)` (~57), whose filter line becomes
    `.filter(event => eventConditionsMet(run, event, gameData))`.
  - `getBlockedReason(run, action, selections, context = {})` (~269): its **first**
    statement becomes
    `const unmetConditionReason = getUnmetConditionReason(run, action, context.gameData);`
    Do not change its signature.

- [ ] 5. **`map/event.js`** — `getActionAvailabilityReason` (~606): pass the page's game
  data, `eventSystem.getUnmetConditionReason(state.run, action, arena.GameData)`. Grep the
  file for how it already names the arena namespace (it destructures `arena` in its IIFE
  header) and match it.

- [ ] 6. **`dev/editor/validate.js`** — in the condition block inside `validateEvents`
  (~467), branch on `subject` before the card-kind checks. Add the achievement id set to
  `validateEvents`'s parameters (it already receives `cardNames`; pass a new
  `achievementIds` `Set` built in `validateAll` from `data.achievements`):

  ```js
                if (condition.subject !== undefined && condition.subject !== 'card' && condition.subject !== 'achievement') {
                    issues.push(err('events.json', key, 'events.bad-condition-subject',
                        `${key}: condition subject must be card or achievement, got ${condition.subject}`, 'conditions'));
                } else if (condition.subject === 'achievement') {
                    if (!achievementIds.has(condition.name)) {
                        issues.push(err('events.json', key, 'events.unknown-condition-achievement',
                            `${key}: condition names unknown achievement ${condition.name}`, 'conditions'));
                    }
                } else {
                    // …the existing cardKind / unknown-card checks, unchanged…
                }
  ```

  The `mode` and `text` checks stay outside the branch and apply to both subjects.

- [ ] 7. **`dev/editor/tab_events.js`** — the UI. In `conditionRowHtml` (~780), add a
  **Subject** select as the first control and make the rest of the row switch on it:

  ```js
      const subject = cond.subject === 'achievement' ? 'achievement' : 'card';
  ```

  - Subject select: `data-scope="cond-subject"`, options `card` → "Card", `achievement` →
    "Achievement".
  - When `subject === 'card'`: render the existing Card kind select and Card input
    unchanged.
  - When `subject === 'achievement'`: hide the Card kind select entirely and render the
    name input as an **Achievement** field backed by a datalist of achievement ids, with an
    `unknownBadge`-style marker when the id is not in `EditorApp.store.data.achievements`.
    Follow `datalistForStore`'s pattern for building the datalist; if it is keyed off
    `EditorApp.store.data` by store name, `'achievements'` will work once phase 97 adds the
    file — **if phase 97 has not landed yet, read the achievements list defensively**
    (`EditorApp.store.data.achievements || []`) so this phase does not depend on it.
  - "Locked text" row is unchanged for both subjects.

- [ ] 8. **`dev/editor/tab_events.js`** — handlers:
  - `change` listener: add a `'cond-subject'` case beside `'cond-mode'` / `'cond-cardkind'`.
    Setting it to `'achievement'` must `delete cond.cardKind` and clear `cond.name`
    (a card name is never a valid achievement id); setting it back to `'card'` must
    `delete cond.subject`, restore `cond.cardKind = 'pokemon'`, and clear `cond.name`.
    Deleting rather than writing `subject: 'card'` is what keeps untouched events
    diff-clean. Both cases repaint.
  - `newCondition()` (~199) is unchanged — new conditions still default to a card gate.

- [ ] 9. **`dev/editor/tab_events.js`** — `conditionsPreviewHtml` (~403): render achievement
  conditions distinctly, e.g. `Requires achievement <name>` / `Only without achievement
  <name>`, resolving the id to its name from `EditorApp.store.data.achievements` when
  available.

- [ ] 10. **`tests/event_conditions.test.js`** — extend. The file already builds fake runs
  and actions; add:
  - `subject: 'achievement'`, `mode: 'has'`, no profile module → returns
    `Requires the "<id>" achievement.` (fail-closed, id fallback);
  - with `window.PokeProfile` stubbed to report the id unlocked → returns `''`;
  - `mode: 'lacks'` mirrors both cases;
  - a custom `text` overrides both default messages;
  - passing `gameData` with a matching achievement record swaps the id for its `name` in
    the message;
  - a condition **without** `subject` behaves exactly as before (regression guard);
  - `normalizeConditions` output always carries `subject`, and an input object is never
    mutated.

  Stub the profile by assigning `global.PokeProfile = { isUnlocked: id => id === 'champion' }`
  and deleting it afterwards, so the fail-closed case still runs.

- [ ] 11. **`tests/data_validation.test.js`** — mirror the two new validation rules against
  the real `events.json` (which has no achievement conditions today, so both should report
  zero issues — that is the regression guard).

- [ ] 12. **`node tests/run_all.js`** — green.

- [ ] 13. Browser proof. Temporarily add one achievement-gated event to `events.json`,
  serve on 8931, and confirm: with the achievement locked, the choice button is greyed with
  the reason underneath; after unlocking it (set the profile in the console), the button
  works. Then **restore `events.json`** (`git checkout -- events.json`) and confirm
  `git status` shows it unchanged. Screenshot to
  `dev/verify/phase96_achievement_conditions.png`; adapt
  `dev/verify/phase73_event_conditions.py`, which already drives exactly this screen.

## Verification

- [ ] `node tests/run_all.js` green, with every case from step 10 passing.
- [ ] `git diff events.json` is empty at the end of the phase.
- [ ] Editor round trip: open an event with existing card conditions, change nothing, Save →
  empty diff. Add an achievement condition, Save → the diff contains exactly
  `"subject": "achievement"` plus `mode`/`name`, and **no** `cardKind`. Flip it back to a
  card condition, Save → the `subject` key is gone. Restore the file.
- [ ] `dev/verify/phase96_achievement_conditions.png` shows a gated choice greyed with its
  reason.
- [ ] Event-level gating: an event whose top-level `conditions` name a locked achievement is
  never picked by `chooseEvent` (assert in Node, not just by eye).
- [ ] Node safety: `node -e "globalThis.window=globalThis;require('./map/event_effects.js')"`
  still runs without `map/profile.js` loaded.

## Out of scope / do not touch

The achievements page (phase 95) and the Achievements editor tab (phase 97). Do not change
what a **card** condition means, its messages, or its codes. Do not add achievement gating
to `requires` (requirements render pickers; conditions are pure gates — that distinction is
locked by batch 70). Do not author real gated events beyond the temporary fixture in step
13. Do not touch effects, the baby pool, or location/terrain gates.
