/**
 * Pokemon Rogue Pocket - card arena data loading and test deck constants
 *
 * Data flow: game.js calls loadGameData() during page boot. JSON records are
 * loaded from pokemon.json, attacks.json, items.json, trainers.json, and events.json,
 * normalized into the
 * shape expected by arena_model.js, then stored on arena.GameData before a
 * battle is restored or reset. The fallbackRecords below keep the arena usable
 * when fetch fails, such as when opening the file directly in some browsers.
 */

(function attachArenaData(arena, rogue) {
    'use strict';

    arena.Constants = Object.freeze({
        ATTACK_COPIES_PER_MAIN_DECK: 2,
        BOARD_SLOT_COUNT: 2,
        BURN_DAMAGE_PERCENT: 0.05,
        CONFUSION_DAMAGE_PERCENT: 0.1,
        CONFUSION_RECOVERY_CHANCE: 0.5,
        CONFUSION_SELF_DAMAGE_CHANCE: 0.5,
        DAMAGE_PERCENT: 0.2,
        DEFAULT_BATTLE_DECK: {
            items: [
                'Sitrus Berry',
                'Withdraw Wand',
                'Withdraw Wand',
                'Salac Berry',
                'Fire Gem',
                'Electric Gem',
                'Psychic Gem',
                'Dark Gem',
                'Grass Gem',
                'Poison Gem'
            ],
            pokemon: [
                { name: 'Blastoise', attacks: ['Angered Roar', 'Crunch'] },
                { name: 'Gyarados', attacks: ['Hydro Pump', 'Dragon Claw'] },
                { name: 'Machamp', attacks: ['Mega Punch', 'Karate Smash'] },
                { name: 'Gengar', attacks: ['Jumpscare', 'Ghastly Grip'] },
                { name: 'Feraligatr', attacks: ['Murky Water', 'Waterfall'] },
                { name: 'Suicune', attacks: ['Rain Dance', 'Great Flood'] }
            ]
        },
        HAND_SIZE: 6,
        ITEM_CARDS_PER_MAIN_DECK: 10,
        KNOCKOUT_LIMIT: 4,
        MULTI_ATTACK_MAX_HITS: 6,
        MULTI_ATTACK_MIN_HITS: 2,
        MULTI_ATTACK_STAT_CHANGE_TRIGGER_CHANCE: 0.2,
        PARALYSIS_SKIP_CHANCE: 1 / 3,
        POISON_DAMAGE_PERCENT: 0.1,
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
                baseHealth: 80,
                baseAttack: 90,
                baseDefense: 100,
                baseSpeed: 80
            },
            {
                name: 'Gyarados',
                type1: 'WATER',
                type2: 'DRAGON',
                type3: 'NONE',
                id: '0130',
                baseHealth: 95,
                baseAttack: 125,
                baseDefense: 85,
                baseSpeed: 80
            },
            {
                name: 'Machamp',
                type1: 'FIGHTING',
                type2: 'HUMAN',
                type3: 'NONE',
                id: '0068',
                baseHealth: 90,
                baseAttack: 130,
                baseDefense: 80,
                baseSpeed: 55
            },
            {
                name: 'Gengar',
                type1: 'GHOST',
                type2: 'HUMAN',
                type3: 'NONE',
                id: '0094',
                baseHealth: 60,
                baseAttack: 130,
                baseDefense: 60,
                baseSpeed: 110
            },
            {
                name: 'Feraligatr',
                type1: 'WATER',
                type2: 'DARK',
                type3: 'NONE',
                id: '0160',
                baseHealth: 90,
                baseAttack: 100,
                baseDefense: 80,
                baseSpeed: 80
            },
            {
                name: 'Suicune',
                type1: 'WATER',
                type2: 'LEGENDARY',
                type3: 'NONE',
                id: '0245',
                baseHealth: 115,
                baseAttack: 90,
                baseDefense: 115,
                baseSpeed: 75
            }
        ],
        attacks: [
            {
                name: 'Angered Roar',
                type1: 'MONSTER',
                type2: 'NONE',
                basePower: 0,
                status: 'NONE',
                statChanges: ['ATTACK_UP', 'ATTACK_UP', 'DEFENSE_DOWN', 'DEFENSE_DOWN'],
                target: 'SELF',
                full_type_requirements: false
            },
            {
                name: 'Crunch',
                type1: 'MONSTER',
                type2: 'DARK',
                basePower: 55,
                status: 'FLINCH',
                statChanges: ['DEFENSE_DOWN'],
                target: 'OPPONENT',
                full_type_requirements: false
            },
            {
                name: 'Hydro Pump',
                type1: 'WATER',
                type2: 'NONE',
                basePower: 80,
                status: 'HEAL_BURN',
                statChanges: [],
                target: 'OPPONENT',
                full_type_requirements: false
            },
            {
                name: 'Dragon Claw',
                type1: 'DRAGON',
                type2: 'NONE',
                basePower: 65,
                status: 'NONE',
                statChanges: [],
                target: 'OPPONENT',
                full_type_requirements: false
            },
            {
                name: 'Mega Punch',
                type1: 'FIGHTING',
                type2: 'HUMAN',
                basePower: 70,
                status: 'NONE',
                statChanges: [],
                target: 'OPPONENT',
                full_type_requirements: false
            },
            {
                name: 'Karate Smash',
                type1: 'FIGHTING',
                type2: 'NONE',
                basePower: 55,
                status: 'NONE',
                statChanges: ['DEFENSE_DOWN', 'DEFENSE_DOWN'],
                target: 'OPPONENT',
                full_type_requirements: false
            },
            {
                name: 'Jumpscare',
                type1: 'GHOST',
                type2: 'NONE',
                basePower: 0,
                status: 'FLINCH',
                statChanges: [],
                target: 'ALL_OPPONENTS',
                full_type_requirements: false
            },
            {
                name: 'Ghastly Grip',
                type1: 'HUMAN',
                type2: 'GHOST',
                basePower: 55,
                status: 'FATIGUE',
                statChanges: ['SPEED_DOWN'],
                target: 'OPPONENT',
                full_type_requirements: true
            },
            {
                name: 'Murky Water',
                type1: 'WATER',
                type2: 'DARK',
                basePower: 55,
                status: 'FLINCH',
                statChanges: ['SPEED_DOWN'],
                target: 'ALL_OPPONENTS',
                full_type_requirements: true
            },
            {
                name: 'Waterfall',
                type1: 'WATER',
                type2: 'NONE',
                basePower: 70,
                status: 'FLINCH',
                statChanges: [],
                target: 'OPPONENT',
                full_type_requirements: false
            },
            {
                name: 'Rain Dance',
                type1: 'WATER',
                type2: 'NONE',
                basePower: 0,
                status: 'HEAL_STATUS',
                statChanges: ['DEFENSE_UP'],
                target: 'ALL_ALLIES',
                full_type_requirements: false
            },
            {
                name: 'Great Flood',
                type1: 'WATER',
                type2: 'LEGENDARY',
                basePower: 85,
                status: 'HEAL_BURN',
                statChanges: [],
                target: 'ALL_OPPONENTS',
                full_type_requirements: true
            }
        ],
        items: [
            {
                name: 'Sitrus Berry',
                target: 'ALLY',
                status: ['HEAL'],
                statChanges: []
            },
            {
                name: 'Withdraw Wand',
                target: 'ALLY',
                status: ['SWITCH'],
                statChanges: []
            },
            {
                name: 'Salac Berry',
                target: 'ALLY',
                status: [],
                statChanges: ['SPEED_UP']
            },
            {
                name: 'Fire Gem',
                target: 'SIDE',
                status: ['DRAGON_GEM', 'BURN'],
                statChanges: []
            },
            {
                name: 'Electric Gem',
                target: 'SIDE',
                status: ['DRAGON_GEM', 'PARALYSIS'],
                statChanges: []
            },
            {
                name: 'Psychic Gem',
                target: 'SIDE',
                status: ['DRAGON_GEM', 'CONFUSION'],
                statChanges: []
            },
            {
                name: 'Dark Gem',
                target: 'SIDE',
                status: ['DRAGON_GEM', 'FLINCH'],
                statChanges: []
            },
            {
                name: 'Grass Gem',
                target: 'SIDE',
                status: ['DRAGON_GEM', 'SLEEP'],
                statChanges: []
            },
            {
                name: 'Poison Gem',
                target: 'SIDE',
                status: ['DRAGON_GEM', 'POISON'],
                statChanges: []
            }
        ],
        trainers: [],
        events: []
    });

    /**
     * Removes NONE/empty type slots when building normalized type arrays.
     */
    function compactTypes(types) {
        return types.filter(type => type && type !== 'NONE');
    }

    /**
     * Normalizes raw Pokemon JSON before decks are created. Called by
     * normalizeGameData() for each species during loadGameData().
     */
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

    /**
     * Normalizes raw attack JSON, including cached attack types and the
     * full_type_requirements flag used by Model.pokemonCanUseAttack().
     */
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

    /**
     * Normalizes raw item JSON. Legacy non-stat entries in statChanges are moved
     * into status so the controller can resolve them as action effects.
     */
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

    function normalizeTrainer(record) {
        const sprite = record.sprite || record.name;
        const trainerSprites = rogue && rogue.TrainerSprites;
        const resolvedSprite = trainerSprites && typeof trainerSprites.resolveSprite === 'function'
            ? trainerSprites.resolveSprite(record.name, sprite)
            : null;
        const displayName = trainerSprites && typeof trainerSprites.getDisplayName === 'function'
            ? trainerSprites.getDisplayName(record.name)
            : stripTerminalGender(record.name);

        return {
            attacks: Array.isArray(record.attacks)
                ? record.attacks.map(attacks => Array.isArray(attacks) ? attacks.filter(Boolean) : [])
                : [],
            cash: Number(record.cash) || 0,
            items: Array.isArray(record.items) ? record.items.filter(Boolean) : [],
            displayName,
            name: record.name,
            pokemon: Array.isArray(record.pokemon) ? record.pokemon.filter(Boolean) : [],
            rank: record.rank || 'Standard',
            sprite,
            spriteFile: resolvedSprite ? resolvedSprite.file : `${sprite}.png`,
            spritePath: resolvedSprite ? resolvedSprite.path : `assets/sprites/${encodeURIComponent(sprite)}.png`,
            spriteSource: resolvedSprite ? resolvedSprite.source : null,
            typeSpecialization: record.typeSpecialization || null
        };
    }

    function normalizeEvent(record) {
        return record && typeof record === 'object' ? record : null;
    }

    function stripTerminalGender(name) {
        return String(name || '').trim().replace(/\s+/g, ' ').replace(/\s+[MF]$/u, '');
    }

    /**
     * Converts item names into the default uppercase asset filename format.
     */
    function formatAssetName(name) {
        return String(name || 'item')
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
    }

    /**
     * Applies record-level normalization to all loaded game data at boot.
     */
    function normalizeGameData(records) {
        return {
            attacks: records.attacks.map(normalizeAttack),
            events: (records.events || []).map(normalizeEvent).filter(Boolean),
            items: records.items.map(normalizeItem),
            pokemon: records.pokemon.map(normalizePokemon),
            trainers: (records.trainers || []).map(normalizeTrainer).filter(trainer => trainer.name)
        };
    }

    /**
     * Fetches a JSON data file for boot. On any load/parse/HTTP failure, it logs
     * the problem and returns the built-in fallback data for that file.
     */
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

    /**
     * Public data-loading function called by game.js before battle creation.
     * It loads and normalizes all card data, then replaces arena.GameData.
     */
    async function loadGameData() {
        const [pokemon, attacks, items, trainers, events] = await Promise.all([
            loadJson('pokemon.json', fallbackRecords.pokemon),
            loadJson('attacks.json', fallbackRecords.attacks),
            loadJson('items.json', fallbackRecords.items),
            loadJson('trainers.json', fallbackRecords.trainers),
            loadJson('events.json', fallbackRecords.events)
        ]);

        arena.GameData = normalizeGameData({ pokemon, attacks, items, trainers, events });
        return arena.GameData;
    }

    arena.GameData = normalizeGameData(fallbackRecords);
    arena.Data = {
        loadGameData
    };
})(window.CardArena = window.CardArena || {}, window.PokeRogue = window.PokeRogue || {});
