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

test('overkill damage is capped at remaining HP for the log and damage float', () => {
    const state = arena.state;

    state.elements = { popup: { hidden: false } };
    state.log = [];
    state.pendingPokemonReplacements = [];
    state.players = {
        opponent: Model.createPlayer('opponent', 'Rival'),
        player: Model.createPlayer('player', 'You')
    };

    const attacker = makePokemonCard('player', ['FIRE']);
    const target = makePokemonCard('opponent', ['WATER']);

    // basePower 50 with equal stats always rolls 18-23 raw damage, far past
    // the target's 5 remaining HP.
    target.currentHealth = 5;
    state.players.player.board[0] = attacker;
    state.players.opponent.board[0] = target;

    const result = Controller.damagePokemon('opponent', target, attacker, makeAttackCard('player', ['FIRE']));

    assert.equal(result.damage, 5);
    assert.equal(result.damagePercent, 10);
    assert.equal(target.currentHealth, 0);
    assert.ok(state.players.opponent.knockout.some(card => card.id === target.id));
});

test('a knockout at the limit still queues a replacement when a Fossil can revive', () => {
    const state = arena.state;

    state.elements = { popup: { hidden: false } };
    state.log = [];
    state.pendingPokemonReplacements = [];
    state.players = {
        opponent: Model.createPlayer('opponent', 'Rival'),
        player: Model.createPlayer('player', 'You')
    };

    const player = state.players.player;
    const limit = Model.getEffectiveKnockoutLimit(player);
    const fossil = makePokemonCard('player', ['FOSSIL', 'ROCK']);
    const victim = makePokemonCard('player', ['WATER']);

    player.board[0] = victim;
    player.knockout = [fossil];
    player.knockoutCount = limit - 1;

    Controller.knockOutPokemon('player', victim);

    // The knockout reaches the limit, but the revivable Fossil defers defeat
    // and the vacated slot still gets an end-of-turn replacement queued.
    assert.equal(player.knockoutCount, limit);
    assert.equal(Model.isPlayerDefeated(player), false);
    assert.ok(state.pendingPokemonReplacements.some(replacement => (
        replacement.ownerId === 'player' && replacement.slotIndex === 0
    )));

    // Once the Fossil's revival is spent, the next knockout is a real defeat
    // and no replacement is queued.
    state.pendingPokemonReplacements = [];
    fossil.hasUsedFossilRevival = true;
    const secondVictim = makePokemonCard('player', ['WATER']);
    player.board[1] = secondVictim;

    Controller.knockOutPokemon('player', secondVictim);

    assert.equal(Model.isPlayerDefeated(player), true);
    assert.equal(state.pendingPokemonReplacements.length, 0);
});

test('the last Pokemon down revives at the end of the same turn when it is a Fossil', () => {
    const state = arena.state;

    state.elements = { popup: { hidden: false } };
    state.log = [];
    state.pendingPokemonReplacements = [];
    state.players = {
        opponent: Model.createPlayer('opponent', 'Rival'),
        player: Model.createPlayer('player', 'You')
    };

    const player = state.players.player;
    const fossil = makePokemonCard('player', ['FOSSIL', 'ROCK']);

    player.board = player.board.map(() => null);
    player.board[0] = fossil;
    player.pokemonDeck = [];
    player.initialPokemonCount = 2;
    player.knockoutCount = 1;
    player.knockout = [makePokemonCard('player', ['WATER'])];

    Controller.knockOutPokemon('player', fossil);

    // Nothing else can be knocked out to trigger the usual delayed revival, so
    // the Fossil's own knockout must queue an end-of-turn replacement instead
    // of ending the battle.
    assert.equal(player.knockoutCount, 2);
    assert.equal(Model.isPlayerDefeated(player), false);
    assert.ok(state.pendingPokemonReplacements.some(replacement => (
        replacement.ownerId === 'player' && replacement.slotIndex === 0
    )));

    const revivedCard = Controller.reviveFossilPokemonFromKnockout(player, 0);

    assert.equal(revivedCard && revivedCard.id, fossil.id);
    assert.equal(player.board[0].id, fossil.id);
    assert.equal(player.knockout.some(card => card.id === fossil.id), false);
    assert.equal(player.knockoutCount, 1);
    assert.equal(fossil.currentHealth, 30);
    assert.equal(fossil.hasUsedFossilRevival, true);
    assert.equal(Model.hasPokemonStatus(fossil, 'FATIGUE'), true);
    assert.equal(Model.isPlayerDefeated(player), false);
});

test('a damaging attack targets a guaranteed-KO Pokemon over a healthy one', () => {
    const state = arena.state;

    state.players = {
        opponent: Model.createPlayer('opponent', 'Rival'),
        player: Model.createPlayer('player', 'You')
    };

    const attacker = makePokemonCard('opponent', ['NORMAL']);
    const healthy = makePokemonCard('player', ['NORMAL']);
    const frail = makePokemonCard('player', ['NORMAL']);

    frail.currentHealth = 5;

    state.players.opponent.board[0] = attacker;
    state.players.player.board[0] = healthy;
    state.players.player.board[1] = frail;

    const selection = Controller.chooseOpponentTarget(makeAttackCard('opponent', ['NORMAL']), attacker);

    assert.equal(selection.cardId, frail.id);
});

