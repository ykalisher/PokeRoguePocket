# Session 17 — Legendary encounter attack rewards

**Standalone feature** (not part of the 08–14 mobile-polish batch). Touches the capture-encounter reward logic + one data-invariant test. Card data lives in root JSON (see the `data` skill). Validate with `node tests/run_all.js` and the `verify` skill.

## Context / why
When the player captures a Pokémon (`capture.html` → `map/capture.js`), the reward attack is chosen by `chooseRandomLearnableAttack(pokemon)` (~capture.js:485). It rolls a random attack the Pokémon shares any one type with, and **explicitly excludes every dual-requirement attack** (`pokemonCanLearnCaptureAttack` returns false via `requiresBothAttackTypes`, capture.js:544-556). A legendary Pokémon is any whose `type1/2/3` includes the token `'LEGENDARY'` (`isLegendaryPokemon`, capture.js:481).

Consequence today: a captured legendary can only ever receive a *base* legendary attack (`Divine Power`/`Divine Wrath`, which require just LEGENDARY) or a plain type attack — never a proper legendary+element attack.

**Goal:** When the captured Pokémon is legendary, grant a **dual-requirement legendary attack** — one with `full_type_requirements: true` that requires `LEGENDARY` AND one other type the legendary also has. Ends green + playable.

## Facts you need (verified against the JSON 2026-07-14)
- Exactly **14** dual-req legendary attacks (each pairs `LEGENDARY` with one real type, `full_type_requirements: true`): Blizzard(ICE), Great Storm(FLYING), Thunder Storm(ELECTRIC), Eruption(FIRE), Shatter Reality(PSYCHIC), Great Flood(WATER), Healing River(WATER), Lovecraftian Horror(GHOST), Hyper Beam(DRAGON), Ancient Force(FOSSIL), Sacred Sword(FIGHTING), Dazzling Aura(FAIRY), Dreadful Atmosphere(DARK), Roaring Swarm(BUG).
- **Exclude** these three legendary-touching attacks: `Ancient Power` (FOSSIL/LEGENDARY but `full_type_requirements:false`), `Divine Power`, `Divine Wrath` (LEGENDARY only).
- All 28 legendary Pokémon are eligible for ≥1 dual-req legendary attack (their non-LEGENDARY type is covered), so the legendary branch never falls back in practice — but keep a defensive fallback.
- Eligibility rule (canonical): with `full_type_requirements` true, the Pokémon must have ALL required types (`requiredTypes.every(t => pokemonTypes.includes(t))`). A legendary always has `LEGENDARY`, so this reduces to "the legendary also has the attack's other required type."
- Reusable helpers already in `map/capture.js`: `isLegendaryPokemon(pokemon)` (:481), `getRecordTypes(record, keys)` (:559, default keys `['type1','type2','type3']`), `requiresBothAttackTypes(attack)` (:555), `randomInt(min,max)`. Keep the two-copies reward and Dragon Gem logic (`completeCapture` ~:137, `chooseDragonGemReward` ~:500) untouched.

## Steps (`map/capture.js`)

### 17a. Legendary-eligibility helper
Near `requiresBothAttackTypes` (~capture.js:555), add:
```js
function legendaryCanUseDualAttack(pokemon, attack) {
    const attackTypes = getRecordTypes(attack, ['type1', 'type2']);
    if (!requiresBothAttackTypes(attack) || !attackTypes.includes('LEGENDARY')) return false;
    const pokemonTypes = getRecordTypes(pokemon);
    return attackTypes.every(type => pokemonTypes.includes(type));
}
```

### 17b. Branch the reward roll for legendaries
Add a legendary branch at the top of `chooseRandomLearnableAttack(pokemon)` (~capture.js:485), before the existing learnable/fallback logic:
```js
function chooseRandomLearnableAttack(pokemon) {
    const attacks = arena.GameData && Array.isArray(arena.GameData.attacks)
        ? arena.GameData.attacks
        : [];

    if (isLegendaryPokemon(pokemon)) {
        const legendaryOptions = attacks.filter(attack => legendaryCanUseDualAttack(pokemon, attack));
        if (legendaryOptions.length > 0) {
            return legendaryOptions[randomInt(0, legendaryOptions.length - 1)];
        }
        // Defensive: no eligible dual-req legendary attack — fall through to the normal roll.
    }

    const learnableAttacks = attacks.filter(attack => pokemonCanLearnCaptureAttack(pokemon, attack));
    const fallbackAttacks = attacks.filter(attack => !requiresBothAttackTypes(attack));
    const options = learnableAttacks.length > 0 ? learnableAttacks : fallbackAttacks;

    if (options.length > 0) {
        return options[randomInt(0, options.length - 1)];
    }

    return createFallbackAttack();
}
```
Leave `completeCapture` (two identical reward copies) and `chooseDragonGemReward` unchanged — a DRAGON dual-req reward (Hyper Beam) still correctly triggers the Dragon Gem.

### 17c. Data-invariant test
`map/capture.js` is a DOM-bound browser IIFE with private functions, so it is not Node-requireable — guard the feature's core assumption with a pure data test instead. In `tests/data_validation.test.js` (match its existing `node:test` style; load `../pokemon.json` and `../attacks.json`), add a test asserting: for every Pokémon whose types include `'LEGENDARY'`, at least one attack is eligible. Core check per (legendary, attack):
```js
const pokeTypes = [p.type1, p.type2, p.type3].filter(t => t && t !== 'NONE');
const attackTypes = [a.type1, a.type2].filter(t => t && t !== 'NONE');
const eligible = a.full_type_requirements
    && attackTypes.includes('LEGENDARY')
    && attackTypes.length > 1
    && attackTypes.every(t => pokeTypes.includes(t));
```
Fail with a message naming any legendary that has zero eligible attacks. This catches future JSON edits that would strand a legendary with no proper reward.

## Verify
- [ ] `node tests/run_all.js` green (incl. the new invariant test).
- [ ] `verify` skill (serve on 8931): trigger a legendary capture and confirm the reward is one of the 14 dual-req legendary attacks matching the legendary's second type (e.g. Articuno → Blizzard or Great Storm). Legendary offers are chance-gated on last-third map nodes; if hard to hit organically, drive `map/capture.js` directly after `arena.Data.loadGameData()` and read the capture `state.encounter.rewardAttackName`. Screenshot to scratchpad.
- [ ] Spot-check a non-legendary capture still gets a normal attack (unchanged).

## Out of scope
Don't change non-legendary reward logic, `pokemonCanLearnCaptureAttack`, the capture UI/animation, or the legendary spawn chance. Don't touch the battle engine. Never run `scripts/manage_*`, never act on `TODO.md`, never git commit unless asked.
