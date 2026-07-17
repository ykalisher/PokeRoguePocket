/**
 * Pokemon Rogue Pocket - locations framework
 *
 * Pure selection/config logic for the locations system: level structure,
 * starter decks, location selection, trainer selection, and wild pools.
 * This module is INERT in phase 1 — nothing calls it yet. It touches no DOM
 * at load time so the Node tests can require it (window is aliased to
 * globalThis by tests/helpers/arena_env.js).
 */

(function attachLocations(global) {
    'use strict';

    const TOTAL_LEVELS = 4;

    const LEVEL_CONFIG = Object.freeze({
        1: { nodeCount: 12, layout: 'branching',
             forcedTypes: { 1: 'capture', 2: 'capture', 3: 'battle' },
             weights: { battle: 38, capture: 26, event: 21, shop: 15 },
             caps: { capture: 4, shop: 2 },
             battleRanks: [{ rank: 'Standard', weight: 100 }],
             bossRanks: [{ rank: 'Boss', weight: 100 }] },
        2: { nodeCount: 12, layout: 'branching', forcedTypes: {},
             weights: { battle: 44, capture: 22, event: 21, shop: 13 },
             caps: { capture: 3, shop: 2 },
             battleRanks: [{ rank: 'Standard', weight: 60 }, { rank: 'Ace', weight: 40 }],
             bossRanks: [{ rank: 'Boss', weight: 100 }] },
        3: { nodeCount: 12, layout: 'branching', forcedTypes: {},
             weights: { battle: 52, capture: 16, event: 20, shop: 12 },
             caps: { capture: 3, shop: 1 },
             battleRanks: [{ rank: 'Ace', weight: 100 }],
             bossRanks: [{ rank: 'Boss', weight: 100 }] },
        4: { nodeCount: 5, layout: 'gauntlet',
             forcedTypes: { 1: 'shop', 2: 'battle', 3: 'battle', 4: 'battle' },
             weights: null, caps: null,
             battleRanks: [{ rank: 'Elite', weight: 100 }],
             bossRanks: [{ rank: 'Elite', weight: 100 }] }
    });

    const STARTER_DECKS = Object.freeze({
        water: Object.freeze({
            id: 'water',
            name: 'Tide Caller',
            type: 'WATER',
            pokemon: ['Blastoise', 'Feraligatr'],
            attacks: [['Surf', 2], ['Waterfall', 2], ['Rain Dance', 2]],
            items: [['Sitrus Berry', 1], ['Withdraw Wand', 1]]
        }),
        grass: Object.freeze({
            id: 'grass',
            name: 'Verdant Bloom',
            type: 'GRASS',
            pokemon: ['Venusaur', 'Meganium'],
            attacks: [['Sleep Powder', 2], ['Leech Seed', 2], ['Razor Leaf', 2]],
            items: [['Sitrus Berry', 1], ['Withdraw Wand', 1]]
        }),
        fire: Object.freeze({
            id: 'fire',
            name: 'Ember Heart',
            type: 'FIRE',
            pokemon: ['Charizard', 'Typhlosion'],
            attacks: [['Flame Thrower', 2], ['Fire Spin', 2], ['Will-o-wisp', 2]],
            items: [['Sitrus Berry', 1], ['Withdraw Wand', 1]]
        })
    });

    // Built-in fallback used only when locations data is empty/broken.
    const BUILTIN_LOCATIONS = Object.freeze([
        Object.freeze({
            id: 'tidepool-coast',
            name: 'Tidepool Coast',
            terrain: 'Waterfront',
            types: Object.freeze(['WATER', 'ICE']),
            theme: Object.freeze({ accent: '#e8c266', glow: '#4ab0c8', surface: '#143a4a', bgDeep: '#081b26', bgMid: '#123240' }),
            background: 'assets/backgrounds/tidepool-coast.png',
            enabled: true
        })
    ]);

    function randomPick(list) {
        return list[Math.floor(Math.random() * list.length)];
    }

    function getRecordTypes(record) {
        if (record && Array.isArray(record.types)) return record.types;
        if (!record) return [];
        return [record.type1, record.type2, record.type3].filter(type => type && type !== 'NONE');
    }

    function uniqueByName(records) {
        const seen = new Set();
        const unique = [];
        records.forEach(record => {
            if (!record || seen.has(record.name)) return;
            seen.add(record.name);
            unique.push(record);
        });
        return unique;
    }

    function getAllLocations(gameData) {
        return gameData && Array.isArray(gameData.locations) ? gameData.locations : [];
    }

    function getLocations(gameData) {
        return getAllLocations(gameData).filter(location => location && location.enabled !== false);
    }

    function getLocationById(gameData, id) {
        return getAllLocations(gameData).find(location => location && location.id === id) || null;
    }

    function createLocationSnapshot(location) {
        if (!location) return null;
        const theme = location.theme && typeof location.theme === 'object' ? location.theme : {};
        return {
            id: location.id,
            name: location.name,
            terrain: location.terrain || location.name,
            types: Array.isArray(location.types) ? location.types.slice() : [],
            theme: {
                accent: theme.accent || null,
                glow: theme.glow || null,
                surface: theme.surface || null,
                bgDeep: theme.bgDeep || null,
                bgMid: theme.bgMid || null
            },
            background: location.background || null
        };
    }

    /**
     * Picks the next location for a level. Applies a type filter (required type
     * for level 1, or shared type with the previous level otherwise), prefers
     * unvisited locations, and walks a relaxation ladder so the result is never
     * null when any location data exists.
     */
    function chooseNextLocation(gameData, options) {
        const opts = options || {};
        const requiredType = opts.requiredType || null;
        const previousTypes = Array.isArray(opts.previousTypes) ? opts.previousTypes : [];
        const visited = new Set(Array.isArray(opts.visitedIds) ? opts.visitedIds : []);
        const previousId = opts.previousId || null;

        const enabled = getLocations(gameData);

        const matchesType = location => {
            if (requiredType) return getRecordTypes(location).includes(requiredType);
            if (previousTypes.length > 0) return getRecordTypes(location).some(type => previousTypes.includes(type));
            return true;
        };

        const ladder = [
            enabled.filter(location => matchesType(location) && !visited.has(location.id)),
            enabled.filter(location => matchesType(location) && location.id !== previousId),
            enabled.filter(location => !visited.has(location.id)),
            enabled.filter(location => location.id !== previousId),
            enabled
        ];

        for (const pool of ladder) {
            if (pool.length > 0) return randomPick(pool);
        }

        return BUILTIN_LOCATIONS[0];
    }

    function rankListForNode(level, nodeType) {
        const config = LEVEL_CONFIG[level] || LEVEL_CONFIG[1];
        const isBoss = nodeType === 'boss' || nodeType === 'final';
        return (isBoss ? config.bossRanks : config.battleRanks) || [];
    }

    function rollRank(level, nodeType) {
        const mix = rankListForNode(level, nodeType);
        if (mix.length === 0) return 'Standard';

        const total = mix.reduce((sum, entry) => sum + (Number(entry.weight) || 0), 0);
        if (total <= 0) return mix[0].rank;

        let roll = Math.random() * total;
        for (const entry of mix) {
            roll -= Number(entry.weight) || 0;
            if (roll < 0) return entry.rank;
        }
        return mix[mix.length - 1].rank;
    }

    /**
     * True when a trainer's rank may appear at this node type and level. The
     * configured rank mix plus Standard is always allowed; Special is never
     * allowed (it is reserved for event trainers).
     */
    function isAllowedTrainerRank(trainer, nodeType, level) {
        if (!trainer || trainer.rank === 'Special') return false;
        const allowed = new Set(rankListForNode(level, nodeType).map(entry => entry.rank));
        allowed.add('Standard');
        return allowed.has(trainer.rank);
    }

    /**
     * Picks a map/boss trainer. Rolls a rank from the level's rank mix, then
     * walks a ladder preferring the rolled rank and a location-type match, and
     * relaxing both before dropping the exclusion list. Special-rank trainers
     * are excluded at every rung.
     */
    function chooseTrainer(gameData, options) {
        const opts = options || {};
        const { level, nodeType } = opts;
        const locationTypes = Array.isArray(opts.locationTypes) ? opts.locationTypes : [];
        const excludeSet = new Set(Array.isArray(opts.excludeNames) ? opts.excludeNames : []);

        const trainers = (gameData && Array.isArray(gameData.trainers) ? gameData.trainers : [])
            .filter(trainer => trainer && trainer.rank !== 'Special');
        if (trainers.length === 0) return null;

        const rolledRank = rollRank(level, nodeType);
        const isTypeMatch = trainer => Boolean(trainer.typeSpecialization) && locationTypes.includes(trainer.typeSpecialization);
        const isAllowed = trainer => isAllowedTrainerRank(trainer, nodeType, level);

        const attempt = pool => {
            // Rank is the invariant (per the difficulty table), type is only a
            // preference: honor the rolled rank first — with a type match, then
            // without — before ever relaxing the rank. Otherwise a type-matching
            // Standard could displace an Elite at an L4 gauntlet node.
            const rungs = [
                pool.filter(trainer => trainer.rank === rolledRank && isTypeMatch(trainer)),
                pool.filter(trainer => trainer.rank === rolledRank),
                pool.filter(trainer => isAllowed(trainer) && isTypeMatch(trainer)),
                pool.filter(trainer => isAllowed(trainer))
            ];
            for (const rung of rungs) {
                if (rung.length > 0) return randomPick(rung);
            }
            return null;
        };

        const included = trainers.filter(trainer => !excludeSet.has(trainer.name));
        return attempt(included) || attempt(trainers) || randomPick(trainers);
    }

    // --- Area graph generation -------------------------------------------
    // Ported from map/area.js so a single generator drives every level. The
    // output shape { columns, edges, nodes } is identical to the old area.js
    // graph — renderers depend on it, so it must not change.

    const LANE_COUNT = 5;
    const OPENING_LINEAR_STEPS = 3;
    const START_NODE_ID = 'start';

    function bossNodeIdForLevel(level) {
        const config = LEVEL_CONFIG[level] || LEVEL_CONFIG[1];
        return `boss-${config.nodeCount}`;
    }

    /**
     * Builds the area graph for a level from LEVEL_CONFIG. Branching levels
     * (1-3) use the classic 12-step map; the gauntlet level (4) is a strictly
     * linear 6-node chain. `includeEvents === false` zeroes the event weight.
     */
    function createAreaGraph(level, options) {
        const opts = options || {};
        const includeEvents = opts.includeEvents !== false;
        const config = LEVEL_CONFIG[level] || LEVEL_CONFIG[1];

        return config.layout === 'gauntlet'
            ? createGauntletGraph(config)
            : createBranchingGraph(config, includeEvents);
    }

    function graphFromColumns(columns, edges) {
        return { columns, edges, nodes: columns.flat() };
    }

    function createGauntletGraph(config) {
        const nodeCount = config.nodeCount;
        const edges = [];
        const columns = [[makeNode(START_NODE_ID, 2, 0, 'start', nodeCount)]];
        let previous = columns[0][0];

        for (let step = 1; step <= nodeCount; step += 1) {
            const type = forcedTypeForStep(step, config, nodeCount) || 'battle';
            const node = makeNode(singleNodeId(step, nodeCount), 2, step, type, nodeCount);

            columns[step] = [node];
            addEdge(edges, previous.id, node.id);
            previous = node;
        }

        return graphFromColumns(columns, edges);
    }

    function createBranchingGraph(config, includeEvents) {
        const nodeCount = config.nodeCount;
        const counts = { capture: 0, shop: 0 };
        const edges = [];
        const columns = [[makeNode(START_NODE_ID, 2, 0, 'start', nodeCount)]];
        let currentNode = columns[0][0];
        let segmentIndex = 1;

        for (let step = 1; step <= OPENING_LINEAR_STEPS; step += 1) {
            const node = makeStepNode(step, 0, null, config, counts, includeEvents, nodeCount);

            columns[step] = [node];
            addEdge(edges, currentNode.id, node.id);
            currentNode = node;
        }

        while (currentNode.step < nodeCount) {
            const remainingSteps = nodeCount - currentNode.step;

            if (remainingSteps < 3) {
                const node = makeStepNode(currentNode.step + 1, 0, null, config, counts, includeEvents, nodeCount);

                columns[node.step] = [node];
                addEdge(edges, currentNode.id, node.id);
                currentNode = node;
                continue;
            }

            currentNode = addBranchSegment(columns, edges, currentNode, segmentIndex, config, counts, includeEvents, nodeCount);
            segmentIndex += 1;
        }

        const graph = graphFromColumns(columns, edges);
        enforceBranchingGuarantees(graph, config, includeEvents);
        return graph;
    }

    /**
     * Levels 1-3 must have >=3 total capture nodes, and every start->boss
     * path must pass through >=1 qualifying capture (a capture not on a
     * config-forced step) and, when events are enabled, >=1 event. Runs
     * after the weighted rolls and forced steps are already placed, so
     * these conversions may push the capture count past `caps.capture` -
     * per-path coverage takes priority over the roll cap by design.
     */
    function enforceBranchingGuarantees(graph, config, includeEvents) {
        const isQualifyingCapture = node => node.type === 'capture' &&
            !(config.forcedTypes && config.forcedTypes[node.step] === 'capture');
        const isEvent = node => node.type === 'event';
        const exclude = { nodeId: null, branchStep: -1 };

        if (!everyPathHas(graph, isQualifyingCapture)) {
            const converted = convertMandatoryNodeType(graph, config, 'capture', ['battle', 'shop', 'event'], exclude);
            if (converted) {
                exclude.nodeId = converted.nodeId;
                exclude.branchStep = converted.branchStep;
            }
        }

        if (includeEvents && !everyPathHas(graph, isEvent)) {
            convertMandatoryNodeType(graph, config, 'event', ['battle', 'shop'], exclude);
        }

        while (countGraphType(graph, 'capture') < 3) {
            if (!convertRandomBattleNode(graph)) break;
        }
    }

    /**
     * Converts one node that lies on every start->boss path (a single-node
     * column, excluding start/boss/forced steps) to `targetType`, preferring
     * the first type in `preferredTypesInOrder` that has an eligible
     * candidate. `exclude` skips a node/branch-step already converted by an
     * earlier guarantee pass in the same call, so the two passes never
     * fight over the same conversion. Falls back to converting every lane of
     * the earliest branch segment when no single mandatory node qualifies.
     */
    function convertMandatoryNodeType(graph, config, targetType, preferredTypesInOrder, exclude) {
        const mandatory = mandatoryNodes(graph, config).filter(node => node.id !== exclude.nodeId);

        for (const type of preferredTypesInOrder) {
            const candidates = mandatory.filter(node => node.type === type);
            if (candidates.length > 0) {
                const chosen = randomPick(candidates);
                chosen.type = targetType;
                return { nodeId: chosen.id, branchStep: -1 };
            }
        }

        const branchStep = findBranchStep(graph, exclude.branchStep);
        if (branchStep === -1) return null;

        graph.columns[branchStep].forEach(node => { node.type = targetType; });
        return { nodeId: graph.columns[branchStep][0].id, branchStep };
    }

    // Nodes in a single-node column lie on every start->boss path.
    function mandatoryNodes(graph, config) {
        const nodeCount = config.nodeCount;
        return graph.columns
            .filter(column => column.length === 1)
            .map(column => column[0])
            .filter(node => node.step !== 0 && node.step !== nodeCount)
            .filter(node => !(config.forcedTypes && config.forcedTypes[node.step]));
    }

    function findBranchStep(graph, excludeStep) {
        for (let step = 0; step < graph.columns.length; step += 1) {
            if (step === excludeStep) continue;
            if (graph.columns[step].length > 1) return step;
        }
        return -1;
    }

    function countGraphType(graph, type) {
        return graph.nodes.filter(node => node.type === type).length;
    }

    function convertRandomBattleNode(graph) {
        const battleNodes = graph.nodes.filter(node => node.type === 'battle');
        if (battleNodes.length === 0) return false;

        randomPick(battleNodes).type = 'capture';
        return true;
    }

    /**
     * Every start->boss path through the graph, as arrays of node ids. Pure
     * DFS over `graph.edges`; branching maps have at most a few dozen paths.
     */
    function listAllPaths(graph) {
        const boss = graph.nodes.find(node => node.type === 'boss');
        if (!boss) return [];

        const adjacency = {};
        graph.edges.forEach(edge => {
            if (!adjacency[edge.from]) adjacency[edge.from] = [];
            adjacency[edge.from].push(edge.to);
        });

        const paths = [];
        const walk = (nodeId, path) => {
            const nextPath = path.concat(nodeId);
            if (nodeId === boss.id) {
                paths.push(nextPath);
                return;
            }
            (adjacency[nodeId] || []).forEach(nextId => walk(nextId, nextPath));
        };

        walk(START_NODE_ID, []);
        return paths;
    }

    function everyPathHas(graph, predicate) {
        const byId = {};
        graph.nodes.forEach(node => { byId[node.id] = node; });

        return listAllPaths(graph).every(path => path.some(nodeId => predicate(byId[nodeId])));
    }

    function makeStepNode(step, lane, id, config, counts, includeEvents, nodeCount) {
        const type = forcedTypeForStep(step, config, nodeCount) || pickRandomType(config, counts, includeEvents);

        tallyType(counts, type);
        return makeNode(id || singleNodeId(step, nodeCount), lane, step, type, nodeCount);
    }

    function addBranchSegment(columns, edges, sourceNode, segmentIndex, config, counts, includeEvents, nodeCount) {
        const remainingSteps = nodeCount - sourceNode.step;
        const branchLength = chooseBranchLength(remainingSteps);
        const branchCount = randomInt(2, 3);
        const lanes = getBranchLanes(branchCount);
        let previousBranchNodes = [];

        for (let offset = 1; offset <= branchLength; offset += 1) {
            const step = sourceNode.step + offset;
            const branchNodes = lanes.map((lane, branchIndex) => {
                const type = pickRandomType(config, counts, includeEvents);

                tallyType(counts, type);
                return makeNode(`node-${step}-${branchIndex + 1}`, lane, step, type, nodeCount);
            });

            columns[step] = branchNodes;

            branchNodes.forEach((node, branchIndex) => {
                const fromNode = offset === 1 ? sourceNode : previousBranchNodes[branchIndex];

                addEdge(edges, fromNode.id, node.id);
            });

            previousBranchNodes = branchNodes;
        }

        const joinStep = sourceNode.step + branchLength + 1;
        const joinNode = makeStepNode(joinStep, 2, joinNodeId(joinStep, segmentIndex, nodeCount), config, counts, includeEvents, nodeCount);

        columns[joinStep] = [joinNode];
        previousBranchNodes.forEach(node => addEdge(edges, node.id, joinNode.id));

        return joinNode;
    }

    function makeNode(id, lane, step, type, nodeCount) {
        const x = 5 + ((step / nodeCount) * 90);
        const lanePercent = LANE_COUNT === 1 ? 50 : 18 + ((lane / (LANE_COUNT - 1)) * 64);

        return {
            id,
            lane,
            step,
            type,
            x: roundOneDecimal(x),
            y: roundOneDecimal(clamp(lanePercent, 10, 90))
        };
    }

    // The final step is always a boss node; other forced types come from config.
    function forcedTypeForStep(step, config, nodeCount) {
        if (step === nodeCount) return 'boss';

        const forced = config.forcedTypes || {};
        return forced[step] || null;
    }

    /**
     * Weighted random node type honoring per-level weights, the event toggle,
     * and capture/shop caps. Battle is never capped, so the pool is never empty.
     */
    function pickRandomType(config, counts, includeEvents) {
        const weights = config.weights || {};
        const caps = config.caps || {};
        const entries = [];
        const pushWeight = (type, weight) => { if (weight > 0) entries.push({ type, weight }); };

        pushWeight('battle', weights.battle || 0);
        if ((counts.capture || 0) < (caps.capture != null ? caps.capture : Infinity)) {
            pushWeight('capture', weights.capture || 0);
        }
        if (includeEvents) pushWeight('event', weights.event || 0);
        if ((counts.shop || 0) < (caps.shop != null ? caps.shop : Infinity)) {
            pushWeight('shop', weights.shop || 0);
        }

        if (entries.length === 0) return 'battle';

        const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
        let roll = Math.random() * total;

        for (const entry of entries) {
            roll -= entry.weight;
            if (roll <= 0) return entry.type;
        }

        return entries[0].type;
    }

    // Forced and rolled nodes both count toward caps.
    function tallyType(counts, type) {
        if (type === 'capture') counts.capture = (counts.capture || 0) + 1;
        else if (type === 'shop') counts.shop = (counts.shop || 0) + 1;
    }

    function chooseBranchLength(remainingSteps) {
        if (remainingSteps <= 3) return 2;
        if (remainingSteps === 4) return 3;
        if (remainingSteps === 5) return 3;

        return randomInt(2, 3);
    }

    function getBranchLanes(branchCount) {
        if (branchCount === 3) return [0, 2, 4];

        return Math.random() < 0.5 ? [1, 3] : [0, 4];
    }

    function singleNodeId(step, nodeCount) {
        if (step === nodeCount) return `boss-${nodeCount}`;

        return `node-${step}-1`;
    }

    function joinNodeId(step, segmentIndex, nodeCount) {
        if (step === nodeCount) return `boss-${nodeCount}`;

        return `node-${step}-join-${segmentIndex}`;
    }

    function addEdge(edges, from, to) {
        const key = `${from}->${to}`;

        if (edges.some(edge => `${edge.from}->${edge.to}` === key)) return false;

        edges.push({ from, to });
        return true;
    }

    function randomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function roundOneDecimal(value) {
        return Math.round(value * 10) / 10;
    }

    /**
     * Advances a run to its next level in place: bumps the level, picks a new
     * location sharing a type with the current one, regenerates a fresh area
     * graph, and wipes every per-area encounter map. Collections, cash,
     * nextCardId, and starterId are left untouched. Caller guards level bounds.
     */
    function advanceRunToNextLevel(run, gameData, options) {
        const opts = options || {};
        const includeEvents = opts.includeEvents !== false;

        run.level += 1;

        const nextLocation = chooseNextLocation(gameData, {
            previousTypes: run.location ? run.location.types : [],
            visitedIds: run.visitedLocationIds,
            previousId: run.location ? run.location.id : null
        });
        const snapshot = createLocationSnapshot(nextLocation);

        run.location = snapshot;
        if (!Array.isArray(run.visitedLocationIds)) run.visitedLocationIds = [];
        if (snapshot && !run.visitedLocationIds.includes(snapshot.id)) {
            run.visitedLocationIds.push(snapshot.id);
        }

        run.area = {
            activeBattleNodeId: null,
            activeCaptureNodeId: null,
            activeEventNodeId: null,
            activeMartNodeId: null,
            bossNodeId: bossNodeIdForLevel(run.level),
            completed: false,
            completedAt: null,
            completedBossNodeId: null,
            currentNodeId: START_NODE_ID,
            graph: createAreaGraph(run.level, { includeEvents }),
            traveledPathKeys: [],
            visitedNodeIds: [START_NODE_ID]
        };
        run.battleEncounters = {};
        run.captureEncounters = {};
        run.martEncounters = {};
        run.eventEncounters = {};

        return run;
    }

    /**
     * Applies the run's location palette to <body> as inline custom
     * properties plus a data-location attribute. Inline body styles survive
     * the innerHTML re-renders the pages use, and the document guard keeps
     * this module loadable in Node tests. No run/location/theme -> no-op,
     * leaving the neutral stylesheet defaults untouched.
     */
    function applyLocationTheme(run) {
        if (typeof document === 'undefined' || !document.body) return;

        const location = run && run.location;
        if (!location || !location.theme) return;

        const style = document.body.style;
        const setToken = (name, value) => { if (value) style.setProperty(name, value); };

        setToken('--loc-accent', location.theme.accent);
        setToken('--loc-glow', location.theme.glow);
        setToken('--loc-surface', location.theme.surface);
        setToken('--loc-bg-deep', location.theme.bgDeep);
        setToken('--loc-bg-mid', location.theme.bgMid);

        if (location.background) {
            // Resolve against the document: a relative url() inside a custom
            // property is otherwise resolved against the stylesheet that
            // substitutes it (static/styles.css), which breaks the path.
            const backgroundUrl = new URL(location.background, document.baseURI).href;
            style.setProperty('--page-bg-image', `url("${backgroundUrl}")`);
        } else {
            style.removeProperty('--page-bg-image');
        }

        document.body.dataset.location = location.id || '';
    }

    /**
     * Wild pokemon pool for a location: unique-by-name, obtainable species
     * (not legendary, not a baby, not a mega target) with at least one type
     * slot in the location's types. Falls back to all obtainable species so
     * the pool is never empty.
     */
    function getWildPokemonPool(gameData, locationTypes) {
        const pokemon = gameData && Array.isArray(gameData.pokemon) ? gameData.pokemon : [];
        const unique = uniqueByName(pokemon);
        const obtainable = unique.filter(species => isObtainablePokemon(species, gameData));
        const types = Array.isArray(locationTypes) ? locationTypes : [];

        const matched = obtainable.filter(species => getRecordTypes(species).some(type => types.includes(type)));
        return matched.length > 0 ? matched : obtainable;
    }

    // --- Baby/mega pokemon (phase 42) -------------------------------------
    // There is no mega type: a "mega" is any record referenced by some
    // baby's evolvesInto (name or id). Zero baby data exists today, so
    // these are inert until the owner authors baby/mega cards.

    /**
     * Resolves a pokemon reference (as used by `evolvesInto`) to a record by
     * exact name match, else exact id match, else null.
     */
    function findPokemonByNameOrId(gameData, ref) {
        if (!ref) return null;
        const pokemon = gameData && Array.isArray(gameData.pokemon) ? gameData.pokemon : [];
        return pokemon.find(record => record && record.name === ref) ||
            pokemon.find(record => record && record.id === ref) ||
            null;
    }

    function isBabyPokemon(record) {
        return getRecordTypes(record).includes('BABY');
    }

    // Set of every name AND id resolved from any baby's evolvesInto, so
    // isMegaPokemon can match a record by either key.
    function getMegaTargetKeys(gameData) {
        const pokemon = gameData && Array.isArray(gameData.pokemon) ? gameData.pokemon : [];
        const keys = new Set();

        pokemon.filter(isBabyPokemon).forEach(baby => {
            const mega = findPokemonByNameOrId(gameData, baby.evolvesInto);
            if (!mega) return;
            keys.add(mega.name);
            keys.add(mega.id);
        });

        return keys;
    }

    function isMegaPokemon(record, gameData) {
        if (!record) return false;
        const keys = getMegaTargetKeys(gameData);
        return keys.has(record.name) || keys.has(record.id);
    }

    function getBabyPokemonPool(gameData) {
        const pokemon = gameData && Array.isArray(gameData.pokemon) ? gameData.pokemon : [];
        return uniqueByName(pokemon).filter(isBabyPokemon);
    }

    function isObtainablePokemon(record, gameData) {
        if (!record) return false;
        if (getRecordTypes(record).includes('LEGENDARY')) return false;
        if (isBabyPokemon(record)) return false;
        if (isMegaPokemon(record, gameData)) return false;
        return true;
    }

    function getObtainablePokemonPool(gameData) {
        const pokemon = gameData && Array.isArray(gameData.pokemon) ? gameData.pokemon : [];
        return uniqueByName(pokemon).filter(record => isObtainablePokemon(record, gameData));
    }

    // --- Mart stock eligibility (phase 43) ---------------------------------
    // No LEGENDARY-typed attack in stock without an owned LEGENDARY pokemon;
    // no dragon-gem item in stock without both a DRAGON attack and a DRAGON
    // pokemon owned. "Owned" = active or bench.

    function getRunPokemonRecords(run) {
        const collections = run && run.collections;
        if (!collections) return [];
        const active = Array.isArray(collections.pokemon) ? collections.pokemon : [];
        const bench = collections.bench && Array.isArray(collections.bench.pokemon) ? collections.bench.pokemon : [];
        return [...active, ...bench].map(card => card && card.pokemon).filter(Boolean);
    }

    function getRunAttackRecords(run) {
        const collections = run && run.collections;
        if (!collections) return [];
        const active = Array.isArray(collections.actions) ? collections.actions : [];
        const bench = collections.bench && Array.isArray(collections.bench.actions) ? collections.bench.actions : [];
        return [...active, ...bench]
            .filter(card => card && card.kind === 'attack')
            .map(card => card.attack)
            .filter(Boolean);
    }

    function runOwnsLegendaryPokemon(run) {
        return getRunPokemonRecords(run).some(record => getRecordTypes(record).includes('LEGENDARY'));
    }

    function runHasDragonGemPrereqs(run) {
        const hasDragonAttack = getRunAttackRecords(run).some(record => getRecordTypes(record).includes('DRAGON'));
        const hasDragonPokemon = getRunPokemonRecords(run).some(record => getRecordTypes(record).includes('DRAGON'));
        return hasDragonAttack && hasDragonPokemon;
    }

    function itemIsDragonGem(item) {
        return Boolean(item && Array.isArray(item.status) && item.status.includes('DRAGON_GEM'));
    }

    /**
     * Whether a candidate record may appear in mart stock for the given
     * collection. Evaluated at encounter creation/repair time only — gaining
     * a legendary/dragon prereq later does not retro-upgrade existing stock.
     */
    function isMartOfferAllowed(record, collectionKey, run) {
        if (!record) return false;
        if (collectionKey === 'attacks') {
            return !(getRecordTypes(record).includes('LEGENDARY') && !runOwnsLegendaryPokemon(run));
        }
        if (collectionKey === 'items') {
            return !(itemIsDragonGem(record) && !runHasDragonGemPrereqs(run));
        }
        return true;
    }

    global.PokeLocations = {
        LEVEL_CONFIG,
        STARTER_DECKS,
        TOTAL_LEVELS,
        advanceRunToNextLevel,
        applyLocationTheme,
        bossNodeIdForLevel,
        chooseNextLocation,
        chooseTrainer,
        createAreaGraph,
        createLocationSnapshot,
        findPokemonByNameOrId,
        getBabyPokemonPool,
        getLocationById,
        getLocations,
        getMegaTargetKeys,
        getObtainablePokemonPool,
        getRunAttackRecords,
        getRunPokemonRecords,
        getWildPokemonPool,
        isAllowedTrainerRank,
        isBabyPokemon,
        isMartOfferAllowed,
        isMegaPokemon,
        isObtainablePokemon,
        listAllPaths,
        runHasDragonGemPrereqs,
        runOwnsLegendaryPokemon
    };
})(window);
