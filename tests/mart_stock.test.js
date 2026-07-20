'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// arena_env aliases window to globalThis, so map/locations.js and
// map/run_state.js attach to the globalThis namespaces below.
const { loadRealGameData, arena } = require('./helpers/arena_env');
require('../map/locations');
require('../map/run_state');

const P = globalThis.PokeLocations;
const R = globalThis.PokeRun;

function makeGraph() {
    return { nodes: [{ id: 'start' }], edges: [] };
}

function emptyRun() {
    return R.createRunState({ area: makeGraph(), collections: {} });
}

function addPokemon(run, record, bench = false) {
    const card = R.createPokemonCard(record, 'player', `test-pkmn-${record.name}`);
    (bench ? run.collections.bench.pokemon : run.collections.pokemon).push(card);
    return card;
}

function addAttack(run, record, bench = false) {
    const card = R.createAttackCard(record, 'player', `test-atk-${record.name}`);
    (bench ? run.collections.bench.actions : run.collections.actions).push(card);
    return card;
}

function typesOf(record) {
    if (record && Array.isArray(record.types)) return record.types;
    return record ? [record.type1, record.type2, record.type3].filter(t => t && t !== 'NONE') : [];
}
function itemIsDragonGem(item) {
    return Boolean(item && Array.isArray(item.status) && item.status.includes('DRAGON_GEM'));
}
function pick(records, predicate, label) {
    const record = records.find(predicate);
    assert.ok(record, `expected real data to contain ${label}`);
    return record;
}

// Draw mimics the shuffle-and-slice used by chooseMartCardNames/chooseOfferNames,
// filtered through isMartOfferAllowed exactly as the real draw paths do.
function drawNames(records, collectionKey, run, count) {
    const eligible = records.filter(record => P.isMartOfferAllowed(record, collectionKey, run));
    const shuffled = eligible.slice();
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled.slice(0, count).map(record => record.name);
}

test('isMartOfferAllowed: legendary attacks require an owned legendary pokemon', async () => {
    await loadRealGameData();
    const gameData = arena.GameData;
    const legendaryAttack = pick(gameData.attacks, a => typesOf(a).includes('LEGENDARY'), 'a legendary attack');
    const normalAttack = pick(gameData.attacks, a => !typesOf(a).includes('LEGENDARY') && !typesOf(a).includes('DRAGON'), 'an ungated attack');
    const legendaryPokemon = pick(gameData.pokemon, p => typesOf(p).includes('LEGENDARY'), 'a legendary pokemon');
    const plainPokemon = pick(gameData.pokemon, p => P.isObtainablePokemon(p, gameData) && !typesOf(p).includes('DRAGON'), 'a plain obtainable non-dragon pokemon');

    const runWithoutLegendary = emptyRun();
    addPokemon(runWithoutLegendary, plainPokemon);
    assert.equal(P.isMartOfferAllowed(legendaryAttack, 'attacks', runWithoutLegendary), false);
    assert.equal(P.isMartOfferAllowed(normalAttack, 'attacks', runWithoutLegendary), true);

    const runWithLegendary = emptyRun();
    addPokemon(runWithLegendary, plainPokemon);
    addPokemon(runWithLegendary, legendaryPokemon, true); // bench counts too
    assert.equal(P.isMartOfferAllowed(legendaryAttack, 'attacks', runWithLegendary), true);
    assert.equal(P.isMartOfferAllowed(normalAttack, 'attacks', runWithLegendary), true);
});

