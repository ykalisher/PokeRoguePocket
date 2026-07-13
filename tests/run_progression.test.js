'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// arena_env aliases window to globalThis, so the locations IIFE below attaches
// to globalThis.PokeLocations.
const { loadRealGameData, arena } = require('./helpers/arena_env');
require('../map/locations');
require('../map/run_state');

const P = globalThis.PokeLocations;
const R = globalThis.PokeRun;

function makeGraph() {
    return { nodes: [{ id: 'start' }], edges: [] };
}

function makeSnapshot(id = 'tidepool-coast', types = ['WATER', 'ICE']) {
    return {
        id,
        name: 'Tidepool Coast',
        terrain: 'Waterfront',
        types,
        theme: { accent: '#e8c266', glow: '#4ab0c8', surface: '#143a4a', bgDeep: '#081b26', bgMid: '#123240' },
        background: 'assets/backgrounds/tidepool-coast.png'
    };
}

function makeLoc(id, types, enabled = true) {
    return { id, name: id, terrain: id, types, theme: {}, background: null, enabled };
}

function makeTrainer(name, rank, typeSpecialization) {
    return { name, rank, typeSpecialization };
}

test('LEVEL_CONFIG has exactly levels 1-4', () => {
    assert.deepEqual(Object.keys(P.LEVEL_CONFIG).sort(), ['1', '2', '3', '4']);
    assert.equal(P.TOTAL_LEVELS, 4);
});

test('every rank mix weight sums to 100', () => {
    Object.values(P.LEVEL_CONFIG).forEach(config => {
        [config.battleRanks, config.bossRanks].forEach(mix => {
            const total = mix.reduce((sum, entry) => sum + entry.weight, 0);
            assert.equal(total, 100, `rank mix ${JSON.stringify(mix)} does not sum to 100`);
        });
    });
});

test('LEVEL_CONFIG matches the spec table verbatim', () => {
    assert.deepEqual(P.LEVEL_CONFIG[1].weights, { battle: 38, capture: 26, event: 21, shop: 15 });
    assert.deepEqual(P.LEVEL_CONFIG[1].caps, { capture: 4, shop: 2 });
    assert.deepEqual(P.LEVEL_CONFIG[1].forcedTypes, { 1: 'capture', 2: 'capture', 3: 'battle' });
    assert.deepEqual(P.LEVEL_CONFIG[1].battleRanks, [{ rank: 'Standard', weight: 100 }]);

    assert.deepEqual(P.LEVEL_CONFIG[2].weights, { battle: 44, capture: 22, event: 21, shop: 13 });
    assert.deepEqual(P.LEVEL_CONFIG[2].caps, { capture: 3, shop: 2 });
    assert.deepEqual(P.LEVEL_CONFIG[2].battleRanks, [{ rank: 'Standard', weight: 60 }, { rank: 'Ace', weight: 40 }]);

    assert.deepEqual(P.LEVEL_CONFIG[3].weights, { battle: 52, capture: 16, event: 20, shop: 12 });
    assert.deepEqual(P.LEVEL_CONFIG[3].caps, { capture: 2, shop: 1 });
    assert.deepEqual(P.LEVEL_CONFIG[3].battleRanks, [{ rank: 'Ace', weight: 100 }]);

    assert.equal(P.LEVEL_CONFIG[1].nodeCount, 12);
    assert.equal(P.LEVEL_CONFIG[1].layout, 'branching');
});

test('L4 is a fixed 5-node gauntlet', () => {
    const level4 = P.LEVEL_CONFIG[4];
    assert.equal(level4.nodeCount, 5);
    assert.equal(level4.layout, 'gauntlet');
    assert.equal(level4.weights, null);
    assert.equal(level4.caps, null);
    assert.deepEqual(level4.forcedTypes, { 1: 'shop', 2: 'battle', 3: 'battle', 4: 'battle' });
    assert.deepEqual(level4.battleRanks, [{ rank: 'Elite', weight: 100 }]);
    assert.deepEqual(level4.bossRanks, [{ rank: 'Elite', weight: 100 }]);
});

