# Phase 93 — Achievements: the persistent profile store

**Recommended agent:** Sonnet · medium effort.
**Prereqs:** none. **Read first:** `92-achievements-overview.md`.
**Goal:** A new `map/profile.js` owns the lifetime profile — counters, unlocked
achievements, and the pending-toast queue — with a small API the rest of the batch calls.
Fully covered by a new `tests/achievements.test.js`. Nothing calls it yet, and nothing in
the game changes; that is correct for this phase.

## Context you need

One new file, **`map/profile.js`**, plus one new test file. Read the overview's "Locked
spec" for the profile shape and the stat namespace before starting.

**The module to imitate is `map/run_state.js`** (785 lines). Copy its skeleton exactly:

```js
/**
 * Pokemon Rogue Pocket - persistent player profile (lifetime stats + achievements)
 */

(function attachProfile(global) {
    'use strict';

    const STORAGE_KEY = 'pokemon-rogue-pocket-profile';
    const STORAGE_VERSION = 1;
    …
    function canUseStorage() {
        return typeof localStorage !== 'undefined';
    }
    …
    global.PokeProfile = { … };   // alphabetically sorted export list
})(window);
```

Binding constraints on the module:

- **Inert at load.** No side effects beyond an optional guarded read. `dev/editor/server.js`
  and the Node tests `require()` it with `window` aliased to `globalThis`, and it must not
  throw when `localStorage` is missing.
- **Never clears itself.** There is deliberately no call from `clearRunState()` or New Game.
  A `clearProfile()` export exists **only** for tests and manual debugging.
- **Defensive normalization**, like `normalizeRunState`: any malformed or wrong-version
  payload yields a fresh empty profile rather than throwing. Stats coerce to non-negative
  integers; unknown keys in `stats` are kept (an achievement may reference a suffix key the
  module has never seen).

**Caching.** Read once into a module-level `profile` variable, then serve from memory and
write through on every mutation. `map/run_state.js` re-reads on every `loadRunState()`; the
profile is touched far more often (once per bump), so cache it — but re-read it in
`clearProfile()` so tests can reset cleanly.

**Testing.** `tests/helpers/arena_env.js` installs an in-memory `localStorage` backed by
`storageMap` and aliases `window` to `globalThis`, so
`require('../map/profile.js')` after requiring the helper is enough. `storageMap` is
exported from the helper, so a test can clear storage directly between cases.

## Steps

- [ ] 1. **`map/profile.js`** — the constants and the stat namespace. Both lists are
  exported, because `dev/editor/server.js` will surface them to the editor's
  achievement form (phase 97) and to `validate.js`:

  ```js
    // The closed set of counters the game keeps. Anything else is an authoring
    // error. Kept here so the data editor can offer exactly these.
    const STAT_KEYS = Object.freeze([
        'runs.started',
        'runs.completed',
        'runs.lost',
        'battles.won',
        'battles.lost',
        'events.seen',
        'captures.completed',
        'attacks.claimed',
        'marts.visited'
    ]);

    // Dynamic families: a concrete suffix (a starter id, a PokeType, a Rank, an
    // event id) is appended to one of these.
    const STAT_PREFIXES = Object.freeze([
        'runs.completed.starter.',
        'runs.completed.mono.',
        'battles.won.rank.',
        'events.seen.'
    ]);
  ```

- [ ] 2. **`map/profile.js`** — `isKnownStat(key)`:

  ```js
    function isKnownStat(key) {
        const stat = String(key || '');

        if (STAT_KEYS.includes(stat)) return true;

        return STAT_PREFIXES.some(prefix => stat.startsWith(prefix) && stat.length > prefix.length);
    }
  ```

- [ ] 3. **`map/profile.js`** — `createEmptyProfile()`, `normalizeProfile(raw)`,
  `loadProfile()`, `saveProfile()`, `canUseStorage()`, following `map/run_state.js`'s
  `loadRunState`/`saveRunState`/`normalizeRunState` structure. `normalizeProfile` must:
  - return a fresh empty profile when `raw` is missing, not an object, or
    `raw.version !== STORAGE_VERSION`;
  - coerce every `stats` value with `Math.max(0, Math.floor(Number(value)) || 0)` and drop
    non-finite ones;
  - keep only string values in `unlocked`;
  - keep only strings in `pendingUnlocks`, de-duplicated.

- [ ] 4. **`map/profile.js`** — the reader/writer API:

  ```js
    function getProfile() { … }                     // cached, normalized
    function getStat(key) { … }                     // 0 when absent
    function bumpStat(key, amount = 1) { … }        // returns the new value, saves
    function bumpStats(bumps) { … }                 // { key: amount }, ONE save
    function isUnlocked(id) { … }
    function getUnlockedIds() { … }
    function clearProfile() { … }                   // tests / debugging only
  ```

  `bumpStat` and `bumpStats` accept any key (including one not in the namespace) — the
  namespace is an *authoring* constraint enforced by the editor, not a runtime one. A bump
  of 0 or a negative amount is ignored.

