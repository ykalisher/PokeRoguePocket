'use strict';

const { before, beforeEach, afterEach, test } = require('node:test');
const assert = require('node:assert/strict');
const { arena, loadRealGameData } = require('./helpers/arena_env');

require('../arena/arena_render.js');
require('../arena/arena_controller.js');

const { Constants, Controller, Model } = arena;

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

function makeAttackCard(owner, { status = [], statChanges = [] } = {}) {
    return {
        attack: {
            basePower: 50,
            full_type_requirements: false,
            name: 'Test Attack',
            status,
            statChanges,
            target: 'OPPONENT',
            types: ['WATER']
        },
        faceUp: true,
        id: `TEST-ATK-${Math.random().toString(36).slice(2)}`,
        kind: 'attack',
        owner
    };
}

function makeEffectBoostItemCard(owner) {
    const record = arena.GameData.items.find(item => item.status.includes('EFFECT_BOOST'));

    return {
        faceUp: true,
        id: `TEST-ITEM-${owner}-${Math.random().toString(36).slice(2)}`,
        item: record,
        kind: 'item',
        owner
    };
}

// A headless battle scaffold: stubbed DOM so the fly-out/animation helpers take
// their "no element" branch instead of throwing, and two empty players.
function setupBattle() {
    globalThis.document = {
        body: { appendChild: () => {} },
        querySelector: () => null
    };
    arena.state.elements = {
        board: { getBoundingClientRect: () => ({ height: 100, left: 0, top: 0, width: 100 }) },
        popup: { hidden: false }
    };
    arena.state.players = {
        opponent: Model.createPlayer('opponent', 'Rival'),
        player: Model.createPlayer('player', 'You')
    };
    arena.state.phase = 'turn';
    arena.state.currentPlayer = 'player';
    arena.state.isResolving = false;
    arena.state.finished = false;
}

before(async () => {
    await loadRealGameData();
});

let realRandom;

beforeEach(() => {
    realRandom = Math.random;
});

afterEach(() => {
    Math.random = realRandom;
    delete globalThis.document;
});

test('the Effect Amplifier item is registered as a standalone (non-gem) SIDE item', () => {
    const record = arena.GameData.items.find(item => item.name === 'Effect Amplifier');

    assert.ok(record, 'Effect Amplifier missing from item data');
    assert.equal(record.target, 'SIDE');
    assert.deepEqual(record.status, ['EFFECT_BOOST']);

    const card = makeEffectBoostItemCard('player');

    assert.equal(Model.isEffectBoostItemCard(card), true);
    // It must NOT be treated as a dragon gem.
    assert.equal(Model.isDragonGemItemCard(card), false);
});

test('playing the Effect Amplifier sets the side boost flag and discards the card', async () => {
    setupBattle();

    const player = arena.state.players.player;
    const itemCard = makeEffectBoostItemCard('player');

    player.hand = [itemCard];

    assert.equal(Model.hasEffectBoost('player'), false);

    const played = await Controller.useEffectBoostItemFromHand('player', itemCard.id);

    assert.equal(played, true);
    assert.equal(Model.hasEffectBoost('player'), true);
    // Standalone item discards normally (unlike gems, which are removed from play).
    assert.ok(player.discard.some(card => card.id === itemCard.id));
    assert.ok(!player.removed.some(card => card.id === itemCard.id));
    assert.ok(!player.hand.some(card => card.id === itemCard.id));
    // The opponent side is unaffected.
    assert.equal(Model.hasEffectBoost('opponent'), false);
});

