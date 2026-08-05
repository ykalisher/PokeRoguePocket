'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// arena_env aliases window to globalThis, so these IIFEs attach to the
// globalThis namespaces below.
const { loadRealGameData, arena } = require('./helpers/arena_env');
require('../map/locations');
require('../map/run_state');
require('../map/event_effects');

const E = globalThis.PokeEvents;
const L = globalThis.PokeLocations;

const LEGENDARY_BIRD = {
    name: 'Fixture Bird',
    id: '9501',
    type1: 'FLYING',
    type2: 'LEGENDARY',
    type3: 'NONE',
    baseHealth: 10,
    baseAttack: 10,
    baseDefense: 10,
    baseSpeed: 10
};

const PLAIN_MON = Object.assign({}, LEGENDARY_BIRD, { name: 'Fixture Plain', id: '9502', type2: 'NONE' });

const LEGENDARY_BATTLE_EVENT = {
    type: 'trainer',
    title: 'The Legendary Fixture Bird',
    id: 'fixture-bird-battle',
    body: 'It stares you down.',
    trainerName: 'Fixture Bird',
    rewardEffects: [{ type: 'gain-card', cardKind: 'pokemon', count: 1, name: 'Fixture Bird' }],
    enabled: true
};

const LEGENDARY_GIFT_EVENT = {
    type: 'gift',
    title: 'A Legendary Handoff',
    id: 'fixture-bird-gift',
    body: 'Someone hands you a very rare card.',
    effects: [{ type: 'gain-card', cardKind: 'pokemon', count: 1, name: 'Fixture Bird' }],
    enabled: true
};

const PLAIN_EVENT = {
    type: 'gift',
    title: 'An Ordinary Handoff',
    id: 'fixture-plain-gift',
    body: 'Someone hands you a card.',
    effects: [{ type: 'gain-card', cardKind: 'pokemon', count: 1, name: 'Fixture Plain' }],
    enabled: true
};

function fixtureGameData() {
    return {
        pokemon: [LEGENDARY_BIRD, PLAIN_MON],
        events: [LEGENDARY_BATTLE_EVENT, LEGENDARY_GIFT_EVENT, PLAIN_EVENT]
    };
}

function rollEventIds(gameData, run, rolls = 300) {
    const seen = new Set();

    for (let i = 0; i < rolls; i += 1) {
        const chosen = E.chooseEvent(gameData, run);
        if (chosen) seen.add(chosen.id);
    }

    return seen;
}

test('chooseEvent never returns a legendary battle or a legendary card gift on level 1', () => {
    const gameData = fixtureGameData();
    const seen = rollEventIds(gameData, { level: 1 });

    assert.deepEqual([...seen], ['fixture-plain-gift']);
});

test('chooseEvent returns legendary events from level 2 on', () => {
    const gameData = fixtureGameData();

    [2, 3, 4].forEach(level => {
        const seen = rollEventIds(gameData, { level });

        assert.ok(seen.has('fixture-bird-battle'), `expected the legendary battle at level ${level}`);
        assert.ok(seen.has('fixture-bird-gift'), `expected the legendary gift at level ${level}`);
    });
});

test('a run without a level is left ungated (older saves, restore paths)', () => {
    const gameData = fixtureGameData();
    const seen = rollEventIds(gameData, {});

    assert.equal(seen.size, 3, 'expected every fixture event to stay reachable');
});

test('getEventById still resolves a legendary event on level 1 (saved-encounter restore path)', () => {
    assert.equal(E.getEventById(fixtureGameData(), 'fixture-bird-battle').id, 'fixture-bird-battle');
});

test('real data: legendary events are unreachable on level 1 and every location keeps a pool', async () => {
    await loadRealGameData();
    const gameData = arena.GameData;

    const legendaryNames = new Set(gameData.pokemon
        .filter(record => [record.type1, record.type2, record.type3].includes('LEGENDARY'))
        .map(record => record.name));
    const legendaryEventIds = new Set(gameData.events
        .filter(event => legendaryNames.has(event.trainerName))
        .map(event => event.id));

    assert.ok(legendaryEventIds.size > 0, 'expected legendary battle events to be authored');

    gameData.locations.forEach(location => {
        const snapshot = L.createLocationSnapshot(location);
        const seen = rollEventIds(gameData, { level: 1, location: snapshot });

        assert.ok(seen.size > 0, `expected ${location.id} to still offer an event on level 1`);
        seen.forEach(eventId => {
            assert.ok(!legendaryEventIds.has(eventId), `expected ${eventId} to be gated out of ${location.id} on level 1`);
        });
    });
});
