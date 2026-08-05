'use strict';

const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { arena, loadRealGameData } = require('./helpers/arena_env');

require('../arena/arena_render.js');
require('../arena/arena_controller.js');

const { Controller, Model } = arena;

let cardCounter = 0;

function nextId(prefix) {
    cardCounter += 1;

    return `TEST-${prefix}-${cardCounter}`;
}

function makePokemonCard(owner, types) {
    return {
        currentHealth: 50,
        currentStatus: [],
        faceUp: true,
        id: nextId(`PKM-${owner}`),
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
        statStages: undefined
    };
}

function makeAttackCard(owner, attackRecord) {
    return {
        attack: attackRecord,
        faceUp: true,
        id: nextId(`ATK-${owner}`),
        kind: 'attack',
        owner
    };
}

function makePlainAttackCard(owner, types) {
    return makeAttackCard(owner, {
        basePower: 50,
        full_type_requirements: false,
        name: 'Test Attack',
        target: 'OPPONENT',
        types
    });
}

function makeItemCard(owner, itemRecord) {
    return {
        faceUp: true,
        id: nextId(`ITEM-${owner}`),
        item: itemRecord,
        kind: 'item',
        owner
    };
}

function findArtificialAttackRecord(status) {
    return arena.GameData.attacks.find(attack => (
        (attack.types || []).includes('ARTIFICIAL') && attack.status === status
    ));
}

/**
 * The controller renders and animates on every action. Node has no DOM, so a
 * stub document makes every element lookup miss, which sends the animation
 * helpers down their "no element found" branch (a short sleep) instead of
 * throwing. Mirrors the setup in tests/arena_controller.test.js.
 */
function setUpPlayerTurn() {
    const state = arena.state;

    globalThis.document = {
        body: { appendChild: () => {} },
        querySelector: () => null
    };
    state.elements = {
        board: {
            getBoundingClientRect: () => ({ height: 100, left: 0, top: 0, width: 100 }),
            innerHTML: ''
        },
        popup: { hidden: false }
    };
    state.players = {
        opponent: Model.createPlayer('opponent', 'Rival'),
        player: Model.createPlayer('player', 'You')
    };
    state.arrivingCardIds = [];
    state.currentPlayer = 'player';
    state.extraAttacks = { opponent: {}, player: {} };
    state.finished = false;
    state.isResolving = false;
    state.itemAllowance = { opponent: 1, player: 1 };
    state.itemUsed = { opponent: 0, player: 0 };
    state.log = [];
    state.pendingActionCardId = null;
    state.pendingPokemonReplacements = [];
    state.pendingUserCardId = null;
    state.phase = 'turn';
    state.plannedActions = { opponent: [], player: [] };
    state.selectedCardId = null;
    state.suppressNextClick = false;
    state.turnNumber = 3;
    Model.clearUndoStack();

    return state;
}

function tearDown() {
    clearTimeout(arena.state.flowTimer);
    clearTimeout(arena.state.popupTimer);
    delete globalThis.document;
}

/**
 * Item, artificial-attack and discard commits animate before they finish, so
 * tests wait for the controller to release input rather than guessing a delay.
 */
async function waitForIdle() {
    for (let attempt = 0; attempt < 200 && arena.state.isResolving; attempt += 1) {
        await Model.sleep(10);
    }

    assert.equal(arena.state.isResolving, false, 'controller never released input');
}

function handIds(playerId) {
    return arena.state.players[playerId].hand.map(card => card.id);
}

function cardIds(cards) {
    return cards.map(card => card.id);
}

before(async () => {
    await loadRealGameData();
});

after(tearDown);

