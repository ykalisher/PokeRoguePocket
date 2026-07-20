'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// arena_env aliases window to globalThis, so these IIFEs attach to the
// globalThis namespaces below.
require('./helpers/arena_env');
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

// A plain (non-legendary/non-baby/non-mega) species flagged eventOnly, plus
// an ordinary obtainable species to prove the filter is scoped correctly.
function fixtureGameData() {
    const eventOnly = makePokemon('Fixture Event Only', '0906', ['WATER'], { eventOnly: true });
    const plain = makePokemon('Fixture Plain', '0907', ['WATER']);
    return { pokemon: [eventOnly, plain] };
}

test('isObtainablePokemon excludes an eventOnly-flagged species', () => {
    const gameData = fixtureGameData();
    const [eventOnly, plain] = gameData.pokemon;

    assert.equal(P.isObtainablePokemon(eventOnly, gameData), false);
    assert.equal(P.isObtainablePokemon(plain, gameData), true);
});

test('getWildPokemonPool omits an eventOnly-flagged species', () => {
    const gameData = fixtureGameData();
    const pool = P.getWildPokemonPool(gameData, ['WATER']);
    assert.deepEqual(pool.map(record => record.name), ['Fixture Plain']);
});

test('a gain-card effect naming an eventOnly species still grants it', () => {
    const gameData = fixtureGameData();
    const run = R.createRunState({ area: makeGraph(), collections: {} });
    const effect = { type: 'gain-card', cardKind: 'pokemon', name: 'Fixture Event Only', count: 1 };

    E.applyEffects(run, [effect], {}, { runStore: R, gameData });

    const granted = [...run.collections.pokemon, ...run.collections.bench.pokemon].map(card => card.pokemon.name);
    assert.deepEqual(granted, ['Fixture Event Only']);
});
