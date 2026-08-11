'use strict';

/**
 * FOSSIL revival: when a knocked out Fossil comes back, which slot it takes,
 * and the order several waiting Fossils return in.
 *
 * The three timings the rule has to cover:
 * 1. Allies left to fight - the Fossil waits out the turn it went down on and
 *    then claims the slot the next knocked out ally leaves behind.
 * 2. No Pokemon deck left to draw from - its own slot stays open, and the
 *    Fossil revives into it one turn later.
 * 3. Nothing left at all - waiting would end the battle, so it revives at the
 *    end of the turn it was knocked out.
 * Timing 3 wins over 2, and 2 wins over 1.
 */

const { before, test } = require('node:test');
const assert = require('node:assert/strict');
const { arena, loadRealGameData } = require('./helpers/arena_env');

require('../arena/arena_render.js');
require('../arena/arena_controller.js');

const { Controller, Model } = arena;

function makePokemonCard(owner, types, name) {
    return {
        currentHealth: 50,
        currentStatus: [],
        faceUp: true,
        hasUsedFossilRevival: false,
        id: `TEST-PKM-${name}-${Math.random().toString(36).slice(2)}`,
        kind: 'pokemon',
        owner,
        pokemon: {
            baseAttack: 100,
            baseDefense: 100,
            baseHealth: 50,
            baseSpeed: 100,
            name,
            types
        },
        statStages: undefined
    };
}

function makeFossilCard(owner, name) {
    return makePokemonCard(owner, ['FOSSIL', 'ROCK'], name);
}

/**
 * Fresh battle state with a stubbed document, so the arrival animations take
 * their "no element found" branch instead of reaching for a real DOM.
 */
function startBattle() {
    const state = arena.state;

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
    state.arrivingCardIds = [];
    state.finished = false;
    state.isResolving = false;
    state.log = [];
    state.menuWindowOpen = false;
    state.pendingActionCardId = null;
    state.pendingPokemonReplacements = [];
    state.pendingUserCardId = null;
    state.phase = 'turn';
    state.pileWindow = null;
    state.plannedActions = { opponent: [], player: [] };
    state.rulesWindowOpen = false;
    state.turnNumber = 1;

    return state;
}

function endBattle() {
    clearTimeout(arena.state.flowTimer);
    clearTimeout(arena.state.popupTimer);
    delete globalThis.document;
}

/**
 * Seats a team the way the opening draw would - board slots first, the rest
 * face down in the Pokemon deck - and syncs the counters isPlayerDefeated()
 * reads off the player.
 */
function seatTeam(player, boardCards, deckCards = []) {
    player.board = player.board.map((slot, index) => boardCards[index] || null);
    player.pokemonDeck = deckCards.slice();
    player.knockout = [];
    player.knockoutCount = 0;
    player.initialPokemonCount = boardCards.filter(Boolean).length + deckCards.length;
    Model.updatePokemonLeft(player);
}

function boardIds(player) {
    return player.board.map(card => (card ? card.id : null));
}

function queuedFossilIds(player) {
    return Model.getRevivableFossilQueue(player).map(entry => entry.card.id);
}

before(async () => {
    await loadRealGameData();
});

test('a knocked out Pokemon records the turn it went down', () => {
    const state = startBattle();
    const player = state.players.player;
    const fossil = makeFossilCard('player', 'Fossilmon');

    try {
        seatTeam(player, [fossil, makePokemonCard('player', ['WATER'], 'Ally')], [
            makePokemonCard('player', ['GRASS'], 'Bench')
        ]);
        state.turnNumber = 7;

        Controller.knockOutPokemon('player', fossil);

        assert.equal(fossil.knockoutTurn, 7);
        assert.equal(player.knockout[0].id, fossil.id);
    } finally {
        endBattle();
    }
});

