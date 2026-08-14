'use strict';

const { before, test } = require('node:test');
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

function makePokemonCard(owner, name, baseSpeed) {
    return {
        currentHealth: 50,
        currentStatus: [],
        faceUp: true,
        id: nextId(`PKM-${name}`),
        kind: 'pokemon',
        owner,
        pokemon: {
            baseAttack: 100,
            baseDefense: 100,
            baseHealth: 50,
            baseSpeed,
            name,
            types: ['FIRE']
        },
        statStages: undefined
    };
}

function makeAttackCard(owner, name, status) {
    return {
        attack: {
            basePower: 50,
            full_type_requirements: false,
            name,
            status: status || 'NONE',
            target: 'OPPONENT',
            types: ['FIRE']
        },
        faceUp: true,
        id: nextId('ATK'),
        kind: 'attack',
        owner
    };
}

function setUpBoard() {
    const state = arena.state;

    state.players = {
        opponent: Model.createPlayer('opponent', 'Rival'),
        player: Model.createPlayer('player', 'You')
    };
    state.plannedActions = { opponent: [], player: [] };
    state.extraAttacks = { opponent: {}, player: {} };

    return state;
}

/**
 * Ready an attack the way queuePlayerAttackForUser does, appending to that
 * side's plannedActions in ready order.
 */
function readyAttack(state, userCard, attackName, status) {
    const attackCard = makeAttackCard(userCard.owner, attackName, status);

    state.plannedActions[userCard.owner].push({
        card: attackCard,
        owner: userCard.owner,
        selection: { kind: 'group', owner: userCard.owner === 'player' ? 'opponent' : 'player' },
        speed: Model.getPokemonSpeed(userCard),
        userCardId: userCard.id
    });
}

/**
 * Mirrors resolveQueuedAttacks(): re-sort the remaining actions before each
 * one is taken, since Speed and priority can change mid-resolution.
 */
function resolutionOrder() {
    const actions = Controller.createResolutionActions();
    const order = [];

    while (actions.length > 0) {
        Controller.sortResolutionActions(actions);
        order.push(Model.getCardName(actions.shift().card));
    }

    return order;
}

before(async () => {
    await loadRealGameData();
});

test('one Pokemon\'s readied attacks resolve in the order they were readied', () => {
    // Energize grants an ally extra attacks for the turn, so the same Pokemon
    // can hold several readied attacks. They are a queue, not a stack: whatever
    // was readied first resolves first.
    for (let attempt = 0; attempt < 25; attempt += 1) {
        const state = setUpBoard();
        const attacker = makePokemonCard('player', 'Attacker', 100);

        state.players.player.board[0] = attacker;
        state.players.opponent.board[0] = makePokemonCard('opponent', 'Target', 100);

        readyAttack(state, attacker, 'FIRST');
        readyAttack(state, attacker, 'SECOND');
        readyAttack(state, attacker, 'THIRD');

        assert.deepEqual(resolutionOrder(), ['FIRST', 'SECOND', 'THIRD']);
    }
});

test('an equally fast rival never splits up one Pokemon\'s readied attacks', () => {
    for (let attempt = 0; attempt < 25; attempt += 1) {
        const state = setUpBoard();
        const attacker = makePokemonCard('player', 'Attacker', 100);
        const rival = makePokemonCard('opponent', 'Rivalmon', 100);

        state.players.player.board[0] = attacker;
        state.players.opponent.board[0] = rival;

        readyAttack(state, attacker, 'FIRST');
        readyAttack(state, attacker, 'SECOND');
        readyAttack(state, rival, 'RIVAL');

        const order = resolutionOrder();

        assert.equal(order.indexOf('SECOND') - order.indexOf('FIRST'), 1, order.join(' > '));
    }
});

test('Speed still outranks ready order across Pokemon', () => {
    const state = setUpBoard();
    const slow = makePokemonCard('player', 'Slowmon', 40);
    const fast = makePokemonCard('opponent', 'Fastmon', 160);

    state.players.player.board[0] = slow;
    state.players.opponent.board[0] = fast;

    readyAttack(state, slow, 'SLOW-FIRST');
    readyAttack(state, slow, 'SLOW-SECOND');
    readyAttack(state, fast, 'FAST');

    assert.deepEqual(resolutionOrder(), ['FAST', 'SLOW-FIRST', 'SLOW-SECOND']);
});

test('PROTECT priority still resolves before an earlier readied attack', () => {
    const state = setUpBoard();
    const attacker = makePokemonCard('player', 'Attacker', 100);

    state.players.player.board[0] = attacker;
    state.players.opponent.board[0] = makePokemonCard('opponent', 'Target', 100);

    readyAttack(state, attacker, 'NORMAL');
    readyAttack(state, attacker, 'PROTECTING', 'PROTECT');

    assert.deepEqual(resolutionOrder(), ['PROTECTING', 'NORMAL']);
});
