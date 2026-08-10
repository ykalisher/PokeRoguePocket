'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// arena_env aliases window to globalThis, so the IIFEs below attach to the
// globalThis namespaces used here.
const { loadRealGameData, arena } = require('./helpers/arena_env');
require('../map/locations');
require('../map/run_state');
require('../map/event_effects');

const P = globalThis.PokeLocations;
const R = globalThis.PokeRun;
const E = globalThis.PokeEvents;

function makeEvent(id) {
    return { id, type: 'gift', title: id, body: 'text', enabled: true, effects: [] };
}

function makeGameData(eventIds) {
    return { events: eventIds.map(makeEvent), pokemon: [], attacks: [], items: [] };
}

function newRun(overrides) {
    return Object.assign(R.createRunState({
        area: { nodes: [{ id: 'start' }], edges: [] },
        collections: {}
    }), overrides || {});
}

// Mirrors area.js chooseEventForRun: draw, then record the draw.
function drawEvent(gameData, run) {
    const eventRecord = E.chooseEvent(gameData, run);

    if (eventRecord) R.markEventUsed(run, eventRecord.id);

    return eventRecord;
}

// Mirrors area.js chooseTrainerForNode: exclude everything already drawn in
// the run, then record the draw.
function drawTrainer(gameData, run, { level, nodeType, locationTypes, nodeId }) {
    const trainer = P.chooseTrainer(gameData, {
        level,
        nodeType,
        locationTypes: locationTypes || [],
        excludeNames: R.getExcludedTrainerNames(run, nodeId || null)
    });

    if (trainer) R.markTrainerUsed(run, trainer.name);

    return trainer;
}

test('a fresh run starts with empty event/trainer histories', () => {
    const run = newRun();

    assert.deepEqual(run.usedEventIds, []);
    assert.deepEqual(run.usedTrainerNames, []);
});

test('chooseEvent never repeats an event the run already drew', () => {
    const gameData = makeGameData(['a', 'b', 'c', 'd']);
    const run = newRun();

    const drawn = [drawEvent(gameData, run), drawEvent(gameData, run),
        drawEvent(gameData, run), drawEvent(gameData, run)].map(event => event.id);

    assert.equal(new Set(drawn).size, 4);
    assert.deepEqual(drawn.slice().sort(), ['a', 'b', 'c', 'd']);
});

test('chooseEvent skips ids saved on current-area encounters (pre-history saves)', () => {
    const gameData = makeGameData(['a', 'b']);
    const run = newRun({
        usedEventIds: undefined,
        eventEncounters: { 'event-3': { nodeId: 'event-3', eventId: 'a', completed: false } }
    });

    for (let attempt = 0; attempt < 20; attempt += 1) {
        assert.equal(E.chooseEvent(gameData, run).id, 'b');
    }
});

test('chooseEvent repeats only once every eligible event is used up', () => {
    const gameData = makeGameData(['a', 'b']);
    const run = newRun({ usedEventIds: ['a', 'b'] });

    // The node still gets an event rather than stranding the player on a map
    // it cannot cross.
    const eventRecord = E.chooseEvent(gameData, run);

    assert.ok(eventRecord);
    assert.ok(['a', 'b'].includes(eventRecord.id));
});

test('chooseEvent still returns null when the location has no eligible events', () => {
    assert.equal(E.chooseEvent(makeGameData([]), newRun()), null);
});

test('isEventUsed reads the run history and the current encounters', () => {
    const run = newRun({
        usedEventIds: ['a'],
        eventEncounters: { 'event-2': { nodeId: 'event-2', eventId: 'b' } }
    });

    assert.equal(E.isEventUsed(run, 'a'), true);
    assert.equal(E.isEventUsed(run, 'b'), true);
    assert.equal(E.isEventUsed(run, 'c'), false);
    assert.equal(E.isEventUsed(null, 'a'), false);
});

test('markEventUsed / markTrainerUsed append once and ignore junk', () => {
    const run = newRun();

    assert.equal(R.markEventUsed(run, 'a'), true);
    assert.equal(R.markEventUsed(run, 'a'), false);
    assert.equal(R.markEventUsed(run, ''), false);
    assert.equal(R.markEventUsed(null, 'a'), false);
    assert.deepEqual(run.usedEventIds, ['a']);

    assert.equal(R.markTrainerUsed(run, 'Gamer John'), true);
    assert.equal(R.markTrainerUsed(run, 'Gamer John'), false);
    assert.deepEqual(run.usedTrainerNames, ['Gamer John']);
});