test('case 1: a Fossil sits out its own turn, then takes the next knocked out ally slot', async () => {
    const state = startBattle();
    const player = state.players.player;
    const fossil = makeFossilCard('player', 'Fossilmon');
    const ally = makePokemonCard('player', ['WATER'], 'Ally');
    const benchFirst = makePokemonCard('player', ['GRASS'], 'BenchOne');
    const benchSecond = makePokemonCard('player', ['FIRE'], 'BenchTwo');

    try {
        seatTeam(player, [fossil, ally], [benchFirst, benchSecond]);

        state.turnNumber = 1;
        Controller.knockOutPokemon('player', fossil);
        await Controller.resolvePendingPokemonReplacements();

        // Same turn: the Fossil stays in the pile and the Pokemon deck covers
        // the slot it left.
        assert.deepEqual(boardIds(player), [benchFirst.id, ally.id]);
        assert.ok(player.knockout.some(card => card.id === fossil.id));
        assert.equal(player.knockoutCount, 1);
        assert.equal(fossil.hasUsedFossilRevival, false);

        // The next turn's knockout opens the slot the Fossil claims, ahead of
        // the Pokemon still waiting in the deck.
        state.turnNumber = 2;
        Controller.knockOutPokemon('player', ally);
        await Controller.resolvePendingPokemonReplacements();

        assert.deepEqual(boardIds(player), [benchFirst.id, fossil.id]);
        assert.ok(player.pokemonDeck.some(card => card.id === benchSecond.id));
        assert.equal(player.knockout.some(card => card.id === fossil.id), false);
        assert.equal(fossil.hasUsedFossilRevival, true);
        assert.equal(Model.hasPokemonStatus(fossil, 'FATIGUE'), true);

        // Two knockouts, one of them refunded by the revival.
        assert.equal(player.knockoutCount, 1);
    } finally {
        endBattle();
    }
});

test('case 1: two Pokemon down on the same turn both draw replacements, and the Fossil returns a turn later', async () => {
    const state = startBattle();
    const player = state.players.player;
    const fossil = makeFossilCard('player', 'Fossilmon');
    const ally = makePokemonCard('player', ['WATER'], 'Ally');
    const benchFirst = makePokemonCard('player', ['GRASS'], 'BenchOne');
    const benchSecond = makePokemonCard('player', ['FIRE'], 'BenchTwo');

    try {
        seatTeam(player, [fossil, ally], [benchFirst, benchSecond]);

        state.turnNumber = 3;
        Controller.knockOutPokemon('player', fossil);
        Controller.knockOutPokemon('player', ally);
        await Controller.resolvePendingPokemonReplacements();

        // The ally's knockout landed on the Fossil's own turn, so it does not
        // hand the Fossil an early ride back - both slots draw instead.
        assert.deepEqual(boardIds(player), [benchFirst.id, benchSecond.id]);
        assert.ok(player.knockout.some(card => card.id === fossil.id));
        assert.equal(player.knockoutCount, 2);

        state.turnNumber = 4;
        Controller.knockOutPokemon('player', benchFirst);
        await Controller.resolvePendingPokemonReplacements();

        assert.deepEqual(boardIds(player), [fossil.id, benchSecond.id]);
        assert.equal(player.knockoutCount, 2);
    } finally {
        endBattle();
    }
});

test('case 2: a Fossil downed with an empty Pokemon deck revives into its own open slot one turn later', async () => {
    const state = startBattle();
    const player = state.players.player;
    const fossil = makeFossilCard('player', 'Fossilmon');
    const ally = makePokemonCard('player', ['WATER'], 'Ally');

    try {
        seatTeam(player, [fossil, ally], []);

        state.turnNumber = 1;
        Controller.knockOutPokemon('player', fossil);
        assert.equal(await Controller.resolvePendingPokemonReplacements(), false);

        // Nothing to draw and no revival yet, so the slot is simply held open.
        assert.deepEqual(boardIds(player), [null, ally.id]);
        assert.ok(player.knockout.some(card => card.id === fossil.id));
        assert.equal(Model.isPlayerDefeated(player), false);
        assert.equal(state.finished, false);

        // One turn on, with no fresh knockout to ride back in on, the Fossil
        // claims the slot that stayed open.
        state.turnNumber = 2;
        assert.equal(state.pendingPokemonReplacements.length, 0);
        await Controller.resolvePendingPokemonReplacements();

        assert.deepEqual(boardIds(player), [fossil.id, ally.id]);
        assert.equal(player.knockoutCount, 0);
        assert.equal(fossil.hasUsedFossilRevival, true);
        assert.equal(Model.hasPokemonStatus(fossil, 'FATIGUE'), true);
    } finally {
        endBattle();
    }
});

