'use strict';

/**
 * Vitamins: permanent, per-instance stat boosts (Protein/Iron/Carbos).
 *
 * The whole point of the feature is that the boost belongs to ONE CARD, not to
 * a species — two Blastoise must be able to differ — and that it survives every
 * seam where the engine destroys and rebuilds a Pokemon card. Those seams are
 * what these tests actually guard.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

// locations.js must load before run_state.js: the mega helpers reach for
// global.PokeLocations at call time. event_effects.js supplies the replace/
// trade/duplicate paths and the boost-selected-pokemon effect.
const { arena, loadRealGameData } = require('./helpers/arena_env');
require('../map/locations');
require('../map/run_state');
require('../map/event_effects');

const { pick } = require('./helpers/pick');

const R = globalThis.PokeRun;
const E = globalThis.PokeEvents;
const model = arena.Model;

const PROTEIN = { name: 'Test Protein', vitaminStat: 'attack', vitaminAmount: 5, imagePath: 'assets/items/PROTEIN.svg' };
const CARBOS = { name: 'Test Carbos', vitaminStat: 'speed', vitaminAmount: 3, imagePath: 'assets/items/CARBOS.svg' };

function makePokemon(name, id, types, extra) {
    return Object.assign({
        name,
        id,
        type1: types[0] || 'NONE',
        type2: types[1] || 'NONE',
        type3: types[2] || 'NONE',
        baseHealth: 100,
        baseAttack: 40,
        baseDefense: 30,
        baseSpeed: 20
    }, extra || {});
}

const SPECIES = makePokemon('Testoise', '7101', ['WATER']);
const OTHER_SPECIES = makePokemon('Testasaur', '7102', ['GRASS']);
const BABY = makePokemon('Baby Test', '9101', ['WATER', 'BABY'], { evolvesInto: 'Mega Testoise' });
const MEGA = makePokemon('Mega Testoise', '8101', ['WATER', 'MONSTER']);

function fixtureGameData() {
    return {
        pokemon: [SPECIES, OTHER_SPECIES, BABY, MEGA],
        attacks: [],
        items: [PROTEIN, CARBOS]
    };
}

let cardCounter = 0;

function card(species) {
    cardCounter += 1;
    return R.createPokemonCard(species, 'player', `test-pokemon-${cardCounter}`);
}

function fixtureRun(pokemonCards) {
    return R.createRunState({
        area: { nodes: [{ id: 'start' }], edges: [] },
        collections: {
            pokemon: pokemonCards,
            bench: { pokemon: [], actions: [] },
            actions: []
        }
    });
}

// --- the core promise: one instance, not the species ----------------------

test('a vitamin boosts only the card it was given to, not others of the same species', () => {
    const boosted = card(SPECIES);
    const untouched = card(SPECIES);

    model.applyVitaminToCard(boosted, PROTEIN);

    assert.equal(model.getPokemonBaseStat(boosted, 'attack'), SPECIES.baseAttack + 5);
    assert.equal(model.getPokemonBaseStat(untouched, 'attack'), SPECIES.baseAttack,
        'the second card of the same species must be unaffected');
    assert.equal(SPECIES.baseAttack, 40, 'the shared species record must never be mutated');
});

test('vitamins stack without a cap and only on their own stat', () => {
    const target = card(SPECIES);

    model.applyVitaminToCard(target, PROTEIN);
    model.applyVitaminToCard(target, PROTEIN);
    model.applyVitaminToCard(target, CARBOS);

    assert.equal(model.getPokemonStatBoost(target, 'attack'), 10);
    assert.equal(model.getPokemonStatBoost(target, 'speed'), 3);
    assert.equal(model.getPokemonStatBoost(target, 'defense'), 0);
    assert.equal(model.getPokemonBaseStat(target, 'defense'), SPECIES.baseDefense);
});

test('getPokemonVitamins reports every vitamin in the order it was given', () => {
    const target = card(SPECIES);

    model.applyVitaminToCard(target, PROTEIN);
    model.applyVitaminToCard(target, CARBOS);

    assert.deepEqual(model.getPokemonVitamins(target).map(vitamin => vitamin.name),
        [PROTEIN.name, CARBOS.name]);
    assert.deepEqual(model.getPokemonVitamins(target).map(vitamin => vitamin.stat),
        ['attack', 'speed']);
});

test('applyVitaminToCard rejects non-vitamin items and non-Pokemon cards', () => {
    const target = card(SPECIES);

    assert.equal(model.applyVitaminToCard(target, { name: 'Sitrus Berry' }), null);
    assert.equal(model.applyVitaminToCard(target, { name: 'Bad', vitaminStat: 'luck' }), null);
    assert.equal(model.applyVitaminToCard({ kind: 'attack' }, PROTEIN), null);
    assert.equal(model.getPokemonVitamins(target).length, 0);
});

test('a missing vitaminAmount falls back to the default dose', () => {
    const target = card(SPECIES);

    const applied = model.applyVitaminToCard(target, { name: 'Doseless', vitaminStat: 'defense' });

    assert.equal(applied.amount, 5);
    assert.equal(model.getPokemonStatBoost(target, 'defense'), 5);
});

// --- the boost has to actually reach the battle math ----------------------

test('the boost flows into the effective stat through stage and status multipliers', () => {
    const target = card(SPECIES);

    model.applyVitaminToCard(target, PROTEIN);
    assert.equal(model.getPokemonEffectiveStat(target, 'attack'), 45);

    // One +1 attack stage is x1.5, and it must multiply the boosted base.
    model.applyStatChange(target, 'ATTACK_UP');
    assert.equal(model.getPokemonEffectiveStat(target, 'attack'), Math.round(45 * 1.5));
});

test('clearing stat stages leaves the permanent boost in place', () => {
    const target = card(SPECIES);

    model.applyVitaminToCard(target, PROTEIN);
    model.applyStatChange(target, 'ATTACK_UP');
    model.clearPokemonStatChanges(target);

    assert.equal(model.getPokemonBaseStat(target, 'attack'), 45,
        'stages are transient, vitamins are not');
    assert.equal(model.getPokemonEffectiveStat(target, 'attack'), 45);
});

test('speed ordering reads the boosted stat', () => {
    const slow = card(SPECIES);
    const fast = card(SPECIES);

    assert.equal(model.getPokemonSpeed(slow), model.getPokemonSpeed(fast));

    model.applyVitaminToCard(fast, CARBOS);

    assert.ok(model.getPokemonSpeed(fast) > model.getPokemonSpeed(slow));
});

// --- the seams that destroy and rebuild a card ----------------------------

test('the boost survives the baby -> mega cutscene', () => {
    const gameData = fixtureGameData();
    const baby = card(BABY);
    const run = fixtureRun([baby]);

    model.applyVitaminToCard(baby, PROTEIN);

    const pending = R.getPendingMegaEvolutions(run, gameData);
    R.applyMegaEvolutions(run, pending);

    const mega = run.collections.pokemon[0];

    assert.equal(mega.pokemon.name, 'Mega Testoise');
    assert.notEqual(mega.id, baby.id, 'mega evolution mints a fresh card');
    assert.equal(model.getPokemonStatBoost(mega, 'attack'), 5);
    assert.equal(model.getPokemonBaseStat(mega, 'attack'), MEGA.baseAttack + 5);
});

test('the boost survives a mega-stone replace-selected-card event', () => {
    const gameData = fixtureGameData();
    const target = card(SPECIES);
    const run = fixtureRun([target]);

    model.applyVitaminToCard(target, PROTEIN);

    E.applyEffects(run, [{
        type: 'replace-selected-card',
        selectionId: 'target',
        replacement: { cardKind: 'pokemon', name: 'Mega Testoise' }
    }], { target: target.id }, { gameData, runStore: R });

    const evolved = run.collections.pokemon[0];

    assert.equal(evolved.pokemon.name, 'Mega Testoise');
    assert.equal(model.getPokemonStatBoost(evolved, 'attack'), 5,
        'a mega stone must carry the vitamins over');
});

test('a trade does NOT carry the boost to the traded-for Pokemon', () => {
    const gameData = fixtureGameData();
    const target = card(SPECIES);
    const run = fixtureRun([target]);

    model.applyVitaminToCard(target, PROTEIN);

    E.applyEffects(run, [{
        type: 'trade-selected-pokemon',
        selectionId: 'target',
        replacement: { name: 'Testasaur' }
    }], { target: target.id }, { gameData, runStore: R });

    const traded = run.collections.pokemon[0];

    assert.equal(traded.pokemon.name, 'Testasaur');
    assert.equal(model.getPokemonStatBoost(traded, 'attack'), 0,
        'trading away a Pokemon must not launder its vitamins onto the new one');
});

test('duplicate-selected-card copies the boost onto the clone', () => {
    const gameData = fixtureGameData();
    const target = card(SPECIES);
    const run = fixtureRun([target]);

    model.applyVitaminToCard(target, PROTEIN);

    E.applyEffects(run, [{ type: 'duplicate-selected-card', selectionId: 'target' }],
        { target: target.id }, { gameData, runStore: R });

    const clone = run.collections.pokemon.find(entry => entry.id !== target.id);

    assert.ok(clone, 'expected a duplicated card');
    assert.equal(model.getPokemonStatBoost(clone, 'attack'), 5);

    // Independent copies: boosting the clone must not touch the original.
    model.applyVitaminToCard(clone, PROTEIN);
    assert.equal(model.getPokemonStatBoost(clone, 'attack'), 10);
    assert.equal(model.getPokemonStatBoost(target, 'attack'), 5);
});

test('the boost-selected-pokemon effect applies the named vitamin to the picked card', () => {
    const gameData = fixtureGameData();
    const target = card(SPECIES);
    const bystander = card(SPECIES);
    const run = fixtureRun([target, bystander]);

    const summary = E.applyEffects(run, [{
        type: 'boost-selected-pokemon',
        selectionId: 'target',
        item: PROTEIN.name
    }], { target: target.id }, { gameData, runStore: R });

    assert.equal(model.getPokemonStatBoost(target, 'attack'), 5);
    assert.equal(model.getPokemonStatBoost(bystander, 'attack'), 0);
    assert.ok(summary.join(' ').includes('Attack'), 'the summary should name the stat raised');
});

test('boost-selected-pokemon is inert without a resolvable item or selection', () => {
    const gameData = fixtureGameData();
    const target = card(SPECIES);
    const run = fixtureRun([target]);

    assert.deepEqual(E.applyEffects(run, [{ type: 'boost-selected-pokemon', selectionId: 'target', item: 'No Such Item' }],
        { target: target.id }, { gameData, runStore: R }), []);
    assert.deepEqual(E.applyEffects(run, [{ type: 'boost-selected-pokemon', selectionId: 'target', item: PROTEIN.name }],
        {}, { gameData, runStore: R }), []);
    assert.equal(model.getPokemonStatBoost(target, 'attack'), 0);
});

// --- persistence and the run -> battle handoff ----------------------------

test('the boost survives a run save/load round-trip', () => {
    const target = card(SPECIES);
    const run = fixtureRun([target]);

    model.applyVitaminToCard(target, PROTEIN);
    R.saveRunState(run);

    const restored = R.loadRunState();
    const restoredCard = restored.collections.pokemon[0];

    assert.equal(model.getPokemonStatBoost(restoredCard, 'attack'), 5);
    assert.equal(model.getPokemonVitamins(restoredCard)[0].name, PROTEIN.name);

    R.clearRunState();
});

test('the run -> battle handoff carries the boost into the battle deck', async () => {
    const gameData = await loadRealGameData();
    const species = pick(gameData.pokemon,
        record => Number(record.baseAttack) > 0 && !record.eventOnly,
        'a Pokemon with a positive base attack');

    const boosted = R.createPokemonCard(species, 'player', 'run-pokemon-boosted');
    const plain = R.createPokemonCard(species, 'player', 'run-pokemon-plain');

    model.applyVitaminToCard(boosted, PROTEIN);

    arena.BattleDecks = {
        opponent: { actionCards: [], exactCards: true, pokemonCards: [plain] },
        player: { actionCards: [], exactCards: true, pokemonCards: [boosted, plain] }
    };

    const battleCards = model.createPlayer('player', 'You').pokemonDeck;

    // The deck is shuffled, so match on the boost rather than on position.
    const boostedInBattle = battleCards.filter(entry => model.getPokemonStatBoost(entry, 'attack') === 5);
    const plainInBattle = battleCards.filter(entry => model.getPokemonStatBoost(entry, 'attack') === 0);

    assert.equal(boostedInBattle.length, 1, 'exactly one battle card should carry the boost');
    assert.equal(plainInBattle.length, 1, 'the unboosted copy must stay unboosted');
    assert.equal(
        model.getPokemonBaseStat(boostedInBattle[0], 'attack'),
        model.getPokemonBaseStat(plainInBattle[0], 'attack') + 5
    );

    arena.BattleDecks = null;
});

// --- the live data actually wires up -------------------------------------

test('every vitamin in items.json is well-formed and reachable', async () => {
    const gameData = await loadRealGameData();
    const vitamins = gameData.items.filter(model.isVitaminItem);

    assert.ok(vitamins.length > 0, 'expected at least one vitamin item in items.json');

    const stats = new Set();

    vitamins.forEach(item => {
        assert.ok(model.getVitaminAmount(item) > 0, `${item.name}: vitamin dose must be positive`);
        assert.ok(item.imagePath, `${item.name}: a vitamin needs an icon for its card token`);

        const target = R.createPokemonCard(gameData.pokemon[0], 'player', `vitamin-check-${item.name}`);
        const applied = model.applyVitaminToCard(target, item);

        assert.ok(applied, `${item.name}: should apply to a Pokemon card`);
        assert.equal(model.getPokemonStatBoost(target, item.vitaminStat), applied.amount);

        stats.add(item.vitaminStat);
    });

    // Every stat a vitamin can raise must be one the battle math understands.
    stats.forEach(stat => {
        const target = R.createPokemonCard(gameData.pokemon[0], 'player', `stat-check-${stat}`);

        assert.ok(model.getPokemonBaseStat(target, stat) > 0, `${stat} is not a real battle stat`);
    });
});

test('an event grants each vitamin through boost-selected-pokemon', async () => {
    const gameData = await loadRealGameData();
    const vitaminNames = new Set(gameData.items.filter(model.isVitaminItem).map(item => item.name));

    const boostEffects = gameData.events
        .flatMap(event => [
            ...(Array.isArray(event.effects) ? event.effects : []),
            ...(Array.isArray(event.rewardEffects) ? event.rewardEffects : []),
            ...(Array.isArray(event.choices) ? event.choices : [])
                .flatMap(choice => (Array.isArray(choice.effects) ? choice.effects : []))
        ])
        .filter(effect => effect && effect.type === 'boost-selected-pokemon');

    assert.ok(boostEffects.length > 0, 'expected at least one vitamin event');

    boostEffects.forEach(effect => {
        assert.ok(vitaminNames.has(effect.item), `${effect.item} is not a vitamin item`);
    });

    // Each such event must pair its effect with a picker requirement, or the
    // player would never get to choose a target.
    gameData.events.forEach(event => {
        const effects = Array.isArray(event.effects) ? event.effects : [];

        if (!effects.some(effect => effect && effect.type === 'boost-selected-pokemon')) return;

        const requires = Array.isArray(event.requires) ? event.requires : [];

        effects
            .filter(effect => effect.type === 'boost-selected-pokemon')
            .forEach(effect => {
                assert.ok(requires.some(requirement => requirement.id === effect.selectionId),
                    `${event.id}: selectionId ${effect.selectionId} has no matching requirement`);
            });
    });
});
