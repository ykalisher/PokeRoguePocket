'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// arena_env aliases window to globalThis, so the locations IIFE below attaches
// to globalThis.PokeLocations.
const { loadRealGameData, arena } = require('./helpers/arena_env');
require('../map/locations');
require('../map/run_state');

require('../map/event_effects');

const P = globalThis.PokeLocations;
const R = globalThis.PokeRun;
const E = globalThis.PokeEvents;

function makeEvent(id, type, types, extra) {
    const event = { id, type, title: id, body: 'text', enabled: true };
    if (types) event.types = types;
    if (type === 'choice') event.choices = [{ title: 'a', id: 'a', effects: [] }];
    if (type === 'trainer') { event.trainerName = 'x'; event.rewardEffects = []; }
    return Object.assign(event, extra || {});
}

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
    [1, 2, 3].forEach(level => {
        assert.equal(P.LEVEL_CONFIG[level].nodeCount, 11, `L${level}: nodeCount`);
        assert.equal(P.LEVEL_CONFIG[level].layout, 'branching', `L${level}: layout`);
    });

    assert.deepEqual(P.LEVEL_CONFIG[1].quotas,
        { battle: [2, 3], capture: [2, 4], event: [2, 3], shop: [1, 2], attack: [1, 2] });
    assert.deepEqual(P.LEVEL_CONFIG[1].forcedTypes, { 1: 'capture', 2: 'capture', 3: 'battle' });
    assert.deepEqual(P.LEVEL_CONFIG[1].battleRanks, [{ rank: 'Standard', weight: 100 }]);

    assert.deepEqual(P.LEVEL_CONFIG[2].quotas,
        { battle: [3, 4], capture: [1, 3], event: [2, 3], shop: [1, 2], attack: [1, 2] });
    assert.deepEqual(P.LEVEL_CONFIG[2].battleRanks, [{ rank: 'Standard', weight: 60 }, { rank: 'Ace', weight: 40 }]);

    assert.deepEqual(P.LEVEL_CONFIG[3].quotas,
        { battle: [2, 3], capture: [1, 2], event: [2, 3], shop: [1, 2], attack: [2, 3] });
    assert.deepEqual(P.LEVEL_CONFIG[3].battleRanks, [{ rank: 'Ace', weight: 100 }]);
    assert.deepEqual(P.LEVEL_CONFIG[3].bossRanks, [{ rank: 'Elite', weight: 100 }]);
});

test('branching levels\' quota minimums total 8, leaving room for the free token and a real branch', () => {
    [1, 2, 3].forEach(level => {
        const config = P.LEVEL_CONFIG[level];
        const quotas = config.quotas;
        const mins = Object.values(quotas).reduce((sum, [min]) => sum + min, 0);
        const slack = config.nodeCount - 2 - mins;
        const roomy = Object.values(quotas).filter(([min, max]) => min < max).length;

        assert.equal(mins, 8, `L${level}: quota minimums`);
        assert.equal(slack, 1, `L${level}: free-token slack`);
        assert.ok(roomy >= slack + 2, `L${level}: needs the free token plus 2 distinct branchable lanes`);
    });
});

