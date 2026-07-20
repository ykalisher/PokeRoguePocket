'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// arena_env aliases window to globalThis, so these IIFEs attach to the
// globalThis namespaces below.
const { loadRealGameData, arena } = require('./helpers/arena_env');
require('../map/locations');
require('../map/run_state');
require('../map/event_effects');

const P = globalThis.PokeLocations;
const R = globalThis.PokeRun;
const E = globalThis.PokeEvents;

function makeGraph() {
    return { nodes: [{ id: 'start' }], edges: [] };
}

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

// A baby (evolvesInto a fixture mega), the mega, a legendary, and two plain
// obtainable species — enough to exercise every pool-eligibility branch.
function fixtureGameData() {
    const mega = makePokemon('Fixture Mega', '9002', ['FIRE', 'DRAGON']);
    const baby = makePokemon('Fixture Baby', '9001', ['FIRE', 'BABY'], { evolvesInto: 'Fixture Mega' });
    const legendary = makePokemon('Fixture Legend', '9003', ['LEGENDARY']);
    // Ids stay below 9000 so these read as obtainable — ids >9000 are the mega
    // convention (see isMegaPokemon), exercised separately below.
    const plainA = makePokemon('Fixture Plain A', '0904', ['WATER']);
    const plainB = makePokemon('Fixture Plain B', '0905', ['WATER']);
    return { pokemon: [baby, mega, legendary, plainA, plainB] };
}

test('isObtainablePokemon verdicts against a baby/mega/legendary fixture', () => {
    const gameData = fixtureGameData();
    const [baby, mega, legendary, plainA, plainB] = gameData.pokemon;

    assert.equal(P.isObtainablePokemon(plainA, gameData), true);
    assert.equal(P.isObtainablePokemon(plainB, gameData), true);
    assert.equal(P.isObtainablePokemon(baby, gameData), false);
    assert.equal(P.isObtainablePokemon(mega, gameData), false);
    assert.equal(P.isObtainablePokemon(legendary, gameData), false);
});

test('isMegaPokemon uses id > 9000 for the mega convention, not the name', () => {
    const megaById = makePokemon('Highnum Fixture', '9500', ['FIRE']);
    // "Mega"-prefixed name but a low id: NOT a mega. Guards the real Meganium
    // (id 0154) case — the convention is id-based on purpose.
    const megaNameLowId = makePokemon('Mega Fixture', '0500', ['FIRE']);
    const plain = makePokemon('Plain Fixture', '0501', ['FIRE']);
    const gameData = { pokemon: [megaById, megaNameLowId, plain] };

    assert.equal(P.isMegaPokemon(megaById, gameData), true);
    assert.equal(P.isMegaPokemon(megaNameLowId, gameData), false, 'a "Mega"-named record below id 9000 (cf. Meganium) is not a mega');
    assert.equal(P.isMegaPokemon(plain, gameData), false);

    assert.equal(P.isObtainablePokemon(megaById, gameData), false);
    assert.equal(P.isObtainablePokemon(megaNameLowId, gameData), true);
    assert.equal(P.isObtainablePokemon(plain, gameData), true);
});

test('findPokemonByNameOrId resolves by exact name and by exact id', () => {
    const gameData = fixtureGameData();
    assert.equal(P.findPokemonByNameOrId(gameData, 'Fixture Mega').id, '9002');
    assert.equal(P.findPokemonByNameOrId(gameData, '9002').name, 'Fixture Mega');
    assert.equal(P.findPokemonByNameOrId(gameData, 'nope-at-all'), null);
});

test('getMegaTargetKeys is memoized per gameData object and stays correct', () => {
    const gameData = fixtureGameData();
    const first = P.getMegaTargetKeys(gameData);

    assert.deepEqual([...first].sort(), ['9002', 'Fixture Mega']);
    // Same object in, same cached Set out.
    assert.equal(P.getMegaTargetKeys(gameData), first);
});

