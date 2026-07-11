'use strict';

const { before, test } = require('node:test');
const assert = require('node:assert/strict');
const { arena, loadRealGameData, storageMap } = require('./helpers/arena_env');

const { Constants, Model } = arena;

function makePokemonCard(types, overrides = {}) {
    return {
        currentHealth: 50,
        currentStatus: [],
        faceUp: true,
        id: `TEST-PKM-${Math.random().toString(36).slice(2)}`,
        kind: 'pokemon',
        owner: 'player',
        pokemon: {
            baseAttack: 100,
            baseDefense: 100,
            baseHealth: 50,
            baseSpeed: 100,
            name: 'Testmon',
            types,
            ...overrides
        },
        statChanges: [],
        statStages: undefined
    };
}

function makeAttackCard(types, fullTypeRequirements) {
    return {
        attack: {
            basePower: 50,
            full_type_requirements: fullTypeRequirements,
            name: 'Test Attack',
            types
        },
        faceUp: true,
        id: 'TEST-ATK-1',
        kind: 'attack',
        owner: 'player'
    };
}

before(async () => {
    await loadRealGameData();
});

test('default decks match Constants-driven composition', () => {
    const player = Model.createPlayer('player', 'You');
    const deckDefinition = Constants.DEFAULT_BATTLE_DECK;

    assert.equal(player.handSize, Constants.HAND_SIZE);
    assert.equal(player.pokemonDeck.length, deckDefinition.pokemon.length);
    assert.equal(player.pokemonLeft, deckDefinition.pokemon.length);

    const attackCards = player.deck.filter(Model.isAttackCard);
    const itemCards = player.deck.filter(Model.isItemCard);

    // Mirror getSelectedAttacksForDeck: a selection only enters the deck if
    // the paired species can use it (unusable pairings are silently dropped).
    const speciesByName = new Map(arena.GameData.pokemon.map(record => [record.name, record]));
    const attacksByName = new Map(arena.GameData.attacks.map(record => [record.name, record]));
    const selectedAttackNames = deckDefinition.pokemon.flatMap(entry => {
        const species = speciesByName.get(entry.name);
        return entry.attacks.filter(attackName => {
            const attack = attacksByName.get(attackName);
            return attack && Model.pokemonCanUseAttack(
                { kind: 'pokemon', pokemon: species },
                { kind: 'attack', attack }
            );
        });
    });

    assert.equal(attackCards.length, selectedAttackNames.length * Constants.ATTACK_COPIES_PER_MAIN_DECK);
    assert.equal(itemCards.length, deckDefinition.items.length);
    assert.ok(itemCards.length <= Constants.ITEM_CARDS_PER_MAIN_DECK);
    assert.equal(player.deck.length, attackCards.length + itemCards.length);

    const copiesByName = new Map();
    attackCards.forEach(card => {
        copiesByName.set(card.attack.name, (copiesByName.get(card.attack.name) || 0) + 1);
    });
    [...new Set(selectedAttackNames)].forEach(name => {
        assert.equal(copiesByName.get(name), Constants.ATTACK_COPIES_PER_MAIN_DECK, `${name} copies`);
    });
});

test('drawCardsUpToHandSize fills the hand and recycles discard when empty', () => {
    const player = Model.createPlayer('player', 'You');
    const drawn = Model.drawCardsUpToHandSize(player);

    assert.equal(drawn.length, Constants.HAND_SIZE);
    assert.equal(player.hand.length, Constants.HAND_SIZE);

    // Empty the deck into the discard pile; the next draw must recycle it.
    player.discard.push(...player.deck.splice(0));
    player.hand.length = 0;
    const redrawn = Model.drawCardsUpToHandSize(player);

    assert.equal(redrawn.length, Constants.HAND_SIZE);
    assert.equal(player.discard.length, 0);
});

test('shuffle preserves the multiset and does not mutate its input', () => {
    const original = Array.from({ length: 30 }, (_, index) => ({ id: index % 7 }));
    const snapshot = [...original];
    const shuffled = Model.shuffle(original);

    assert.notEqual(shuffled, original);
    assert.deepEqual(original, snapshot);
    assert.equal(shuffled.length, original.length);

    const countIds = cards => cards.reduce((counts, card) => (
        counts.set(card.id, (counts.get(card.id) || 0) + 1), counts
    ), new Map());
    assert.deepEqual(countIds(shuffled), countIds(original));
});

test('pokemonCanUseAttack matches any shared type by default', () => {
    const waterMonster = makePokemonCard(['WATER', 'MONSTER']);

    assert.equal(Model.pokemonCanUseAttack(waterMonster, makeAttackCard(['MONSTER', 'DARK'], false)), true);
    assert.equal(Model.pokemonCanUseAttack(waterMonster, makeAttackCard(['FIRE'], false)), false);
    assert.equal(Model.pokemonCanUseAttack(waterMonster, makeAttackCard([], false)), true, 'typeless attacks are universal');
});