test('L4 is a fixed 6-node gauntlet', () => {
    const level4 = P.LEVEL_CONFIG[4];
    assert.equal(level4.nodeCount, 6);
    assert.equal(level4.layout, 'gauntlet');
    assert.equal(level4.quotas, null);
    assert.deepEqual(level4.forcedTypes, { 1: 'shop', 2: 'battle', 3: 'battle', 4: 'shop', 5: 'battle' });
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

test('getStarterDecks reads starter_decks.json in the tuple shape', async () => {
    // createCardCollections destructures [name, count], so the normalizer must
    // keep turning the file's { name, count } objects into tuples.
    await loadRealGameData();
    const decks = P.getStarterDecks(arena.GameData);

    // Derived, never hardcoded: the roster grows as the owner authors decks.
    // What matters is that every enabled deck is present and keyed by its own
    // id — createCardCollections looks decks up by that key.
    const expectedIds = arena.GameData.starterDecks
        .filter(deck => deck && deck.id && deck.enabled !== false)
        .map(deck => deck.id);

    assert.ok(expectedIds.length > 0, 'starter_decks.json must ship at least one enabled deck');
    assert.deepEqual(Object.keys(decks), expectedIds);
    Object.entries(decks).forEach(([key, deck]) => {
        assert.equal(key, deck.id, `deck map key ${key} does not match its own id ${deck.id}`);
    });

    Object.values(decks).forEach(deck => {
        [...deck.attacks, ...deck.items].forEach(entry => {
            assert.ok(Array.isArray(entry) && entry.length === 2, `${deck.id}: ${JSON.stringify(entry)} is not a [name, count] tuple`);
            assert.equal(typeof entry[0], 'string');
            assert.ok(Number.isInteger(entry[1]) && entry[1] >= 1, `${deck.id}: bad count for ${entry[0]}`);
        });
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

    Object.values(P.getStarterDecks(gameData)).forEach(deck => {
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

test('every starter-deck type has an enabled location containing it', async () => {
    // Level 1's location must include the chosen starter's type, so each deck's
    // type needs at least one enabled location to select from.
    await loadRealGameData();
    const locations = P.getLocations(arena.GameData);

    Object.values(P.getStarterDecks(arena.GameData)).forEach(deck => {
        const match = locations.some(location => Array.isArray(location.types) && location.types.includes(deck.type));
        assert.ok(match, `${deck.id} deck: no enabled location includes ${deck.type}`);
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

test('getWildPokemonPool falls back to all obtainable species when nothing matches', async () => {
    await loadRealGameData();
    const gameData = arena.GameData;

    // The empty-types fallback is exactly the obtainable pool: unique-by-name
    // species that are not legendary, not a baby, and not a mega.
    const fallbackPool = P.getWildPokemonPool(gameData, []);
    const obtainable = P.getObtainablePokemonPool(gameData);
    assert.deepEqual(fallbackPool.map(species => species.name), obtainable.map(species => species.name));

    fallbackPool.forEach(species => {
        assert.ok(!species.types.includes('LEGENDARY'), `${species.name} legendary leaked`);
        assert.ok(!species.types.includes('BABY'), `${species.name} baby leaked`);
        assert.ok(parseInt(species.id, 10) <= 9000, `${species.name} mega leaked (id > 9000)`);
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

    assert.equal(run.version, 3);
    assert.equal(run.level, 1);
    assert.equal(run.starterId, 'water');
    assert.equal(run.location.id, 'tidepool-coast');
    assert.deepEqual(run.visitedLocationIds, ['tidepool-coast']);
    assert.equal(run.runCompleted, false);
    assert.equal(run.runCompletedAt, null);
    assert.equal(run.area.bossNodeId, 'boss-11');
});

test('the level music track round-trips on the run and defaults to none', () => {
    R.clearRunState();
    const run = R.createRunState({
        area: makeGraph(),
        collections: {},
        location: makeSnapshot(),
        starterId: 'water',
        level: 1
    });

    assert.equal(run.musicTrackId, null);

    run.musicTrackId = 'dppt-route-209';
    assert.ok(R.saveRunState(run));
    assert.equal(R.loadRunState().musicTrackId, 'dppt-route-209');

    run.musicTrackId = 42;
    assert.ok(R.saveRunState(run));
    assert.equal(R.loadRunState().musicTrackId, null);
});

test('ensureLevelMusic stores the chosen track on the run and keeps it across calls', () => {
    R.clearRunState();

    const tracks = [
        { id: 'map-a', category: 'trainer', enabled: true, file: 'assets/music/map-a.mp3' },
        { id: 'boss-a', category: 'boss', enabled: true, file: 'assets/music/boss-a.mp3' }
    ];
    const run = R.createRunState({ area: makeGraph(), collections: {}, location: makeSnapshot(), level: 1 });

    // No PokeAudio (the achievements/editor pages never load it) is a no-op.
    assert.equal(R.ensureLevelMusic(run, tracks), null);
    assert.equal(run.musicTrackId, null);

    require('../arena/audio.js');
    globalThis.PokeAudio = globalThis.window.PokeAudio;

    try {
        assert.equal(R.ensureLevelMusic(run, tracks), 'map-a');
        assert.equal(run.musicTrackId, 'map-a');
        assert.equal(R.loadRunState().musicTrackId, 'map-a');

        // A gym leader battle interrupts, then the level track comes back.
        globalThis.PokeAudio.playCategory('boss');
        assert.equal(R.ensureLevelMusic(run, tracks), 'map-a');
        assert.equal(globalThis.PokeAudio.getCurrentTrack().id, 'map-a');
    } finally {
        delete globalThis.PokeAudio;
        delete require.cache[require.resolve('../arena/audio.js')];
    }
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

    assert.equal(result.version, 3);
    assert.equal(result.level, 3);
    assert.equal(result.starterId, 'fire');
    assert.equal(result.location.id, 'cinder-ridge');
    assert.deepEqual(result.location.types, ['FIRE', 'ROCK']);
    assert.deepEqual(result.visitedLocationIds, ['a', 'cinder-ridge']);
    assert.equal(result.runCompleted, true);
    assert.equal(result.runCompletedAt, '2026-07-13T00:00:00.000Z');
    assert.equal(result.area.bossNodeId, 'boss-11');
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

// --- Phase 3: area graph generation ----------------------------------------

function countTypes(nodes) {
    return nodes.reduce((counts, node) => {
        counts[node.type] = (counts[node.type] || 0) + 1;
        return counts;
    }, {});
}

test('every level graph ends in a boss node with the right id and step', () => {
    [1, 2, 3, 4].forEach(level => {
        const nodeCount = P.LEVEL_CONFIG[level].nodeCount;
        for (let seed = 0; seed < 200; seed++) {
            const graph = P.createAreaGraph(level, { includeEvents: true });
            const bosses = graph.nodes.filter(node => node.type === 'boss');
            assert.equal(bosses.length, 1, `L${level}: expected exactly one boss node`);
            assert.equal(bosses[0].id, `boss-${nodeCount}`, `L${level}: boss id`);
            assert.equal(bosses[0].step, nodeCount, `L${level}: boss step`);
            assert.ok(graph.nodes.some(node => node.id === 'start'), `L${level}: has a start node`);
            assert.deepEqual(graph.nodes, graph.columns.flat(), `L${level}: nodes match flattened columns`);
        }
    });
});

test('bossNodeIdForLevel matches the generated graph', () => {
    [1, 2, 3, 4].forEach(level => {
        const graph = P.createAreaGraph(level, { includeEvents: true });
        const boss = graph.nodes.find(node => node.type === 'boss');
        assert.equal(P.bossNodeIdForLevel(level), boss.id);
    });
});

test('includeEvents:false produces zero event nodes on every branching level', () => {
    [1, 2, 3].forEach(level => {
        for (let seed = 0; seed < 300; seed++) {
            const graph = P.createAreaGraph(level, { includeEvents: false });
            assert.equal(countTypes(graph.nodes).event || 0, 0, `L${level}: no events`);
        }
    });
});

// --- Phase 79: 11-node branching routes with hard per-route quotas --------

const ROUTE_ITERATIONS = 500;

// Mirrors resolveQuotas's deterministic scarcest-first redistribution
// (map/locations.js) so the events-off case can be checked against the same
// effective bounds the generator enforces, not the pre-redistribution config
// values that the free token can legitimately land above.
const EVENT_FALLBACK_ORDER = ['capture', 'shop', 'attack', 'battle'];

function computeEffectiveQuotas(config, includeEvents) {
    const quotas = {};

    Object.keys(config.quotas).forEach(type => { quotas[type] = config.quotas[type].slice(); });
    if (includeEvents !== false || !quotas.event) return quotas;

    const eventMinimum = quotas.event[0];

    quotas.event = [0, 0];
    for (let i = 0; i < eventMinimum; i += 1) {
        const target = EVENT_FALLBACK_ORDER
            .filter(type => quotas[type])
            .reduce((best, type) => (quotas[type][0] < quotas[best][0] ? type : best));

        quotas[target] = [quotas[target][0] + 1, quotas[target][1] + 1];
    }

    return quotas;
}

test('levels 1-3 generate exactly-11-node routes with quotas held by construction', () => {
    [1, 2, 3].forEach(level => {
        const config = P.LEVEL_CONFIG[level];
        const quotaKeys = Object.keys(config.quotas);

        [true, false].forEach(includeEvents => {
            const effectiveQuotas = computeEffectiveQuotas(config, includeEvents);
            const observedByType = {};

            quotaKeys.forEach(type => { observedByType[type] = new Set(); });

            for (let seed = 0; seed < ROUTE_ITERATIONS; seed += 1) {
                const graph = P.createAreaGraph(level, { includeEvents });
                const nodeById = {};

                graph.nodes.forEach(node => { nodeById[node.id] = node; });

                assert.equal(graph.columns.length, config.nodeCount + 1, `L${level}: columns.length`);
                assert.deepEqual(graph.nodes, graph.columns.flat(), `L${level}: nodes match flattened columns`);

                const multiColumns = graph.columns.filter(column => column.length > 1);
                assert.equal(multiColumns.length, 1, `L${level}: exactly one branch column`);

                const laneCount = multiColumns[0].length;
                assert.ok(laneCount === 2 || laneCount === 3, `L${level}: branch has 2-3 lanes, got ${laneCount}`);
                assert.equal(new Set(multiColumns[0].map(node => node.type)).size, laneCount,
                    `L${level}: branch lane types are distinct`);

                const branchStep = multiColumns[0][0].step;
                assert.ok(branchStep >= 4 && branchStep <= 10, `L${level}: branch step in 4..10, got ${branchStep}`);

                assert.equal(graph.nodes.length, config.nodeCount + laneCount, `L${level}: nodes.length`);
                assert.equal(graph.edges.length, (config.nodeCount - 2) + (2 * laneCount), `L${level}: edges.length`);

                const inbound = new Set();
                const outbound = new Set();

                graph.edges.forEach(edge => { outbound.add(edge.from); inbound.add(edge.to); });
                graph.nodes.forEach(node => {
                    if (node.id !== 'start') assert.ok(inbound.has(node.id), `L${level}: ${node.id} lacks an inbound edge`);
                    if (node.type !== 'boss') assert.ok(outbound.has(node.id), `L${level}: ${node.id} lacks an outbound edge`);
                });

                if (includeEvents === false) {
                    assert.equal(graph.nodes.filter(node => node.type === 'event').length, 0,
                        `L${level}: events off means zero event nodes`);
                }

                const paths = P.listAllPaths(graph);
                assert.equal(paths.length, laneCount, `L${level}: one route per lane`);

                paths.forEach(path => {
                    // listAllPaths includes the leading 'start' node.
                    assert.equal(path.length - 1, config.nodeCount, `L${level}: route length excluding start`);

                    const routeIds = path.slice(1);
                    const steps = routeIds.map(id => nodeById[id].step);
                    assert.deepEqual(steps, Array.from({ length: config.nodeCount }, (_, i) => i + 1),
                        `L${level}: contiguous steps 1..${config.nodeCount}`);

                    const last = nodeById[routeIds[routeIds.length - 1]];
                    assert.equal(last.type, 'boss', `L${level}: route ends on a boss node`);
                    assert.equal(last.id, `boss-${config.nodeCount}`, `L${level}: boss id`);

                    const nonBossIds = routeIds.slice(0, -1);
                    const nonBossNodes = nonBossIds.map(id => nodeById[id]);

                    nonBossNodes.forEach(node => {
                        assert.ok(quotaKeys.includes(node.type), `L${level}: ${node.id} has non-quota type ${node.type}`);
                    });

                    const counts = countTypes(nonBossNodes);
                    quotaKeys.forEach(type => {
                        const [min, max] = effectiveQuotas[type];
                        const count = counts[type] || 0;

                        assert.ok(count >= min && count <= max,
                            `L${level} includeEvents=${includeEvents}: ${type} count ${count} outside [${min},${max}]`);
                        observedByType[type].add(count);
                    });

                    for (let i = 2; i < nonBossNodes.length; i += 1) {
                        const a = nonBossNodes[i - 2].type;
                        const b = nonBossNodes[i - 1].type;
                        const c = nonBossNodes[i].type;

                        assert.ok(!(a === b && b === c), `L${level}: three consecutive ${a} nodes on a route`);
                    }
                });
            }

            if (includeEvents) {
                quotaKeys.forEach(type => {
                    const [min] = config.quotas[type];

                    assert.ok(observedByType[type].has(min), `L${level}: ${type} never hit its minimum ${min}`);
                    assert.ok(observedByType[type].has(min + 1), `L${level}: ${type} never hit min+1 ${min + 1}`);
                });
            }
        });
    });
});

// The branch may not land on steps 1-3 (MIN_BRANCH_STEP is 4), so these
// columns are always single-node.
test('L1 forced steps 1-2 stay captures and step 3 a battle after guarantee conversions', () => {
    for (let seed = 0; seed < 200; seed++) {
        const graph = P.createAreaGraph(1, { includeEvents: true });
        const byStep = {};
        graph.columns.forEach((column, step) => { if (column.length === 1) byStep[step] = column[0]; });
        assert.equal(byStep[1].type, 'capture');
        assert.equal(byStep[2].type, 'capture');
        assert.equal(byStep[3].type, 'battle');
    }
});

test('level 4 is a strictly linear 7-column single-lane gauntlet', () => {
    for (let seed = 0; seed < 200; seed++) {
        const graph = P.createAreaGraph(4, { includeEvents: true });

        // 7 columns (start + 6 steps), each a single node.
        assert.equal(graph.columns.length, 7);
        graph.columns.forEach(column => assert.equal(column.length, 1));
        assert.equal(graph.nodes.length, 7);

        const typeByStep = {};
        graph.nodes.forEach(node => { typeByStep[node.step] = node.type; });
        assert.equal(typeByStep[0], 'start');
        assert.equal(typeByStep[1], 'shop');
        assert.equal(typeByStep[2], 'battle');
        assert.equal(typeByStep[3], 'battle');
        assert.equal(typeByStep[4], 'shop');
        assert.equal(typeByStep[5], 'battle');
        assert.equal(typeByStep[6], 'boss');

        // Strictly linear edges: start -> 1 -> 2 -> 3 -> 4 -> 5 -> boss-6.
        const ids = ['start', 'node-1-1', 'node-2-1', 'node-3-1', 'node-4-1', 'node-5-1', 'boss-6'];
        const expectedEdges = ids.slice(0, -1).map((from, i) => `${from}->${ids[i + 1]}`);
        assert.deepEqual(graph.edges.map(edge => `${edge.from}->${edge.to}`), expectedEdges);
    }
});

// --- Phase 3: level transition ---------------------------------------------

test('advanceRunToNextLevel bumps the level, refreshes the area, and preserves progress', () => {
    const gameData = {
        locations: [
            makeLoc('a', ['WATER', 'ICE']),
            makeLoc('b', ['ICE', 'ROCK'])
        ]
    };
    const run = {
        level: 1,
        location: { id: 'a', name: 'A', terrain: 'A', types: ['WATER', 'ICE'], theme: {}, background: null },
        visitedLocationIds: ['a'],
        area: { completed: true, graph: makeGraph(), bossNodeId: 'boss-11' },
        attackEncounters: { 'node-4-1': {} },
        battleEncounters: { 'node-3-1': {} },
        captureEncounters: { 'node-1-1': {} },
        martEncounters: { 'node-5-1': {} },
        eventEncounters: { 'node-6-1': {} },
        collections: { pokemon: ['keep'] },
        cash: 250,
        musicTrackId: 'level-one-theme',
        nextCardId: 9,
        starterId: 'water'
    };

    P.advanceRunToNextLevel(run, gameData, { includeEvents: false });

    assert.equal(run.level, 2);
    // A new level means a new song.
    assert.equal(run.musicTrackId, null);
    assert.equal(run.location.id, 'b');
    assert.ok(run.location.types.some(type => ['WATER', 'ICE'].includes(type)), 'shares a type with the old location');
    assert.deepEqual(run.visitedLocationIds, ['a', 'b']);

    assert.deepEqual(run.attackEncounters, {});
    assert.deepEqual(run.battleEncounters, {});
    assert.deepEqual(run.captureEncounters, {});
    assert.deepEqual(run.martEncounters, {});
    assert.deepEqual(run.eventEncounters, {});

    assert.equal(run.area.completed, false);
    assert.equal(run.area.currentNodeId, 'start');
    assert.deepEqual(run.area.visitedNodeIds, ['start']);
    assert.deepEqual(run.area.traveledPathKeys, []);
    assert.equal(run.area.activeAttackNodeId, null);
    assert.equal(run.area.activeBattleNodeId, null);
    assert.equal(run.area.bossNodeId, 'boss-11');
    assert.ok(run.area.graph.nodes.length > 1);

    // Untouched carry-over.
    assert.deepEqual(run.collections, { pokemon: ['keep'] });
    assert.equal(run.cash, 250);
    assert.equal(run.nextCardId, 9);
    assert.equal(run.starterId, 'water');
});

// --- Phase 3: trainer selection against real data --------------------------

test('chooseTrainer against real data never returns null or Special and honors rank floors', async () => {
    await loadRealGameData();
    const gameData = arena.GameData;
    const locations = gameData.locations;

    // Battle-node rank floor per level (L2 is a Standard/Ace mix, so no strict
    // single rank); the final boss node has its own rank.
    const battleExpect = { 1: 'Standard', 3: 'Ace', 4: 'Elite' };
    const bossExpect = { 1: 'Boss', 2: 'Boss', 3: 'Elite', 4: 'Elite' };

    [1, 2, 3, 4].forEach(level => {
        locations.forEach(location => {
            const excludeNames = [];
            for (let node = 0; node < 4; node++) {
                const nodeType = node === 3 ? 'boss' : 'battle';
                const picked = P.chooseTrainer(gameData, {
                    level, nodeType, locationTypes: location.types, excludeNames
                });
                assert.ok(picked, `L${level} ${location.id}: never null`);
                assert.notEqual(picked.rank, 'Special', `L${level} ${location.id}: never Special`);

                const expected = nodeType === 'boss' ? bossExpect[level] : battleExpect[level];
                if (expected) {
                    assert.equal(picked.rank, expected, `L${level} ${location.id} ${nodeType}: expected ${expected}`);
                }
                excludeNames.push(picked.name);
            }
        });
    });
});

const EVENT_POOL = {
    events: [
        makeEvent('universal-gift', 'gift'),
        makeEvent('water-gift', 'gift', ['WATER', 'ICE']),
        makeEvent('fire-choice', 'choice', ['FIRE', 'ROCK', 'GROUND'])
    ]
};

test('getAvailableEvents keeps universal events for any location types', () => {
    const water = E.getAvailableEvents(EVENT_POOL, ['WATER']).map(event => event.id);
    const psychic = E.getAvailableEvents(EVENT_POOL, ['PSYCHIC']).map(event => event.id);

    assert.ok(water.includes('universal-gift'));
    assert.ok(psychic.includes('universal-gift'));
});

test('getAvailableEvents gates typed events by location type overlap', () => {
    const water = E.getAvailableEvents(EVENT_POOL, ['WATER']).map(event => event.id);
    const fire = E.getAvailableEvents(EVENT_POOL, ['FIRE']).map(event => event.id);

    assert.ok(water.includes('water-gift'));
    assert.ok(!water.includes('fire-choice'));
    assert.ok(fire.includes('fire-choice'));
    assert.ok(!fire.includes('water-gift'));
});

test('getAvailableEvents with undefined location types stays ungated', () => {
    const all = E.getAvailableEvents(EVENT_POOL).map(event => event.id);

    assert.deepEqual(all.sort(), ['fire-choice', 'universal-gift', 'water-gift']);
});

test('getAvailableEvents returns nothing when no typed or universal event matches', () => {
    const typedOnly = { events: [makeEvent('water-gift', 'gift', ['WATER'])] };

    assert.equal(E.getAvailableEvents(typedOnly, ['FIRE']).length, 0);
});

test('chooseEvent only returns events matching the run location types', () => {
    const run = { location: { types: ['FIRE'] } };
    const allowed = new Set(['universal-gift', 'fire-choice']);

    for (let index = 0; index < 200; index += 1) {
        const event = E.chooseEvent(EVENT_POOL, run);
        assert.ok(event && allowed.has(event.id), `chooseEvent leaked ${event && event.id}`);
    }
});

// --- Location / terrain gate overrides (phase 54) --------------------------

const OVERRIDE_POOL = {
    events: [
        makeEvent('universal-gift', 'gift'),
        makeEvent('seafoam-only', 'gift', ['FIRE'], { locations: ['seafoam-islands'] }),
        makeEvent('island-only', 'gift', null, { terrains: ['Island'] }),
        makeEvent('either-place', 'gift', null, { locations: ['new-mauville'], terrains: ['Lake'] })
    ]
};

function atLocation(id, terrain, types) {
    return { id, terrain, types };
}

test('event locations override beats the type gate both ways', () => {
    const atSeafoam = E.getAvailableEvents(OVERRIDE_POOL, atLocation('seafoam-islands', 'Island', ['WATER', 'ICE']))
        .map(event => event.id);
    // id matches even though the event's types (FIRE) do not overlap WATER/ICE
    assert.ok(atSeafoam.includes('seafoam-only'));

    const atVolcano = E.getAvailableEvents(OVERRIDE_POOL, atLocation('cinnabar-island-volcano', 'Volcanic', ['FIRE', 'ROCK']))
        .map(event => event.id);
    // types overlap (FIRE) but the locations override is set and does not match
    assert.ok(!atVolcano.includes('seafoam-only'));
});

test('event terrains override matches trimmed and case-insensitive', () => {
    const island = E.getAvailableEvents(OVERRIDE_POOL, atLocation('sevii-islands', '  island ', ['WATER']))
        .map(event => event.id);
    assert.ok(island.includes('island-only'));

    const cave = E.getAvailableEvents(OVERRIDE_POOL, atLocation('cerulean-cave', 'Cave', ['MONSTER']))
        .map(event => event.id);
    assert.ok(!cave.includes('island-only'));
});

test('locations and terrains overrides OR together', () => {
    const byId = E.getAvailableEvents(OVERRIDE_POOL, atLocation('new-mauville', 'Factory', ['ELECTRIC'])).map(event => event.id);
    const byTerrain = E.getAvailableEvents(OVERRIDE_POOL, atLocation('lake-of-rage', 'Lake', ['DRAGON'])).map(event => event.id);
    const neither = E.getAvailableEvents(OVERRIDE_POOL, atLocation('safari-zone', 'Safari', ['NORMAL'])).map(event => event.id);

    assert.ok(byId.includes('either-place'));
    assert.ok(byTerrain.includes('either-place'));
    assert.ok(!neither.includes('either-place'));
});

test('ungated calls still include override-gated events', () => {
    const all = E.getAvailableEvents(OVERRIDE_POOL).map(event => event.id);
    ['seafoam-only', 'island-only', 'either-place'].forEach(id => assert.ok(all.includes(id), id));
});

test('chooseEvent respects overrides via run.location', () => {
    const run = { location: atLocation('seafoam-islands', 'Island', ['WATER', 'ICE']) };
    const allowed = new Set(['universal-gift', 'seafoam-only', 'island-only']);

    for (let index = 0; index < 100; index += 1) {
        const event = E.chooseEvent(OVERRIDE_POOL, run);
        assert.ok(event && allowed.has(event.id), `chooseEvent leaked ${event && event.id}`);
    }
});

// --- Typed random attack rewards (phase 15) --------------------------------

test('gain-random-card with types only grants on-type attacks', async () => {
    await loadRealGameData();
    const gameData = arena.GameData;
    const run = R.createRunState({ area: makeGraph(), collections: {} });
    const effect = { type: 'gain-random-card', cardKind: 'attack', types: ['FIRE'], count: 40 };

    E.applyEffects(run, [effect], {}, { runStore: R, gameData });

    const grantedAttacks = [...run.collections.actions, ...run.collections.bench.actions]
        .map(card => card.attack);

    assert.ok(grantedAttacks.length > 0, 'expected at least one granted attack');
    grantedAttacks.forEach(attack => {
        assert.ok(
            attack.type1 === 'FIRE' || attack.type2 === 'FIRE',
            `${attack.name} is not a FIRE attack`
        );
    });
});

test('gain-random-card with locationTypes:true grants attacks matching run.location.types', async () => {
    await loadRealGameData();
    const gameData = arena.GameData;
    const run = R.createRunState({ area: makeGraph(), collections: {}, location: atLocation('fixture-fire-loc', 'Volcanic', ['FIRE']) });
    const effect = { type: 'gain-random-card', cardKind: 'attack', locationTypes: true, count: 40 };

    E.applyEffects(run, [effect], {}, { runStore: R, gameData });

    const grantedAttacks = [...run.collections.actions, ...run.collections.bench.actions]
        .map(card => card.attack);

    assert.ok(grantedAttacks.length > 0, 'expected at least one granted attack');
    grantedAttacks.forEach(attack => {
        assert.ok(
            attack.type1 === 'FIRE' || attack.type2 === 'FIRE',
            `${attack.name} is not a FIRE attack`
        );
    });
});

test('gain-random-card locationTypes:true wins over a disjoint authored types list', async () => {
    await loadRealGameData();
    const gameData = arena.GameData;
    const run = R.createRunState({ area: makeGraph(), collections: {}, location: atLocation('fixture-fire-loc-2', 'Volcanic', ['FIRE']) });
    const effect = { type: 'gain-random-card', cardKind: 'attack', types: ['WATER'], locationTypes: true, count: 40 };

    E.applyEffects(run, [effect], {}, { runStore: R, gameData });

    const grantedAttacks = [...run.collections.actions, ...run.collections.bench.actions]
        .map(card => card.attack);

    assert.ok(grantedAttacks.length > 0, 'expected at least one granted attack');
    grantedAttacks.forEach(attack => {
        assert.ok(
            attack.type1 === 'FIRE' || attack.type2 === 'FIRE',
            `${attack.name} is not a FIRE attack (locationTypes should win over types: WATER)`
        );
    });
});

test('gain-random-card with an unmatched type grants nothing', () => {
    const gameData = { attacks: [{ name: 'Splash', type1: 'WATER', type2: 'NONE' }] };
    const run = R.createRunState({ area: makeGraph(), collections: {} });
    const effect = { type: 'gain-random-card', cardKind: 'attack', types: ['GRASS'], count: 3 };

    const summary = E.applyEffects(run, [effect], {}, { runStore: R, gameData });

    assert.equal(run.collections.actions.length, 0);
    assert.equal(run.collections.bench.actions.length, 0);
    assert.deepEqual(summary, ['No GRASS attack available.']);
});

// --- Location theming (phase 6) ------------------------------------------

test('applyLocationTheme without document does not throw', () => {
    // Node has no document; the guard must make every call shape a no-op.
    assert.equal(typeof document, 'undefined');
    assert.doesNotThrow(() => P.applyLocationTheme(null));
    assert.doesNotThrow(() => P.applyLocationTheme(undefined));
    assert.doesNotThrow(() => P.applyLocationTheme({}));
    assert.doesNotThrow(() => P.applyLocationTheme({
        location: {
            id: 'tidepool-coast',
            theme: { accent: '#fff', glow: '#fff', surface: '#111', bgDeep: '#000', bgMid: '#222' },
            background: 'assets/backgrounds/tidepool-coast.png'
        }
    }));
});

test('applyLocationTheme sets body tokens when a document exists', () => {
    // Minimal document stub shaped like the DOM surface the function touches.
    const setCalls = {};
    const removed = [];
    globalThis.document = {
        baseURI: 'http://localhost/area.html',
        body: {
            dataset: {},
            style: {
                setProperty: (name, value) => { setCalls[name] = value; },
                removeProperty: name => { removed.push(name); }
            }
        }
    };

    try {
        P.applyLocationTheme({
            location: {
                id: 'cinder-ridge',
                theme: { accent: '#f2a35c', glow: '#d95f3b', surface: '#402420', bgDeep: '#1c0f0c', bgMid: '#2e1a14' },
                background: 'assets/backgrounds/cinder-ridge.png'
            }
        });

        assert.equal(setCalls['--loc-accent'], '#f2a35c');
        assert.equal(setCalls['--loc-glow'], '#d95f3b');
        assert.equal(setCalls['--loc-surface'], '#402420');
        assert.equal(setCalls['--loc-bg-deep'], '#1c0f0c');
        assert.equal(setCalls['--loc-bg-mid'], '#2e1a14');
        // Document-absolute: a relative url() in a custom property would
        // resolve against static/styles.css instead of the page.
        assert.equal(setCalls['--page-bg-image'], 'url("http://localhost/assets/backgrounds/cinder-ridge.png")');
        assert.equal(document.body.dataset.location, 'cinder-ridge');

        // No background -> the inline image override is cleared, not kept.
        P.applyLocationTheme({
            location: {
                id: 'no-bg',
                theme: { accent: '#fff', glow: '#fff', surface: '#111', bgDeep: '#000', bgMid: '#222' },
                background: null
            }
        });
        assert.deepEqual(removed, ['--page-bg-image']);

        // No run/location/theme -> body untouched.
        const before = JSON.stringify(setCalls);
        P.applyLocationTheme(null);
        P.applyLocationTheme({ location: { id: 'x' } });
        assert.equal(JSON.stringify(setCalls), before);
    } finally {
        delete globalThis.document;
    }
});
