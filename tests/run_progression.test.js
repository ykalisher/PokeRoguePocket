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
    assert.deepEqual(P.LEVEL_CONFIG[1].weights, { battle: 38, capture: 26, event: 21, shop: 15 });
    assert.deepEqual(P.LEVEL_CONFIG[1].caps, { capture: 4, shop: 2 });
    assert.deepEqual(P.LEVEL_CONFIG[1].forcedTypes, { 1: 'capture', 2: 'capture', 3: 'battle' });
    assert.deepEqual(P.LEVEL_CONFIG[1].battleRanks, [{ rank: 'Standard', weight: 100 }]);

    assert.deepEqual(P.LEVEL_CONFIG[2].weights, { battle: 44, capture: 22, event: 21, shop: 13 });
    assert.deepEqual(P.LEVEL_CONFIG[2].caps, { capture: 3, shop: 2 });
    assert.deepEqual(P.LEVEL_CONFIG[2].battleRanks, [{ rank: 'Standard', weight: 60 }, { rank: 'Ace', weight: 40 }]);

    assert.deepEqual(P.LEVEL_CONFIG[3].weights, { battle: 52, capture: 16, event: 20, shop: 12 });
    assert.deepEqual(P.LEVEL_CONFIG[3].caps, { capture: 3, shop: 1 });
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

