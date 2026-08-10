'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// arena_env aliases window to globalThis, so these IIFEs attach to the
// globalThis namespaces below.
require('./helpers/arena_env');
require('../map/locations');
require('../map/run_state');
require('../map/event_effects');

const R = globalThis.PokeRun;
const E = globalThis.PokeEvents;

function mon(name, id) {
    return {
        name, id,
        type1: 'NORMAL', type2: 'NONE', type3: 'NONE',
        baseHealth: 10, baseAttack: 10, baseDefense: 10, baseSpeed: 10
    };
}

// Eight party members so a full active party (six) still leaves benched cards,
// plus a gift Pokemon that is never granted.
function fixtureGameData() {
    return {
        pokemon: [
            mon('Alpha', 'a1'),
            mon('Bravo', 'b1'),
            mon('Charlie', 'c1'),
            mon('Delta', 'd1'),
            mon('Echo', 'e1'),
            mon('Foxtrot', 'f1'),
            mon('Golf', 'g1'),
            mon('Hotel', 'h1'),
            mon('Gift', 'x1')
        ],
        attacks: [],
        items: []
    };
}

function newRun() {
    return R.createRunState({ area: { nodes: [{ id: 'start' }], edges: [] }, collections: {} });
}

function grant(run, gameData, name) {
    E.applyEffects(run, [{ type: 'gain-card', cardKind: 'pokemon', name, count: 1 }], {}, { gameData, runStore: R });
}

// A full active party plus two benched Pokemon, so a replacement that fails to
// keep its slot gets pushed behind a promoted bench card.
function fullPartyRun(gameData) {
    const run = newRun();

    ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel']
        .forEach(name => grant(run, gameData, name));

    assert.deepEqual(activeNames(run), ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot']);
    assert.deepEqual(benchNames(run), ['Golf', 'Hotel']);

    return run;
}

function activeNames(run) {
    return run.collections.pokemon.map(card => card.pokemon.name);
}

function benchNames(run) {
    return run.collections.bench.pokemon.map(card => card.pokemon.name);
}

function cardNamed(run, name) {
    return [...run.collections.pokemon, ...run.collections.bench.pokemon]
        .find(card => card.pokemon.name === name) || null;
}

function replaceAction(replacement) {
    return {
        requires: [{ id: 'target', cardKind: 'pokemon' }],
        effects: [{
            type: 'replace-selected-card',
            selectionId: 'target',
            replacement
        }]
    };
}

test('replacing an active Pokemon leaves the gift in that active slot', () => {
    const gameData = fixtureGameData();
    const run = fullPartyRun(gameData);
    const selections = { target: cardNamed(run, 'Charlie').id };

    const result = E.applyAction(run, replaceAction({ cardKind: 'pokemon', name: 'Gift' }), selections, {
        gameData,
        runStore: R
    });

    assert.equal(result.ok, true);
    assert.equal(result.message, 'Replaced Charlie with Gift.');
    assert.deepEqual(activeNames(run), ['Alpha', 'Bravo', 'Gift', 'Delta', 'Echo', 'Foxtrot']);
    assert.deepEqual(benchNames(run), ['Golf', 'Hotel']);
});

test('replacing a benched Pokemon leaves the gift in that bench slot', () => {
    const gameData = fixtureGameData();
    const run = fullPartyRun(gameData);
    const selections = { target: cardNamed(run, 'Golf').id };

    const result = E.applyAction(run, replaceAction({ cardKind: 'pokemon', name: 'Gift' }), selections, {
        gameData,
        runStore: R
    });

    assert.equal(result.ok, true);
    assert.deepEqual(activeNames(run), ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot']);
    assert.deepEqual(benchNames(run), ['Gift', 'Hotel']);
});

test('replacing an active Pokemon with a Pokemon under the active limit keeps the party size', () => {
    const gameData = fixtureGameData();
    const run = newRun();

    grant(run, gameData, 'Alpha');
    grant(run, gameData, 'Bravo');

    const selections = { target: cardNamed(run, 'Alpha').id };
    const result = E.applyAction(run, replaceAction({ cardKind: 'pokemon', name: 'Gift' }), selections, {
        gameData,
        runStore: R
    });

    assert.equal(result.ok, true);
    assert.deepEqual(activeNames(run), ['Gift', 'Bravo']);
    assert.deepEqual(benchNames(run), []);
});

test('trading an active Pokemon for a random one keeps the active slot', () => {
    const gameData = fixtureGameData();
    const run = fullPartyRun(gameData);
    const selections = { target: cardNamed(run, 'Echo').id };
    const action = {
        requires: [{ id: 'target', cardKind: 'pokemon' }],
        effects: [{ type: 'trade-selected-pokemon', selectionId: 'target' }]
    };

    const result = E.applyAction(run, action, selections, { gameData, runStore: R });

    assert.equal(result.ok, true);

    const active = activeNames(run);

    assert.equal(active.length, 6);
    assert.notEqual(active[4], 'Echo');
    assert.deepEqual(active.slice(0, 4), ['Alpha', 'Bravo', 'Charlie', 'Delta']);
    assert.equal(active[5], 'Foxtrot');
    assert.deepEqual(benchNames(run), ['Golf', 'Hotel']);
});

test('a replacement of a different kind still goes through the normal add path', () => {
    const gameData = fixtureGameData();

    gameData.items = [{ name: 'Potion', id: 'i1', effect: 'HEAL', value: 20 }];

    const run = fullPartyRun(gameData);
    const selections = { target: cardNamed(run, 'Hotel').id };

    const result = E.applyAction(run, replaceAction({ cardKind: 'item', name: 'Potion' }), selections, {
        gameData,
        runStore: R
    });

    assert.equal(result.ok, true);
    assert.deepEqual(activeNames(run), ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot']);
    assert.deepEqual(benchNames(run), ['Golf']);
    assert.ok(run.collections.actions.some(card => card.item && card.item.name === 'Potion'));
});