test('case 3: the last Pokemon down revives at the end of the same turn when it is a Fossil', async () => {
    const state = startBattle();
    const player = state.players.player;
    const fossil = makeFossilCard('player', 'Fossilmon');
    const ally = makePokemonCard('player', ['WATER'], 'Ally');

    try {
        seatTeam(player, [fossil, ally], []);

        // The ally goes first, leaving an empty Pokemon deck and an open slot.
        state.turnNumber = 5;
        Controller.knockOutPokemon('player', ally);
        await Controller.resolvePendingPokemonReplacements();

        assert.deepEqual(boardIds(player), [fossil.id, null]);

        // Now the Fossil is the last Pokemon down. Waiting a turn would end the
        // battle first, so it comes straight back.
        state.turnNumber = 6;
        Controller.knockOutPokemon('player', fossil);

        assert.equal(player.knockoutCount, 2);
        assert.equal(Model.isPlayerDefeated(player), false);

        await Controller.resolvePendingPokemonReplacements();

        assert.deepEqual(boardIds(player), [fossil.id, null]);
        assert.equal(player.knockoutCount, 1);
        assert.equal(state.finished, false);
        // 60% of the fixture's 50 max HP, rounded up.
        assert.equal(fossil.currentHealth, 30);
        assert.equal(Model.hasPokemonStatus(fossil, 'FATIGUE'), true);
    } finally {
        endBattle();
    }
});

test('case 3 outranks case 2: a Fossil downed alongside the team\'s last Pokemon skips the wait', async () => {
    const state = startBattle();
    const player = state.players.player;
    const fossil = makeFossilCard('player', 'Fossilmon');
    const ally = makePokemonCard('player', ['WATER'], 'Ally');

    try {
        seatTeam(player, [fossil, ally], []);

        state.turnNumber = 2;
        Controller.knockOutPokemon('player', fossil);
        Controller.knockOutPokemon('player', ally);

        // Every Pokemon is down, but the pending revival keeps the knockout
        // limit from ending the battle.
        assert.equal(player.knockoutCount, 2);
        assert.equal(Model.isPlayerDefeated(player), false);

        await Controller.resolvePendingPokemonReplacements();

        assert.deepEqual(boardIds(player), [fossil.id, null]);
        assert.equal(player.knockoutCount, 1);
        assert.equal(state.finished, false);
    } finally {
        endBattle();
    }
});

test('waiting Fossils revive first knocked out first', async () => {
    const state = startBattle();
    const player = state.players.player;
    const firstFossil = makeFossilCard('player', 'FossilOne');
    const secondFossil = makeFossilCard('player', 'FossilTwo');
    const benchFirst = makePokemonCard('player', ['GRASS'], 'BenchOne');
    const benchSecond = makePokemonCard('player', ['FIRE'], 'BenchTwo');

    try {
        seatTeam(player, [firstFossil, secondFossil], [benchFirst, benchSecond]);

        state.turnNumber = 1;
        Controller.knockOutPokemon('player', firstFossil);
        Controller.knockOutPokemon('player', secondFossil);
        await Controller.resolvePendingPokemonReplacements();

        // Both went down on the same turn, so both wait and both slots draw.
        assert.deepEqual(boardIds(player), [benchFirst.id, benchSecond.id]);
        assert.equal(firstFossil.knockoutTurn, 1);
        assert.equal(secondFossil.knockoutTurn, 1);
        assert.deepEqual(queuedFossilIds(player), []);

        // From the next turn the queue offers them in knockout order, not pile
        // order - the pile is newest first.
        state.turnNumber = 2;
        assert.equal(player.knockout[0].id, secondFossil.id);
        assert.deepEqual(queuedFossilIds(player), [firstFossil.id, secondFossil.id]);

        Controller.knockOutPokemon('player', benchFirst);
        await Controller.resolvePendingPokemonReplacements();

        assert.deepEqual(boardIds(player), [firstFossil.id, benchSecond.id]);
        assert.deepEqual(queuedFossilIds(player), [secondFossil.id]);

        state.turnNumber = 3;
        Controller.knockOutPokemon('player', benchSecond);
        await Controller.resolvePendingPokemonReplacements();

        assert.deepEqual(boardIds(player), [firstFossil.id, secondFossil.id]);
        assert.deepEqual(queuedFossilIds(player), []);
        assert.equal(player.knockoutCount, 2);
    } finally {
        endBattle();
    }
});

