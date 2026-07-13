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
             caps: { capture: 2, shop: 1 },
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
            const rungs = [
                pool.filter(trainer => trainer.rank === rolledRank && isTypeMatch(trainer)),
                pool.filter(trainer => isAllowed(trainer) && isTypeMatch(trainer)),
                pool.filter(trainer => trainer.rank === rolledRank),
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

    /**
     * Wild pokemon pool for a location: unique-by-name, non-legendary species
     * with at least one type slot in the location's types. Falls back to all
     * non-legendaries so the pool is never empty.
     */
    function getWildPokemonPool(gameData, locationTypes) {
        const pokemon = gameData && Array.isArray(gameData.pokemon) ? gameData.pokemon : [];
        const unique = uniqueByName(pokemon);
        const nonLegendary = unique.filter(species => !getRecordTypes(species).includes('LEGENDARY'));
        const types = Array.isArray(locationTypes) ? locationTypes : [];

        const matched = nonLegendary.filter(species => getRecordTypes(species).some(type => types.includes(type)));
        return matched.length > 0 ? matched : nonLegendary;
    }

    global.PokeLocations = {
        LEVEL_CONFIG,
        STARTER_DECKS,
        TOTAL_LEVELS,
        chooseNextLocation,
        chooseTrainer,
        createLocationSnapshot,
        getLocationById,
        getLocations,
        getWildPokemonPool,
        isAllowedTrainerRank
    };
})(window);
