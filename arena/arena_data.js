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
            },
            {
                name: 'Effect Amplifier',
                target: 'SIDE',
                status: ['EFFECT_BOOST'],
                statChanges: [],
                imagePath: 'assets/items/EFFECT_AMPLIFIER.svg'
            }
        ],
        trainers: [],
        events: [],
        locations: [
            {
                id: 'tidepool-coast',
                name: 'Tidepool Coast',
                terrain: 'Waterfront',
                types: ['WATER', 'ICE'],
                theme: { accent: '#e8c266', glow: '#4ab0c8', surface: '#143a4a', bgDeep: '#081b26', bgMid: '#123240' },
                background: 'assets/backgrounds/tidepool-coast.png',
                enabled: true
            },
            {
                id: 'murkwater-marsh',
                name: 'Murkwater Marsh',
                terrain: 'Swamp',
                types: ['WATER', 'POISON', 'GRASS'],
                theme: { accent: '#b5cc66', glow: '#66a68c', surface: '#22362c', bgDeep: '#0e1a13', bgMid: '#1a2a20' },
                background: 'assets/backgrounds/murkwater-marsh.png',
                enabled: true
            },
            {
                id: 'cinder-ridge',
                name: 'Cinder Ridge',
                terrain: 'Volcanic',
                types: ['FIRE', 'ROCK', 'GROUND'],
                theme: { accent: '#f2a35c', glow: '#d95f3b', surface: '#402420', bgDeep: '#1c0f0c', bgMid: '#2e1a14' },
                background: 'assets/backgrounds/cinder-ridge.png',
                enabled: true
            }
        ],
        starterDecks: [
            {
                id: 'water',
                name: 'Water',
                type: 'WATER',
                pokemon: ['Blastoise', 'Feraligatr'],
                attacks: [
                    { name: 'Surf', count: 2 },
                    { name: 'Waterfall', count: 2 },
                    { name: 'Crunch', count: 1 },
                    { name: 'Sucker Punch', count: 1 }
                ],
                items: [
                    { name: 'Sitrus Berry', count: 1 },
                    { name: 'Withdraw Wand', count: 1 }
                ],
                enabled: true
            },
            {
                id: 'grass',
                name: 'Grass',
                type: 'GRASS',
                pokemon: ['Venusaur', 'Meganium'],
                attacks: [
                    { name: 'Razor Leaf', count: 3 },
                    { name: 'Sleep Powder', count: 1 },
                    { name: 'Sludge Bomb', count: 1 },
                    { name: 'Moon Blast', count: 1 }
                ],
                items: [
                    { name: 'Sitrus Berry', count: 1 },
                    { name: 'Withdraw Wand', count: 1 }
                ],
                enabled: true
            },
            {
                id: 'fire',
                name: 'Fire',
                type: 'FIRE',
                pokemon: ['Charizard', 'Typhlosion'],
                attacks: [
                    { name: 'Flame Thrower', count: 2 },
                    { name: 'Fire Spin', count: 2 },
                    { name: 'Air Slash', count: 1 },
                    { name: 'Shadow Ball', count: 1 }
                ],
                items: [
                    { name: 'Sitrus Berry', count: 1 },
                    { name: 'Withdraw Wand', count: 1 }
                ],
                enabled: true
            }
        ],
        achievements: [
            { id: 'first-steps', name: 'First Steps', description: 'Start your first run.', stat: 'runs.started', atLeast: 1, hidden: false, enabled: true },
            { id: 'first-blood', name: 'First Blood', description: 'Win your first battle.', stat: 'battles.won', atLeast: 1, hidden: false, enabled: true },
            { id: 'gym-challenger', name: 'Gym Challenger', description: 'Beat 5 Gym Leaders.', stat: 'battles.won.rank.Boss', atLeast: 5, hidden: false, enabled: true },
            { id: 'champion', name: 'Champion', description: 'Finish a full run.', stat: 'runs.completed', atLeast: 1, hidden: false, enabled: true },
            { id: 'blaze-purist', name: 'Blaze Purist', description: 'Finish a run with only Fire Pokemon.', stat: 'runs.completed.mono.FIRE', atLeast: 1, hidden: true, enabled: true },
            { id: 'wanderer', name: 'Wanderer', description: 'Experience 25 events.', stat: 'events.seen', atLeast: 25, hidden: false, enabled: true }
        ],
        music: []
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
            eventOnly: record.eventOnly === true,
            // A baby's mega target. Dropping it here leaves every baby in a run
            // unable to resolve its mega, so no baby ever evolves.
            evolvesInto: record.evolvesInto,
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

    function normalizeTrainerAttackNames(attacks) {
        if (!Array.isArray(attacks)) return [];

        return attacks.flatMap(entry => {
            if (Array.isArray(entry)) return normalizeTrainerAttackNames(entry);
            if (typeof entry !== 'string') return [];

            const attackName = entry.trim();
            return attackName ? [attackName] : [];
        });
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
            attacks: normalizeTrainerAttackNames(record.attacks),
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
        if (!record || typeof record !== 'object') return null;
        if (!Array.isArray(record.types)) return record;

        // Uppercase + compact location-type gates so events match the same
        // normalized type strings that locations use.
        const types = compactTypes(record.types.map(type => String(type || '').toUpperCase()));

        return { ...record, types };
    }

    /**
     * Neutral palette used when a location omits theme fields. Phase 6 reads
     * these custom-property values, so keep them in sync with the CLI default.
     */
    const NEUTRAL_LOCATION_THEME = Object.freeze({
        accent: '#e0b84f',
        glow: '#4ab0a5',
        surface: '#232f3d',
        bgDeep: '#10161f',
        bgMid: '#1b2836'
    });

    /**
     * Normalizes a raw location record. Returns null (so it is filtered out)
     * when id or name is missing. Types are upper-cased and compacted; missing
     * theme fields fall back to the neutral palette.
     */
    function normalizeLocation(record) {
        if (!record || typeof record !== 'object') return null;

        const id = String(record.id || '').trim();
        const name = String(record.name || '').trim();
        if (!id || !name) return null;

        const rawTypes = Array.isArray(record.types) ? record.types : [];
        const types = compactTypes(rawTypes.map(type => String(type || '').toUpperCase()));
        const rawTheme = record.theme && typeof record.theme === 'object' ? record.theme : {};
        const theme = {
            accent: rawTheme.accent || NEUTRAL_LOCATION_THEME.accent,
            glow: rawTheme.glow || NEUTRAL_LOCATION_THEME.glow,
            surface: rawTheme.surface || NEUTRAL_LOCATION_THEME.surface,
            bgDeep: rawTheme.bgDeep || NEUTRAL_LOCATION_THEME.bgDeep,
            bgMid: rawTheme.bgMid || NEUTRAL_LOCATION_THEME.bgMid
        };

        return {
            id,
            name,
            terrain: record.terrain || name,
            types,
            theme,
            background: record.background || null,
            enabled: record.enabled !== false
        };
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
     * Converts a starter-deck record from its authoring shape ({ name, count }
     * pairs) into the tuple shape the run builder and starter picker already
     * consume ([name, count]). Records without an id are dropped.
     *
     * `requiresAchievement` is an achievement id that must be unlocked before
     * the deck can be picked; an empty string means the deck is always
     * available (see PokeLocations.isStarterDeckUnlocked).
     */
    function normalizeStarterDeck(record) {
        if (!record || !record.id) return null;

        const pairs = list => (Array.isArray(list) ? list : [])
            .filter(entry => entry && entry.name)
            .map(entry => [entry.name, Math.max(1, Math.floor(Number(entry.count)) || 1)]);

        return {
            attacks: pairs(record.attacks),
            enabled: record.enabled !== false,
            id: record.id,
            items: pairs(record.items),
            name: record.name || record.id,
            pokemon: (Array.isArray(record.pokemon) ? record.pokemon : []).filter(Boolean),
            requiresAchievement: typeof record.requiresAchievement === 'string' ? record.requiresAchievement.trim() : '',
            type: record.type || 'NONE'
        };
    }

    /**
     * Cleans up one achievement record. Records without an id are dropped; the
     * threshold is coerced to an integer of at least 1 so a bad value can never
     * make an achievement unlock for free.
     */
    function normalizeAchievement(record) {
        if (!record || !record.id) return null;

        return {
            atLeast: Math.max(1, Math.floor(Number(record.atLeast)) || 1),
            description: record.description || '',
            enabled: record.enabled !== false,
            hidden: record.hidden === true,
            id: record.id,
            name: record.name || record.id,
            stat: record.stat || ''
        };
    }

    const MUSIC_CATEGORIES = ['trainer', 'boss', 'elite', 'legendary'];

    /**
     * Normalizes one music track. Records without an id, or with an unknown
     * category, are dropped — a bad row must never crash boot or leak into a
     * category's rotation.
     */
    function normalizeMusicTrack(record) {
        if (!record || !record.id) return null;
        if (!MUSIC_CATEGORIES.includes(record.category)) return null;

        return {
            category: record.category,
            enabled: record.enabled !== false,
            file: record.file || `assets/music/${record.id}.mp3`,
            id: record.id,
            title: record.title || record.id
        };
    }

    /**
     * Applies record-level normalization to all loaded game data at boot.
     */
    function normalizeGameData(records) {
        return {
            achievements: (records.achievements || []).map(normalizeAchievement).filter(Boolean),
            attacks: records.attacks.map(normalizeAttack),
            events: (records.events || []).map(normalizeEvent).filter(Boolean),
            locations: (records.locations || []).map(normalizeLocation).filter(Boolean),
            items: records.items.map(normalizeItem),
            music: (records.music || []).map(normalizeMusicTrack).filter(Boolean),
            pokemon: records.pokemon.map(normalizePokemon),
            starterDecks: (records.starterDecks || []).map(normalizeStarterDeck).filter(Boolean),
            trainers: (records.trainers || []).map(normalizeTrainer).filter(trainer => trainer.name)
        };
    }

    /**
     * Fetches a JSON data file for boot. On any load/parse/HTTP failure, it logs
     * the problem and returns the built-in fallback data for that file.
     * 'no-cache' revalidates with the server so data edits show up on the next
     * page load, while still allowing 304 responses instead of the full
     * re-download that 'no-store' forced on every page navigation.
     */
    async function loadJson(path, fallback) {
        try {
            const response = await fetch(path, { cache: 'no-cache' });

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
        const [pokemon, attacks, items, trainers, events, locations, starterDecks, achievements, music] = await Promise.all([
            loadJson('pokemon.json', fallbackRecords.pokemon),
            loadJson('attacks.json', fallbackRecords.attacks),
            loadJson('items.json', fallbackRecords.items),
            loadJson('trainers.json', fallbackRecords.trainers),
            loadJson('events.json', fallbackRecords.events),
            loadJson('locations.json', fallbackRecords.locations),
            loadJson('starter_decks.json', fallbackRecords.starterDecks),
            loadJson('achievements.json', fallbackRecords.achievements),
            loadJson('music.json', fallbackRecords.music)
        ]);

        arena.GameData = normalizeGameData({ pokemon, attacks, items, trainers, events, locations, starterDecks, achievements, music });
        return arena.GameData;
    }

    arena.GameData = normalizeGameData(fallbackRecords);
    arena.Data = {
        loadGameData
    };
})(window.CardArena = window.CardArena || {}, window.PokeRogue = window.PokeRogue || {});
