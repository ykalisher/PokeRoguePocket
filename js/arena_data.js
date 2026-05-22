/**
 * Squish - card arena data loading and test deck constants
 */

(function attachArenaData(arena) {
    'use strict';

    arena.Constants = Object.freeze({
        ATTACK_CARDS_PER_DECK: 12,
        BOARD_SLOT_COUNT: 2,
        BURN_DAMAGE_PERCENT: 0.05,
        CONFUSION_DAMAGE_PERCENT: 0.1,
        CONFUSION_RECOVERY_CHANCE: 0.5,
        CONFUSION_SELF_DAMAGE_CHANCE: 0.5,
        DAMAGE_PERCENT: 0.2,
        ITEM_CARDS_PER_DECK: 4,
        MULTI_ATTACK_MAX_HITS: 6,
        MULTI_ATTACK_MIN_HITS: 2,
        MULTI_ATTACK_STAT_CHANGE_TRIGGER_CHANCE: 0.2,
        OPENING_HAND_SIZE: 3,
        PARALYSIS_SKIP_CHANCE: 1 / 3,
        POISON_DAMAGE_PERCENT: 0.1,
        POKEMON_CARDS_PER_DECK: 4,
        SECOND_SLOT_INDEX: 1,
        SLEEP_GUARANTEED_WAKE_ATTEMPT: 4,
        SLEEP_WAKE_CHANCE: 0.5,
        STAT_CHANGE_TRIGGER_CHANCE: 1 / 3,
        STATUS_TRIGGER_CHANCE: 1 / 3
    });

    const fallbackRecords = Object.freeze({
        pokemon: [
            {
                name: 'Blastoise',
                type1: 'WATER',
                type2: 'MONSTER',
                type3: 'NONE',
                id: '0009',
                baseHealth: 79,
                baseAttack: 85,
                baseDefense: 105,
                baseSpeed: 78
            }
        ],
        attacks: [
            {
                name: 'Surf',
                type1: 'WATER',
                type2: 'NONE',
                basePower: 90,
                status: 'NONE',
                statChanges: [],
                target: 'ALL_OPPONENTS',
                full_type_requirements: false
            }
        ],
        items: [
            {
                name: 'Potion',
                target: 'ALLY',
                status: ['HEAL'],
                statChanges: []
            }
        ]
    });

    function compactTypes(types) {
        return types.filter(type => type && type !== 'NONE');
    }

    function normalizePokemon(record) {
        const species = {
            baseAttack: Number(record.baseAttack) || 0,
            baseDefense: Number(record.baseDefense) || 0,
            baseHealth: Number(record.baseHealth) || 1,
            baseSpeed: Number(record.baseSpeed) || 0,
            id: record.id,
            name: record.name,
            type1: record.type1,
            type2: record.type2,
            type3: record.type3
        };

        species.types = compactTypes([species.type1, species.type2, species.type3]);
        species.portraitPath = `assets/portraits/${encodeURIComponent(species.name)}.png`;

        return species;
    }

    function normalizeAttack(record) {
        const attack = {
            basePower: Number(record.basePower) || 0,
            full_type_requirements: Boolean(record.full_type_requirements),
            name: record.name,
            statChanges: Array.isArray(record.statChanges) ? record.statChanges : [],
            status: record.status || 'NONE',
            target: record.target,
            type1: record.type1,
            type2: record.type2
        };

        attack.types = compactTypes([attack.type1, attack.type2]);

        return attack;
    }

    function normalizeItem(record) {
        const rawStatuses = Array.isArray(record.status) ? record.status : compactTypes([record.status]);
        const rawStatChanges = Array.isArray(record.statChanges) ? record.statChanges : [];
        const statChangeTypes = ['ATTACK_DOWN', 'ATTACK_UP', 'DEFENSE_DOWN', 'DEFENSE_UP', 'SPEED_DOWN', 'SPEED_UP'];

        return {
            imagePath: record.imagePath || record.picturePath || record.image || `assets/items/${formatAssetName(record.name)}.png`,
            name: record.name,
            statChanges: rawStatChanges.filter(change => statChangeTypes.includes(change)),
            status: [...rawStatuses, ...rawStatChanges.filter(change => !statChangeTypes.includes(change))],
            target: record.target
        };
    }

    function formatAssetName(name) {
        return String(name || 'item')
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
    }

    function normalizeGameData(records) {
        return {
            attacks: records.attacks.map(normalizeAttack),
            items: records.items.map(normalizeItem),
            pokemon: records.pokemon.map(normalizePokemon)
        };
    }

    async function loadJson(path, fallback) {
        try {
            const response = await fetch(path, { cache: 'no-store' });

            if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

            return await response.json();
        } catch (error) {
            console.warn(`Using built-in ${path} fallback.`, error);
            return fallback;
        }
    }

    async function loadGameData() {
        const [pokemon, attacks, items] = await Promise.all([
            loadJson('pokemon.json', fallbackRecords.pokemon),
            loadJson('attacks.json', fallbackRecords.attacks),
            loadJson('items.json', fallbackRecords.items)
        ]);

        arena.GameData = normalizeGameData({ pokemon, attacks, items });
        return arena.GameData;
    }

    arena.GameData = normalizeGameData(fallbackRecords);
    arena.Data = {
        loadGameData
    };
})(window.CardArena = window.CardArena || {});
