'use strict';

const { beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const { storageMap } = require('./helpers/arena_env');

require('../map/profile.js');

const { PokeProfile } = window;

beforeEach(() => {
    PokeProfile.clearProfile();
});

test('a fresh profile has zeroed stats and no unlocks', () => {
    assert.equal(PokeProfile.getStat('runs.completed'), 0);
    assert.deepEqual(PokeProfile.getUnlockedIds(), []);
});

test('bumpStat accumulates and persists', () => {
    PokeProfile.bumpStat('battles.won');
    PokeProfile.bumpStat('battles.won', 2);

    assert.equal(PokeProfile.getStat('battles.won'), 3);

    const raw = JSON.parse(storageMap.get(PokeProfile.STORAGE_KEY));

    assert.equal(raw.version, PokeProfile.STORAGE_VERSION);
    assert.equal(raw.stats['battles.won'], 3);
});

test('bumpStats writes multiple keys in one call', () => {
    const results = PokeProfile.bumpStats({ 'battles.lost': 2, 'battles.won': 1 });

    assert.equal(results['battles.won'], 1);
    assert.equal(results['battles.lost'], 2);
    assert.equal(PokeProfile.getStat('battles.won'), 1);
    assert.equal(PokeProfile.getStat('battles.lost'), 2);
});

test('a bump of 0 or a negative amount is ignored', () => {
    PokeProfile.bumpStat('battles.won', 5);
    PokeProfile.bumpStat('battles.won', 0);
    PokeProfile.bumpStat('battles.won', -1);

    assert.equal(PokeProfile.getStat('battles.won'), 5);
});

test('evaluateAchievements unlocks reached thresholds exactly once', () => {
    PokeProfile.bumpStat('runs.completed', 3);

    const achievements = [
        { atLeast: 1, id: 'champion', stat: 'runs.completed' },
        { atLeast: 10, id: 'legend', stat: 'runs.completed' }
    ];

    const unlockedNow = PokeProfile.evaluateAchievements(achievements);

    assert.deepEqual(unlockedNow.map(achievement => achievement.id), ['champion']);
    assert.deepEqual(PokeProfile.getUnlockedIds(), ['champion']);

    const secondPass = PokeProfile.evaluateAchievements(achievements);

    assert.deepEqual(secondPass, []);
});

test('enabled: false achievements never unlock', () => {
    PokeProfile.bumpStat('runs.completed', 5);

    const unlockedNow = PokeProfile.evaluateAchievements([
        { atLeast: 1, enabled: false, id: 'disabled', stat: 'runs.completed' }
    ]);

    assert.deepEqual(unlockedNow, []);
    assert.equal(PokeProfile.isUnlocked('disabled'), false);
});

test('an unlock is permanent across repeated evaluation', () => {
    PokeProfile.bumpStat('runs.completed', 1);

    const achievements = [{ atLeast: 1, id: 'champion', stat: 'runs.completed' }];

    PokeProfile.evaluateAchievements(achievements);
    PokeProfile.evaluateAchievements(achievements);
    const thirdPass = PokeProfile.evaluateAchievements(achievements);

    assert.deepEqual(thirdPass, []);
    assert.deepEqual(PokeProfile.getUnlockedIds(), ['champion']);
});

test('takePendingUnlocks drains the queue exactly once', () => {
    PokeProfile.bumpStat('runs.completed', 1);
    PokeProfile.evaluateAchievements([{ atLeast: 1, id: 'champion', stat: 'runs.completed' }]);

    assert.deepEqual(PokeProfile.takePendingUnlocks(), ['champion']);
    assert.deepEqual(PokeProfile.takePendingUnlocks(), []);
});

test('isKnownStat accepts the closed set and open-ended prefixes', () => {
    PokeProfile.STAT_KEYS.forEach(key => {
        assert.equal(PokeProfile.isKnownStat(key), true, key);
    });

    assert.equal(PokeProfile.isKnownStat('events.seen.foo'), true);
    assert.equal(PokeProfile.isKnownStat('nonsense.key'), false);
    assert.equal(PokeProfile.isKnownStat('events.seen.'), false);
});

test('getProgress clamps current at threshold and reports unlocked', () => {
    PokeProfile.bumpStat('runs.completed', 5);

    const achievement = { atLeast: 3, id: 'champion', stat: 'runs.completed' };
    const before = PokeProfile.getProgress(achievement);

    assert.deepEqual(before, { current: 3, threshold: 3, unlocked: false });

    PokeProfile.evaluateAchievements([achievement]);

    const after = PokeProfile.getProgress(achievement);

    assert.equal(after.unlocked, true);
});

test('corrupt storage yields a fresh empty profile without throwing', () => {
    PokeProfile.clearProfile();
    storageMap.set(PokeProfile.STORAGE_KEY, 'not json');

    assert.doesNotThrow(() => PokeProfile.getProfile());
    assert.deepEqual(PokeProfile.getProfile().stats, {});

    PokeProfile.clearProfile();
    storageMap.set(PokeProfile.STORAGE_KEY, JSON.stringify({ version: 99 }));

    const profile = PokeProfile.getProfile();

    assert.deepEqual(profile.stats, {});
    assert.deepEqual(profile.unlocked, {});
});

// monoTypeBumps lives inside arena/game.js's page IIFE, which needs a real DOM
// to boot, so the three-line intersection is replicated here rather than
// exported. Keep it in step with the helper in arena/game.js.
function monoTypeBumps(run) {
    const records = window.PokeLocations.getRunPokemonRecords(run);

    if (records.length === 0) return {};

    const typesOf = record => (Array.isArray(record.types)
        ? record.types
        : [record.type1, record.type2, record.type3]).filter(type => type && type !== 'NONE');

    const shared = records
        .map(typesOf)
        .reduce((common, types) => common.filter(type => types.includes(type)));

    return Object.fromEntries(shared.map(type => [`runs.completed.mono.${type}`, 1]));
}

function runWithSpecies(activeSpecies, benchSpecies) {
    return {
        collections: {
            bench: { actions: [], pokemon: benchSpecies.map(pokemon => ({ kind: 'pokemon', pokemon })) },
            actions: [],
            pokemon: activeSpecies.map(pokemon => ({ kind: 'pokemon', pokemon }))
        }
    };
}

test('a run sharing two types bumps a mono counter for each', () => {
    require('../map/locations.js');

    const run = runWithSpecies(
        [{ name: 'Charizard', type1: 'FIRE', type2: 'FLYING', type3: 'NONE' }],
        [{ name: 'Talonflame', type1: 'FIRE', type2: 'FLYING', type3: 'NONE' }]
    );

    assert.deepEqual(monoTypeBumps(run), {
        'runs.completed.mono.FIRE': 1,
        'runs.completed.mono.FLYING': 1
    });
});

test('a mixed-type run bumps no mono counter', () => {
    require('../map/locations.js');

    const run = runWithSpecies(
        [{ name: 'Charizard', type1: 'FIRE', type2: 'FLYING', type3: 'NONE' }],
        [{ name: 'Blastoise', type1: 'WATER', type2: 'NONE', type3: 'NONE' }]
    );

    assert.deepEqual(monoTypeBumps(run), {});
});

test('an empty run bumps no mono counter', () => {
    require('../map/locations.js');

    assert.deepEqual(monoTypeBumps(runWithSpecies([], [])), {});
});
