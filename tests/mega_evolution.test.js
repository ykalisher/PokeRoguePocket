'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// arena_env aliases window to globalThis, so these IIFEs attach to the
// globalThis namespaces below. locations.js must load before run_state.js
// because getPendingMegaEvolutions reaches for global.PokeLocations at call
// time (guarded), and both are needed for the mega-evolution helpers.
require('./helpers/arena_env');
require('../map/locations');
require('../map/run_state');

const R = globalThis.PokeRun;

function makePokemon(name, id, types, extra) {
    return Object.assign({
        name,
        id,
        type1: types[0] || 'NONE',
        type2: types[1] || 'NONE',
        type3: types[2] || 'NONE',
        baseHealth: 10,
        baseAttack: 10,
        baseDefense: 10,
        baseSpeed: 10
    }, extra || {});
}

// A mega referenced by name, a mega referenced by id, plus the plain filler
// species used to fill the active deck to its 6-slot cap so the bench baby
// actually stays on the bench.
const MEGA_BY_NAME = makePokemon('Mega Blazeon', '8001', ['FIRE', 'DRAGON']);
const MEGA_BY_ID = makePokemon('Mega Tidalon', '8002', ['WATER']);
const BABY_NAME_REF = makePokemon('Baby Blaze', '9001', ['FIRE', 'BABY'], { evolvesInto: 'Mega Blazeon' });
const BABY_ID_REF = makePokemon('Baby Tide', '9002', ['WATER', 'BABY'], { evolvesInto: '8002' });
const BABY_BAD_REF = makePokemon('Baby Lost', '9003', ['GRASS', 'BABY'], { evolvesInto: 'Does Not Exist' });
const BENCH_BABY = makePokemon('Baby Bench', '9004', ['FIRE', 'BABY'], { evolvesInto: 'Mega Blazeon' });
const PLAIN_A = makePokemon('Plain A', '7001', ['NORMAL']);
const PLAIN_B = makePokemon('Plain B', '7002', ['NORMAL']);
const PLAIN_C = makePokemon('Plain C', '7003', ['NORMAL']);

function fixtureGameData() {
    return {
        pokemon: [
            MEGA_BY_NAME, MEGA_BY_ID,
            BABY_NAME_REF, BABY_ID_REF, BABY_BAD_REF, BENCH_BABY,
            PLAIN_A, PLAIN_B, PLAIN_C
        ]
    };
}

function card(record) {
    return R.createPokemonCard(record, 'player', R.allocateCardId({ nextCardId: 1 }, 'pokemon', record.name));
}

// Active deck holds exactly ACTIVE_POKEMON_LIMIT (6) pokemon so normalization
// leaves the bench baby on the bench: two resolvable babies (name-ref at slot 0,
// id-ref at slot 2), one unresolvable baby (slot 4), and three plain fillers.
function fixtureRun() {
    return R.createRunState({
        area: { nodes: [{ id: 'start' }], edges: [] },
        collections: {
            pokemon: [
                card(BABY_NAME_REF),
                card(PLAIN_A),
                card(BABY_ID_REF),
                card(PLAIN_B),
                card(BABY_BAD_REF),
                card(PLAIN_C)
            ],
            bench: { pokemon: [card(BENCH_BABY)], actions: [] },
            actions: []
        }
    });
}

test('getPendingMegaEvolutions covers only active-deck babies whose evolvesInto resolves', () => {
    const gameData = fixtureGameData();
    const run = fixtureRun();

    const pending = R.getPendingMegaEvolutions(run, gameData);

    assert.equal(pending.length, 2, 'bench baby and unresolvable baby must be excluded');
    assert.deepEqual(pending.map(entry => entry.index), [0, 2]);
    assert.deepEqual(pending.map(entry => entry.babyCard.pokemon.name), ['Baby Blaze', 'Baby Tide']);
    assert.deepEqual(pending.map(entry => entry.megaRecord.name), ['Mega Blazeon', 'Mega Tidalon']);
});