test('chooseNextLocation honors the required-type filter', () => {
    const gameData = { locations: [makeLoc('a', ['WATER']), makeLoc('b', ['FIRE'])] };
    for (let i = 0; i < 40; i++) {
        assert.equal(P.chooseNextLocation(gameData, { requiredType: 'WATER' }).id, 'a');
    }
});

test('chooseNextLocation honors the shared-type overlap filter', () => {
    const gameData = { locations: [makeLoc('a', ['WATER', 'ICE']), makeLoc('b', ['FIRE'])] };
    for (let i = 0; i < 40; i++) {
        assert.equal(P.chooseNextLocation(gameData, { previousTypes: ['ICE'] }).id, 'a');
    }
});

test('chooseNextLocation excludes visited ids at the top rung', () => {
    const gameData = { locations: [makeLoc('a', ['WATER']), makeLoc('b', ['WATER'])] };
    for (let i = 0; i < 40; i++) {
        assert.equal(P.chooseNextLocation(gameData, { requiredType: 'WATER', visitedIds: ['a'] }).id, 'b');
    }
});

test('chooseNextLocation relaxes visited when only previousId differs (rung 2)', () => {
    const gameData = { locations: [makeLoc('a', ['WATER']), makeLoc('b', ['WATER'])] };
    // Both visited, type filter still satisfiable, previousId a -> returns b.
    for (let i = 0; i < 40; i++) {
        assert.equal(P.chooseNextLocation(gameData, {
            requiredType: 'WATER', visitedIds: ['a', 'b'], previousId: 'a'
        }).id, 'b');
    }
});

test('chooseNextLocation drops the type filter when nothing matches (rung 3)', () => {
    const gameData = { locations: [makeLoc('a', ['WATER']), makeLoc('b', ['FIRE'])] };
    // No location has STEEL and none visited -> falls to "not visited" pool.
    const result = P.chooseNextLocation(gameData, { requiredType: 'STEEL', visitedIds: [] });
    assert.ok(['a', 'b'].includes(result.id));
});

test('chooseNextLocation falls to any non-previous when all visited and no type match (rung 4)', () => {
    const gameData = { locations: [makeLoc('a', ['WATER']), makeLoc('b', ['FIRE'])] };
    for (let i = 0; i < 40; i++) {
        assert.equal(P.chooseNextLocation(gameData, {
            requiredType: 'STEEL', visitedIds: ['a', 'b'], previousId: 'a'
        }).id, 'b');
    }
});

test('chooseNextLocation returns the sole location as a last resort (rung 5)', () => {
    const gameData = { locations: [makeLoc('a', ['WATER'])] };
    assert.equal(P.chooseNextLocation(gameData, {
        requiredType: 'STEEL', visitedIds: ['a'], previousId: 'a'
    }).id, 'a');
});

test('chooseNextLocation never returns null with any data present', () => {
    assert.ok(P.chooseNextLocation({ locations: [] }, {}));
    assert.ok(P.chooseNextLocation({ locations: [makeLoc('a', ['WATER'])] }, { requiredType: 'DRAGON' }));
});

test('chooseTrainer with a weight-100 config returns only that rank', () => {
    const gameData = {
        trainers: [
            makeTrainer('std', 'Standard', 'WATER'),
            makeTrainer('ace', 'Ace', 'WATER'),
            makeTrainer('boss', 'Boss', 'WATER')
        ]
    };
    for (let i = 0; i < 60; i++) {
        const picked = P.chooseTrainer(gameData, { level: 1, nodeType: 'battle', locationTypes: ['WATER'] });
        assert.equal(picked.rank, 'Standard');
    }
});

test('chooseTrainer prefers a location-type match', () => {
    const gameData = {
        trainers: [makeTrainer('water', 'Standard', 'WATER'), makeTrainer('fire', 'Standard', 'FIRE')]
    };
    for (let i = 0; i < 60; i++) {
        const picked = P.chooseTrainer(gameData, { level: 2, nodeType: 'battle', locationTypes: ['WATER'] });
        assert.equal(picked.typeSpecialization, 'WATER');
    }
});