test('undoing an item returns the card to hand and restores the target and item use', async () => {
    const state = setUpPlayerTurn();
    const target = makePokemonCard('player', ['FIRE']);

    target.currentHealth = 10;
    state.players.player.board[0] = target;

    const healRecord = arena.GameData.items.find(item => (
        Array.isArray(item.status) && item.status.includes('HEAL')
    ));
    const itemCard = makeItemCard('player', healRecord);

    state.players.player.hand = [itemCard];
    state.phase = 'selecting-item-target';
    state.pendingActionCardId = itemCard.id;

    try {
        await Controller.usePendingItem({ cardId: target.id, kind: 'single', owner: 'player' });
        await waitForIdle();

        assert.ok(state.players.player.removed.some(card => card.id === itemCard.id));
        assert.ok(!handIds('player').includes(itemCard.id));
        assert.equal(state.itemUsed.player, 1);
        assert.ok(state.players.player.board[0].currentHealth > 10, 'the item should have healed the target');

        assert.equal(Controller.undoLastAction(), true);

        assert.ok(handIds('player').includes(itemCard.id));
        assert.ok(!state.players.player.removed.some(card => card.id === itemCard.id));
        assert.equal(state.itemUsed.player, 0);
        assert.equal(state.players.player.board[0].currentHealth, 10);
        assert.equal(state.phase, 'turn');
        assert.equal(state.pendingActionCardId, null);
        assert.ok(state.log[0].includes(`Undid ${healRecord.name}.`));
        assert.equal(Model.canUndo(), false);
    } finally {
        tearDown();
    }
});

test('undoing a queued attack empties the planned actions and returns the card to hand', () => {
    const state = setUpPlayerTurn();
    const attacker = makePokemonCard('player', ['FIRE']);
    const defender = makePokemonCard('opponent', ['WATER']);

    state.players.player.board[0] = attacker;
    state.players.opponent.board[0] = defender;

    const attackCard = makePlainAttackCard('player', ['FIRE']);

    state.players.player.hand = [attackCard];

    try {
        Controller.handleCardDrop(attackCard.id, {
            kind: 'attack-target',
            selection: { cardId: defender.id, kind: 'single', owner: 'opponent' },
            userCardId: attacker.id
        });

        assert.equal(state.plannedActions.player.length, 1);
        assert.ok(!handIds('player').includes(attackCard.id));

        assert.equal(Controller.undoLastAction(), true);

        assert.equal(state.plannedActions.player.length, 0);
        assert.ok(handIds('player').includes(attackCard.id));
        assert.ok(state.log[0].includes('Undid Test Attack.'));
    } finally {
        tearDown();
    }
});

test('undoing INCREASE_CAPACITY restores the previous hand size', async () => {
    const state = setUpPlayerTurn();
    const user = makePokemonCard('player', ['ARTIFICIAL']);

    state.players.player.board[0] = user;

    const attackCard = makeAttackCard('player', findArtificialAttackRecord('INCREASE_CAPACITY'));
    const originalHandSize = state.players.player.handSize;

    state.players.player.hand = [attackCard];

    try {
        Controller.handleCardDrop(attackCard.id, { kind: 'attack-user', userCardId: user.id });
        await waitForIdle();

        assert.equal(state.players.player.handSize, originalHandSize + 1);

        assert.equal(Controller.undoLastAction(), true);

        assert.equal(state.players.player.handSize, originalHandSize);
        assert.ok(handIds('player').includes(attackCard.id));
        assert.ok(!state.players.player.removed.some(card => card.id === attackCard.id));
    } finally {
        tearDown();
    }
});

test('undoing EXTRA_ITEM restores the item allowance', async () => {
    const state = setUpPlayerTurn();
    const user = makePokemonCard('player', ['ARTIFICIAL']);

    state.players.player.board[0] = user;

    const attackCard = makeAttackCard('player', findArtificialAttackRecord('EXTRA_ITEM'));

    state.players.player.hand = [attackCard];

    try {
        Controller.handleCardDrop(attackCard.id, { kind: 'attack-user', userCardId: user.id });
        await waitForIdle();

        assert.equal(state.itemAllowance.player, 2);

        assert.equal(Controller.undoLastAction(), true);

        assert.equal(state.itemAllowance.player, 1);
        assert.ok(handIds('player').includes(attackCard.id));
    } finally {
        tearDown();
    }
});