- [ ] 5. **`map/profile.js`** — unlock evaluation:

  ```js
    /**
     * Unlocks every enabled achievement whose counter has reached its threshold
     * and that is not already unlocked. Newly unlocked ids are queued in
     * pendingUnlocks so the next page that renders can toast them. Returns the
     * achievement records that were newly unlocked, in list order.
     */
    function evaluateAchievements(achievements) {
        const list = Array.isArray(achievements) ? achievements : [];
        const unlockedNow = [];
        const profile = getProfile();

        list.forEach(achievement => {
            if (!achievement || !achievement.id) return;
            if (achievement.enabled === false) return;
            if (profile.unlocked[achievement.id]) return;

            const threshold = Number.isFinite(achievement.atLeast) ? achievement.atLeast : 1;

            if (getStat(achievement.stat) < threshold) return;

            profile.unlocked[achievement.id] = new Date().toISOString();
            profile.pendingUnlocks.push(achievement.id);
            unlockedNow.push(achievement);
        });

        if (unlockedNow.length > 0) saveProfile();

        return unlockedNow;
    }

    /**
     * One-call hook for the game pages: apply a batch of counter bumps, then
     * check every achievement. Returns the newly unlocked records.
     */
    function record(bumps, achievements) {
        bumpStats(bumps);
        return evaluateAchievements(achievements);
    }
  ```

  Note `record` saves twice in the unlock case (once per `bumpStats`, once per
  `evaluateAchievements`). That is fine — these fire at most once per encounter.

- [ ] 6. **`map/profile.js`** — the pending-toast queue:

  ```js
    function takePendingUnlocks() {
        const profile = getProfile();
        const pending = profile.pendingUnlocks.slice();

        if (pending.length > 0) {
            profile.pendingUnlocks = [];
            saveProfile();
        }

        return pending;
    }
  ```

  Also add a progress helper the achievements page and the editor preview both want:

  ```js
    function getProgress(achievement) {
        const threshold = Number.isFinite(achievement && achievement.atLeast) ? achievement.atLeast : 1;
        const current = getStat(achievement && achievement.stat);

        return { current: Math.min(current, threshold), threshold, unlocked: isUnlocked(achievement && achievement.id) };
    }
  ```

- [ ] 7. **`map/profile.js`** — export alphabetically on `global.PokeProfile`:
  `STAT_KEYS`, `STAT_PREFIXES`, `STORAGE_KEY`, `STORAGE_VERSION`, `bumpStat`, `bumpStats`,
  `clearProfile`, `evaluateAchievements`, `getProfile`, `getProgress`, `getStat`,
  `getUnlockedIds`, `isKnownStat`, `isUnlocked`, `record`, `takePendingUnlocks`.
  **Do not** export `saveProfile`/`normalizeProfile` — every write goes through the
  mutators.

- [ ] 8. **`tests/achievements.test.js`** — new file, `node:test` + `node:assert/strict`,
  requiring `./helpers/arena_env` first (for the localStorage shim) then
  `../map/profile.js`. Call `PokeProfile.clearProfile()` at the top of each case. Cover:
  - a fresh profile: `getStat('runs.completed') === 0`, `getUnlockedIds()` empty;
  - `bumpStat` accumulates and persists (read the raw `localStorage` value and check the
    JSON shape and `version`);
  - `bumpStats({a: 1, b: 2})` writes both;
  - a bump of 0 or −1 is ignored;
  - `evaluateAchievements` unlocks exactly the achievements whose counter has reached the
    threshold, returns them once, and returns `[]` on a second call;
  - `enabled: false` achievements never unlock;
  - an unlock is permanent: after `clearProfile()`-free stat manipulation downward (write a
    lower stat via `bumpStats` is impossible, so assert instead that a second
    `evaluateAchievements` does not duplicate the entry);
  - `takePendingUnlocks()` returns the ids once and empties the queue;
  - `isKnownStat` accepts every `STAT_KEYS` entry and `events.seen.foo`, and rejects
    `nonsense.key` and a bare prefix `events.seen.`;
  - `getProgress` clamps `current` at `threshold` and reports `unlocked`;
  - corrupt storage: write `'not json'` and then `{"version":99}` under the key and assert
    `getProfile()` returns an empty profile without throwing (call `clearProfile()` first
    so the cache is not serving a stale object — if the cache makes this untestable,
    that is a design smell: make `clearProfile()` drop the cache).

- [ ] 9. **`node tests/run_all.js`** — green.

## Verification

- [ ] `node tests/run_all.js` green, with every case from step 8 passing.
- [ ] `node -e "globalThis.window=globalThis;require('./map/profile.js');console.log(Object.keys(window.PokeProfile).sort().join(' '))"`
  runs without throwing and prints the full export list — proof the module is load-inert
  and Node-safe even with no `localStorage`.
- [ ] `grep -rn "PokeProfile" --include=*.js --include=*.html . | grep -v tests/` shows
  **only** `map/profile.js` — nothing is wired up yet, which is this phase's contract.

## Out of scope / do not touch

Every call site (phase 94), the achievements page and any DOM/toast code (phase 95), event
conditions (phase 96), and the editor (phase 97). Do not create `achievements.json` yet.
Do not add `map/profile.js` to any HTML page. Do not touch `map/run_state.js`,
`arena/**`, or any data file.
