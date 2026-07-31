'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// arena_env aliases window to globalThis, so these IIFEs attach to the
// globalThis namespaces below.
const { arena } = require('./helpers/arena_env');
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
        pokemon: [
            mon('Rotom', 'r1', ['ELECTRIC', 'GHOST']),
            mon('Rotom-Heat', 'r2', ['ELECTRIC', 'GHOST']),
            mon('Pikachu', 'p1', ['ELECTRIC'])
        ],
        attacks: [],
        items: []
    };
}

function grant(run, gameData, cardKind, name) {
    E.applyEffects(run, [{ type: 'gain-card', cardKind, name, count: 1 }], {}, { gameData, runStore: R });
}

function cardNamed(run, name) {
    return E.getSelectableCards(run, { id: 'any', cardKind: 'pokemon' })
        .find(card => arena.Model.getCardName(card) === name) || null;
}

function runPokemonNames(run) {
    return E.getSelectableCards(run, { id: 'any', cardKind: 'pokemon' })
        .map(card => arena.Model.getCardName(card))
        .sort();
}

test('a requirement without a name filter still offers every card of the kind', () => {
    const gameData = fixtureGameData();
    const run = newRun();

    grant(run, gameData, 'pokemon', 'Rotom');
    grant(run, gameData, 'pokemon', 'Pikachu');

    const cards = E.getSelectableCards(run, { id: 'rotom', cardKind: 'pokemon' });

    assert.deepEqual(cards.map(card => arena.Model.getCardName(card)).sort(), ['Pikachu', 'Rotom']);
});

test('a name filter narrows the picker to matching cards only', () => {
    const gameData = fixtureGameData();
    const run = newRun();

    grant(run, gameData, 'pokemon', 'Rotom');
    grant(run, gameData, 'pokemon', 'Pikachu');

    const cards = E.getSelectableCards(run, { id: 'rotom', cardKind: 'pokemon', name: 'Rotom' });

    assert.deepEqual(cards.map(card => arena.Model.getCardName(card)), ['Rotom']);
});

test('a names list accepts any of the listed cards', () => {
    const gameData = fixtureGameData();
    const run = newRun();

    grant(run, gameData, 'pokemon', 'Rotom');
    grant(run, gameData, 'pokemon', 'Rotom-Heat');
    grant(run, gameData, 'pokemon', 'Pikachu');

    const cards = E.getSelectableCards(run, { id: 'rotom', cardKind: 'pokemon', names: ['Rotom', 'Rotom-Heat'] });

    assert.deepEqual(cards.map(card => arena.Model.getCardName(card)).sort(), ['Rotom', 'Rotom-Heat']);
});

test('selecting a filtered-out card is blocked and applyAction refuses it', () => {
    const gameData = fixtureGameData();
    const run = newRun();

    grant(run, gameData, 'pokemon', 'Rotom');
    grant(run, gameData, 'pokemon', 'Pikachu');

    const action = {
        requires: [{ id: 'rotom', cardKind: 'pokemon', name: 'Rotom' }],
        effects: [{
            type: 'replace-selected-card',
            selectionId: 'rotom',
            replacement: { cardKind: 'pokemon', name: 'Rotom-Heat' }
        }]
    };
    const selections = { rotom: cardNamed(run, 'Pikachu').id };

    assert.equal(E.getBlockedReason(run, action, selections, { gameData }), 'Choose an available card.');

    const result = E.applyAction(run, action, selections, { gameData, runStore: R });

    assert.equal(result.ok, false);
    assert.deepEqual(runPokemonNames(run), ['Pikachu', 'Rotom']);
});

test('selecting the filtered card replaces exactly that card with the named form', () => {
    const gameData = fixtureGameData();
    const run = newRun();

    grant(run, gameData, 'pokemon', 'Rotom');
    grant(run, gameData, 'pokemon', 'Pikachu');

    const action = {
        requires: [{ id: 'rotom', cardKind: 'pokemon', name: 'Rotom' }],
        effects: [{
            type: 'replace-selected-card',
            selectionId: 'rotom',
            replacement: { cardKind: 'pokemon', name: 'Rotom-Heat' }
        }]
    };
    const selections = { rotom: cardNamed(run, 'Rotom').id };

    assert.equal(E.getBlockedReason(run, action, selections, { gameData }), '');

    const result = E.applyAction(run, action, selections, { gameData, runStore: R });

    assert.equal(result.ok, true);
    assert.deepEqual(runPokemonNames(run), ['Pikachu', 'Rotom-Heat']);
});

test('an unowned filtered name reports the requirement emptyText instead of a picker', () => {
    const gameData = fixtureGameData();
    const run = newRun();

    grant(run, gameData, 'pokemon', 'Pikachu');

    const requirement = { id: 'rotom', cardKind: 'pokemon', name: 'Rotom', emptyText: 'You have no Rotom to send in.' };

    assert.deepEqual(E.getSelectableCards(run, requirement), []);
    assert.equal(
        E.getBlockedReason(run, { requires: [requirement], effects: [] }, {}, { gameData }),
        'You have no Rotom to send in.'
    );
});

test('the live rotom-appliances choices each pick from Rotom only', async () => {
    const { loadRealGameData } = require('./helpers/arena_env');
    await loadRealGameData();

    const event = E.getEventById(arena.GameData, 'rotom-appliances');
    assert.ok(event, 'rotom-appliances must exist in events.json');

    const run = newRun();
    grant(run, arena.GameData, 'pokemon', 'Rotom');
    grant(run, arena.GameData, 'pokemon', 'Pikachu');

    const formChoices = event.choices.filter(choice => (choice.effects || []).length > 0);
    assert.equal(formChoices.length, 5, 'expected the five appliance choices');

    formChoices.forEach(choice => {
        E.getActionRequirements(choice).forEach(requirement => {
            const names = E.getSelectableCards(run, requirement).map(card => arena.Model.getCardName(card));
            assert.deepEqual(names, ['Rotom'], `${choice.id}: picker must offer only Rotom`);
        });
    });
});