test('undoing EXTRA_ATTACK clears the granted extra attack', async () => {
    const state = setUpPlayerTurn();
    const user = makePokemonCard('player', ['ARTIFICIAL']);
    const ally = makePokemonCard('player', ['FIRE']);

    state.players.player.board[0] = user;
    state.players.player.board[1] = ally;

    const attackCard = makeAttackCard('player', findArtificialAttackRecord('EXTRA_ATTACK'));

    state.players.player.hand = [attackCard];

    try {
        Controller.handleCardDrop(attackCard.id, { kind: 'attack-user', userCardId: user.id });
        await waitForIdle();

        assert.equal(state.extraAttacks.player[ally.id], 1);

        assert.equal(Controller.undoLastAction(), true);

        assert.deepEqual(state.extraAttacks.player, {});
        assert.ok(handIds('player').includes(attackCard.id));
    } finally {
        tearDown();
    }
});

test('undoing REFRESH_DECK restores the deck and discard piles in order', async () => {
    const state = setUpPlayerTurn();
    const user = makePokemonCard('player', ['ARTIFICIAL']);
    const player = state.players.player;

    state.players.player.board[0] = user;
    player.discard = player.deck.splice(0, 3);

    const attackCard = makeAttackCard('player', findArtificialAttackRecord('REFRESH_DECK'));

    player.hand = [attackCard];

    const originalDeckIds = cardIds(player.deck);
    const originalDiscardIds = cardIds(player.discard);

    try {
        Controller.handleCardDrop(attackCard.id, { kind: 'attack-user', userCardId: user.id });
        await waitForIdle();

        assert.equal(state.players.player.discard.length, 0);
        assert.equal(state.players.player.deck.length, originalDeckIds.length + originalDiscardIds.length);

        assert.equal(Controller.undoLastAction(), true);

        assert.deepEqual(cardIds(state.players.player.deck), originalDeckIds);
        assert.deepEqual(cardIds(state.players.player.discard), originalDiscardIds);
        assert.ok(handIds('player').includes(attackCard.id));
    } finally {
        tearDown();
    }
});

test('undoing a discard takes the card back out of the discard pile', async () => {
    const state = setUpPlayerTurn();

    state.players.player.board[0] = makePokemonCard('player', ['FIRE']);

    const attackCard = makePlainAttackCard('player', ['WATER']);

    state.players.player.hand = [attackCard];

    try {
        Controller.handleCardDrop(attackCard.id, { kind: 'discard' });
        await waitForIdle();

        assert.ok(state.players.player.discard.some(card => card.id === attackCard.id));
        assert.ok(!handIds('player').includes(attackCard.id));

        assert.equal(Controller.undoLastAction(), true);

        assert.ok(handIds('player').includes(attackCard.id));
        assert.ok(!state.players.player.discard.some(card => card.id === attackCard.id));
    } finally {
        tearDown();
    }
});

test('three actions undo one at a time back to the start of the turn', async () => {
    const state = setUpPlayerTurn();
    const attacker = makePokemonCard('player', ['FIRE']);
    const defender = makePokemonCard('opponent', ['WATER']);

    attacker.currentHealth = 10;
    state.players.player.board[0] = attacker;
    state.players.opponent.board[0] = defender;

    const healRecord = arena.GameData.items.find(item => (
        Array.isArray(item.status) && item.status.includes('HEAL')
    ));
    const attackCard = makePlainAttackCard('player', ['FIRE']);
    const itemCard = makeItemCard('player', healRecord);
    const discardCard = makePlainAttackCard('player', ['WATER']);

    state.players.player.hand = [attackCard, itemCard, discardCard];

    const startingHandIds = handIds('player');
    const startingDiscardIds = cardIds(state.players.player.discard);

    try {
        Controller.handleCardDrop(attackCard.id, {
            kind: 'attack-target',
            selection: { cardId: defender.id, kind: 'single', owner: 'opponent' },
            userCardId: attacker.id
        });

        state.phase = 'selecting-item-target';
        state.pendingActionCardId = itemCard.id;
        await Controller.usePendingItem({ cardId: attacker.id, kind: 'single', owner: 'player' });
        await waitForIdle();

        Controller.handleCardDrop(discardCard.id, { kind: 'discard' });
        await waitForIdle();

        assert.equal(arena.state.undoStack.length, 3);
        assert.equal(handIds('player').length, 0);

        assert.equal(Controller.undoLastAction(), true);
        assert.deepEqual(handIds('player'), [discardCard.id]);

        assert.equal(Controller.undoLastAction(), true);
        assert.equal(handIds('player').length, 2);
        assert.equal(state.itemUsed.player, 0);

        assert.equal(Controller.undoLastAction(), true);
        assert.deepEqual(handIds('player').slice().sort(), startingHandIds.slice().sort());
        assert.equal(state.plannedActions.player.length, 0);
        assert.deepEqual(cardIds(state.players.player.discard), startingDiscardIds);
        assert.equal(state.players.player.board[0].currentHealth, 10);

        assert.equal(Controller.undoLastAction(), false);
        assert.equal(Controller.canUndoAction(), false);
    } finally {
        tearDown();
    }
});

