# Phase 97 — Achievements: the Achievements tab in the data editor

**Recommended agent:** Sonnet · medium effort.
**Prereqs:** phase 94 (`achievements.json` must exist). Independent of 95 and 96.
**Read first:** `92-achievements-overview.md`.
**Goal:** `node dev/editor/server.js` → 127.0.0.1:8932 has an **Achievements** tab where the
owner authors achievements: pick a counter, set a threshold, write the name and
description. Validated by the same write guard as every other file.

## Context you need

Read `88-starter-decks-overview.md`'s "Cross-phase architecture facts" if the starter-decks
batch has landed — plumbing a new data file into the editor is the same five-step routine,
and `dev/editor/tab_starters.js` is then the nearest model. Otherwise
`dev/editor/tab_locations.js` (400 lines) is the model: list view + detail editor + a
`template()` for new records.

**The five plumbing points for a new data file:**

| File | Change |
|---|---|
| `dev/editor/server.js` | `FILE_NAMES` (~85) gains `'achievements'` |
| `dev/editor/format_json.js` | `PLAIN_FILES` or `SMART_FILES` (~64) — `formatDataFile` **throws** on unknown names |
| `dev/editor/app.js` | `FILE_TO_TAB` (~30) gains `'achievements.json': 'achievements'` |
| `dev/editor/validate.js` | a `validateAchievements` wired into `validateAll` (~769) |
| `dev/editor/index.html` | one `<script>` tag |

Achievement records are flat objects of primitives, so they belong in **`PLAIN_FILES`**
(`JSON.stringify(data, null, 2)`), like `pokemon.json` and `items.json`.

**The stat namespace comes from the engine, not a copy.** `dev/editor/server.js` already
loads game modules at require time (~24: `trainer_sprites.js`, `arena_data.js`,
`locations.js`) with `globalThis.window = globalThis`. Add `require('../../map/profile.js')`
there and surface the lists through the existing enums payload:

```js
const ENUMS_PAYLOAD = {
    …,
    statKeys: window.PokeProfile.STAT_KEYS,
    statPrefixes: window.PokeProfile.STAT_PREFIXES,
    …
};
```