test('a different gameData object gets freshly computed keys', () => {
    const gameData = fixtureGameData();
    P.getMegaTargetKeys(gameData);

    const other = fixtureGameData();
    other.pokemon.push(
        makePokemon('Other Mega', '9102', ['WATER', 'DRAGON']),
        makePokemon('Other Baby', '9101', ['WATER', 'BABY'], { evolvesInto: 'Other Mega' })
    );
    const keys = P.getMegaTargetKeys(other);

    assert.deepEqual([...keys].sort(), ['9002', '9102', 'Fixture Mega', 'Other Mega']);
    // The first object's cache entry is untouched.
    assert.deepEqual([...P.getMegaTargetKeys(gameData)].sort(), ['9002', 'Fixture Mega']);
});

test('memoization does not change pool verdicts', () => {
    const gameData = fixtureGameData();
    const [baby, mega, , plainA] = gameData.pokemon;

    // Call twice: the second pass runs entirely from cache.
    for (let pass = 0; pass < 2; pass += 1) {
        assert.equal(P.isObtainablePokemon(plainA, gameData), true);
        assert.equal(P.isObtainablePokemon(baby, gameData), false);
        assert.equal(P.isObtainablePokemon(mega, gameData), false);
        assert.deepEqual(
            P.getObtainablePokemonPool(gameData).map(record => record.name).sort(),
            ['Fixture Plain A', 'Fixture Plain B']
        );
    }
});

test('getWildPokemonPool excludes baby/mega/legendary from the fixture', () => {
    const gameData = fixtureGameData();
    const pool = P.getWildPokemonPool(gameData, ['WATER']);
    assert.deepEqual(pool.map(record => record.name).sort(), ['Fixture Plain A', 'Fixture Plain B']);
});

test('getBabyPokemonPool returns only BABY-typed species from real pokemon.json', async () => {
    await loadRealGameData();
    const babies = P.getBabyPokemonPool(arena.GameData);
    assert.ok(babies.length >= 1, 'expected at least one authored BABY-typed species');
    babies.forEach(record => {
        assert.ok([record.type1, record.type2, record.type3].includes('BABY'), `${record.name} is not BABY-typed`);
    });
});

test('getWildPokemonPool against real data returns exactly the obtainable species (no legendary/baby/mega)', async () => {
    await loadRealGameData();
    const gameData = arena.GameData;
    const pool = P.getWildPokemonPool(gameData, []);

    // Independently recompute the obtainable set so this survives the owner
    // adding ordinary pokemon: unique-by-name, not LEGENDARY, not BABY, not a
    // mega (id > 9000). Guards that megas like Mega Camerupt (9323) stay out
    // while Meganium (0154) stays in.
    const seen = new Set();
    const expected = [];
    gameData.pokemon.forEach(species => {
        if (seen.has(species.name)) return;
        seen.add(species.name);
        const types = [species.type1, species.type2, species.type3];
        if (types.includes('LEGENDARY') || types.includes('BABY')) return;
        if (parseInt(species.id, 10) > 9000) return;
        expected.push(species);
    });

    assert.ok(expected.length > 0, 'expected a non-empty obtainable set');
    assert.deepEqual(pool.map(species => species.name).sort(), expected.map(species => species.name).sort());
});

test('gain-random-card pokemon picks from the fixture never return baby/mega/legendary', () => {
    const gameData = fixtureGameData();
    const run = R.createRunState({ area: makeGraph(), collections: {} });
    const effect = { type: 'gain-random-card', cardKind: 'pokemon', count: 40 };

    E.applyEffects(run, [effect], {}, { runStore: R, gameData });

    const granted = [...run.collections.pokemon, ...run.collections.bench.pokemon].map(card => card.pokemon.name);
    assert.ok(granted.length > 0, 'expected at least one granted pokemon');
    granted.forEach(name => {
        assert.ok(['Fixture Plain A', 'Fixture Plain B'].includes(name), `unexpected grant: ${name}`);
    });
});
