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

function makeItemCard(owner, itemRecord) {
    return {
        faceUp: true,
        id: `TEST-ITEM-${owner}-${Math.random().toString(36).slice(2)}`,
        item: itemRecord,
        kind: 'item',
        owner
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

test('tapping an unusable attack card again clears its highlight while phase stays "turn"', () => {
    const state = arena.state;

    state.elements = { board: {}, popup: { hidden: false } };
    state.players = {
        opponent: Model.createPlayer('opponent', 'Rival'),
        player: Model.createPlayer('player', 'You')
    };
    // The only active Pokemon is WATER but the attack requires FIRE, so no
    // eligible attacker exists: selection highlights the card without leaving
    // the 'turn' phase.
    state.players.player.board[0] = makePokemonCard('player', ['WATER']);
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

    assert.equal(state.phase, 'turn');
    assert.equal(state.selectedCardId, attackCard.id);
    assert.equal(state.pendingActionCardId, null);

    Controller.handleArenaClick(clickOnCard(attackCard.id));

    assert.equal(state.phase, 'turn');
    assert.equal(state.selectedCardId, null);

    clearTimeout(state.popupTimer);
});

test('playing a Dragon Gem removes it from play instead of discarding it', async () => {
    const state = arena.state;

    // No real DOM in Node: stub document/board rect so the fly-out animation
    // helpers take their "no element found" branch instead of throwing.
    globalThis.document = {
        body: { appendChild: () => {} },
        querySelector: () => null
    };
    state.elements = {
        board: { getBoundingClientRect: () => ({ height: 100, left: 0, top: 0, width: 100 }) },
        popup: { hidden: false }
    };
    state.players = {
        opponent: Model.createPlayer('opponent', 'Rival'),
        player: Model.createPlayer('player', 'You')
    };

    const gemRecord = arena.GameData.items.find(item => item.status.includes('DRAGON_GEM'));
    const gemCard = makeItemCard('player', gemRecord);

    state.players.player.hand = [gemCard];
    state.phase = 'turn';
    state.currentPlayer = 'player';
    state.isResolving = false;

    try {
        const played = await Controller.useDragonGemItemFromHand('player', gemCard.id);

        assert.equal(played, true);
        assert.ok(state.players.player.removed.some(card => card.id === gemCard.id));
        assert.ok(!state.players.player.discard.some(card => card.id === gemCard.id));
        assert.ok(!state.players.player.hand.some(card => card.id === gemCard.id));

        const gemEffect = gemRecord.status.find(status => status !== 'DRAGON_GEM');

        assert.ok(Model.getDragonGemEffects('player').some(effect => effect.status === gemEffect));
    } finally {
        delete globalThis.document;
    }
});

test('using a normal item removes it from play instead of discarding it', async () => {
    const state = arena.state;

    // No real DOM in Node: stub document/board rect so the fly-out animation
    // helpers take their "no element found" branch instead of throwing.
    globalThis.document = {
        body: { appendChild: () => {} },
        querySelector: () => null
    };
    state.elements = {
        board: { getBoundingClientRect: () => ({ height: 100, left: 0, top: 0, width: 100 }) },
        popup: { hidden: false }
    };
    state.players = {
        opponent: Model.createPlayer('opponent', 'Rival'),
        player: Model.createPlayer('player', 'You')
    };

    const target = makePokemonCard('player', ['FIRE']);

    target.currentHealth = 10;
    state.players.player.board[0] = target;

    const healRecord = arena.GameData.items.find(item => Array.isArray(item.status) && item.status.includes('HEAL'));
    const itemCard = makeItemCard('player', healRecord);

    state.players.player.hand = [itemCard];
    state.phase = 'selecting-item-target';
    state.currentPlayer = 'player';
    state.isResolving = false;
    state.pendingActionCardId = itemCard.id;

    try {
        await Controller.usePendingItem({ kind: 'single', owner: 'player', cardId: target.id });

        assert.ok(state.players.player.removed.some(card => card.id === itemCard.id));
        assert.ok(!state.players.player.discard.some(card => card.id === itemCard.id));
        assert.ok(!state.players.player.hand.some(card => card.id === itemCard.id));
    } finally {
        delete globalThis.document;
    }
});

test('sleep applied after a Pokemon has acted still blocks its own next-turn attack', () => {
    const state = arena.state;

    state.elements = { popup: { hidden: false } };
    state.log = [];
    state.players = {
        opponent: Model.createPlayer('opponent', 'Rival'),
        player: Model.createPlayer('player', 'You')
    };

    const sleeper = makePokemonCard('opponent', ['WATER']);
    state.players.opponent.board[0] = sleeper;

    // Sleep is applied on a turn where the Pokemon already acted (or is on
    // the defending side), so the same turn's end-of-turn tick must not
    // advance the wake ladder.
    state.turnNumber = 5;
    const applied = Model.applyStatus(sleeper, 'SLEEP');
    assert.equal(applied.added, true);

    Controller.tickSleepTimersWithoutAttack();
    assert.equal(Model.getPokemonStatusEntry(sleeper, 'SLEEP').wakeAttempts, 0);

    // Its own next turn: the first real wake attempt always fails.
    state.turnNumber += 1;
    const firstAttempt = Controller.resolveSleepAttempt(sleeper);
    assert.equal(firstAttempt.blocked, true);
    assert.equal(Model.getPokemonStatusEntry(sleeper, 'SLEEP').wakeAttempts, 1);
    assert.equal(Model.hasPokemonStatus(sleeper, 'SLEEP'), true);

    // Keep attempting on later turns; the ladder guarantees a wake by the
    // 4th attempt (SLEEP_GUARANTEED_WAKE_ATTEMPT) at the latest.
    for (let i = 0; i < arena.Constants.SLEEP_GUARANTEED_WAKE_ATTEMPT && Model.hasPokemonStatus(sleeper, 'SLEEP'); i += 1) {
        state.turnNumber += 1;
        Controller.resolveSleepAttempt(sleeper);
    }

    assert.equal(Model.hasPokemonStatus(sleeper, 'SLEEP'), false);
});