test('effect boost doubles a damaging attack secondary-status trigger chance', () => {
    setupBattle();

    // Build cards with the real RNG so their ids stay distinct before we pin
    // Math.random for the trigger rolls below.
    const attackCard = makeAttackCard('player', { status: ['BURN'] });
    const unboostedTarget = makePokemonCard('opponent', ['WATER']);
    const boostedTarget = makePokemonCard('opponent', ['WATER']);
    arena.state.players.opponent.board[0] = unboostedTarget;
    arena.state.players.opponent.board[1] = boostedTarget;

    // STATUS_TRIGGER_CHANCE is 1/3 (~0.333); boosted it is ~0.667. A roll of 0.5
    // fails unboosted (>= 0.333) but succeeds boosted (< 0.667).
    Math.random = () => 0.5;
    assert.ok(0.5 >= Constants.STATUS_TRIGGER_CHANCE && 0.5 < Constants.STATUS_TRIGGER_CHANCE * 2);

    const unboosted = Controller.maybeApplyAttackStatuses(
        attackCard, [{ owner: 'opponent', card: unboostedTarget }], true, [], false
    );
    const boosted = Controller.maybeApplyAttackStatuses(
        attackCard, [{ owner: 'opponent', card: boostedTarget }], true, [], true
    );

    assert.equal(unboosted, false, 'status should not trigger unboosted at roll 0.5');
    assert.equal(boosted, true, 'status should trigger under boost at roll 0.5');
    assert.ok(Model.hasPokemonStatus(boostedTarget, 'BURN'));
    assert.ok(!Model.hasPokemonStatus(unboostedTarget, 'BURN'));
});

test('effect boost doubles a damaging attack stat-change trigger chance', () => {
    setupBattle();

    const attackCard = makeAttackCard('player', { statChanges: ['ATTACK_DOWN'] });
    const unboostedTarget = makePokemonCard('opponent', ['WATER']);
    const boostedTarget = makePokemonCard('opponent', ['WATER']);
    arena.state.players.opponent.board[0] = unboostedTarget;
    arena.state.players.opponent.board[1] = boostedTarget;

    Math.random = () => 0.5;
    assert.ok(0.5 >= Constants.STAT_CHANGE_TRIGGER_CHANCE && 0.5 < Constants.STAT_CHANGE_TRIGGER_CHANCE * 2);

    const unboosted = Controller.maybeApplyAttackStatChanges(
        attackCard, [{ owner: 'opponent', card: unboostedTarget }], true, Constants.STAT_CHANGE_TRIGGER_CHANCE, false
    );
    const boosted = Controller.maybeApplyAttackStatChanges(
        attackCard, [{ owner: 'opponent', card: boostedTarget }], true, Constants.STAT_CHANGE_TRIGGER_CHANCE, true
    );

    assert.equal(unboosted, false, 'stat change should not trigger unboosted at roll 0.5');
    assert.equal(boosted, true, 'stat change should trigger under boost at roll 0.5');
});

test('effect boost biases multi-attack toward more hits', () => {
    const samples = 8000;
    let unboostedSum = 0;
    let boostedSum = 0;
    let unboostedHigh = 0;
    let boostedHigh = 0;

    for (let i = 0; i < samples; i += 1) {
        const unboostedHits = Controller.getRandomMultiAttackHitCount(false);
        const boostedHits = Controller.getRandomMultiAttackHitCount(true);

        // Every roll stays within the configured hit bounds regardless of boost.
        assert.ok(unboostedHits >= Constants.MULTI_ATTACK_MIN_HITS && unboostedHits <= Constants.MULTI_ATTACK_MAX_HITS);
        assert.ok(boostedHits >= Constants.MULTI_ATTACK_MIN_HITS && boostedHits <= Constants.MULTI_ATTACK_MAX_HITS);

        unboostedSum += unboostedHits;
        boostedSum += boostedHits;
        if (unboostedHits >= 4) unboostedHigh += 1;
        if (boostedHits >= 4) boostedHigh += 1;
    }

    const unboostedAvg = unboostedSum / samples;
    const boostedAvg = boostedSum / samples;

    assert.ok(boostedAvg > unboostedAvg + 0.5, `boosted avg ${boostedAvg} should clearly exceed unboosted avg ${unboostedAvg}`);
    assert.ok(boostedAvg > 4, `boosted avg ${boostedAvg} should favor 4-5+ hits`);
    assert.ok(unboostedAvg < 3.6, `unboosted avg ${unboostedAvg} should lean toward 2-3 hits`);
    assert.ok(boostedHigh > unboostedHigh, 'boosted rolls should hit 4+ more often than unboosted');
});