test('the rendered action bar enables Undo only while an action is undoable', async () => {
    const state = setUpPlayerTurn();

    state.players.player.board[0] = makePokemonCard('player', ['FIRE']);

    const discardCard = makePlainAttackCard('player', ['WATER']);

    state.players.player.hand = [discardCard];

    try {
        arena.Render.render();

        assert.match(state.elements.board.innerHTML, /class="arena-button arena-button--undo" type="button" data-action="undo" disabled>Undo</);

        Controller.handleCardDrop(discardCard.id, { kind: 'discard' });
        await waitForIdle();
        arena.Render.render();

        assert.match(state.elements.board.innerHTML, /class="arena-button arena-button--undo" type="button" data-action="undo" >Undo</);

        assert.equal(Controller.undoLastAction(), true);

        assert.match(state.elements.board.innerHTML, /class="arena-button arena-button--undo" type="button" data-action="undo" disabled>Undo</);
    } finally {
        tearDown();
    }
});

test('ending the turn clears the undo stack', async () => {
    const state = setUpPlayerTurn();

    state.players.player.board[0] = makePokemonCard('player', ['FIRE']);

    const discardCard = makeItemCard('player', arena.GameData.items[0]);

    state.players.player.hand = [discardCard];

    try {
        Controller.handleCardDrop(discardCard.id, { kind: 'discard' });
        await waitForIdle();

        assert.equal(Controller.canUndoAction(), true);

        Controller.handleArenaClick(clickOnAction('end-turn'));
        clearTimeout(state.flowTimer);

        assert.equal(Model.canUndo(), false);
        assert.equal(Controller.canUndoAction(), false);
    } finally {
        tearDown();
    }
});

test('opponent actions are never snapshotted', async () => {
    const state = setUpPlayerTurn();

    state.currentPlayer = 'opponent';
    state.phase = 'opponent-planning';
    state.players.opponent.board[0] = makePokemonCard('opponent', ['DRAGON']);

    const gemRecord = arena.GameData.items.find(item => item.status.includes('DRAGON_GEM'));
    const boostRecord = arena.GameData.items.find(item => (
        item.target === 'SIDE' && item.status.includes('EFFECT_BOOST')
    ));
    const gemCard = makeItemCard('opponent', gemRecord);
    const boostCard = makeItemCard('opponent', boostRecord);

    state.players.opponent.hand = [gemCard, boostCard];

    try {
        assert.equal(await Controller.useDragonGemItemFromHand('opponent', gemCard.id), true);
        assert.ok(state.players.opponent.removed.some(card => card.id === gemCard.id));
        assert.equal(arena.state.undoStack.length, 0);

        assert.equal(await Controller.useEffectBoostItemFromHand('opponent', boostCard.id), true);
        assert.ok(state.players.opponent.removed.some(card => card.id === boostCard.id));
        assert.equal(arena.state.undoStack.length, 0);
        assert.equal(Controller.canUndoAction(), false);
    } finally {
        tearDown();
    }
});

// Mimics the delegated click handler's use of Element.closest() for a command
// button, matching only the '[data-action]' selector.
function clickOnAction(action) {
    const element = {
        closest(selector) {
            return selector === '[data-action]' ? element : null;
        },
        dataset: { action }
    };

    return { target: element };
}