test('every starter-deck type has an enabled location containing it', async () => {
    // Level 1's location must include the chosen starter's type, so each deck's
    // type needs at least one enabled location to select from.
    await loadRealGameData();
    const locations = P.getLocations(arena.GameData);

    Object.values(P.STARTER_DECKS).forEach(deck => {
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

test('branching graphs honor forced node types and the shop cap', () => {
    // Capture guarantees (phase 41) may push the capture count past
    // `caps.capture` by design, so that cap is no longer asserted here; the
    // shop cap is untouched by the guarantee pass and still holds.
    [1, 2, 3].forEach(level => {
        const config = P.LEVEL_CONFIG[level];
        for (let seed = 0; seed < 300; seed++) {
            const graph = P.createAreaGraph(level, { includeEvents: true });
            const singleByStep = {};
            graph.columns.forEach((column, step) => {
                if (column.length === 1) singleByStep[step] = column[0];
            });

            Object.entries(config.forcedTypes).forEach(([step, type]) => {
                const node = singleByStep[Number(step)];
                assert.ok(node, `L${level}: forced step ${step} should be a single-lane node`);
                assert.equal(node.type, type, `L${level} step ${step} forced type`);
            });

            const counts = countTypes(graph.nodes);
            assert.ok((counts.shop || 0) <= config.caps.shop, `L${level}: shop cap`);
        }
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

// --- Phase 41: map generation guarantees for levels 1-3 --------------------

function isQualifyingCapture(node, config) {
    return node.type === 'capture' && !(config.forcedTypes && config.forcedTypes[node.step] === 'capture');
}

function nodesById(graph) {
    const byId = {};
    graph.nodes.forEach(node => { byId[node.id] = node; });
    return byId;
}

test('levels 1-3 always generate at least 3 total capture nodes', () => {
    [1, 2, 3].forEach(level => {
        for (let seed = 0; seed < 300; seed++) {
            const graph = P.createAreaGraph(level, { includeEvents: true });
            const counts = countTypes(graph.nodes);
            assert.ok((counts.capture || 0) >= 3, `L${level}: expected >=3 total captures, got ${counts.capture || 0}`);
        }
    });
});

test('every start->boss path has a qualifying capture and (with events on) an event', () => {
    [1, 2, 3].forEach(level => {
        const config = P.LEVEL_CONFIG[level];
        for (let seed = 0; seed < 300; seed++) {
            const graph = P.createAreaGraph(level, { includeEvents: true });
            const byId = nodesById(graph);
            const paths = P.listAllPaths(graph);
            assert.ok(paths.length > 0, `L${level}: at least one start->boss path`);

            paths.forEach(path => {
                const nodes = path.map(id => byId[id]);
                assert.ok(
                    nodes.some(node => isQualifyingCapture(node, config)),
                    `L${level}: path ${path.join(',')} has no qualifying capture`
                );
                assert.ok(
                    nodes.some(node => node.type === 'event'),
                    `L${level}: path ${path.join(',')} has no event`
                );
            });
        }
    });
});

test('includeEvents:false keeps zero events while every path still has a qualifying capture', () => {
    [1, 2, 3].forEach(level => {
        const config = P.LEVEL_CONFIG[level];
        for (let seed = 0; seed < 300; seed++) {
            const graph = P.createAreaGraph(level, { includeEvents: false });
            const counts = countTypes(graph.nodes);
            assert.equal(counts.event || 0, 0, `L${level}: no events`);
            assert.ok((counts.capture || 0) >= 3, `L${level}: still >=3 total captures`);

            const byId = nodesById(graph);
            P.listAllPaths(graph).forEach(path => {
                const nodes = path.map(id => byId[id]);
                assert.ok(
                    nodes.some(node => isQualifyingCapture(node, config)),
                    `L${level}: path ${path.join(',')} has no qualifying capture with events disabled`
                );
            });
        }
    });
});

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

test('level 4 is a strictly linear 6-node single-lane gauntlet', () => {
    for (let seed = 0; seed < 200; seed++) {
        const graph = P.createAreaGraph(4, { includeEvents: true });

        // 6 columns, each a single node.
        assert.equal(graph.columns.length, 6);
        graph.columns.forEach(column => assert.equal(column.length, 1));
        assert.equal(graph.nodes.length, 6);

        const typeByStep = {};
        graph.nodes.forEach(node => { typeByStep[node.step] = node.type; });
        assert.equal(typeByStep[0], 'start');
        assert.equal(typeByStep[1], 'shop');
        assert.equal(typeByStep[2], 'battle');
        assert.equal(typeByStep[3], 'battle');
        assert.equal(typeByStep[4], 'battle');
        assert.equal(typeByStep[5], 'boss');

        // Strictly linear edges: start -> 1 -> 2 -> 3 -> 4 -> boss-5.
        const ids = ['start', 'node-1-1', 'node-2-1', 'node-3-1', 'node-4-1', 'boss-5'];
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
        area: { completed: true, graph: makeGraph(), bossNodeId: 'boss-12' },
        battleEncounters: { 'node-3-1': {} },
        captureEncounters: { 'node-1-1': {} },
        martEncounters: { 'node-5-1': {} },
        eventEncounters: { 'node-6-1': {} },
        collections: { pokemon: ['keep'] },
        cash: 250,
        nextCardId: 9,
        starterId: 'water'
    };

    P.advanceRunToNextLevel(run, gameData, { includeEvents: false });

    assert.equal(run.level, 2);
    assert.equal(run.location.id, 'b');
    assert.ok(run.location.types.some(type => ['WATER', 'ICE'].includes(type)), 'shares a type with the old location');
    assert.deepEqual(run.visitedLocationIds, ['a', 'b']);

    assert.deepEqual(run.battleEncounters, {});
    assert.deepEqual(run.captureEncounters, {});
    assert.deepEqual(run.martEncounters, {});
    assert.deepEqual(run.eventEncounters, {});

    assert.equal(run.area.completed, false);
    assert.equal(run.area.currentNodeId, 'start');
    assert.deepEqual(run.area.visitedNodeIds, ['start']);
    assert.deepEqual(run.area.traveledPathKeys, []);
    assert.equal(run.area.activeBattleNodeId, null);
    assert.equal(run.area.bossNodeId, 'boss-12');
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
    const bossExpect = { 1: 'Boss', 2: 'Boss', 3: 'Boss', 4: 'Elite' };

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
