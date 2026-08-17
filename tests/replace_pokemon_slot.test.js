'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// arena_env aliases window to globalThis, so these IIFEs attach to the
// globalThis namespaces below.
require('./helpers/arena_env');
require('../map/locations');
require('../map/run_state');

const R = globalThis.PokeRun;

function mon(name, type1) {
    return {
        name,
        id: name.toLowerCase(),
        type1,
        type2: 'NONE',
        type3: 'NONE',
        baseHealth: 10,
        baseAttack: 10,
        baseDefense: 10,
        baseSpeed: 10
    };
}

function attack(name, type1) {
    return { name, id: name.toLowerCase(), type1, type2: 'NONE' };
}

function newRun() {
    return R.createRunState({ area: { nodes: [{ id: 'start' }], edges: [] }, collections: {} });
}

function addMon(run, name, type1) {
    const record = mon(name, type1);
    const card = R.createPokemonCard(record, 'player', R.allocateCardId(run, 'pokemon', name));

    R.addPokemonCard(run, card);

    return card;
}

function addAttack(run, name, type1) {
    const record = attack(name, type1);
    const card = R.createAttackCard(record, 'player', R.allocateCardId(run, 'attack', name));

    R.addActionCard(run, card);

    return card;
}

function activeNames(run) {
    return run.collections.pokemon.map(card => card.pokemon.name);
}

function benchNames(run) {
    return run.collections.bench.pokemon.map(card => card.pokemon.name);
}

function deckAttackNames(run) {
    return run.collections.actions.filter(card => card.attack).map(card => card.attack.name);
}

function benchAttackNames(run) {
    return run.collections.bench.actions.filter(card => card.attack).map(card => card.attack.name);
}

// A full active party plus benched Pokemon, so a replacement that failed to keep
// its slot would land behind a promoted bench card.
function fullPartyRun() {
    const run = newRun();
    const names = [];

    for (let index = 0; index < R.ACTIVE_POKEMON_LIMIT + 2; index += 1) {
        const name = `Mon${index}`;

        addMon(run, name, 'NORMAL');
        names.push(name);
    }

    assert.deepEqual(activeNames(run), names.slice(0, R.ACTIVE_POKEMON_LIMIT));
    assert.deepEqual(benchNames(run), names.slice(R.ACTIVE_POKEMON_LIMIT));

    return run;
}

function replacementCard(run, name, type1) {
    return R.createPokemonCard(mon(name, type1), 'player', R.allocateCardId(run, 'pokemon', name));
}

test('replacing an active Pokemon keeps the incoming card in that active slot', () => {
    const run = fullPartyRun();
    const target = run.collections.pokemon[2];
    const incoming = replacementCard(run, 'Gift', 'NORMAL');

    const result = R.replacePokemonCard(run, target.id, incoming);

    assert.equal(result.zone, 'active');
    assert.equal(result.removedCard, target);
    assert.equal(run.collections.pokemon[2], incoming);
    assert.equal(run.collections.pokemon.length, R.ACTIVE_POKEMON_LIMIT);
    assert.ok(!activeNames(run).includes(target.pokemon.name));
    assert.ok(!benchNames(run).includes('Gift'));
});

test('replacing a benched Pokemon keeps the incoming card in that bench slot', () => {
    const run = fullPartyRun();
    const target = run.collections.bench.pokemon[0];
    const incoming = replacementCard(run, 'Gift', 'NORMAL');

    const result = R.replacePokemonCard(run, target.id, incoming);

    assert.equal(result.zone, 'bench');
    assert.equal(run.collections.bench.pokemon[0], incoming);
    assert.ok(!activeNames(run).includes('Gift'));
});

test('replacing an active Pokemon under the active limit keeps the party size', () => {
    const run = newRun();
    const target = addMon(run, 'Alpha', 'NORMAL');

    addMon(run, 'Bravo', 'NORMAL');

    R.replacePokemonCard(run, target.id, replacementCard(run, 'Gift', 'NORMAL'));

    assert.deepEqual(activeNames(run), ['Gift', 'Bravo']);
    assert.deepEqual(benchNames(run), []);
});

test('replacing a Pokemon moves attacks between the deck and the attack bench', () => {
    const run = newRun();
    const target = addMon(run, 'Sparky', 'ELECTRIC');

    addAttack(run, 'Thunderbolt', 'ELECTRIC');
    addAttack(run, 'Flamethrower', 'FIRE');

    assert.deepEqual(deckAttackNames(run), ['Thunderbolt']);
    assert.deepEqual(benchAttackNames(run), ['Flamethrower']);

    const result = R.replacePokemonCard(run, target.id, replacementCard(run, 'Blaze', 'FIRE'));

    assert.deepEqual(deckAttackNames(run), ['Flamethrower']);
    assert.deepEqual(benchAttackNames(run), ['Thunderbolt']);
    assert.deepEqual(result.actionChanges.addedToDeck.map(card => card.attack.name), ['Flamethrower']);
    assert.deepEqual(result.actionChanges.movedToBench.map(card => card.attack.name), ['Thunderbolt']);
});

test('an unowned target id falls back to the normal add path', () => {
    const run = newRun();

    addMon(run, 'Alpha', 'NORMAL');

    const result = R.replacePokemonCard(run, 'run-pokemon-missing-99', replacementCard(run, 'Gift', 'NORMAL'));

    assert.equal(result.removedCard, null);
    assert.equal(result.zone, 'active');
    assert.deepEqual(activeNames(run), ['Alpha', 'Gift']);
});

test('a non-Pokemon replacement leaves the collections untouched', () => {
    const run = newRun();
    const target = addMon(run, 'Alpha', 'NORMAL');
    const attackCard = R.createAttackCard(attack('Tackle', 'NORMAL'), 'player', R.allocateCardId(run, 'attack', 'Tackle'));

    const result = R.replacePokemonCard(run, target.id, attackCard);

    assert.equal(result.zone, null);
    assert.equal(result.actionChanges, null);
    assert.deepEqual(activeNames(run), ['Alpha']);
});