`map/profile.js` is load-inert with guarded storage access (phase 93's contract), so this is
safe. `validate.js` then reads `enums.statKeys` / `enums.statPrefixes` with in-file
`DEFAULT_STAT_KEYS` / `DEFAULT_STAT_PREFIXES` fallbacks — the exact pattern
`DEFAULT_EFFECT_TYPES` and `DEFAULT_ARTIFICIAL_ATTACK_STATUSES` already use (~21–31).

**The stat picker is the interesting UI problem.** The namespace has nine exact keys plus
four families whose suffix is data. A plain `<select>` cannot express
`events.seen.<eventId>`. Build it as **two controls**:

1. a `<select>` listing the nine exact keys **plus** the four prefixes as families
   ("Runs completed with starter…", "Runs completed with only type…", "Battles won vs
   rank…", "Times a specific event was seen…");
2. when a family is chosen, a second control appears for the suffix, populated from real
   data where it exists:
   - `runs.completed.starter.` → starter deck ids (`EditorApp.store.data.starter_decks`, or
     a free-text input if that file is not present yet);
   - `runs.completed.mono.` → `EditorApp.store.enums.PokeType` minus `NONE`;
   - `battles.won.rank.` → `EditorApp.store.enums.Rank`;
   - `events.seen.` → event ids from `EditorApp.store.data.events`.

  The draft always stores the **joined** string in `stat`. Keep the split purely in the
  form's render logic (derive it from `draft.stat` on each paint) so the record shape stays
  flat and round-trip-clean.

**Round-trip fidelity is binding:** mutate the `structuredClone` draft in place; saving an
untouched record must produce an empty `git diff achievements.json`.

**Validation surfaces itself.** `computePredictedIssues()` in `dev/editor/app.js` shows
every error in the edited file inside the form on each `markDirty()`. Do not re-implement
checks in the tab.

**Delete guard.** Phase 96 (if landed) makes events reference achievement ids. Extend
`findReferences` so deleting a referenced achievement is blocked with a clickable row, the
same way a referenced Pokemon is. If phase 96 has not landed, add the reference scan anyway
— it reads `condition.subject === 'achievement'`, which is simply absent today, so it
reports nothing and needs no rework later.

## Steps

- [x] 1. **`dev/editor/server.js`** — add `require('../../map/profile.js');` to the engine
  load block (~24, after `locations.js`), add `'achievements'` to `FILE_NAMES` (~85), and
  add `statKeys` / `statPrefixes` to `ENUMS_PAYLOAD` (~70).

- [x] 2. **`dev/editor/format_json.js`** — add `'achievements'` to `PLAIN_FILES` (~64), then
  prove byte-exactness:
  `node -e "const {formatDataFile}=require('./dev/editor/format_json.js');const fs=require('fs');const cur=fs.readFileSync('achievements.json','utf8');console.log(formatDataFile('achievements',JSON.parse(cur))===cur?'BYTE-EXACT':'DIFFERS')"`
  If it differs, rewrite `achievements.json` to the formatter's output — the formatter is
  canonical.

- [x] 3. **`dev/editor/app.js`** — `FILE_TO_TAB` (~30) gains
  `'achievements.json': 'achievements'`.

- [x] 4. **`dev/editor/validate.js`** — `DEFAULT_STAT_KEYS` / `DEFAULT_STAT_PREFIXES`
  constants beside `DEFAULT_EFFECT_TYPES` (~21), mirroring `map/profile.js` with a comment
  saying so, plus a `validateAchievements(achievements, enums)` next to `validateLocations`.
  All issues on `file: 'achievements.json'`, `recordKey` = the id (or `'(unnamed achievement)'`):

  | Code | Severity | Condition |
  |---|---|---|
  | `achievements.missing-id` | error | no non-empty `id` |
  | `achievements.duplicate-id` | error | `id` seen twice |
  | `achievements.bad-id` | error | `id` is not `^[a-z0-9-]+$` |
  | `achievements.missing-name` | error | no non-empty `name` |
  | `achievements.bad-stat` | error | `stat` is not an exact key and does not start with a prefix **with a non-empty suffix** |
  | `achievements.bad-threshold` | error | `atLeast` is not an integer ≥ 1 |
  | `achievements.missing-description` | warning | empty `description` (the page renders a blank row) |
  | `achievements.unreachable-event` | warning | `stat` is `events.seen.<id>` and no event in `events.json` has that id |

  Wire it into `validateAll` (~769): `const achievements = data.achievements || [];` and
  spread `...validateAchievements(achievements, enums)`.

- [x] 5. **`dev/editor/validate.js`** — `findReferences` (~858): add an `achievement` kind
  that scans `collectEventConditions` across `data.events` for
  `condition.subject === 'achievement' && condition.name === name`, pushing
  `{ file: 'events.json', recordKey: event.id, field: 'conditions' }`.

- [x] 6. **`dev/editor/tab_achievements.js`** (new) — the tab module, standard IIFE header
  and `EditorApp.registerTab('achievements', { label: 'Achievements', render });` at the
  end.
  - `columns()`: a lock glyph or `editor-dot` for `enabled`, `name` (sortable), `id`
    (sortable), `stat` in a `<code>`, `atLeast`, and a hidden marker.
  - `template()`:
    `{ id: '', name: '', description: '', stat: 'runs.completed', atLeast: 1, hidden: false, enabled: true }`
    — matching the data file's key order exactly.
  - `renderPreview(el, draft)`: the achievement row as `achievements.html` will show it —
    name, description, and `0 / atLeast` progress — plus the `???` treatment when `hidden`
    is checked, so the author can see what a hidden achievement looks like locked. (If
    phase 95 has not landed, render the same content; matching it later is trivial.)
  - `renderForm(el, draft, api)`: `id` + `name` on one row, `description` on its own,
    the two-control stat picker (see "Context you need") plus `atLeast` (number, min 1),
    and `hidden` + `enabled` checkboxes. Add a hint under the stat picker:
    **"Counters are lifetime totals across every run, stored separately from the save."**
  - `render(root)`: `+ Add achievement` toolbar button, then
    `EditorListView.createListView({ … records: EditorApp.store.data.achievements, getKey:
    (record) => record.id, searchFields: ['name', 'id', 'description'], filters: [enabled,
    hidden], defaultSort: { key: 'name', direction: 'asc' }, onSelect: openAchievementEditor })`.
  - Delete goes through `EditorApp.requestDelete('achievement', 'achievements', record)` so
    step 5's reference guard applies.

- [x] 7. **`dev/editor/index.html`** — add
  `<script src="/dev/editor/tab_achievements.js"></script>` in the tab-module block, before
  `tab_issues.js`.

- [x] 8. **`tests/editor_format.test.js`** — include `achievements` in its byte-exactness
  coverage.

- [x] 9. **`tests/editor_validation.test.js`** — one case per rule from step 4, plus one
  asserting `findReferences(data, 'achievement', '<id>', …)` finds an event whose condition
  names it.

- [x] 10. **`tests/editor_api.test.js`** — `GET /api/data` includes an `achievements` array;
  `GET /api/enums` includes `statKeys` and `statPrefixes`; a `PUT /api/data/achievements`
  with a bad `stat` returns **409** and leaves the file untouched.

- [x] 11. **`node tests/run_all.js`** — green.

- [x] 12. Drive the editor in a browser. Adapt `dev/verify/drive_editor.py` into
  `dev/verify/phase97_editor_achievements.py`, screenshotting to
  `dev/verify/phase97_editor_achievements.png`. Exercise: the list shows the seeded
  achievements; opening `champion` shows the preview; the stat picker switches between an
  exact key and a family + suffix and writes the joined string; a bad `atLeast` of `0`
  surfaces `achievements.bad-threshold` and blocks Save; `+ Add achievement` creates a new
  one that appears on `achievements.html`. **Restore `achievements.json`** afterwards.

## Verification

- [x] `node tests/run_all.js` green.
- [x] `dev/verify/phase97_editor_achievements.py` runs clean with its screenshot committed
  to the working tree.
- [x] Round trip: open an achievement, change nothing, Save → `git diff achievements.json`
  empty. Change `atLeast`, Save → the diff is exactly that field. Restore.
- [x] Stat picker correctness: choosing "Times a specific event was seen…" + an event id
  writes `events.seen.<id>` into the record (check the saved JSON, not just the form), and
  reopening the record re-splits it back into the two controls.
- [x] `PUT` of an achievement with `stat: "nonsense.key"` is refused with
  `achievements.bad-stat`.
- [x] Delete guard: with an event conditioned on an achievement (add one temporarily),
  deleting that achievement is blocked and the dialog links to the event. Remove the
  fixture afterwards and confirm `git diff events.json` is empty.
- [x] `curl -s 127.0.0.1:8932/api/issues` reports no **new** errors against the shipped data.

## Out of scope / do not touch

`map/profile.js` (phase 93 owns the namespace — if a counter is missing, note it rather
than adding it here), the achievements page (phase 95), the event-conditions engine and the
Events tab's condition UI (phase 96). Do not author achievements beyond a temporary
verification fixture. Do not change other validators' codes or severities. Do not touch
`map/**` or `arena/**` game logic.
