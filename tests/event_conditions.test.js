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

function mon(name, id, types) {
    return {
        name, id,
        type1: types[0] || 'NONE', type2: types[1] || 'NONE', type3: types[2] || 'NONE',
        baseHealth: 10, baseAttack: 10, baseDefense: 10, baseSpeed: 10
    };
}

function newRun() {
    return R.createRunState({ area: { nodes: [{ id: 'start' }], edges: [] }, collections: {} });
}

function fixtureGameData() {
    return {
        pokemon: [mon('Rotom', 'r1', ['ELECTRIC', 'GHOST']), mon('Rotom Wash', 'r2', ['ELECTRIC', 'WATER'])],
        attacks: [],
        items: [{ name: 'Potion', id: 'i1' }]
    };
}

function grant(run, gameData, cardKind, name) {
    E.applyEffects(run, [{ type: 'gain-card', cardKind, name, count: 1 }], {}, { gameData, runStore: R });
}

test('getUnmetConditionReason: has mode blocks until the run owns the named card', () => {
    const gameData = fixtureGameData();
    const run = newRun();
    const action = { conditions: [{ mode: 'has', cardKind: 'pokemon', name: 'Rotom' }] };

    assert.equal(E.getUnmetConditionReason(run, action), 'Requires Rotom.');

    grant(run, gameData, 'pokemon', 'Rotom');

    assert.equal(E.getUnmetConditionReason(run, action), '');
});

test('getUnmetConditionReason: lacks mode blocks only once the card is owned', () => {
    const gameData = fixtureGameData();
    const run = newRun();
    const action = { conditions: [{ mode: 'lacks', cardKind: 'pokemon', name: 'Rotom Wash' }] };

    assert.equal(E.getUnmetConditionReason(run, action), '');

    grant(run, gameData, 'pokemon', 'Rotom Wash');

    assert.equal(E.getUnmetConditionReason(run, action), 'You already have Rotom Wash.');
});

test('getBlockedReason mirrors the condition and applyAction fails without mutating the run', () => {
    const gameData = fixtureGameData();
    const run = newRun();
    const action = {
        conditions: [{ mode: 'has', cardKind: 'pokemon', name: 'Rotom' }],
        effects: [{ type: 'gain-cash', amount: 10 }]
    };
    const cashBefore = run.cash;

    assert.equal(E.getBlockedReason(run, action, {}, { gameData }), 'Requires Rotom.');

    const result = E.applyAction(run, action, {}, { gameData, runStore: R });

    assert.equal(result.ok, false);
    assert.equal(result.message, 'Requires Rotom.');
    assert.equal(run.cash, cashBefore);
});

test('applyAction succeeds once the condition is met', () => {
    const gameData = fixtureGameData();
    const run = newRun();
    const action = {
        conditions: [{ mode: 'has', cardKind: 'pokemon', name: 'Rotom' }],
        effects: [{ type: 'gain-cash', amount: 10 }]
    };
    const cashBefore = run.cash;

    grant(run, gameData, 'pokemon', 'Rotom');

    const result = E.applyAction(run, action, {}, { gameData, runStore: R });

    assert.equal(result.ok, true);
    assert.equal(run.cash, cashBefore + 10);
});

test('a custom text overrides the generated message', () => {
    const run = newRun();
    const action = { conditions: [{ mode: 'has', cardKind: 'pokemon', name: 'Rotom', text: 'Catch a Rotom first!' }] };

    assert.equal(E.getUnmetConditionReason(run, action), 'Catch a Rotom first!');
});

test('cardKind item ownership is found after gain-card of an item (items live in collections.actions)', () => {
    const gameData = fixtureGameData();
    const run = newRun();
    const action = { conditions: [{ mode: 'has', cardKind: 'item', name: 'Potion' }] };

    assert.equal(E.getUnmetConditionReason(run, action), 'Requires Potion.');

    grant(run, gameData, 'item', 'Potion');

    assert.equal(E.getUnmetConditionReason(run, action), '');
});

test('malformed condition entries are dropped; a bare name normalizes to mode has, cardKind attack', () => {
    const conditions = E.getActionConditions({ conditions: [null, {}, { name: '   ' }, { name: 'X' }] });

    assert.deepEqual(conditions, [{ cardKind: 'attack', mode: 'has', name: 'X', subject: 'card', text: '' }]);
});

test('normalizeConditions always carries subject and never mutates its input', () => {
    const input = { mode: 'has', cardKind: 'pokemon', name: 'Rotom' };
    const conditions = E.getActionConditions({ conditions: [input] });

    assert.deepEqual(conditions, [{ cardKind: 'pokemon', mode: 'has', name: 'Rotom', subject: 'card', text: '' }]);
    assert.equal(input.subject, undefined);
});

test('an action with no conditions is unaffected', () => {
    const run = newRun();

    assert.equal(E.getBlockedReason(run, {}, {}, {}), '');
});

test('chooseEvent never returns an event whose top-level conditions are unmet, and does once they are met', () => {
    const gameData = fixtureGameData();
    gameData.events = [
        {
            id: 'gated',
            type: 'gift',
            conditions: [{ mode: 'has', cardKind: 'pokemon', name: 'Rotom' }],
            effects: [{ type: 'gain-cash', amount: 1 }]
        },
        {
            id: 'ungated',
            type: 'gift',
            effects: [{ type: 'gain-cash', amount: 1 }]
        }
    ];
    const run = newRun();

    for (let i = 0; i < 300; i += 1) {
        const chosen = E.chooseEvent(gameData, run);
        assert.notEqual(chosen && chosen.id, 'gated');
    }

    grant(run, gameData, 'pokemon', 'Rotom');

    let sawGated = false;
    for (let i = 0; i < 300 && !sawGated; i += 1) {
        const chosen = E.chooseEvent(gameData, run);
        if (chosen && chosen.id === 'gated') sawGated = true;
    }
    assert.ok(sawGated, 'expected the gated event to be reachable once its condition is met');
});