test('with no guaranteed kill available, a frail low-defense target beats a high-defense tank', () => {
    const state = arena.state;

    state.players = {
        opponent: Model.createPlayer('opponent', 'Rival'),
        player: Model.createPlayer('player', 'You')
    };

    const attacker = makePokemonCard('opponent', ['NORMAL']);
    const tank = makePokemonCard('player', ['NORMAL']);
    const frail = makePokemonCard('player', ['NORMAL']);

    tank.pokemon.baseDefense = 200;
    tank.pokemon.baseHealth = 100;
    tank.currentHealth = 100;
    frail.pokemon.baseDefense = 50;

    state.players.opponent.board[0] = attacker;
    state.players.player.board[0] = tank;
    state.players.player.board[1] = frail;

    const selection = Controller.chooseOpponentTarget(makeAttackCard('opponent', ['NORMAL']), attacker);

    assert.equal(selection.cardId, frail.id);
});

test('a basePower-0 sleep attack targets the highest-Attack non-statused Pokemon and skips a statused one', () => {
    const state = arena.state;

    state.players = {
        opponent: Model.createPlayer('opponent', 'Rival'),
        player: Model.createPlayer('player', 'You')
    };
    state.turnNumber = 1;

    const attacker = makePokemonCard('opponent', ['NORMAL']);
    const statusedHighAttack = makePokemonCard('player', ['NORMAL']);
    const statuslessHighAttack = makePokemonCard('player', ['NORMAL']);
    const statuslessLowAttack = makePokemonCard('player', ['NORMAL']);

    statusedHighAttack.pokemon.baseAttack = 200;
    statuslessHighAttack.pokemon.baseAttack = 150;
    statuslessLowAttack.pokemon.baseAttack = 100;
    Model.applyStatus(statusedHighAttack, 'BURN');

    state.players.opponent.board[0] = attacker;
    state.players.player.board[0] = statusedHighAttack;
    state.players.player.board[1] = statuslessHighAttack;
    state.players.player.board[2] = statuslessLowAttack;

    const attackCard = makeAttackCard('opponent', ['NORMAL']);

    attackCard.attack.basePower = 0;
    attackCard.attack.status = ['SLEEP'];

    const selection = Controller.chooseOpponentTarget(attackCard, attacker);

    assert.equal(selection.cardId, statuslessHighAttack.id);
});

test('a basePower-0 paralysis attack targets the highest-Speed Pokemon regardless of Attack', () => {
    const state = arena.state;

    state.players = {
        opponent: Model.createPlayer('opponent', 'Rival'),
        player: Model.createPlayer('player', 'You')
    };

    const attacker = makePokemonCard('opponent', ['NORMAL']);
    const highAttackLowSpeed = makePokemonCard('player', ['NORMAL']);
    const lowAttackHighSpeed = makePokemonCard('player', ['NORMAL']);

    highAttackLowSpeed.pokemon.baseAttack = 200;
    highAttackLowSpeed.pokemon.baseSpeed = 80;
    lowAttackHighSpeed.pokemon.baseAttack = 50;
    lowAttackHighSpeed.pokemon.baseSpeed = 150;

    state.players.opponent.board[0] = attacker;
    state.players.player.board[0] = highAttackLowSpeed;
    state.players.player.board[1] = lowAttackHighSpeed;

    const attackCard = makeAttackCard('opponent', ['NORMAL']);

    attackCard.attack.basePower = 0;
    attackCard.attack.status = ['PARALYSIS'];

    const selection = Controller.chooseOpponentTarget(attackCard, attacker);

    assert.equal(selection.cardId, lowAttackHighSpeed.id);
});

test('a Protect-ed target is avoided when a legal alternative exists', () => {
    const state = arena.state;

    state.players = {
        opponent: Model.createPlayer('opponent', 'Rival'),
        player: Model.createPlayer('player', 'You')
    };

    const attacker = makePokemonCard('opponent', ['NORMAL']);
    const protectedTarget = makePokemonCard('player', ['NORMAL']);
    const alternative = makePokemonCard('player', ['NORMAL']);

    protectedTarget.currentHealth = 5;
    Model.applyStatus(protectedTarget, 'PROTECT');

    state.players.opponent.board[0] = attacker;
    state.players.player.board[0] = protectedTarget;
    state.players.player.board[1] = alternative;

    const selection = Controller.chooseOpponentTarget(makeAttackCard('opponent', ['NORMAL']), attacker);

    assert.equal(selection.cardId, alternative.id);
});

test('a status attack still returns a target when every candidate is already statused', () => {
    const state = arena.state;

    state.players = {
        opponent: Model.createPlayer('opponent', 'Rival'),
        player: Model.createPlayer('player', 'You')
    };
    state.turnNumber = 1;

    const attacker = makePokemonCard('opponent', ['NORMAL']);
    const first = makePokemonCard('player', ['NORMAL']);
    const second = makePokemonCard('player', ['NORMAL']);

    second.currentHealth = 10;
    Model.applyStatus(first, 'BURN');
    Model.applyStatus(second, 'BURN');

    state.players.opponent.board[0] = attacker;
    state.players.player.board[0] = first;
    state.players.player.board[1] = second;

    const attackCard = makeAttackCard('opponent', ['NORMAL']);

    attackCard.attack.basePower = 0;
    attackCard.attack.status = ['SLEEP'];

    const selection = Controller.chooseOpponentTarget(attackCard, attacker);

    assert.ok(selection);
    assert.equal(selection.cardId, second.id);
});

test('chooseOpponentTarget returns null when no legal single target resolves', () => {
    const state = arena.state;

    state.players = {
        opponent: Model.createPlayer('opponent', 'Rival'),
        player: Model.createPlayer('player', 'You')
    };

    const attacker = makePokemonCard('opponent', ['NORMAL']);

    state.players.opponent.board[0] = attacker;

    const selection = Controller.chooseOpponentTarget(makeAttackCard('opponent', ['NORMAL']), attacker);

    assert.equal(selection, null);
});
