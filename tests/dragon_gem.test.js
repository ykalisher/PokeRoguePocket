'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// arena_env aliases window to globalThis, so map/locations.js attaches to the
// globalThis namespace below.
const { loadRealGameData, arena } = require('./helpers/arena_env');
const { pick } = require('./helpers/pick');
require('../map/locations');

const P = globalThis.PokeLocations;

function typesOf(record) {
    if (record && Array.isArray(record.types)) return record.types;
    return record ? [record.type1, record.type2, record.type3].filter(t => t && t !== 'NONE') : [];
}

function itemIsDragonGem(item) {
    return Boolean(item && Array.isArray(item.status) && item.status.includes('DRAGON_GEM'));
}

// The rule restated from the data's side, independently of the implementation.
function expectedEnablesGem(attack) {
    return typesOf(attack).includes('DRAGON') &&
        ['OPPONENT', 'ALL_OPPONENTS'].includes(attack.target) &&
        Number(attack.basePower) > 0;
}

test('attackEnablesDragonGem matches the rule for every authored attack', async () => {
    await loadRealGameData();
    const attacks = arena.GameData.attacks;

    assert.ok(attacks.length > 0, 'attacks must load so the walk is meaningful');
    attacks.forEach(attack => {
        assert.equal(
            P.attackEnablesDragonGem(attack),
            expectedEnablesGem(attack),
            `${attack.name} (${attack.target}, ${attack.basePower} power) classified wrongly`
        );
    });

    assert.ok(attacks.some(P.attackEnablesDragonGem), 'some attack must qualify a run for gems');
    assert.ok(
        attacks.some(a => typesOf(a).includes('DRAGON') && !P.attackEnablesDragonGem(a)),
        'a non-qualifying DRAGON attack must exist so the filter is meaningful'
    );
});

// The map-side gate exists to serve the battle rule in arena_controller.js:
// getDragonGemStatusesForAttack applies a gem's status only when the attack is
// DRAGON-typed and damaging. Anything the gate lets through must satisfy that.
test('every gem-enabling attack is one the battle engine would fire a gem on', async () => {
    await loadRealGameData();

    arena.GameData.attacks.filter(P.attackEnablesDragonGem).forEach(attack => {
        assert.ok(typesOf(attack).includes('DRAGON'), `${attack.name} is not DRAGON-typed`);
        assert.ok(Number(attack.basePower) > 0, `${attack.name} deals no damage, so a gem could never fire`);
    });
});

test('attackEnablesDragonGem rejects missing and malformed records', async () => {
    await loadRealGameData();
    const qualifying = pick(arena.GameData.attacks, P.attackEnablesDragonGem, 'a gem-enabling attack');

    assert.equal(P.attackEnablesDragonGem(null), false);
    assert.equal(P.attackEnablesDragonGem(undefined), false);
    assert.equal(P.attackEnablesDragonGem({}), false);
    assert.equal(P.attackEnablesDragonGem({ ...qualifying, target: 'SELF' }), false);
    assert.equal(P.attackEnablesDragonGem({ ...qualifying, target: 'ALL_ALLIES' }), false);
    assert.equal(P.attackEnablesDragonGem({ ...qualifying, basePower: 0 }), false);
    assert.equal(P.attackEnablesDragonGem({ ...qualifying, types: [], type1: 'NONE', type2: 'NONE' }), false);
});

// A starter deck is dealt whole, bypassing every runtime gate, so a gem in one
// is only sound if that same deck ships an attack to spend it on.
test('every starter deck shipping a gem also ships an attack that can use it', async () => {
    await loadRealGameData();
    const gameData = arena.GameData;
    const decks = Object.values(P.getStarterDecks(gameData));

    assert.ok(decks.length > 0, 'starter decks must load so the walk is meaningful');
    decks.forEach(deck => {
        const items = (deck.items || []).map(([name]) => gameData.items.find(i => i.name === name)).filter(Boolean);

        if (!items.some(itemIsDragonGem)) return;

        const attacks = (deck.attacks || []).map(([name]) => gameData.attacks.find(a => a.name === name)).filter(Boolean);
        assert.ok(
            attacks.some(P.attackEnablesDragonGem),
            `starter deck "${deck.id}" ships a dragon gem but no attack that can trigger it`
        );
    });
});
