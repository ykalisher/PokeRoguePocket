/**
 * Pocket Nuzlocke - locations framework
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
        1: {
            nodeCount: 11,
            layout: 'branching',
            forcedTypes: { 1: 'capture', 2: 'capture', 3: 'battle' },
            quotas: { battle: [2, 3], capture: [2, 4], event: [2, 3], shop: [1, 2], attack: [1, 2] },
            battleRanks: [{ rank: 'Standard', weight: 100 }],
            bossRanks: [{ rank: 'Boss', weight: 100 }]
        },
        2: {
            nodeCount: 11,
            layout: 'branching',
            forcedTypes: {},
            quotas: { battle: [3, 4], capture: [1, 3], event: [2, 3], shop: [1, 2], attack: [1, 2] },
            battleRanks: [{ rank: 'Standard', weight: 60 }, { rank: 'Ace', weight: 40 }],
            bossRanks: [{ rank: 'Boss', weight: 100 }]
        },
        3: {
            nodeCount: 11,
            layout: 'branching',
            forcedTypes: {},
            quotas: { battle: [2, 3], capture: [1, 2], event: [2, 3], shop: [1, 2], attack: [2, 3] },
            battleRanks: [{ rank: 'Ace', weight: 100 }],
            bossRanks: [{ rank: 'Elite', weight: 100 }]
        },
        4: {
            nodeCount: 6,
            layout: 'gauntlet',
            forcedTypes: { 1: 'shop', 2: 'battle', 3: 'battle', 4: 'shop', 5: 'battle' },
            quotas: null,
            battleRanks: [{ rank: 'Elite', weight: 100 }],
            bossRanks: [{ rank: 'Elite', weight: 100 }]
        }
    });

    // Built-in fallback used when the loaded starter-deck data is empty/broken,
    // and by Node tests that require this module without loadGameData().
    const BUILTIN_STARTER_DECKS = Object.freeze({
        water: Object.freeze({
            id: 'water',
            name: 'Water',
            type: 'WATER',
            pokemon: ['Blastoise', 'Feraligatr'],
            attacks: [['Surf', 2], ['Waterfall', 2], ['Crunch', 1], ['Sucker Punch', 1]],
            items: [['Sitrus Berry', 1], ['Withdraw Wand', 1]]
        }),
        grass: Object.freeze({
            id: 'grass',
            name: 'Grass',
            type: 'GRASS',
            pokemon: ['Venusaur', 'Meganium'],
            attacks: [['Razor Leaf', 3], ['Sleep Powder', 1], ['Sludge Bomb', 1], ['Moon Blast', 1]],
            items: [['Sitrus Berry', 1], ['Withdraw Wand', 1]]
        }),
        fire: Object.freeze({
            id: 'fire',
            name: 'Fire',
            type: 'FIRE',
            pokemon: ['Charizard', 'Typhlosion'],
            attacks: [['Flame Thrower', 2], ['Fire Spin', 2], ['Air Slash', 1], ['Shadow Ball', 1]],
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

    /**
     * The starter decks the game should offer, keyed by id. Reads the loaded
     * data file when available and falls back to the frozen builtins, so
     * modules required in Node without loadGameData() still work.
     */
    function getStarterDecks(gameData) {
        const records = gameData && Array.isArray(gameData.starterDecks) ? gameData.starterDecks : [];
        const enabled = records.filter(deck => deck && deck.id && deck.enabled !== false);

        if (enabled.length === 0) return BUILTIN_STARTER_DECKS;

        return Object.fromEntries(enabled.map(deck => [deck.id, deck]));
    }

    /**
     * A deck with `requiresAchievement` set stays locked until that achievement
     * id is unlocked in the local profile. Fails closed when the profile module
     * is absent (same rule as achievement event conditions in event_effects.js);
     * validation guarantees at least one enabled deck carries no requirement, so
     * the picker always has something to offer.
     */
    function isStarterDeckUnlocked(deck) {
        const required = deck && typeof deck.requiresAchievement === 'string'
            ? deck.requiresAchievement.trim()
            : '';

        if (!required) return true;

        return Boolean(global.PokeProfile && global.PokeProfile.isUnlocked(required));
    }

    /**
     * getStarterDecks() minus the decks still locked behind an achievement.
     * Falls back to the full set if every deck is locked, so a bad data state
     * can never leave a run with no deck to build from.
     */
    function getUnlockedStarterDecks(gameData) {
        const decks = getStarterDecks(gameData);
        const unlocked = Object.entries(decks).filter(([, deck]) => isStarterDeckUnlocked(deck));

        if (unlocked.length === 0) return decks;

        return Object.fromEntries(unlocked);
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
    const START_NODE_ID = 'start';
    const MIN_BRANCH_STEP = 4;
    const ARRANGEMENT_ATTEMPTS = 48;
    // Order the event quota is re-homed into when a location has no events:
    // scarcest-first, so disabling events never floods the map with battles.
    const EVENT_FALLBACK_ORDER = ['capture', 'shop', 'attack', 'battle'];

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

    /**
     * Levels 1-3: every start->boss route is exactly 11 nodes (10 + boss),
     * with exactly one one-step-wide branch of 2-3 lanes. Because a route may
     * take any lane, the 9 non-branch steps must independently satisfy every
     * quota minimum; the minimums total 8, so the base multiset is the
     * minimums plus one free token, and each lane adds 1 to a category that
     * still has headroom. Quotas hold by construction - no repair pass.
     */
    function createBranchingGraph(config, includeEvents) {
        const quotas = resolveQuotas(config, includeEvents);
        const branchStep = chooseBranchStep(config);
        const baseCounts = buildBaseCounts(config, quotas);
        const laneTypes = chooseLaneTypes(quotas, baseCounts, randomInt(2, 3));
        const stepTypes = buildStepTypes(config, baseCounts, branchStep, laneTypes);

        return assembleBranchingGraph(config, stepTypes, branchStep, laneTypes);
    }

    // With events disabled the event minimum is re-homed onto the categories
    // that are currently scarcest, keeping the minimum total at 8 and every
    // surviving category's headroom (max - min) intact.
    function resolveQuotas(config, includeEvents) {
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

    // The branch may not collide with a forced step and may not be the boss.
    function chooseBranchStep(config) {
        const forcedSteps = Object.keys(config.forcedTypes || {}).map(Number);
        const first = Math.max(MIN_BRANCH_STEP,
            forcedSteps.length > 0 ? Math.max.apply(null, forcedSteps) + 1 : 1);

        return randomInt(first, config.nodeCount - 1);
    }

    /**
     * How many of each type fill the 9 non-branch steps: every minimum, plus
     * the leftover slots handed out one at a time to a UNIFORMLY RANDOM
     * category that still has headroom. Uniform matters - biasing toward the
     * widest headroom makes the pick deterministic and strands a minimum
     * (see failure mode 2 in the phase notes).
     */
    function buildBaseCounts(config, quotas) {
        const types = Object.keys(quotas);
        const counts = {};
        let remaining = config.nodeCount - 2;

        types.forEach(type => { counts[type] = quotas[type][0]; remaining -= quotas[type][0]; });
        if (remaining < 0) throw new Error(`quota minimums exceed ${config.nodeCount - 2} base nodes`);

        while (remaining > 0) {
            const candidates = types.filter(type => counts[type] < quotas[type][1]);

            if (candidates.length === 0) throw new Error('quota maximums cannot fill the base steps');

            counts[randomPick(candidates)] += 1;
            remaining -= 1;
        }

        return counts;
    }

    // A lane is legal only where the base count is still below the maximum,
    // so base + 1 stays in range. Lanes are distinct types so the branch is a
    // real choice; fewer than 2 legal categories means the quotas are broken.
    function chooseLaneTypes(quotas, baseCounts, laneCount) {
        const candidates = Object.keys(quotas).filter(type => baseCounts[type] < quotas[type][1]);

        if (candidates.length < 2) throw new Error('quotas leave fewer than 2 branchable categories');

        return shuffle(candidates).slice(0, Math.min(laneCount, candidates.length));
    }

    /**
     * Types for every single-node step, keyed by step. The multiset is fixed
     * by buildBaseCounts; only the ORDER is random. Forced steps claim their
     * token first. Ordering is best-of-K on a cosmetic penalty, so it can
     * never break a quota - the worst case is a repetitive-looking map.
     */
    function buildStepTypes(config, baseCounts, branchStep, laneTypes) {
        const baseSteps = [];

        for (let step = 1; step < config.nodeCount; step += 1) {
            if (step !== branchStep) baseSteps.push(step);
        }

        const pool = [];

        Object.keys(baseCounts).forEach(type => {
            for (let i = 0; i < baseCounts[type]; i += 1) pool.push(type);
        });
        if (pool.length !== baseSteps.length) {
            throw new Error(`base counts total ${pool.length}, expected ${baseSteps.length}`);
        }

        const forced = config.forcedTypes || {};
        const fixed = {};
        const freeSteps = [];

        baseSteps.forEach(step => {
            const type = forced[step];

            if (!type) {
                freeSteps.push(step);
                return;
            }

            const index = pool.indexOf(type);

            if (index === -1) throw new Error(`forced ${type}@${step} exceeds its base count`);
            pool.splice(index, 1);
            fixed[step] = type;
        });

        let best = null;
        let bestPenalty = Infinity;

        for (let attempt = 0; attempt < ARRANGEMENT_ATTEMPTS; attempt += 1) {
            const shuffled = shuffle(pool.slice());
            const candidate = Object.assign({}, fixed);

            freeSteps.forEach((step, index) => { candidate[step] = shuffled[index]; });

            const penalty = layoutPenalty(candidate, config, branchStep, laneTypes);

            if (penalty < bestPenalty) {
                best = candidate;
                bestPenalty = penalty;
            }
            if (bestPenalty === 0) break;
        }

        return best;
    }

    // Three of a type in a row is heavily penalized; a single adjacent repeat
    // is mildly penalized. A forced pair (L1's capture,capture opening) is
    // exempt, since the owner locked that opening.
    function layoutPenalty(stepTypes, config, branchStep, laneTypes) {
        const forced = config.forcedTypes || {};
        let penalty = 0;

        laneTypes.forEach(laneType => {
            const sequence = [];

            for (let step = 1; step < config.nodeCount; step += 1) {
                sequence.push({ step, type: step === branchStep ? laneType : stepTypes[step] });
            }

            for (let i = 1; i < sequence.length; i += 1) {
                if (sequence[i].type !== sequence[i - 1].type) continue;
                if (!(forced[sequence[i].step] && forced[sequence[i - 1].step])) penalty += 1;
                if (i >= 2 && sequence[i - 2].type === sequence[i].type) penalty += 100;
            }
        });

        return penalty;
    }

    function assembleBranchingGraph(config, stepTypes, branchStep, laneTypes) {
        const nodeCount = config.nodeCount;
        const lanes = getBranchLanes(laneTypes.length);
        const edges = [];
        const columns = [[makeNode(START_NODE_ID, 2, 0, 'start', nodeCount)]];

        for (let step = 1; step <= nodeCount; step += 1) {
            columns[step] = step === branchStep
                ? laneTypes.map((type, index) =>
                    makeNode(`node-${step}-${index + 1}`, lanes[index], step, type, nodeCount))
                : [makeNode(singleNodeId(step, nodeCount), 2, step,
                    forcedTypeForStep(step, config, nodeCount) || stepTypes[step], nodeCount)];

            columns[step - 1].forEach(from =>
                columns[step].forEach(to => addEdge(edges, from.id, to.id)));
        }

        return graphFromColumns(columns, edges);
    }

    function shuffle(list) {
        for (let i = list.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            const swap = list[i];

            list[i] = list[j];
            list[j] = swap;
        }

        return list;
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

    function getBranchLanes(branchCount) {
        if (branchCount === 3) return [0, 2, 4];

        return Math.random() < 0.5 ? [1, 3] : [0, 4];
    }

    function singleNodeId(step, nodeCount) {
        if (step === nodeCount) return `boss-${nodeCount}`;

        return `node-${step}-1`;
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
     * The level's music track is cleared so the new level picks a new song.
     */
    function advanceRunToNextLevel(run, gameData, options) {
        const opts = options || {};
        const includeEvents = opts.includeEvents !== false;

        run.level += 1;
        run.musicTrackId = null;

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
            activeAttackNodeId: null,
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
        run.attackEncounters = {};
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

    /**
     * Attack pool for a location: unique-by-name attacks that are neither
     * legendary nor artificial (both are encoded as PokeTypes in type1/type2,
     * not as flags) and share at least one type with the location. Falls back
     * to every offerable attack so an attack node is never empty.
     */
    function getAttackCardPool(gameData, locationTypes) {
        const attacks = gameData && Array.isArray(gameData.attacks) ? gameData.attacks : [];
        const offerable = uniqueByName(attacks).filter(isOfferableAttack);
        const types = Array.isArray(locationTypes) ? locationTypes : [];

        const matched = offerable.filter(record => getRecordTypes(record).some(type => types.includes(type)));

        return matched.length > 0 ? matched : offerable;
    }

    function isOfferableAttack(record) {
        if (!record) return false;

        const types = getRecordTypes(record);

        return !types.includes('LEGENDARY') && !types.includes('ARTIFICIAL');
    }

    // 1-3 distinct attacks, matching the wild-capture encounter's offer size.
    function chooseAttackCardOptions(gameData, locationTypes) {
        const pool = getAttackCardPool(gameData, locationTypes);

        if (pool.length === 0) return [];

        return shuffle(pool.slice()).slice(0, randomInt(1, Math.min(3, pool.length)));
    }

    // --- Baby/mega pokemon (phase 42) -------------------------------------
    // There is no mega type. A "mega" is any record referenced by some baby's
    // evolvesInto (name or id), OR one matching the mega convention: id > 9000
    // (see isMegaByConvention). Babies are BABY-typed records; both are
    // excluded from wild/obtainable pools.

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

    function isEventOnlyPokemon(record) {
        return Boolean(record && record.eventOnly === true);
    }

    // Set of every name AND id resolved from any baby's evolvesInto, so
    // isMegaPokemon can match a record by either key.
    // Cache keyed by the gameData object itself: loadGameData() replaces
    // arena.GameData with a fresh object on every load, so object identity is
    // the invalidation and stale entries are garbage-collected with their data.
    const megaKeyCache = new WeakMap();

    function getMegaTargetKeys(gameData) {
        if (!gameData || typeof gameData !== 'object') return computeMegaTargetKeys(gameData);

        let keys = megaKeyCache.get(gameData);

        if (!keys) {
            keys = computeMegaTargetKeys(gameData);
            megaKeyCache.set(gameData, keys);
        }

        return keys;
    }

    function computeMegaTargetKeys(gameData) {
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

    // A record is a mega if any baby's evolvesInto resolves to it, OR by
    // convention: its id is above 9000 (all mega cards are authored with ids
    // >9000). Id — not name — is the rule on purpose: names are unreliable
    // (e.g. "Meganium" starts with "Mega" but is id 0154, not a mega). The
    // convention keeps megas out of the wild/obtainable pools even before a
    // baby links to one.
    function isMegaByConvention(record) {
        if (!record) return false;
        const idNum = parseInt(record && record.id, 10);
        return Number.isFinite(idNum) && idNum > 9000;
    }

    function isMegaPokemon(record, gameData) {
        if (!record) return false;
        if (isMegaByConvention(record)) return true;
        const keys = getMegaTargetKeys(gameData);
        return keys.has(record.name) || keys.has(record.id);
    }

    /**
     * Baby pool, optionally narrowed to a location's types. Falls back to every
     * baby when nothing matches, so a typed grant never comes up empty.
     */
    function getBabyPokemonPool(gameData, locationTypes) {
        const pokemon = gameData && Array.isArray(gameData.pokemon) ? gameData.pokemon : [];
        const babies = uniqueByName(pokemon).filter(isBabyPokemon);
        const types = Array.isArray(locationTypes) ? locationTypes : [];

        if (types.length === 0) return babies;

        const matched = babies.filter(record => getRecordTypes(record).some(type => types.includes(type)));

        return matched.length > 0 ? matched : babies;
    }

    function isObtainablePokemon(record, gameData) {
        if (!record) return false;
        if (getRecordTypes(record).includes('LEGENDARY')) return false;
        if (isBabyPokemon(record)) return false;
        if (isMegaPokemon(record, gameData)) return false;
        if (isEventOnlyPokemon(record)) return false;
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

    // --- Mart trade service (phase 46) --------------------------------------
    // Each mart offers MART_TRADE_COUNT independent trades. An offer's wanted
    // type AND the exact species it hands back are rolled once, when the
    // encounter is created, and persist until that offer is used or its roll
    // goes stale (see sanitizeMartTrades, called from map/area.js and
    // map/mart.js).

    const MART_TRADE_COUNT = 2;

    function getDistinctRecordTypes(records) {
        const types = new Set();
        records.forEach(record => getRecordTypes(record).forEach(type => types.add(type)));
        return Array.from(types);
    }

    /**
     * Rolls the mart trade's two types: `acceptedType` uniform over the
     * distinct types present on the player's active+bench pokemon (what the
     * player may trade away), excluding LEGENDARY and BABY so the mart never
     * asks the player to give one up; `offeredType` uniform over the distinct
     * types that have at least one obtainable species (what the player may
     * receive — already excludes LEGENDARY/BABY via getObtainablePokemonPool).
     * Returns null if the player owns no eligible pokemon.
     */
    function rollMartTradeTypes(run, gameData) {
        const ownedTypes = getDistinctRecordTypes(getRunPokemonRecords(run))
            .filter(type => type !== 'LEGENDARY' && type !== 'BABY');
        if (ownedTypes.length === 0) return null;

        const offerableTypes = getDistinctRecordTypes(getObtainablePokemonPool(gameData));
        if (offerableTypes.length === 0) return null;

        return {
            acceptedType: randomPick(ownedTypes),
            offeredType: randomPick(offerableTypes)
        };
    }

    /**
     * Uniform pick over obtainable species whose types include offeredType,
     * excluding `exclude` (a name or a list of names) when possible — falls
     * back to including them if they are the only matches, since the pool is
     * never empty on a valid roll.
     */
    function chooseTradeResultRecord(gameData, offeredType, exclude) {
        const excluded = new Set((Array.isArray(exclude) ? exclude : [exclude]).filter(Boolean));
        const matching = getObtainablePokemonPool(gameData)
            .filter(record => getRecordTypes(record).includes(offeredType));
        const withoutExcluded = matching.filter(record => !excluded.has(record.name));
        const candidates = withoutExcluded.length > 0 ? withoutExcluded : matching;

        return candidates.length > 0 ? randomPick(candidates) : null;
    }

    /**
     * Rolls one whole trade offer: the wanted type plus the exact species the
     * mart hands back, so the player can see what they are trading for.
     * excludeNames keeps an offer off the other offers' species (and off the
     * species the run already owns) when the pool allows it.
     * Returns null when the run has nothing tradeable.
     */
    function rollMartTrade(run, gameData, excludeNames) {
        const types = rollMartTradeTypes(run, gameData);

        if (!types) return null;

        const owned = getRunPokemonRecords(run).map(record => record.name);
        const exclude = [...(Array.isArray(excludeNames) ? excludeNames : []), ...owned];
        const record = chooseTradeResultRecord(gameData, types.offeredType, exclude);

        if (!record) return null;

        return { acceptedType: types.acceptedType, offeredName: record.name };
    }

    function martTradeIsStale(trade, run, gameData) {
        if (!trade || !trade.acceptedType || !trade.offeredName) return true;
        if (!getRunPokemonRecords(run).some(record => getRecordTypes(record).includes(trade.acceptedType))) return true;
        return !getObtainablePokemonPool(gameData).some(record => record.name === trade.offeredName);
    }

    /**
     * Brings encounter.trades up to MART_TRADE_COUNT valid offers, re-rolling
     * any that went stale: old saves missing the fields, the player no longer
     * owning a pokemon of the wanted type, or the offered species having left
     * the obtainable pool (data changed). Used offers are never touched, and
     * re-rolls avoid the other offers' species. (Pre-array saves are migrated
     * to a one-entry `trades` array by normalizeMartEncounters in
     * map/run_state.js, so their offers land here as stale entries.)
     * Returns whether anything changed.
     */
    function sanitizeMartTrades(encounter, run, gameData) {
        const existing = Array.isArray(encounter.trades) ? encounter.trades : [];
        const trades = [];
        let changed = !Array.isArray(encounter.trades) || encounter.trades.length !== MART_TRADE_COUNT;

        for (let index = 0; index < MART_TRADE_COUNT; index += 1) {
            const trade = existing[index] || null;

            if (trade && (trade.used || !martTradeIsStale(trade, run, gameData))) {
                trades.push(trade);
                continue;
            }

            const excludeNames = trades.map(other => other.offeredName).filter(Boolean);
            const rolled = rollMartTrade(run, gameData, excludeNames);

            trades.push({
                acceptedType: rolled ? rolled.acceptedType : null,
                offeredName: rolled ? rolled.offeredName : null,
                used: Boolean(trade && trade.used)
            });
            changed = true;
        }

        encounter.trades = trades;

        return changed;
    }

    global.PokeLocations = {
        LEVEL_CONFIG,
        MART_TRADE_COUNT,
        // Alias kept so callers that never load game data (Node tests, the
        // data editor's engine refs) still see the built-in decks.
        STARTER_DECKS: BUILTIN_STARTER_DECKS,
        TOTAL_LEVELS,
        advanceRunToNextLevel,
        applyLocationTheme,
        bossNodeIdForLevel,
        chooseAttackCardOptions,
        chooseNextLocation,
        chooseTradeResultRecord,
        chooseTrainer,
        createAreaGraph,
        createLocationSnapshot,
        findPokemonByNameOrId,
        getAttackCardPool,
        getBabyPokemonPool,
        getLocationById,
        getLocations,
        getMegaTargetKeys,
        getObtainablePokemonPool,
        getRunAttackRecords,
        getRunPokemonRecords,
        getStarterDecks,
        getUnlockedStarterDecks,
        getWildPokemonPool,
        isAllowedTrainerRank,
        isBabyPokemon,
        isEventOnlyPokemon,
        isMartOfferAllowed,
        isMegaPokemon,
        isObtainablePokemon,
        isStarterDeckUnlocked,
        listAllPaths,
        rollMartTrade,
        rollMartTradeTypes,
        sanitizeMartTrades,
        runHasDragonGemPrereqs,
        runOwnsLegendaryPokemon
    };
})(window);
