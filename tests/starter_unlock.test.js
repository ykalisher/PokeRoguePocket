'use strict';

/**
 * Achievement-gated starter decks: a deck with `requiresAchievement` stays
 * locked until the profile has unlocked that achievement id.
 */

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { loadRealGameData, arena } = require('./helpers/arena_env');
require('../map/profile.js');
require('../map/locations');

const L = globalThis.PokeLocations;
const { PokeProfile } = globalThis;

function deck(id, requiresAchievement) {
    const record = { id, name: id, type: 'WATER', pokemon: ['Blastoise'], attacks: [], items: [] };

    if (requiresAchievement !== undefined) record.requiresAchievement = requiresAchievement;

    return record;
}

function gameDataWith(decks) {
    return { starterDecks: decks };
}

/** Runs `fn` with the profile module hidden, restoring it afterwards. */
function withoutProfile(fn) {
    const saved = globalThis.PokeProfile;
    delete globalThis.PokeProfile;
    try {
        fn();
    } finally {
        globalThis.PokeProfile = saved;
    }
}

beforeEach(() => {
    PokeProfile.clearProfile();
});

test('a deck with no requiresAchievement is always unlocked', () => {
    assert.equal(L.isStarterDeckUnlocked(deck('water')), true);
    assert.equal(L.isStarterDeckUnlocked(deck('water', '')), true);
    assert.equal(L.isStarterDeckUnlocked(deck('water', '   ')), true);
});

test('a gated deck is locked until its achievement unlocks, then stays unlocked', () => {
    const gated = deck('dragon', 'champion');

    assert.equal(L.isStarterDeckUnlocked(gated), false);

    PokeProfile.evaluateAchievements([{ id: 'champion', stat: 'runs.completed', atLeast: 1 }]);
    assert.equal(L.isStarterDeckUnlocked(gated), false, 'the stat threshold is not met yet');

    PokeProfile.bumpStat('runs.completed');
    PokeProfile.evaluateAchievements([{ id: 'champion', stat: 'runs.completed', atLeast: 1 }]);

    assert.equal(PokeProfile.isUnlocked('champion'), true);
    assert.equal(L.isStarterDeckUnlocked(gated), true);
});

test('a gated deck fails closed when the profile module is absent', () => {
    withoutProfile(() => {
        assert.equal(L.isStarterDeckUnlocked(deck('dragon', 'champion')), false);
        assert.equal(L.isStarterDeckUnlocked(deck('water')), true);
    });
});

test('getUnlockedStarterDecks drops locked decks but getStarterDecks keeps them', () => {
    const gameData = gameDataWith([deck('water'), deck('dragon', 'champion')]);

    assert.deepEqual(Object.keys(L.getStarterDecks(gameData)), ['water', 'dragon']);
    assert.deepEqual(Object.keys(L.getUnlockedStarterDecks(gameData)), ['water']);

    PokeProfile.bumpStat('runs.completed');
    PokeProfile.evaluateAchievements([{ id: 'champion', stat: 'runs.completed', atLeast: 1 }]);

    assert.deepEqual(Object.keys(L.getUnlockedStarterDecks(gameData)), ['water', 'dragon']);
});

test('getUnlockedStarterDecks falls back to every deck when all of them are locked', () => {
    const gameData = gameDataWith([deck('dragon', 'champion'), deck('ghost', 'collector')]);

    assert.deepEqual(Object.keys(L.getUnlockedStarterDecks(gameData)), ['dragon', 'ghost']);
});

test('disabled decks stay excluded regardless of their achievement gate', () => {
    const gated = deck('dragon', 'champion');
    gated.enabled = false;
    const gameData = gameDataWith([deck('water'), gated]);

    PokeProfile.bumpStat('runs.completed');
    PokeProfile.evaluateAchievements([{ id: 'champion', stat: 'runs.completed', atLeast: 1 }]);

    assert.deepEqual(Object.keys(L.getUnlockedStarterDecks(gameData)), ['water']);
});

test('loadGameData normalizes requiresAchievement onto every real starter deck', async () => {
    await loadRealGameData();

    const decks = arena.GameData.starterDecks;

    assert.ok(decks.length > 0);
    decks.forEach((record) => {
        assert.equal(typeof record.requiresAchievement, 'string');
    });
    assert.ok(decks.some((record) => record.requiresAchievement === ''),
        'at least one shipped deck must be available from the start');
});
