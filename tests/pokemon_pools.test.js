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
    const plainA = makePokemon('Fixture Plain A', '9004', ['WATER']);
    const plainB = makePokemon('Fixture Plain B', '9005', ['WATER']);
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

test('findPokemonByNameOrId resolves by exact name and by exact id', () => {
    const gameData = fixtureGameData();
    assert.equal(P.findPokemonByNameOrId(gameData, 'Fixture Mega').id, '9002');
    assert.equal(P.findPokemonByNameOrId(gameData, '9002').name, 'Fixture Mega');
    assert.equal(P.findPokemonByNameOrId(gameData, 'nope-at-all'), null);
});

test('getWildPokemonPool excludes baby/mega/legendary from the fixture', () => {
    const gameData = fixtureGameData();
    const pool = P.getWildPokemonPool(gameData, ['WATER']);
    assert.deepEqual(pool.map(record => record.name).sort(), ['Fixture Plain A', 'Fixture Plain B']);
});

test('getBabyPokemonPool is empty against real pokemon.json (no baby data authored yet)', async () => {
    await loadRealGameData();
    assert.deepEqual(P.getBabyPokemonPool(arena.GameData), []);
});

test('getWildPokemonPool against real data still returns exactly the 160 non-legendary species', async () => {
    await loadRealGameData();
    const gameData = arena.GameData;
    const pool = P.getWildPokemonPool(gameData, []);
    assert.equal(pool.length, 160);
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