test('chooseTrainer never returns a Special trainer, even as the only type match', () => {
    const gameData = {
        trainers: [makeTrainer('special', 'Special', 'WATER'), makeTrainer('std', 'Standard', 'FIRE')]
    };
    for (let i = 0; i < 60; i++) {
        const picked = P.chooseTrainer(gameData, { level: 1, nodeType: 'battle', locationTypes: ['WATER'] });
        assert.notEqual(picked.rank, 'Special');
        assert.equal(picked.name, 'std');
    }
});

test('chooseTrainer returns null when only Special trainers exist', () => {
    const gameData = { trainers: [makeTrainer('special', 'Special', 'WATER')] };
    assert.equal(P.chooseTrainer(gameData, { level: 1, nodeType: 'battle', locationTypes: ['WATER'] }), null);
});

test('chooseTrainer respects excludeNames but drops them before failing', () => {
    const twoWater = {
        trainers: [makeTrainer('a', 'Standard', 'WATER'), makeTrainer('b', 'Standard', 'WATER')]
    };
    for (let i = 0; i < 60; i++) {
        const picked = P.chooseTrainer(twoWater, {
            level: 1, nodeType: 'battle', locationTypes: ['WATER'], excludeNames: ['a']
        });
        assert.equal(picked.name, 'b');
    }

    const onlyExcluded = { trainers: [makeTrainer('a', 'Standard', 'WATER')] };
    const picked = P.chooseTrainer(onlyExcluded, {
        level: 1, nodeType: 'battle', locationTypes: ['WATER'], excludeNames: ['a']
    });
    assert.equal(picked.name, 'a');
});

test('isAllowedTrainerRank gates ranks by node type and level', () => {
    assert.equal(P.isAllowedTrainerRank({ rank: 'Ace' }, 'battle', 2), true);
    assert.equal(P.isAllowedTrainerRank({ rank: 'Ace' }, 'battle', 3), true);
    assert.equal(P.isAllowedTrainerRank({ rank: 'Ace' }, 'battle', 1), false);
    assert.equal(P.isAllowedTrainerRank({ rank: 'Elite' }, 'battle', 4), true);
    assert.equal(P.isAllowedTrainerRank({ rank: 'Elite' }, 'battle', 1), false);
    assert.equal(P.isAllowedTrainerRank({ rank: 'Boss' }, 'boss', 1), true);

    [1, 2, 3, 4].forEach(level => {
        assert.equal(P.isAllowedTrainerRank({ rank: 'Standard' }, 'battle', level), true);
        assert.equal(P.isAllowedTrainerRank({ rank: 'Special' }, 'battle', level), false);
        assert.equal(P.isAllowedTrainerRank({ rank: 'Special' }, 'boss', level), false);
    });
});

test('every starter-deck card name resolves to a real record', async () => {
    // findGameRecord uses exact name matching with a silent fallback, so a typo
    // ("Flamethrower" vs "Flame Thrower") would produce dud cards with no error.
    await loadRealGameData();
    const gameData = arena.GameData;
    const pokemonNames = new Set(gameData.pokemon.map(record => record.name));
    const attackNames = new Set(gameData.attacks.map(record => record.name));
    const itemNames = new Set(gameData.items.map(record => record.name));

    Object.values(P.STARTER_DECKS).forEach(deck => {
        deck.pokemon.forEach(name => {
            assert.ok(pokemonNames.has(name), `${deck.id} deck: unknown pokemon ${name}`);
        });
        deck.attacks.forEach(([name]) => {
            assert.ok(attackNames.has(name), `${deck.id} deck: unknown attack ${name}`);
        });
        deck.items.forEach(([name]) => {
            assert.ok(itemNames.has(name), `${deck.id} deck: unknown item ${name}`);
        });
    });
});

test('getWildPokemonPool filters by type and excludes legendaries', async () => {
    await loadRealGameData();
    const gameData = arena.GameData;

    const waterPool = P.getWildPokemonPool(gameData, ['WATER']);
    assert.ok(waterPool.length > 0);
    waterPool.forEach(species => {
        assert.ok(species.types.includes('WATER'), `${species.name} lacks WATER`);
        assert.ok(!species.types.includes('LEGENDARY'), `${species.name} is legendary`);
    });

    // Unique by name.
    const names = waterPool.map(species => species.name);
    assert.equal(new Set(names).size, names.length);
});

