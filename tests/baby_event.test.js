'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// arena_env aliases window to globalThis, so these IIFEs attach to the
// globalThis namespaces below.
const { loadRealGameData, arena } = require('./helpers/arena_env');
require('../map/locations');
require('../map/run_state');
require('../map/event_effects');

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

const NURSERY_EVENT = {
    type: 'gift',
    title: 'Nursery Surprise',
    id: 'nursery-egg',
    body: 'A day-care worker presses a warm, wobbling egg into your hands.',
    buttonText: 'Take the egg!',
    effects: [{ type: 'gain-random-baby' }],
    enabled: true,
    requiresPool: 'baby'
};

function fixtureGameDataWithBaby() {
    const baby = makePokemon('Fixture Baby', '9001', ['FIRE', 'BABY']);
    return { pokemon: [baby], events: [NURSERY_EVENT] };
}

function fixtureGameDataWithoutBaby() {
    const plain = makePokemon('Fixture Plain', '9002', ['WATER']);
    return { pokemon: [plain], events: [NURSERY_EVENT] };
}

test('chooseEvent never returns nursery-egg against real game data (zero babies authored)', async () => {
    await loadRealGameData();
    const gameData = arena.GameData;

    assert.ok(gameData.events.some(event => event.id === 'nursery-egg'), 'expected nursery-egg to be seeded in events.json');

    for (let i = 0; i < 200; i += 1) {
        const chosen = E.chooseEvent(gameData, {});
        assert.notEqual(chosen && chosen.id, 'nursery-egg');
    }
});

test('chooseEvent can return nursery-egg once a baby exists in the pool', () => {
    const gameData = fixtureGameDataWithBaby();
    let sawNursery = false;

    for (let i = 0; i < 200 && !sawNursery; i += 1) {
        const chosen = E.chooseEvent(gameData, {});
        if (chosen && chosen.id === 'nursery-egg') sawNursery = true;
    }

    assert.ok(sawNursery, 'expected nursery-egg to be chosen at least once out of 200 rolls');
});

test('chooseEvent never returns nursery-egg when the baby pool is empty (no BABY-typed pokemon)', () => {
    const gameData = fixtureGameDataWithoutBaby();

    for (let i = 0; i < 200; i += 1) {
        const chosen = E.chooseEvent(gameData, {});
        assert.notEqual(chosen && chosen.id, 'nursery-egg');
    }
});

test('applyEffect gain-random-baby adds exactly one baby pokemon card and returns a summary', () => {
    const gameData = fixtureGameDataWithBaby();
    const run = R.createRunState({ area: makeGraph(), collections: {} });

    const summary = E.applyEffects(run, [{ type: 'gain-random-baby' }], {}, { runStore: R, gameData });

    const granted = [...run.collections.pokemon, ...run.collections.bench.pokemon];
    assert.equal(granted.length, 1);
    assert.equal(granted[0].pokemon.name, 'Fixture Baby');
    const grantedTypes = [granted[0].pokemon.type1, granted[0].pokemon.type2, granted[0].pokemon.type3];
    assert.ok(grantedTypes.includes('BABY'), 'expected the granted card to be BABY-typed');
    assert.deepEqual(summary, ['Gained Fixture Baby.']);
});

test('gain-random-baby is blocked with a clear reason when the baby pool is empty', () => {
    const gameData = fixtureGameDataWithoutBaby();
    const run = R.createRunState({ area: makeGraph(), collections: {} });
    const effect = { type: 'gain-random-baby' };

    const blockedReason = E.getBlockedReason(run, { effects: [effect] }, {}, { gameData });

    assert.equal(blockedReason, 'No baby Pokemon are available.');
});

test('getEventById resolves nursery-egg regardless of pool state (saved-encounter restore path)', () => {
    const emptyPoolGameData = fixtureGameDataWithoutBaby();
    const babyPoolGameData = fixtureGameDataWithBaby();

    assert.equal(E.getEventById(emptyPoolGameData, 'nursery-egg').id, 'nursery-egg');
    assert.equal(E.getEventById(babyPoolGameData, 'nursery-egg').id, 'nursery-egg');
});
