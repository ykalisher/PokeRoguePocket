'use strict';

const { before, test } = require('node:test');
const assert = require('node:assert/strict');
const { arena, loadRealGameData } = require('./helpers/arena_env');

const { Model } = arena;

before(async () => {
    await loadRealGameData();
});

function setUpBattleState() {
    const state = arena.state;

    state.players = {
        opponent: Model.createPlayer('opponent', 'Rival'),
        player: Model.createPlayer('player', 'You')
    };
    state.phase = 'turn';
    state.currentPlayer = 'player';
    state.isResolving = false;
    state.finished = false;
    state.turnNumber = 3;
    Model.drawCardsUpToHandSize(state.players.player);

    return state;
}

test('createBattleSnapshot is detached from live state', () => {
    const state = setUpBattleState();
    const snapshot = Model.createBattleSnapshot();
    const originalHandLength = snapshot.players.player.hand.length;
    const originalHandSize = snapshot.players.player.handSize;

    state.players.player.hand.push({ id: 'FAKE-CARD', kind: 'item' });
    state.players.player.handSize = originalHandSize + 5;

    assert.equal(snapshot.players.player.hand.length, originalHandLength);
    assert.equal(snapshot.players.player.handSize, originalHandSize);
});

test('applyBattleSnapshot restores hand, handSize, itemUsed, itemAllowance, extraAttacks and deck order', () => {
    const state = setUpBattleState();
    const originalDeckIds = state.players.player.deck.map(card => card.id);
    const originalHandLength = state.players.player.hand.length;
    const originalHandSize = state.players.player.handSize;
    const snapshot = Model.createBattleSnapshot();

    state.players.player.hand.push({ id: 'FAKE-CARD', kind: 'item' });
    state.players.player.handSize = originalHandSize + 5;
    state.itemUsed.player = 9;
    state.itemAllowance.player = 9;
    state.extraAttacks.player['SOME-CARD'] = 2;
    state.players.player.deck.reverse();

    assert.equal(Model.applyBattleSnapshot(snapshot), true);
    assert.equal(state.players.player.hand.length, originalHandLength);
    assert.equal(state.players.player.handSize, originalHandSize);
    assert.deepEqual(state.itemUsed, { opponent: 0, player: 0 });
    assert.deepEqual(state.itemAllowance, { opponent: 1, player: 1 });
    assert.deepEqual(state.extraAttacks.player, {});
    assert.deepEqual(state.players.player.deck.map(card => card.id), originalDeckIds);
});

test('applyBattleSnapshot(null) returns false and leaves state alone', () => {
    const state = setUpBattleState();
    state.turnNumber = 42;

    assert.equal(Model.applyBattleSnapshot(null), false);
    assert.equal(state.turnNumber, 42);
});

test('applyBattleSnapshot does not touch rulesWindowOpen', () => {
    const state = setUpBattleState();
    const snapshot = Model.createBattleSnapshot();

    state.rulesWindowOpen = true;
    assert.equal(Model.applyBattleSnapshot(snapshot), true);
    assert.equal(state.rulesWindowOpen, true);
});

test('undo stack behaves as a LIFO', () => {
    setUpBattleState();
    Model.clearUndoStack();

    assert.equal(Model.canUndo(), false);
    assert.equal(Model.popUndoSnapshot(), null);

    Model.pushUndoSnapshot('Sitrus Berry');
    Model.pushUndoSnapshot('Poke Ball');
    assert.equal(Model.canUndo(), true);

    const top = Model.popUndoSnapshot();
    assert.equal(top.label, 'Poke Ball');

    const next = Model.popUndoSnapshot();
    assert.equal(next.label, 'Sitrus Berry');

    assert.equal(Model.canUndo(), false);
    assert.equal(Model.popUndoSnapshot(), null);

    Model.pushUndoSnapshot('Sitrus Berry');
    Model.clearUndoStack();
    assert.equal(Model.canUndo(), false);
});

test('serializeBattleState output has no undoStack key', () => {
    setUpBattleState();

    // serializeBattleState isn't exported directly; createBattleSnapshot()
    // deep-clones exactly its output, so this is an equivalent check.
    const snapshot = Model.createBattleSnapshot();
    assert.equal(Object.prototype.hasOwnProperty.call(snapshot, 'undoStack'), false);
});