test('pokemonCanUseAttack with full_type_requirements needs every attack type', () => {
    const attack = makeAttackCard(['HUMAN', 'GHOST'], true);

    assert.equal(Model.pokemonCanUseAttack(makePokemonCard(['GHOST', 'HUMAN']), attack), true);
    assert.equal(Model.pokemonCanUseAttack(makePokemonCard(['GHOST']), attack), false);
});

test('applyStatChange steps one stage and clamps at +/-6', () => {
    const card = makePokemonCard(['WATER']);

    const firstChange = Model.applyStatChange(card, 'ATTACK_UP');
    assert.deepEqual(
        { changed: firstChange.changed, nextStage: firstChange.nextStage, stat: firstChange.stat },
        { changed: true, nextStage: 1, stat: 'attack' }
    );

    for (let step = 0; step < 10; step += 1) Model.applyStatChange(card, 'ATTACK_UP');
    assert.equal(Model.getPokemonStatStage(card, 'attack'), 6);
    assert.equal(Model.applyStatChange(card, 'ATTACK_UP').changed, false);

    for (let step = 0; step < 20; step += 1) Model.applyStatChange(card, 'DEFENSE_DOWN');
    assert.equal(Model.getPokemonStatStage(card, 'defense'), -6);
});

test('stat stages multiply effective stats per the stage table', () => {
    const card = makePokemonCard(['WATER']);

    assert.equal(Model.getPokemonEffectiveStat(card, 'attack'), 100);
    Model.applyStatChange(card, 'ATTACK_UP');
    assert.equal(Model.getPokemonEffectiveStat(card, 'attack'), 150);
    Model.applyStatChange(card, 'ATTACK_UP');
    assert.equal(Model.getPokemonEffectiveStat(card, 'attack'), 200);
    Model.applyStatChange(card, 'SPEED_DOWN');
    assert.equal(Model.getPokemonEffectiveStat(card, 'speed'), 80);
});

test('applyStatus adds one persistent status and blocks a second', () => {
    const card = makePokemonCard(['WATER']);

    const applied = Model.applyStatus(card, 'BURN');
    assert.equal(applied.added, true);
    assert.equal(Model.hasPokemonStatus(card, 'BURN'), true);

    const blocked = Model.applyStatus(card, 'POISON');
    assert.equal(blocked.added, false);
    assert.equal(blocked.blocked, true);
    assert.equal(Model.hasPokemonStatus(card, 'POISON'), false);

    Model.removePokemonStatus(card, 'BURN');
    assert.equal(Model.hasPokemonStatus(card, 'BURN'), false);
});

test('status stat multipliers: BURN halves attack, PARALYSIS halves speed, FIGHTING resists', () => {
    const burned = makePokemonCard(['WATER']);
    Model.applyStatus(burned, 'BURN');
    assert.equal(Model.getPokemonStatusMultiplier(burned, 'attack'), 0.5);
    assert.equal(Model.getPokemonEffectiveStat(burned, 'attack'), 50);

    const paralyzed = makePokemonCard(['WATER']);
    Model.applyStatus(paralyzed, 'PARALYSIS');
    assert.equal(Model.getPokemonStatusMultiplier(paralyzed, 'speed'), 0.5);

    // FIGHTING types ignore the BURN attack penalty and rage instead.
    const fighter = makePokemonCard(['FIGHTING']);
    Model.applyStatus(fighter, 'BURN');
    assert.equal(Model.getPokemonStatusMultiplier(fighter, 'attack'), 1.5);
});

test('artificial attacks are detected and skip the attack limit check shape', () => {
    const artificial = makeAttackCard(['ARTIFICIAL'], false);

    assert.equal(Model.isArtificialAttackCard(artificial), true);
    assert.equal(Model.isArtificialAttackCard(makeAttackCard(['WATER'], false)), false);
});

test('saveBattleState/restoreSavedBattleState round-trips and rolls back unsafe phases', () => {
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

    assert.equal(Model.saveBattleState(), true);

    state.turnNumber = 99;
    assert.equal(Model.restoreSavedBattleState(), true);
    assert.equal(state.turnNumber, 3);
    assert.equal(state.players.player.hand.length, Constants.HAND_SIZE);

    // A save captured mid-resolution must reopen as the player's turn.
    const storageKey = [...storageMap.keys()].find(key => storageMap.get(key).includes('"battle"'));
    assert.ok(storageKey, 'battle save present in storage');
    const savedPayload = JSON.parse(storageMap.get(storageKey));
    savedPayload.battle.phase = 'resolving';
    savedPayload.battle.currentPlayer = 'opponent';
    storageMap.set(storageKey, JSON.stringify(savedPayload));

    assert.equal(Model.restoreSavedBattleState(), true);
    assert.equal(state.phase, 'turn');
    assert.equal(state.currentPlayer, 'player');

    assert.equal(Model.clearSavedBattleState(), true);
    assert.equal(storageMap.has(storageKey), false);
});