test('isMartOfferAllowed: dragon-gem items require both a DRAGON attack and a DRAGON pokemon owned', async () => {
    await loadRealGameData();
    const gameData = arena.GameData;
    const gemItem = pick(gameData.items, itemIsDragonGem, 'a dragon-gem item');
    const normalItem = pick(gameData.items, i => !itemIsDragonGem(i), 'a non-gem item');
    const dragonAttack = pick(gameData.attacks, a => typesOf(a).includes('DRAGON'), 'a dragon attack');
    const dragonPokemon = pick(gameData.pokemon, p => typesOf(p).includes('DRAGON'), 'a dragon pokemon');
    const plainPokemon = pick(gameData.pokemon, p => P.isObtainablePokemon(p, gameData) && !typesOf(p).includes('DRAGON'), 'a plain obtainable non-dragon pokemon');
    const plainAttack = pick(gameData.attacks, a => !typesOf(a).includes('LEGENDARY') && !typesOf(a).includes('DRAGON'), 'an ungated attack');

    const noPrereqsRun = emptyRun();
    addPokemon(noPrereqsRun, plainPokemon);
    addAttack(noPrereqsRun, plainAttack);
    assert.equal(P.isMartOfferAllowed(gemItem, 'items', noPrereqsRun), false);
    assert.equal(P.isMartOfferAllowed(normalItem, 'items', noPrereqsRun), true);

    const onlyDragonAttackRun = emptyRun();
    addPokemon(onlyDragonAttackRun, plainPokemon);
    addAttack(onlyDragonAttackRun, dragonAttack);
    assert.equal(P.isMartOfferAllowed(gemItem, 'items', onlyDragonAttackRun), false);

    const onlyDragonPokemonRun = emptyRun();
    addPokemon(onlyDragonPokemonRun, dragonPokemon);
    addAttack(onlyDragonPokemonRun, plainAttack);
    assert.equal(P.isMartOfferAllowed(gemItem, 'items', onlyDragonPokemonRun), false);

    const bothPrereqsRun = emptyRun();
    addPokemon(bothPrereqsRun, dragonPokemon);
    addAttack(bothPrereqsRun, dragonAttack, true); // bench attack counts too
    assert.equal(P.isMartOfferAllowed(gemItem, 'items', bothPrereqsRun), true);
    assert.equal(P.isMartOfferAllowed(normalItem, 'items', bothPrereqsRun), true);
});

test('non-attack/item collections are always allowed regardless of run state', async () => {
    await loadRealGameData();
    const gameData = arena.GameData;
    const legendaryPokemon = pick(gameData.pokemon, p => typesOf(p).includes('LEGENDARY'), 'a legendary pokemon');
    const run = emptyRun();
    assert.equal(P.isMartOfferAllowed(legendaryPokemon, 'pokemon', run), true);
});

test('filtered pools drop exactly the gated cards for an ineligible run', async () => {
    await loadRealGameData();
    const gameData = arena.GameData;
    const run = emptyRun();
    addPokemon(run, pick(gameData.pokemon, p => P.isObtainablePokemon(p, gameData) && !typesOf(p).includes('DRAGON'), 'a plain obtainable non-dragon pokemon'));
    addAttack(run, pick(gameData.attacks, a => !typesOf(a).includes('LEGENDARY') && !typesOf(a).includes('DRAGON'), 'an ungated attack'));

    const legalAttacks = gameData.attacks.filter(record => P.isMartOfferAllowed(record, 'attacks', run));
    const legalItems = gameData.items.filter(record => P.isMartOfferAllowed(record, 'items', run));
    const legendaryAttackCount = gameData.attacks.filter(a => typesOf(a).includes('LEGENDARY')).length;
    const gemItemCount = gameData.items.filter(itemIsDragonGem).length;
    assert.equal(legalAttacks.length, gameData.attacks.length - legendaryAttackCount);
    assert.equal(legalItems.length, gameData.items.length - gemItemCount);
    assert.ok(legendaryAttackCount > 0 && gemItemCount > 0, 'gated cards must exist so the filter is meaningful');
    assert.ok(legalAttacks.length > 0 && legalItems.length > 0, 'filtered pools must stay non-empty');
});