test('applyMegaEvolutions swaps babies for megas in place and rebuilds the action deck', () => {
    const gameData = fixtureGameData();
    const run = fixtureRun();

    const pending = R.getPendingMegaEvolutions(run, gameData);
    const summary = R.applyMegaEvolutions(run, pending);

    assert.deepEqual(summary, [
        { babyName: 'Baby Blaze', megaName: 'Mega Blazeon' },
        { babyName: 'Baby Tide', megaName: 'Mega Tidalon' }
    ]);

    const activeNames = run.collections.pokemon.map(entry => entry.pokemon.name);
    // Megas land at the same slots (0 and 2); other slots untouched; the
    // unresolvable baby (slot 4) stays a baby; the bench baby is never touched.
    assert.deepEqual(activeNames, ['Mega Blazeon', 'Plain A', 'Mega Tidalon', 'Plain B', 'Baby Lost', 'Plain C']);
    assert.ok(!activeNames.includes('Baby Blaze'), 'baby-by-name must be gone');
    assert.ok(!activeNames.includes('Baby Tide'), 'baby-by-id must be gone');
    assert.equal(run.collections.bench.pokemon[0].pokemon.name, 'Baby Bench', 'bench baby must persist unchanged');

    // The mega card is a fresh card with a distinct run-allocated id and full HP.
    const megaCard = run.collections.pokemon[0];
    assert.equal(megaCard.kind, 'pokemon');
    assert.equal(megaCard.currentHealth, MEGA_BY_NAME.baseHealth);
    assert.match(megaCard.id, /^run-pokemon-/);

    // Action deck was rebuilt (collections normalized) — no attack cards here,
    // so both action zones stay empty arrays.
    assert.deepEqual(run.collections.actions, []);
    assert.deepEqual(run.collections.bench.actions, []);
});

test('applyMegaEvolutions rebuild promotes a mega-typed attack from the bench', () => {
    const gameData = fixtureGameData();
    const run = fixtureRun();
    // A DRAGON attack no active baby can use; only Mega Blazeon (FIRE/DRAGON)
    // makes it usable, so the rebuild after evolution must pull it into the deck.
    const dragonAttack = R.createAttackCard(
        { name: 'Dragon Pulse', type1: 'DRAGON', type2: 'NONE' },
        'player',
        'run-attack-dragon-1'
    );
    run.collections.bench.actions.push(dragonAttack);

    const pending = R.getPendingMegaEvolutions(run, gameData);
    R.applyMegaEvolutions(run, pending);

    const activeAttackIds = run.collections.actions.filter(entry => entry.kind === 'attack').map(entry => entry.id);
    assert.ok(activeAttackIds.includes('run-attack-dragon-1'), 'DRAGON attack should move to the active deck post-evolution');
});

test('getPendingMegaEvolutions is empty and applyMegaEvolutions is inert when the deck has no babies', () => {
    const gameData = fixtureGameData();
    const run = R.createRunState({
        area: { nodes: [{ id: 'start' }], edges: [] },
        collections: { pokemon: [card(PLAIN_A), card(PLAIN_B)], actions: [], bench: { pokemon: [], actions: [] } }
    });
    const before = JSON.stringify(run.collections);

    const pending = R.getPendingMegaEvolutions(run, gameData);
    assert.deepEqual(pending, []);

    const summary = R.applyMegaEvolutions(run, pending);
    assert.deepEqual(summary, []);
    assert.equal(JSON.stringify(run.collections), before, 'no babies -> zero mutation');
});

// Regression: the fixtures above hand-build species records, so they cannot
// catch a field dropped by arena_data's normalizePokemon(). The real game only
// ever sees normalized records, and evolvesInto being stripped there made every
// baby unresolvable -> zero evolutions in an actual run.
test('normalized real pokemon keep evolvesInto so real babies resolve to megas', async () => {
    const { arena, loadRealGameData } = require('./helpers/arena_env');

    await loadRealGameData();

    const gameData = arena.GameData;
    const babies = gameData.pokemon.filter(record => record.types.includes('BABY'));

    assert.ok(babies.length >= 1, 'expected at least one authored BABY-typed species');
    babies.forEach(baby => {
        assert.ok(baby.evolvesInto, `${baby.name}: evolvesInto was dropped by normalization`);
        assert.ok(
            globalThis.PokeLocations.findPokemonByNameOrId(gameData, baby.evolvesInto),
            `${baby.name}: evolvesInto "${baby.evolvesInto}" does not resolve`
        );
    });

    const run = R.createRunState({
        area: { nodes: [{ id: 'start' }], edges: [] },
        collections: {
            pokemon: [card(babies[0])],
            actions: [],
            bench: { pokemon: [], actions: [] }
        }
    });
    const pending = R.getPendingMegaEvolutions(run, gameData);

    assert.equal(pending.length, 1, 'a real baby in the active deck must be pending evolution');
    assert.equal(pending[0].babyCard.pokemon.name, babies[0].name);
});
