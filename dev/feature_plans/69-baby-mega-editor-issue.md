# Phase 69 — Editor issue: a baby must point to a Mega

**Recommended agent:** Haiku · low effort.
**Prereqs:** none (independent of Phase 68). **Read first:** `67-event-only-pokemon-overview.md`.
**Goal:** The data editor's Issues tab reports a **save-blocking error** when a BABY-typed
pokemon does not point (via `evolvesInto`) to a Mega (a record with `id` > 9000). All 31
current babies already pass, so this blocks no existing data. Ends green.

## Context you need

- **Where checks live.** `dev/editor/validate.js` `validatePokemon(pokemon, enums)`
  (~L82-129). Existing related checks: `pokemon.baby-needs-other-type` (~L120) and
  `pokemon.bad-evolves-into` (~L123 — fires only when `evolvesInto` is present AND resolves
  to nothing). Neither requires a baby to HAVE an `evolvesInto`, nor that the target is a
  Mega — that is the gap this phase fills. `err(...)` helper at ~L37.
- **"Mega" convention (authoritative).** `map/locations.js` `isMegaByConvention` (~L764): a
  record is a Mega iff `parseInt(id, 10) > 9000`. Reproduce this rule **inline** in the
  validator (it must stay dependency-free — it runs in both browser and Node); cite the
  source in a comment. Verified facts: all 31 Megas have 9xxx ids; all 31 babies'
  `evolvesInto` names a 9xxx Mega; zero non-baby records use `evolvesInto`. So this error
  targets only babies and fires on none of today's data.
- **Resolving the target.** `validatePokemon` has the full `pokemon` array. `namesAndIds`
  (~L86) is only a presence Set — you need the target *record* to read its id, so build a
  small name/id→record Map.
- **Severity = ERROR.** The server write-guard (`dev/editor/server.js` ~L315) blocks a PUT
  on any error in the written file / any new error elsewhere, enforcing the invariant at save
  time. (This is why the "real data has zero such errors" test in step 3 matters — a false
  positive would block all saves.)

## Steps

- [x] 1. **`dev/editor/validate.js`** — inside `validatePokemon`, near the `namesAndIds`
  build (~L86), add a resolver map and a mega predicate:
  ```js
  const byNameOrId = new Map();
  pokemon.forEach((record) => {
      if (record.name) byNameOrId.set(record.name, record);
      if (record.id) byNameOrId.set(record.id, record);
  });
  // Mega convention: id > 9000 (mirrors map/locations.js isMegaByConvention).
  const isMega = (record) => {
      const idNum = parseInt(record && record.id, 10);
      return Number.isFinite(idNum) && idNum > 9000;
  };
  ```

- [x] 2. **`dev/editor/validate.js`** — inside the per-record loop, after the existing
  baby/`evolvesInto` checks (~L125), add:
  ```js
  if ([record.type1, record.type2, record.type3].includes('BABY')) {
      if (record.evolvesInto === undefined || record.evolvesInto === '') {
          issues.push(err('pokemon.json', key, 'pokemon.baby-missing-mega',
              `${key}: BABY pokemon must set evolvesInto to its Mega`, 'evolvesInto'));
      } else {
          const target = byNameOrId.get(record.evolvesInto);
          // target that doesn't resolve at all is already reported by pokemon.bad-evolves-into
          if (target && !isMega(target)) {
              issues.push(err('pokemon.json', key, 'pokemon.baby-missing-mega',
                  `${key}: evolvesInto "${record.evolvesInto}" is not a Mega (id must be > 9000)`, 'evolvesInto'));
          }
      }
  }
  ```

- [x] 3. **Tests — `tests/editor_validation.test.js`.** Add cases: (a) a BABY record with no
  `evolvesInto` → `pokemon.baby-missing-mega` error; (b) a BABY whose `evolvesInto` names a
  non-Mega (id ≤ 9000) → same error; (c) a BABY pointing to a 9xxx Mega → no such error.
  Also assert the **real** `pokemon.json` produces **zero** `pokemon.baby-missing-mega`
  issues (guards against the error ever blocking a live save).

## Verification

- [x] `node tests/run_all.js` green — in particular the "real data has zero
  baby-missing-mega" assertion passes.
- [x] Editor browser check via the `verify` skill: open **Numel** (a baby) → no
  baby-missing-mega issue. Temporarily clear its Evolves-into → the Issues tab shows the
  error and the Save button is blocked; restore it → the error clears. (Do **not** save the
  cleared state.)

## Out of scope / do not touch

- **Ground rules** (see `67-event-only-pokemon-overview.md`).
- Do **not** modify `map/locations.js` (reproduce the id>9000 rule inline; don't import
  engine code into the validator).
- Do **not** change the existing `pokemon.bad-evolves-into` / `pokemon.baby-needs-other-type`
  checks, or any real `pokemon.json` data.
- Do **not** touch the event-only work (Phase 68).