test('filtered draw never surfaces a forbidden name for an ineligible run, over 200 draws', async () => {
    await loadRealGameData();
    const gameData = arena.GameData;
    const run = emptyRun();
    addPokemon(run, pick(gameData.pokemon, p => P.isObtainablePokemon(p, gameData) && !typesOf(p).includes('DRAGON'), 'a plain obtainable non-dragon pokemon'));
    addAttack(run, pick(gameData.attacks, a => !typesOf(a).includes('LEGENDARY') && !typesOf(a).includes('DRAGON'), 'an ungated attack'));

    const forbiddenAttack = pick(gameData.attacks, a => typesOf(a).includes('LEGENDARY'), 'a legendary attack').name;
    const forbiddenItem = pick(gameData.items, itemIsDragonGem, 'a dragon-gem item').name;

    for (let iteration = 0; iteration < 200; iteration += 1) {
        const attackNames = drawNames(gameData.attacks, 'attacks', run, 8);
        const itemNames = drawNames(gameData.items, 'items', run, 4);

        assert.ok(!attackNames.includes(forbiddenAttack), 'legendary attack leaked into an ineligible draw');
        assert.ok(!itemNames.includes(forbiddenItem), 'dragon-gem item leaked into an ineligible draw');
        attackNames.forEach(name => {
            const record = gameData.attacks.find(entry => entry.name === name);
            assert.equal(P.isMartOfferAllowed(record, 'attacks', run), true, `${name} should be allowed`);
        });
        itemNames.forEach(name => {
            const record = gameData.items.find(entry => entry.name === name);
            assert.equal(P.isMartOfferAllowed(record, 'items', run), true, `${name} should be allowed`);
        });
    }
});

test('eligible runs can still draw the full range, including legendary attacks and dragon gems', async () => {
    await loadRealGameData();
    const gameData = arena.GameData;
    const run = emptyRun();
    addPokemon(run, pick(gameData.pokemon, p => typesOf(p).includes('LEGENDARY'), 'a legendary pokemon'));
    addPokemon(run, pick(gameData.pokemon, p => typesOf(p).includes('DRAGON'), 'a dragon pokemon'), true);
    addAttack(run, pick(gameData.attacks, a => typesOf(a).includes('DRAGON'), 'a dragon attack'));

    const legalAttacks = gameData.attacks.filter(record => P.isMartOfferAllowed(record, 'attacks', run));
    const legalItems = gameData.items.filter(record => P.isMartOfferAllowed(record, 'items', run));
    assert.equal(legalAttacks.length, gameData.attacks.length);
    assert.equal(legalItems.length, gameData.items.length);
});

// --- Mart trade service (phase 46) ------------------------------------------

function makePokemon(name, id, types, extra) {
    return Object.assign({
        name,
        id,
        type1: types[0] || 'NONE',
        type2: types[1] || 'NONE',
        type3: types[2] || 'NONE',
        baseHealth: 10,
        baseAttack: 10,
        baseDefense: 10,
        baseSpeed: 10
    }, extra || {});
}

function getRecordTypes(record) {
    return [record.type1, record.type2, record.type3].filter(type => type && type !== 'NONE');
}

// A baby (evolvesInto a fixture mega), the mega, a legendary, and two
// obtainable species per type — enough to exercise every trade branch:
// uniform accepted/offered type rolls and the exclude-when-possible rule.
function fixtureTradeGameData() {
    // Ids stay below 9000 so the obtainable water/grass species are not caught
    // by the mega convention (name "Mega…" or id > 9000; see isMegaPokemon).
    const mega = makePokemon('Trade Mega', '0302', ['FIRE', 'DRAGON']);
    const baby = makePokemon('Trade Baby', '0301', ['FIRE', 'BABY'], { evolvesInto: 'Trade Mega' });
    const legendary = makePokemon('Trade Legend', '0303', ['LEGENDARY']);
    const waterA = makePokemon('Trade Water A', '0304', ['WATER']);
    const waterB = makePokemon('Trade Water B', '0305', ['WATER']);
    const grassA = makePokemon('Trade Grass A', '0306', ['GRASS']);
    return { pokemon: [baby, mega, legendary, waterA, waterB, grassA] };
}