test('getWildPokemonPool falls back to all non-legendaries when nothing matches', async () => {
    await loadRealGameData();
    const gameData = arena.GameData;

    const uniqueNonLegendary = [];
    const seen = new Set();
    gameData.pokemon.forEach(species => {
        if (seen.has(species.name)) return;
        seen.add(species.name);
        if (!species.types.includes('LEGENDARY')) uniqueNonLegendary.push(species);
    });

    const fallbackPool = P.getWildPokemonPool(gameData, []);
    assert.equal(fallbackPool.length, uniqueNonLegendary.length);
    fallbackPool.forEach(species => {
        assert.ok(!species.types.includes('LEGENDARY'));
    });
});

// --- Phase 2: run state v2 -------------------------------------------------

test('createRunState v2 sets the new run fields', () => {
    const run = R.createRunState({
        area: makeGraph(),
        collections: {},
        location: makeSnapshot(),
        starterId: 'water',
        level: 1
    });

    assert.equal(run.version, 2);
    assert.equal(run.level, 1);
    assert.equal(run.starterId, 'water');
    assert.equal(run.location.id, 'tidepool-coast');
    assert.deepEqual(run.visitedLocationIds, ['tidepool-coast']);
    assert.equal(run.runCompleted, false);
    assert.equal(run.runCompletedAt, null);
    assert.equal(run.area.bossNodeId, 'boss-12');
});

test('createRunState clamps level and defaults starter/location', () => {
    const run = R.createRunState({ area: makeGraph(), collections: {}, level: 99 });

    assert.equal(run.level, 4);
    assert.equal(run.starterId, 'water');
    assert.equal(run.location, null);
    assert.deepEqual(run.visitedLocationIds, []);
});

test('save/load round-trips the v2 fields (normalizeRunState)', () => {
    R.clearRunState();
    const run = R.createRunState({
        area: makeGraph(),
        collections: {},
        location: makeSnapshot('cinder-ridge', ['FIRE', 'ROCK']),
        starterId: 'fire',
        level: 3
    });
    run.visitedLocationIds = ['a', 'cinder-ridge'];
    run.runCompleted = true;
    run.runCompletedAt = '2026-07-13T00:00:00.000Z';

    assert.ok(R.saveRunState(run));
    const result = R.loadRunState();

    assert.equal(result.version, 2);
    assert.equal(result.level, 3);
    assert.equal(result.starterId, 'fire');
    assert.equal(result.location.id, 'cinder-ridge');
    assert.deepEqual(result.location.types, ['FIRE', 'ROCK']);
    assert.deepEqual(result.visitedLocationIds, ['a', 'cinder-ridge']);
    assert.equal(result.runCompleted, true);
    assert.equal(result.runCompletedAt, '2026-07-13T00:00:00.000Z');
    assert.equal(result.area.bossNodeId, 'boss-12');
    R.clearRunState();
});

test('a v1 run blob loads as null', () => {
    localStorage.setItem(R.STORAGE_KEY, JSON.stringify({ version: 1, area: makeGraph() }));
    assert.equal(R.loadRunState(), null);
    R.clearRunState();
});

test('a v2 run with no location still loads (location null)', () => {
    R.clearRunState();
    const run = R.createRunState({ area: makeGraph(), collections: {} });
    run.location = null;
    assert.ok(R.saveRunState(run));
    const result = R.loadRunState();
    assert.ok(result);
    assert.equal(result.location, null);
    R.clearRunState();
});

test('normalizeLocationSnapshot rejects id-less and typeless input', () => {
    assert.equal(R.normalizeLocationSnapshot(null), null);
    assert.equal(R.normalizeLocationSnapshot({ name: 'x', types: ['WATER'] }), null);
    assert.equal(R.normalizeLocationSnapshot({ id: 'x', types: [] }), null);
    assert.equal(R.normalizeLocationSnapshot({ id: 'x' }), null);

    const ok = R.normalizeLocationSnapshot({ id: 'x', types: ['WATER'] });
    assert.equal(ok.id, 'x');
    assert.equal(ok.name, 'x');
    assert.equal(ok.terrain, 'x');
    assert.deepEqual(ok.types, ['WATER']);
});