test('getExcludedTrainerNames unions run history with the current area', () => {
    const run = newRun({
        usedTrainerNames: ['Old Rival'],
        battleEncounters: {
            'battle-2': { nodeId: 'battle-2', trainerName: 'Sibling' },
            'boss-11': { nodeId: 'boss-11', trainerName: 'Leader' }
        }
    });

    assert.deepEqual(R.getExcludedTrainerNames(run, null).sort(),
        ['Leader', 'Old Rival', 'Sibling']);
    // The node being re-rolled does not exclude itself through the encounter
    // map (its trainer is still excluded once the history has recorded it).
    assert.deepEqual(R.getExcludedTrainerNames(run, 'battle-2').sort(),
        ['Leader', 'Old Rival']);
    assert.deepEqual(R.getExcludedTrainerNames(null, null), []);
});

test('chooseTrainer honors excludeNames and relaxes them when the pool runs out', () => {
    const gameData = {
        trainers: [
            { name: 'A', rank: 'Standard', cash: 50, typeSpecialization: 'FIRE' },
            { name: 'B', rank: 'Standard', cash: 50, typeSpecialization: 'FIRE' }
        ]
    };

    for (let attempt = 0; attempt < 20; attempt += 1) {
        const trainer = P.chooseTrainer(gameData, {
            level: 1, nodeType: 'battle', locationTypes: ['FIRE'], excludeNames: ['A']
        });
        assert.equal(trainer.name, 'B');
    }

    // Everything excluded: a battle node must still get a trainer.
    const relaxed = P.chooseTrainer(gameData, {
        level: 1, nodeType: 'battle', locationTypes: ['FIRE'], excludeNames: ['A', 'B']
    });
    assert.ok(['A', 'B'].includes(relaxed.name));
});

test('the used histories survive a level advance that wipes the encounter maps', () => {
    const run = newRun({
        usedEventIds: ['a'],
        usedTrainerNames: ['Gamer John'],
        location: R.normalizeLocationSnapshot(P.createLocationSnapshot(P.getLocations()[0])),
        battleEncounters: { 'battle-2': { nodeId: 'battle-2', trainerName: 'Gamer John' } },
        eventEncounters: { 'event-3': { nodeId: 'event-3', eventId: 'a' } }
    });

    P.advanceRunToNextLevel(run, { trainers: [] }, { includeEvents: true });

    assert.deepEqual(run.battleEncounters, {});
    assert.deepEqual(run.eventEncounters, {});
    assert.deepEqual(run.usedEventIds, ['a']);
    assert.deepEqual(run.usedTrainerNames, ['Gamer John']);
});

test('the used histories round-trip through save/load', () => {
    const run = newRun({ usedEventIds: ['a', 'a', 'b', ''], usedTrainerNames: ['Gamer John'] });

    assert.equal(R.saveRunState(run), true);

    const loaded = R.loadRunState();

    assert.deepEqual(loaded.usedEventIds, ['a', 'b']);
    assert.deepEqual(loaded.usedTrainerNames, ['Gamer John']);

    R.clearRunState();
});

test('a full run of real trainer draws never repeats a trainer', async () => {
    await loadRealGameData();
    const gameData = arena.GameData;
    const run = newRun();
    const drawn = [];

    // Worst case per level: every battle node at its quota maximum plus the
    // boss, drawn from the same location types the whole way.
    [1, 2, 3, 4].forEach(level => {
        const config = P.LEVEL_CONFIG[level];
        const battleCount = config.quotas ? config.quotas.battle[1] + 1 : 3;

        for (let index = 0; index < battleCount; index += 1) {
            drawn.push(drawTrainer(gameData, run, {
                level, nodeType: 'battle', locationTypes: ['FIRE'], nodeId: `battle-${index}`
            }).name);
        }

        drawn.push(drawTrainer(gameData, run, {
            level, nodeType: 'boss', locationTypes: ['FIRE'], nodeId: 'boss-11'
        }).name);
    });

    assert.equal(new Set(drawn).size, drawn.length, `repeated trainer in ${drawn.join(', ')}`);
    assert.deepEqual(run.usedTrainerNames.slice().sort(), drawn.slice().sort());
});

test('a full run of real event draws never repeats an event', async () => {
    await loadRealGameData();
    const gameData = arena.GameData;
    const run = newRun();
    const drawn = [];

    // Ungated location so the whole event list is eligible: with the pool wide
    // enough, three event nodes per level across levels 1-3 stay distinct.
    [1, 2, 3].forEach(level => {
        for (let index = 0; index < 3; index += 1) {
            const eventRecord = drawEvent(gameData, run);

            // Asserted per draw rather than as a total count: a shrinking pool
            // shows up here as "draw 2 of level 3 came back empty" instead of a
            // bare count mismatch, and no number needs updating when the owner
            // authors more events.
            assert.ok(eventRecord, `level ${level}, draw ${index + 1}: the pool ran dry`);
            drawn.push(eventRecord.id);
        }
    });

    assert.equal(new Set(drawn).size, drawn.length, `repeated event in ${drawn.join(', ')}`);
});