test('rollMartTradeTypes: accepted is uniform over the run\'s owned types, offered always has an obtainable species', () => {
    const gameData = fixtureTradeGameData();
    const [, , legendary, waterA] = gameData.pokemon;
    const run = emptyRun();
    addPokemon(run, waterA);
    addPokemon(run, legendary, true);

    for (let iteration = 0; iteration < 200; iteration += 1) {
        const rolled = P.rollMartTradeTypes(run, gameData);

        assert.ok(rolled, 'expected a roll since the run owns pokemon');
        assert.ok(['WATER', 'LEGENDARY'].includes(rolled.acceptedType), `unexpected acceptedType: ${rolled.acceptedType}`);
        assert.ok(['WATER', 'GRASS'].includes(rolled.offeredType), `unexpected offeredType: ${rolled.offeredType}`);
    }
});

test('rollMartTradeTypes returns null when the run owns no pokemon', () => {
    const gameData = fixtureTradeGameData();
    const run = emptyRun();
    assert.equal(P.rollMartTradeTypes(run, gameData), null);
});

test('chooseTradeResultRecord: never a legendary/baby/mega, always matches the offered type, over 200 rolls', () => {
    const gameData = fixtureTradeGameData();

    for (let iteration = 0; iteration < 200; iteration += 1) {
        const waterResult = P.chooseTradeResultRecord(gameData, 'WATER', null);
        const grassResult = P.chooseTradeResultRecord(gameData, 'GRASS', null);

        assert.ok(['Trade Water A', 'Trade Water B'].includes(waterResult.name), `unexpected WATER result: ${waterResult.name}`);
        assert.ok(getRecordTypes(waterResult).includes('WATER'));
        assert.equal(grassResult.name, 'Trade Grass A');
        assert.ok(getRecordTypes(grassResult).includes('GRASS'));
    }
});

test('chooseTradeResultRecord excludes the traded-away name when another match exists', () => {
    const gameData = fixtureTradeGameData();

    for (let iteration = 0; iteration < 200; iteration += 1) {
        const result = P.chooseTradeResultRecord(gameData, 'WATER', 'Trade Water A');
        assert.equal(result.name, 'Trade Water B');
    }
});

test('chooseTradeResultRecord falls back to the excluded name when it is the only match', () => {
    const gameData = fixtureTradeGameData();

    for (let iteration = 0; iteration < 200; iteration += 1) {
        const result = P.chooseTradeResultRecord(gameData, 'GRASS', 'Trade Grass A');
        assert.equal(result.name, 'Trade Grass A');
    }
});

test('a simulated trade keeps total pokemon count constant', () => {
    const gameData = fixtureTradeGameData();
    const [, , , waterA, waterB, grassA] = gameData.pokemon;
    const run = emptyRun();
    addPokemon(run, waterA);
    addPokemon(run, waterB, true);
    addPokemon(run, grassA, true);

    const totalBefore = run.collections.pokemon.length + run.collections.bench.pokemon.length;
    const tradedAwayCard = run.collections.pokemon[0];
    const resultRecord = P.chooseTradeResultRecord(gameData, 'GRASS', tradedAwayCard.pokemon.name);
    assert.ok(resultRecord);

    run.collections.pokemon = run.collections.pokemon.filter(card => card.id !== tradedAwayCard.id);
    run.collections.bench.pokemon = run.collections.bench.pokemon.filter(card => card.id !== tradedAwayCard.id);
    const newCard = R.createPokemonCard(resultRecord, 'player', R.allocateCardId(run, 'pokemon', resultRecord.name));
    R.addPokemonCard(run, newCard);
    R.balancePokemonCollections(run);

    const totalAfter = run.collections.pokemon.length + run.collections.bench.pokemon.length;
    assert.equal(totalAfter, totalBefore);
});
