'use strict';

const { before, test } = require('node:test');
const assert = require('node:assert/strict');
const { arena, loadRealGameData } = require('./helpers/arena_env');

require('../arena/arena_render.js');
require('../arena/arena_controller.js');

const { Controller, Model } = arena;

function makePokemonCard(owner, types) {
    return {
        currentHealth: 50,
        currentStatus: [],
        faceUp: true,
        id: `TEST-PKM-${owner}-${Math.random().toString(36).slice(2)}`,
        kind: 'pokemon',
        owner,
        pokemon: {
            baseAttack: 100,
            baseDefense: 100,
            baseHealth: 50,
            baseSpeed: 100,
            name: 'Testmon',
            types
        },
        statChanges: [],
        statStages: undefined
    };
}

function makeAttackCard(owner, types) {
    return {
        attack: {
            basePower: 50,
            full_type_requirements: false,
            name: 'Test Attack',
            target: 'OPPONENT',
            types
        },
        faceUp: true,
        id: 'TEST-ATK-TOGGLE',
        kind: 'attack',
        owner
    };
}

// Mimics the delegated click handler's use of Element.closest(), matching
// only the '[data-card-id]' selector handleArenaClick checks for hand cards.
function clickOnCard(cardId) {
    const element = {
        closest(selector) {
            return selector === '[data-card-id]' ? element : null;
        },
        dataset: { cardId }
    };

    return { target: element };
}

before(async () => {
    await loadRealGameData();
});

test('tapping a selected attack card again deselects it (tap-to-deselect)', () => {
    const state = arena.state;

    state.elements = { board: {}, popup: { hidden: false } };
    state.players = {
        opponent: Model.createPlayer('opponent', 'Rival'),
        player: Model.createPlayer('player', 'You')
    };
    state.players.player.board[0] = makePokemonCard('player', ['FIRE']);
    state.players.opponent.board[0] = makePokemonCard('opponent', ['WATER']);

    const attackCard = makeAttackCard('player', ['FIRE']);
    state.players.player.hand = [attackCard];

    state.phase = 'turn';
    state.currentPlayer = 'player';
    state.isResolving = false;
    state.finished = false;
    state.suppressNextClick = false;
    state.pendingActionCardId = null;
    state.selectedCardId = null;
    state.extraAttacks = { opponent: {}, player: {} };
    state.plannedActions = { opponent: [], player: [] };

    Controller.handleArenaClick(clickOnCard(attackCard.id));

    assert.equal(state.phase, 'selecting-attack-user');
    assert.equal(state.pendingActionCardId, attackCard.id);
    assert.equal(state.selectedCardId, attackCard.id);

    Controller.handleArenaClick(clickOnCard(attackCard.id));

    assert.equal(state.phase, 'turn');
    assert.equal(state.pendingActionCardId, null);
    assert.equal(state.selectedCardId, null);
});
