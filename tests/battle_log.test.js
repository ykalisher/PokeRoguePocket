'use strict';

// The battle log is a summary, not a transcript: one headline per action, one
// line per Pokemon it affected, and one running discard count per player per
// turn. These tests pin that shape.

const { before, test } = require('node:test');
const assert = require('node:assert/strict');
const { arena, loadRealGameData } = require('./helpers/arena_env');

require('../arena/arena_render.js');
require('../arena/arena_controller.js');

const { Controller, Model } = arena;

function makePokemonCard(owner, name) {
    return {
        currentHealth: 200,
        currentStatus: [],
        faceUp: true,
        id: `TEST-PKM-${owner}-${Math.random().toString(36).slice(2)}`,
        kind: 'pokemon',
        owner,
        pokemon: {
            baseAttack: 100,
            baseDefense: 100,
            baseHealth: 200,
            baseSpeed: 100,
            name,
            types: ['NORMAL']
        },
        statStages: undefined
    };
}

function makeAttackCard(owner, statuses = []) {
    return {
        attack: {
            basePower: 50,
            full_type_requirements: false,
            name: 'Test Attack',
            status: statuses,
            target: 'OPPONENT',
            types: ['NORMAL']
        },
        faceUp: true,
        id: `TEST-ATK-${Math.random().toString(36).slice(2)}`,
        kind: 'attack',
        owner
    };
}

function resetBattle(turnNumber = 1) {
    const state = arena.state;

    state.elements = { popup: { hidden: false } };
    state.log = [];
    state.pendingPokemonReplacements = [];
    state.players = {
        opponent: Model.createPlayer('opponent', 'Rival'),
        player: Model.createPlayer('player', 'You')
    };
    state.turnNumber = turnNumber;

    return state;
}

before(async () => {
    await loadRealGameData();
});

test('an action group logs one headline plus one merged line per Pokemon', () => {
    const state = resetBattle();
    const attacker = makePokemonCard('player', 'Attacker');
    const target = makePokemonCard('opponent', 'Target');

    state.players.player.board[0] = attacker;
    state.players.opponent.board[0] = target;

    Controller.beginActionLogGroup('Attacker used Test Attack.');
    // Two hits of the same attack, then a status: all of it belongs to the
    // one line describing what happened to Target.
    Controller.damagePokemon('opponent', target, attacker, makeAttackCard('player'));
    Controller.damagePokemon('opponent', target, attacker, makeAttackCard('player'));
    Controller.maybeApplyAttackStatuses(
        makeAttackCard('player', ['BURN']),
        [{ card: target, owner: 'opponent' }],
        false
    );
    Controller.endActionLogGroup();

    assert.equal(state.log.length, 2, state.log.join(' | '));
    assert.equal(state.log[0], `Turn ${state.turnNumber}: Attacker used Test Attack.`);

    const takenDamage = target.pokemon.baseHealth - target.currentHealth;

    assert.equal(state.log[1], `Turn ${state.turnNumber}: Target took ${takenDamage} damage, gained Burn.`);
});

test('an action group with no outcome logs only its headline', () => {
    const state = resetBattle();

    Controller.beginActionLogGroup('Attacker used Test Attack.');
    Controller.endActionLogGroup();

    assert.deepEqual(state.log, [`Turn ${state.turnNumber}: Attacker used Test Attack.`]);
});

test('outside an action group each outcome still logs its own line', () => {
    const state = resetBattle();
    const attacker = makePokemonCard('player', 'Attacker');
    const target = makePokemonCard('opponent', 'Target');

    state.players.player.board[0] = attacker;
    state.players.opponent.board[0] = target;

    Controller.damagePokemon('opponent', target, attacker, makeAttackCard('player'));

    assert.equal(state.log.length, 1);
    assert.match(state.log[0], /^Turn \d+: Target took \d+ damage\.$/);
});

test('discards are logged as one running count per player per turn', () => {
    const state = resetBattle();

    Controller.logDiscardedCards('player');
    assert.deepEqual(state.log, [`Turn ${state.turnNumber}: You discarded 1 card.`]);

    Controller.logDiscardedCards('player', 2);
    assert.deepEqual(state.log, [`Turn ${state.turnNumber}: You discarded 3 cards.`]);

    // Each side keeps its own count.
    Controller.logDiscardedCards('opponent');
    assert.equal(state.log.length, 2);
    assert.ok(state.log.includes(`Turn ${state.turnNumber}: Rival discarded 1 card.`));
    assert.ok(state.log.includes(`Turn ${state.turnNumber}: You discarded 3 cards.`));

    // A new turn starts a new tally instead of growing the old line.
    const earlierTurn = state.turnNumber;

    state.turnNumber += 1;
    Controller.logDiscardedCards('player');
    assert.ok(state.log.includes(`Turn ${earlierTurn}: You discarded 3 cards.`));
    assert.ok(state.log.includes(`Turn ${state.turnNumber}: You discarded 1 card.`));
});