test('getEventById still resolves a gated event regardless of run state (saved-encounter restore path)', () => {
    const gameData = fixtureGameData();
    gameData.events = [{
        id: 'gated',
        type: 'gift',
        conditions: [{ mode: 'has', cardKind: 'pokemon', name: 'Rotom' }],
        effects: [{ type: 'gain-cash', amount: 1 }]
    }];

    assert.equal(E.getEventById(gameData, 'gated').id, 'gated');
});

test('chooseEvent(gameData, {}) does not throw for a bare run, as older callers pass', () => {
    const gameData = fixtureGameData();
    gameData.events = [{
        id: 'gated',
        type: 'gift',
        conditions: [{ mode: 'has', cardKind: 'pokemon', name: 'Rotom' }],
        effects: [{ type: 'gain-cash', amount: 1 }]
    }];

    assert.doesNotThrow(() => E.chooseEvent(gameData, {}));
});

test('achievement condition: has mode fails closed with no profile module, then passes once unlocked', () => {
    const run = newRun();
    const action = { conditions: [{ subject: 'achievement', mode: 'has', name: 'champion' }] };

    assert.equal(E.getUnmetConditionReason(run, action), 'Requires the "champion" achievement.');

    globalThis.PokeProfile = { isUnlocked: id => id === 'champion' };
    try {
        assert.equal(E.getUnmetConditionReason(run, action), '');
    } finally {
        delete globalThis.PokeProfile;
    }
});

test('achievement condition: lacks mode mirrors has mode', () => {
    const run = newRun();
    const action = { conditions: [{ subject: 'achievement', mode: 'lacks', name: 'champion' }] };

    assert.equal(E.getUnmetConditionReason(run, action), '');

    globalThis.PokeProfile = { isUnlocked: id => id === 'champion' };
    try {
        assert.equal(E.getUnmetConditionReason(run, action), 'Only before earning "champion".');
    } finally {
        delete globalThis.PokeProfile;
    }
});

test('achievement condition: a custom text overrides both default messages', () => {
    const run = newRun();
    const hasAction = { conditions: [{ subject: 'achievement', mode: 'has', name: 'champion', text: 'Beat the champion first!' }] };
    const lacksAction = { conditions: [{ subject: 'achievement', mode: 'lacks', name: 'champion', text: 'Too late now.' }] };

    assert.equal(E.getUnmetConditionReason(run, hasAction), 'Beat the champion first!');

    globalThis.PokeProfile = { isUnlocked: () => true };
    try {
        assert.equal(E.getUnmetConditionReason(run, lacksAction), 'Too late now.');
    } finally {
        delete globalThis.PokeProfile;
    }
});

test('achievement condition: gameData swaps the id for its display name in the default message', () => {
    const run = newRun();
    const gameData = { achievements: [{ id: 'champion', name: 'League Champion' }] };
    const action = { conditions: [{ subject: 'achievement', mode: 'has', name: 'champion' }] };

    assert.equal(E.getUnmetConditionReason(run, action, gameData), 'Requires the "League Champion" achievement.');
});

test('a condition without subject behaves exactly as before (regression guard)', () => {
    const gameData = fixtureGameData();
    const run = newRun();
    const action = { conditions: [{ mode: 'has', cardKind: 'pokemon', name: 'Rotom' }] };

    assert.equal(E.getUnmetConditionReason(run, action, gameData), 'Requires Rotom.');

    grant(run, gameData, 'pokemon', 'Rotom');

    assert.equal(E.getUnmetConditionReason(run, action, gameData), '');
});

test('event-level achievement condition blocks chooseEvent until the achievement is unlocked', () => {
    const gameData = fixtureGameData();
    gameData.events = [
        {
            id: 'gated-achievement',
            type: 'gift',
            conditions: [{ subject: 'achievement', mode: 'has', name: 'champion' }],
            effects: [{ type: 'gain-cash', amount: 1 }]
        },
        {
            id: 'ungated',
            type: 'gift',
            effects: [{ type: 'gain-cash', amount: 1 }]
        }
    ];
    const run = newRun();

    for (let i = 0; i < 300; i += 1) {
        const chosen = E.chooseEvent(gameData, run);
        assert.notEqual(chosen && chosen.id, 'gated-achievement');
    }

    globalThis.PokeProfile = { isUnlocked: id => id === 'champion' };
    try {
        let sawGated = false;
        for (let i = 0; i < 300 && !sawGated; i += 1) {
            const chosen = E.chooseEvent(gameData, run);
            if (chosen && chosen.id === 'gated-achievement') sawGated = true;
        }
        assert.ok(sawGated, 'expected the achievement-gated event to be reachable once unlocked');
    } finally {
        delete globalThis.PokeProfile;
    }
});

test('live events.json is never fully gated: a card-less run can still be offered an event', async () => {
    await loadRealGameData();
    const run = newRun();

    const offered = new Set();
    for (let i = 0; i < 200; i += 1) {
        const chosen = E.chooseEvent(arena.GameData, run);
        if (chosen) offered.add(chosen.id);
    }

    assert.ok(offered.size > 0, 'every authored event is condition-gated: event nodes would show "No events are available."');
});