test('a knockout at the limit still queues a replacement when a Fossil can revive', () => {
    const state = startBattle();
    const player = state.players.player;
    const fossil = makeFossilCard('player', 'Fossilmon');
    const victim = makePokemonCard('player', ['WATER'], 'Victim');
    const secondVictim = makePokemonCard('player', ['WATER'], 'SecondVictim');

    try {
        seatTeam(player, [victim, secondVictim], []);
        player.knockout = [fossil];
        player.initialPokemonCount = 3;
        player.knockoutCount = 1;
        fossil.knockoutTurn = 1;
        state.turnNumber = 2;

        Controller.knockOutPokemon('player', victim);

        // The knockout reaches the limit, but the revivable Fossil defers defeat
        // and the vacated slot still gets an end-of-turn replacement queued.
        assert.equal(player.knockoutCount, 2);
        assert.equal(Model.isPlayerDefeated(player), false);
        assert.ok(state.pendingPokemonReplacements.some(replacement => (
            replacement.ownerId === 'player' && replacement.slotIndex === 0
        )));

        // Once the Fossil's revival is spent, the next knockout is a real defeat
        // and no replacement is queued.
        state.pendingPokemonReplacements = [];
        fossil.hasUsedFossilRevival = true;

        Controller.knockOutPokemon('player', secondVictim);

        assert.equal(Model.findRevivableFossilIndex(player), -1);
        assert.equal(Model.isPlayerDefeated(player), true);
        assert.equal(state.pendingPokemonReplacements.length, 0);
    } finally {
        endBattle();
    }
});

test('the revival queue holds a Fossil for a turn, ignores spent revivals, and skips the wait when nothing is left', () => {
    const state = arena.state;
    const player = Model.createPlayer('player', 'You');
    const fossil = makeFossilCard('player', 'Fossilmon');
    const ally = makePokemonCard('player', ['WATER'], 'Ally');

    player.board = player.board.map(() => null);
    player.board[0] = ally;
    player.pokemonDeck = [];
    player.knockout = [fossil];
    player.initialPokemonCount = 2;
    player.knockoutCount = 1;
    fossil.knockoutTurn = 4;

    // Same turn as the knockout: not ready, but still counted as pending so the
    // knockout limit cannot end the battle out from under it.
    state.turnNumber = 4;
    assert.equal(Model.findRevivableFossilIndex(player), -1);
    assert.equal(Model.countPendingFossilRevivals(player), 1);

    state.turnNumber = 5;
    assert.equal(Model.findRevivableFossilIndex(player), 0);

    // Back to the knockout turn, with nothing left on the board or in the deck:
    // the wait is skipped rather than losing the battle.
    state.turnNumber = 4;
    player.board[0] = null;
    player.knockoutCount = 2;
    assert.equal(Model.findRevivableFossilIndex(player), 0);
    assert.equal(Model.isPlayerDefeated(player), false);

    // A spent revival never revives and never defers defeat.
    fossil.hasUsedFossilRevival = true;
    assert.equal(Model.findRevivableFossilIndex(player), -1);
    assert.equal(Model.countPendingFossilRevivals(player), 0);
    assert.equal(Model.isPlayerDefeated(player), true);
});
