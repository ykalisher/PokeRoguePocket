'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// arena_env aliases window to globalThis, so map/locations.js and
// map/run_state.js attach to the globalThis namespaces below.
const { loadRealGameData, arena } = require('./helpers/arena_env');
const { pick } = require('./helpers/pick');
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
function sharesType(recordA, recordB) {
    const typesB = typesOf(recordB);
    return typesOf(recordA).some(type => typesB.includes(type));
}
// The stock rule, restated from the run's side: an attack belongs on the shelf
// when some owned pokemon (active or bench) shares one of its types.
function attackMatchesRunTypes(attack, run) {
    const owned = [...run.collections.pokemon, ...run.collections.bench.pokemon].map(card => card.pokemon);
    return owned.some(record => sharesType(attack, record));
}
function expectedLegalAttacks(gameData, run) {
    return gameData.attacks.filter(attack => (
        attackMatchesRunTypes(attack, run) &&
        !(typesOf(attack).includes('LEGENDARY') && !run.collections.pokemon
            .concat(run.collections.bench.pokemon)
            .some(card => typesOf(card.pokemon).includes('LEGENDARY')))
    ));
}
// A pokemon whose types some ungated attack shares, so type-filtered stock is
// never empty in the fixtures below.
function pickPlainPokemon(gameData) {
    return pick(
        gameData.pokemon,
        p => P.isObtainablePokemon(p, gameData) &&
            !typesOf(p).includes('DRAGON') &&
            gameData.attacks.some(a => !typesOf(a).includes('LEGENDARY') && sharesType(a, p)),
        'an obtainable non-dragon pokemon with at least one matching ungated attack'
    );
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
// Repair mimics sanitizeMartCardNames/repairOfferNames: keep the offers that
// are still retained, top the shelf back up with a fresh draw.
function repairNames(records, collectionKey, run, names, count) {
    const retained = new Set(
        records.filter(record => P.isMartOfferRetained(record, collectionKey, run)).map(record => record.name)
    );
    const kept = names.filter(name => retained.has(name));
    if (kept.length >= count) return kept;

    const refill = drawNames(records, collectionKey, run, count)
        .filter(name => !kept.includes(name))
        .slice(0, count - kept.length);
    return [...kept, ...refill];
}

test('isMartOfferAllowed: legendary attacks require an owned legendary pokemon', async () => {
    await loadRealGameData();
    const gameData = arena.GameData;
    const legendaryAttack = pick(gameData.attacks, a => typesOf(a).includes('LEGENDARY'), 'a legendary attack');
    const legendaryPokemon = pick(gameData.pokemon, p => typesOf(p).includes('LEGENDARY'), 'a legendary pokemon');
    const plainPokemon = pickPlainPokemon(gameData);
    const normalAttack = pick(
        gameData.attacks,
        a => !typesOf(a).includes('LEGENDARY') && sharesType(a, plainPokemon),
        'an ungated attack matching the plain pokemon'
    );

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
    const plainPokemon = pickPlainPokemon(gameData);
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
    addPokemon(run, pickPlainPokemon(gameData));
    addAttack(run, pick(gameData.attacks, a => !typesOf(a).includes('LEGENDARY') && !typesOf(a).includes('DRAGON'), 'an ungated attack'));

    const legalAttacks = gameData.attacks.filter(record => P.isMartOfferAllowed(record, 'attacks', run));
    const legalItems = gameData.items.filter(record => P.isMartOfferAllowed(record, 'items', run));
    const gemItemCount = gameData.items.filter(itemIsDragonGem).length;
    assert.deepEqual(legalAttacks.map(a => a.name), expectedLegalAttacks(gameData, run).map(a => a.name));
    assert.equal(legalItems.length, gameData.items.length - gemItemCount);
    assert.ok(gemItemCount > 0, 'gated items must exist so the filter is meaningful');
    assert.ok(
        gameData.attacks.some(a => typesOf(a).includes('LEGENDARY')) &&
        gameData.attacks.some(a => !attackMatchesRunTypes(a, run)),
        'gated and off-type attacks must exist so the filter is meaningful'
    );
    assert.ok(legalAttacks.length > 0 && legalItems.length > 0, 'filtered pools must stay non-empty');
});

test('every stocked attack shares a type with an owned pokemon, active or benched', async () => {
    await loadRealGameData();
    const gameData = arena.GameData;
    const run = emptyRun();
    const activePokemon = pickPlainPokemon(gameData);
    const benchPokemon = pick(
        gameData.pokemon,
        p => P.isObtainablePokemon(p, gameData) && !sharesType(p, activePokemon),
        'an obtainable pokemon sharing no type with the active one'
    );
    addPokemon(run, activePokemon);
    addPokemon(run, benchPokemon, true);

    const legalAttacks = gameData.attacks.filter(record => P.isMartOfferAllowed(record, 'attacks', run));
    assert.ok(legalAttacks.length > 0, 'the shelf must not be empty');
    legalAttacks.forEach(attack => {
        assert.ok(
            sharesType(attack, activePokemon) || sharesType(attack, benchPokemon),
            `${attack.name} shares no type with either owned pokemon`
        );
    });
    // The bench pokemon really does widen the shelf, so bench membership counts.
    assert.ok(
        legalAttacks.some(attack => !sharesType(attack, activePokemon) && sharesType(attack, benchPokemon)),
        'expected at least one attack stocked only because of the benched pokemon'
    );
});

test('a mid-visit trade never swaps out attacks already on the shelf', async () => {
    await loadRealGameData();
    const gameData = arena.GameData;
    const run = emptyRun();
    const tradedAway = pickPlainPokemon(gameData);
    const tradedFor = pick(
        gameData.pokemon,
        p => P.isObtainablePokemon(p, gameData) && !sharesType(p, tradedAway),
        'an obtainable pokemon sharing no type with the traded-away one'
    );
    const tradedAwayCard = addPokemon(run, tradedAway);

    const stock = drawNames(gameData.attacks, 'attacks', run, 8);
    assert.ok(stock.length > 0, 'the shelf must not be empty before the trade');

    // The trade service hands the old pokemon over and puts the new one in.
    run.collections.pokemon = run.collections.pokemon.filter(card => card.id !== tradedAwayCard.id);
    addPokemon(run, tradedFor);
    assert.ok(
        stock.some(name => !attackMatchesRunTypes(gameData.attacks.find(a => a.name === name), run)),
        'the trade must have stranded at least one stocked attack for this test to mean anything'
    );

    assert.deepEqual(repairNames(gameData.attacks, 'attacks', run, stock, 8), stock);
});

test('a run with no pokemon yet is not type-filtered, so the shelf is never empty', async () => {
    await loadRealGameData();
    const gameData = arena.GameData;
    const run = emptyRun();
    const legalAttacks = gameData.attacks.filter(record => P.isMartOfferAllowed(record, 'attacks', run));

    assert.deepEqual(
        legalAttacks.map(a => a.name),
        gameData.attacks.filter(a => !typesOf(a).includes('LEGENDARY')).map(a => a.name)
    );
});

test('filtered draw never surfaces a forbidden name for an ineligible run, over 200 draws', async () => {
    await loadRealGameData();
    const gameData = arena.GameData;
    const run = emptyRun();
    const ownedPokemon = pickPlainPokemon(gameData);
    addPokemon(run, ownedPokemon);
    addAttack(run, pick(gameData.attacks, a => !typesOf(a).includes('LEGENDARY') && !typesOf(a).includes('DRAGON'), 'an ungated attack'));

    const forbiddenAttack = pick(gameData.attacks, a => typesOf(a).includes('LEGENDARY'), 'a legendary attack').name;
    const offTypeAttack = pick(gameData.attacks, a => !sharesType(a, ownedPokemon), 'an attack sharing no type with the owned pokemon').name;
    const forbiddenItem = pick(gameData.items, itemIsDragonGem, 'a dragon-gem item').name;

    for (let iteration = 0; iteration < 200; iteration += 1) {
        const attackNames = drawNames(gameData.attacks, 'attacks', run, 8);
        const itemNames = drawNames(gameData.items, 'items', run, 4);

        assert.ok(!attackNames.includes(forbiddenAttack), 'legendary attack leaked into an ineligible draw');
        assert.ok(!attackNames.includes(offTypeAttack), 'off-type attack leaked into a draw');
        assert.ok(!itemNames.includes(forbiddenItem), 'dragon-gem item leaked into an ineligible draw');
        attackNames.forEach(name => {
            const record = gameData.attacks.find(entry => entry.name === name);
            assert.equal(P.isMartOfferAllowed(record, 'attacks', run), true, `${name} should be allowed`);
            assert.ok(sharesType(record, ownedPokemon), `${name} shares no type with the owned pokemon`);
        });
        itemNames.forEach(name => {
            const record = gameData.items.find(entry => entry.name === name);
            assert.equal(P.isMartOfferAllowed(record, 'items', run), true, `${name} should be allowed`);
        });
    }
});

test('eligible runs can still draw legendary attacks and dragon gems, within the type filter', async () => {
    await loadRealGameData();
    const gameData = arena.GameData;
    const run = emptyRun();
    addPokemon(run, pick(gameData.pokemon, p => typesOf(p).includes('LEGENDARY'), 'a legendary pokemon'));
    addPokemon(run, pick(gameData.pokemon, p => typesOf(p).includes('DRAGON'), 'a dragon pokemon'), true);
    addAttack(run, pick(gameData.attacks, a => typesOf(a).includes('DRAGON'), 'a dragon attack'));

    const legalAttacks = gameData.attacks.filter(record => P.isMartOfferAllowed(record, 'attacks', run));
    const legalItems = gameData.items.filter(record => P.isMartOfferAllowed(record, 'items', run));
    // Owning a legendary lifts the legendary gate, so the type rule is all that
    // is left: every attack sharing a type with the roster is on the shelf.
    assert.deepEqual(legalAttacks.map(a => a.name), expectedLegalAttacks(gameData, run).map(a => a.name));
    assert.ok(legalAttacks.some(a => typesOf(a).includes('LEGENDARY')), 'legendary attacks stay stockable');
    assert.ok(legalAttacks.some(a => typesOf(a).includes('DRAGON')), 'dragon attacks stay stockable');
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

test('chooseTradeResultRecord takes a list of excluded names', () => {
    const gameData = fixtureTradeGameData();

    for (let iteration = 0; iteration < 200; iteration += 1) {
        assert.equal(P.chooseTradeResultRecord(gameData, 'WATER', ['Trade Water B']).name, 'Trade Water A');
        // Excluding every match still yields one rather than nothing.
        const exhausted = P.chooseTradeResultRecord(gameData, 'WATER', ['Trade Water A', 'Trade Water B']);
        assert.ok(['Trade Water A', 'Trade Water B'].includes(exhausted.name));
    }
});

// --- Two visible trade offers -----------------------------------------------
// Three obtainable species per type, so a re-roll can always avoid both the
// other offer's species and the one species the run owns of that type.

function fixtureMultiTradeGameData() {
    return {
        pokemon: [
            makePokemon('Multi Water A', '0311', ['WATER']),
            makePokemon('Multi Water B', '0312', ['WATER']),
            makePokemon('Multi Water C', '0313', ['WATER']),
            makePokemon('Multi Grass A', '0314', ['GRASS']),
            makePokemon('Multi Grass B', '0315', ['GRASS']),
            makePokemon('Multi Grass C', '0316', ['GRASS'])
        ]
    };
}

function multiTradeRun(gameData) {
    const run = emptyRun();
    addPokemon(run, gameData.pokemon[0]);
    addPokemon(run, gameData.pokemon[3], true);
    return run;
}

test('rollMartTrade names an obtainable species and never one the run already owns', () => {
    const gameData = fixtureMultiTradeGameData();
    const run = multiTradeRun(gameData);
    const obtainableNames = P.getObtainablePokemonPool(gameData).map(record => record.name);

    for (let iteration = 0; iteration < 200; iteration += 1) {
        const rolled = P.rollMartTrade(run, gameData, ['Multi Water B']);

        assert.ok(rolled, 'expected a roll since the run owns pokemon');
        assert.ok(['WATER', 'GRASS'].includes(rolled.acceptedType), `unexpected acceptedType: ${rolled.acceptedType}`);
        assert.ok(obtainableNames.includes(rolled.offeredName), `unexpected offeredName: ${rolled.offeredName}`);
        assert.ok(!['Multi Water A', 'Multi Grass A'].includes(rolled.offeredName), 'offered a species the run owns');
        assert.notEqual(rolled.offeredName, 'Multi Water B', 'ignored excludeNames');
    }
});

test('rollMartTrade returns null when the run owns no pokemon', () => {
    assert.equal(P.rollMartTrade(emptyRun(), fixtureMultiTradeGameData(), []), null);
});

test('sanitizeMartTrades fills an encounter with MART_TRADE_COUNT distinct offers', () => {
    const gameData = fixtureMultiTradeGameData();
    const run = multiTradeRun(gameData);

    for (let iteration = 0; iteration < 100; iteration += 1) {
        const encounter = { trades: [] };
        assert.equal(P.sanitizeMartTrades(encounter, run, gameData), true);
        assert.equal(encounter.trades.length, P.MART_TRADE_COUNT);

        const offeredNames = encounter.trades.map(trade => trade.offeredName);
        assert.equal(new Set(offeredNames).size, offeredNames.length, `duplicate offers: ${offeredNames}`);
        encounter.trades.forEach(trade => {
            assert.ok(trade.acceptedType, 'offer without a wanted type');
            assert.ok(trade.offeredName, 'offer without a named species');
            assert.equal(trade.used, false);
        });

        // A valid list is left exactly as it is.
        const before = JSON.stringify(encounter.trades);
        assert.equal(P.sanitizeMartTrades(encounter, run, gameData), false);
        assert.equal(JSON.stringify(encounter.trades), before);
    }
});

test('sanitizeMartTrades never touches a used offer, even a stale one', () => {
    const gameData = fixtureMultiTradeGameData();
    const run = multiTradeRun(gameData);
    const used = { acceptedType: 'FIRE', offeredName: 'Not A Species', used: true };
    const encounter = { trades: [used] };

    P.sanitizeMartTrades(encounter, run, gameData);

    assert.equal(encounter.trades.length, P.MART_TRADE_COUNT);
    assert.deepEqual(encounter.trades[0], { acceptedType: 'FIRE', offeredName: 'Not A Species', used: true });
    assert.ok(encounter.trades[1].offeredName, 'the missing second offer should have been rolled');
});

test('sanitizeMartTrades re-rolls an offer whose wanted type the run no longer owns', () => {
    const gameData = fixtureMultiTradeGameData();
    const run = multiTradeRun(gameData);
    const encounter = {
        trades: [
            { acceptedType: 'FIRE', offeredName: 'Multi Water B', used: false },
            { acceptedType: 'WATER', offeredName: 'Multi Grass B', used: false }
        ]
    };

    assert.equal(P.sanitizeMartTrades(encounter, run, gameData), true);
    assert.ok(['WATER', 'GRASS'].includes(encounter.trades[0].acceptedType));
    assert.ok(encounter.trades[0].offeredName);
    assert.deepEqual(encounter.trades[1], { acceptedType: 'WATER', offeredName: 'Multi Grass B', used: false });
});

test('sanitizeMartTrades re-rolls an offer whose species left the obtainable pool', () => {
    const gameData = fixtureMultiTradeGameData();
    const run = multiTradeRun(gameData);
    const encounter = {
        trades: [
            { acceptedType: 'WATER', offeredName: 'Retired Species', used: false },
            { acceptedType: 'GRASS', offeredName: 'Multi Water C', used: false }
        ]
    };

    assert.equal(P.sanitizeMartTrades(encounter, run, gameData), true);
    assert.notEqual(encounter.trades[0].offeredName, 'Retired Species');
    assert.ok(P.getObtainablePokemonPool(gameData).some(record => record.name === encounter.trades[0].offeredName));
});

test('normalizeMartEncounters migrates a pre-array trade, keeping its used flag', () => {
    const normalized = R.normalizeMartEncounters({
        'shop-1': { nodeId: 'shop-1', tradeAcceptedType: 'WATER', tradeOfferedType: 'GRASS', tradeUsed: true },
        'shop-2': { nodeId: 'shop-2', tradeAcceptedType: 'FIRE', tradeOfferedType: 'WATER', tradeUsed: false },
        'shop-3': { nodeId: 'shop-3' }
    });

    assert.deepEqual(normalized['shop-1'].trades, [{ acceptedType: 'WATER', offeredName: null, used: true }]);
    assert.deepEqual(normalized['shop-2'].trades, [{ acceptedType: 'FIRE', offeredName: null, used: false }]);
    assert.deepEqual(normalized['shop-3'].trades, []);
    assert.equal('tradeAcceptedType' in normalized['shop-1'], false);
    assert.equal('tradeUsed' in normalized['shop-1'], false);
});

test('normalizeMartEncounters keeps trade offers as { acceptedType, offeredName, used }', () => {
    const normalized = R.normalizeMartEncounters({
        'shop-1': {
            nodeId: 'shop-1',
            trades: [
                { acceptedType: 'WATER', offeredName: 'Multi Grass A', used: true, stray: 'dropped' },
                null,
                { offeredName: 'Multi Water B' }
            ]
        }
    });

    assert.deepEqual(normalized['shop-1'].trades, [
        { acceptedType: 'WATER', offeredName: 'Multi Grass A', used: true },
        { acceptedType: null, offeredName: 'Multi Water B', used: false }
    ]);
});

test('a used offer survives a save/load round-trip so the mart cannot re-roll it', () => {
    const gameData = fixtureMultiTradeGameData();
    const run = multiTradeRun(gameData);
    const encounter = { nodeId: 'shop-1', trades: [] };

    P.sanitizeMartTrades(encounter, run, gameData);
    encounter.trades[0].used = true;
    const takenName = encounter.trades[0].offeredName;

    const reloaded = R.normalizeMartEncounters({ 'shop-1': encounter })['shop-1'];
    assert.equal(P.sanitizeMartTrades(reloaded, run, gameData), false);
    assert.equal(reloaded.trades[0].used, true);
    assert.equal(reloaded.trades[0].offeredName, takenName);
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
    // The mart now hands back the species named on the offer, looked up by name.
    const resultRecord = P.findPokemonByNameOrId(gameData, 'Trade Grass A');
    assert.ok(resultRecord);

    run.collections.pokemon = run.collections.pokemon.filter(card => card.id !== tradedAwayCard.id);
    run.collections.bench.pokemon = run.collections.bench.pokemon.filter(card => card.id !== tradedAwayCard.id);
    const newCard = R.createPokemonCard(resultRecord, 'player', R.allocateCardId(run, 'pokemon', resultRecord.name));
    R.addPokemonCard(run, newCard);
    R.balancePokemonCollections(run);

    const totalAfter = run.collections.pokemon.length + run.collections.bench.pokemon.length;
    assert.equal(totalAfter, totalBefore);
});
