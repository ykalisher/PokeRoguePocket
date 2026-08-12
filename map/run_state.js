/**
 * Pocket Nuzlocke - persistent run state helpers
 */

(function attachRunState(global) {
    'use strict';

    const STORAGE_KEY = 'pokemon-rogue-pocket-run';
    const STORAGE_VERSION = 3;
    const DEFAULT_BOSS_NODE_ID = 'boss-11';
    const DEFAULT_STARTER_ID = 'water';
    const MIN_LEVEL = 1;
    const MAX_LEVEL = 4;
    const ACTIVE_POKEMON_LIMIT = 6;
    const STARTING_CASH = 100;

    // Owner decision (phase 44): the Pokemon PC is deleted outright, and any
    // pokemon an old save left stored there is discarded, not migrated.
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.removeItem('pokemon-rogue-pocket-pc');
        }
    } catch (error) {
        // Storage unavailable or blocked; nothing to clean up.
    }

    function createRunState({ area, collections, location, starterId, level, bossNodeId }) {
        const locationSnapshot = normalizeLocationSnapshot(location);

        return {
            area: {
                activeAttackNodeId: null,
                activeBattleNodeId: null,
                activeCaptureNodeId: null,
                activeEventNodeId: null,
                activeMartNodeId: null,
                bossNodeId: bossNodeId || DEFAULT_BOSS_NODE_ID,
                completed: false,
                completedAt: null,
                completedBossNodeId: null,
                currentNodeId: 'start',
                graph: area,
                traveledPathKeys: [],
                visitedNodeIds: ['start']
            },
            attackEncounters: {},
            battleEncounters: {},
            cash: STARTING_CASH,
            captureEncounters: {},
            collections: normalizeCollections(collections),
            eventEncounters: {},
            level: clampLevel(level),
            location: locationSnapshot,
            martEncounters: {},
            musicTrackId: null,
            nextCardId: 1,
            runCompleted: false,
            runCompletedAt: null,
            savedAt: null,
            starterId: starterId || DEFAULT_STARTER_ID,
            usedEventIds: [],
            usedTrainerNames: [],
            version: STORAGE_VERSION,
            visitedLocationIds: locationSnapshot ? [locationSnapshot.id] : []
        };
    }

    function clampLevel(level) {
        const numericLevel = Math.floor(Number(level));

        if (!Number.isFinite(numericLevel)) return MIN_LEVEL;

        return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, numericLevel));
    }

    function loadRunState() {
        if (!canUseStorage()) return null;

        try {
            const rawState = localStorage.getItem(STORAGE_KEY);

            if (!rawState) return null;

            const parsedState = JSON.parse(rawState);
            const normalizedState = normalizeRunState(parsedState);

            if (!normalizedState) {
                clearRunState();
                return null;
            }

            return normalizedState;
        } catch (error) {
            console.warn('Could not load run state.', error);
            clearRunState();
            return null;
        }
    }

    function saveRunState(run) {
        if (!canUseStorage()) return false;

        try {
            const normalizedRun = normalizeRunState(run);

            if (!normalizedRun) return false;

            normalizedRun.savedAt = new Date().toISOString();
            localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizedRun));

            return true;
        } catch (error) {
            console.warn('Could not save run state.', error);
            return false;
        }
    }

    function clearRunState() {
        // The level music belongs to the run that is being thrown away.
        if (global.PokeAudio) global.PokeAudio.resetLevelMusic();

        if (!canUseStorage()) return false;

        try {
            localStorage.removeItem(STORAGE_KEY);
            return true;
        } catch (error) {
            console.warn('Could not clear run state.', error);
            return false;
        }
    }

    /**
     * Starts (or keeps) the music for the run's current map level: one track,
     * chosen once per level, playing across every page of that level. The pick
     * is stored on the run so a level advance is what changes the song.
     *
     * Safe to call on every render — the audio module ignores a request for the
     * track it is already playing.
     */
    function ensureLevelMusic(run, tracks) {
        if (!run || !global.PokeAudio) return null;

        global.PokeAudio.configure(tracks);

        const trackId = global.PokeAudio.playLevelTrack(run.musicTrackId || null);

        if (trackId && trackId !== run.musicTrackId) {
            run.musicTrackId = trackId;
            saveRunState(run);
        }

        return trackId;
    }

    function hasSavedRun() {
        return Boolean(loadRunState());
    }

    function getActiveCaptureEncounter(run) {
        const nodeId = run && run.area ? run.area.activeCaptureNodeId : null;

        if (!nodeId || !run.captureEncounters) return null;

        const encounter = run.captureEncounters[nodeId];

        return encounter && !encounter.completed ? encounter : null;
    }

    function getActiveAttackEncounter(run) {
        const nodeId = run && run.area ? run.area.activeAttackNodeId : null;

        if (!nodeId || !run.attackEncounters) return null;

        const encounter = run.attackEncounters[nodeId];

        return encounter && !encounter.completed ? encounter : null;
    }

    function getActiveBattleEncounter(run) {
        const nodeId = run && run.area ? run.area.activeBattleNodeId : null;

        if (!nodeId || !run.battleEncounters) return null;

        const encounter = run.battleEncounters[nodeId];

        return encounter && !encounter.completed ? encounter : null;
    }

    function getActiveMartEncounter(run) {
        const nodeId = run && run.area ? run.area.activeMartNodeId : null;

        if (!nodeId || !run.martEncounters) return null;

        const encounter = run.martEncounters[nodeId];

        return encounter && !encounter.completed ? encounter : null;
    }

    function getActiveEventEncounter(run) {
        const nodeId = run && run.area ? run.area.activeEventNodeId : null;

        if (!nodeId || !run.eventEncounters) return null;

        const encounter = run.eventEncounters[nodeId];

        return encounter && !encounter.completed ? encounter : null;
    }

    /**
     * Run-wide "drawn already" history. Each event and each opposing trainer
     * appears at most once per run, but advancing a level wipes every
     * encounter map, so an id/name is copied here the moment it is drawn and
     * survives for the rest of the run. Returns true when the entry was new.
     */
    function markEventUsed(run, eventId) {
        return markUsed(run, 'usedEventIds', eventId);
    }

    function markTrainerUsed(run, trainerName) {
        return markUsed(run, 'usedTrainerNames', trainerName);
    }

    function markUsed(run, listKey, value) {
        if (!run || typeof value !== 'string' || !value) return false;
        if (!Array.isArray(run[listKey])) run[listKey] = [];
        if (run[listKey].includes(value)) return false;

        run[listKey].push(value);

        return true;
    }

    /**
     * Trainer names a new encounter must avoid: every trainer drawn earlier in
     * the run, plus the ones assigned in the current area (skipping
     * `excludeNodeId`'s own encounter, which the caller is replacing).
     * chooseTrainer relaxes the list when the pool cannot honor it.
     */
    function getExcludedTrainerNames(run, excludeNodeId) {
        if (!run) return [];

        const names = new Set(Array.isArray(run.usedTrainerNames) ? run.usedTrainerNames : []);

        Object.values(run.battleEncounters || {}).forEach(encounter => {
            if (!encounter || encounter.nodeId === excludeNodeId || !encounter.trainerName) return;

            names.add(encounter.trainerName);
        });

        return Array.from(names);
    }

    function createPokemonCard(pokemon, owner, id) {
        return {
            currentHealth: pokemon.baseHealth,
            currentStatus: [],
            faceUp: true,
            hasUsedFossilRevival: false,
            id,
            kind: 'pokemon',
            owner,
            pokemon,
            statStages: {
                attack: 0,
                defense: 0,
                speed: 0
            },
            vitamins: []
        };
    }

    function createAttackCard(attack, owner, id) {
        return {
            attack,
            faceUp: true,
            id,
            kind: 'attack',
            owner
        };
    }

    function createItemCard(item, owner, id) {
        return {
            faceUp: true,
            id,
            item,
            kind: 'item',
            owner
        };
    }

    /**
     * arena_model owns the vitamin vocabulary; run_state reaches it lazily so
     * script load order never matters. The fallback still copies the list
     * rather than dropping it, so a boost can never be lost to a missing model.
     */
    function copyPokemonVitamins(card) {
        const model = global.CardArena && global.CardArena.Model;

        if (model && typeof model.copyPokemonVitamins === 'function') {
            return model.copyPokemonVitamins(card);
        }

        return Array.isArray(card && card.vitamins)
            ? card.vitamins.map(vitamin => ({ ...vitamin }))
            : [];
    }

    function allocateCardId(run, kind, name) {
        const nextCardId = Number.isFinite(run.nextCardId) ? run.nextCardId : 1;

        run.nextCardId = nextCardId + 1;

        return `run-${kind}-${formatId(name)}-${nextCardId}`;
    }

    function addPokemonCard(run, card) {
        if (!run || !isPokemonCard(card)) return { addedCard: null, zone: null };

        ensureCollections(run);
        balancePokemonCollections(run);

        if (run.collections.pokemon.length < ACTIVE_POKEMON_LIMIT) {
            run.collections.pokemon.push(card);
            return { addedCard: card, zone: 'active' };
        }

        run.collections.bench.pokemon.push(card);
        return { addedCard: card, zone: 'bench' };
    }

    function addActionCard(run, card) {
        if (!run || !card) return { addedCard: null, zone: null };

        ensureCollections(run);
        balancePokemonCollections(run);

        if (isAttackCard(card) && shouldBenchNewAttack(run, card)) {
            run.collections.bench.actions.push(card);
            return { addedCard: card, zone: 'bench' };
        }

        run.collections.actions.push(card);
        return { addedCard: card, zone: 'active' };
    }

    function balancePokemonCollections(run) {
        if (!run) return { changed: false };

        ensureCollections(run);

        const activePokemon = run.collections.pokemon;
        const benchPokemon = run.collections.bench.pokemon;
        let changed = false;

        while (activePokemon.length > ACTIVE_POKEMON_LIMIT) {
            benchPokemon.unshift(activePokemon.pop());
            changed = true;
        }

        while (activePokemon.length < ACTIVE_POKEMON_LIMIT && benchPokemon.length > 0) {
            activePokemon.push(benchPokemon.shift());
            changed = true;
        }

        return { changed };
    }

    function rebuildActionDeckForActivePokemon(run) {
        if (!run) {
            return {
                addedToDeck: [],
                movedToBench: []
            };
        }

        ensureCollections(run);
        balancePokemonCollections(run);

        const previousActiveAttackIds = new Set(run.collections.actions.filter(isAttackCard).map(card => card.id));
        const previousBenchAttackIds = new Set(run.collections.bench.actions.filter(isAttackCard).map(card => card.id));
        const allActions = [
            ...run.collections.actions,
            ...run.collections.bench.actions
        ];
        const nextActiveActions = [];
        const nextBenchActions = [];

        allActions.forEach(card => {
            if (isAttackCard(card) && shouldBenchNewAttack(run, card)) {
                nextBenchActions.push(card);
                return;
            }

            nextActiveActions.push(card);
        });

        run.collections.actions = nextActiveActions;
        run.collections.bench.actions = nextBenchActions;

        return {
            addedToDeck: nextActiveActions.filter(card => isAttackCard(card) && previousBenchAttackIds.has(card.id)),
            movedToBench: nextBenchActions.filter(card => previousActiveAttackIds.has(card.id))
        };
    }

    // --- Baby -> mega evolution (phase 48) ---------------------------------
    // Pure helpers driving the post-gym-leader cutscene. getPendingMegaEvolutions
    // inspects only the ACTIVE deck (bench babies never evolve) and skips babies
    // whose evolvesInto reference does not resolve. applyMegaEvolutions swaps each
    // baby card for a fresh mega card in place, then rebuilds the action deck
    // because the mega's types can change which attacks are usable.
    function getPendingMegaEvolutions(run, gameData) {
        const locations = global.PokeLocations;

        if (!run || !locations ||
            typeof locations.isBabyPokemon !== 'function' ||
            typeof locations.findPokemonByNameOrId !== 'function') {
            return [];
        }

        ensureCollections(run);

        const pending = [];

        run.collections.pokemon.forEach((card, index) => {
            if (!isPokemonCard(card) || !card.pokemon) return;
            if (!locations.isBabyPokemon(card.pokemon)) return;

            const megaRecord = locations.findPokemonByNameOrId(gameData, card.pokemon.evolvesInto);

            if (!megaRecord) return;

            pending.push({ index, babyCard: card, megaRecord });
        });

        return pending;
    }

    function applyMegaEvolutions(run, evolutions) {
        if (!run || !Array.isArray(evolutions) || evolutions.length === 0) return [];

        ensureCollections(run);

        const summary = [];

        evolutions.forEach(({ index, babyCard, megaRecord }) => {
            if (!megaRecord || !run.collections.pokemon[index]) return;

            const megaCard = createPokemonCard(megaRecord, 'player', allocateCardId(run, 'pokemon', megaRecord.name));

            // Vitamins are an investment in this Pokemon, not in its current
            // form, so they follow it through the evolution.
            megaCard.vitamins = copyPokemonVitamins(babyCard);

            run.collections.pokemon[index] = megaCard;
            summary.push({
                babyName: babyCard && babyCard.pokemon ? babyCard.pokemon.name : '',
                megaName: megaRecord.name
            });
        });

        rebuildActionDeckForActivePokemon(run);

        return summary;
    }

    function swapBenchPokemon(run, activePokemonId, benchPokemonId) {
        if (!run || !activePokemonId || !benchPokemonId) return null;

        ensureCollections(run);
        balancePokemonCollections(run);

        const activeIndex = run.collections.pokemon.findIndex(card => card.id === activePokemonId);
        const benchIndex = run.collections.bench.pokemon.findIndex(card => card.id === benchPokemonId);

        if (activeIndex === -1 || benchIndex === -1) return null;

        const activePokemon = run.collections.pokemon[activeIndex];
        const benchPokemon = run.collections.bench.pokemon[benchIndex];

        run.collections.pokemon[activeIndex] = benchPokemon;
        run.collections.bench.pokemon[benchIndex] = activePokemon;

        return {
            activePokemon: benchPokemon,
            benchedPokemon: activePokemon,
            actionChanges: rebuildActionDeckForActivePokemon(run)
        };
    }

    function normalizeRunState(run) {
        if (!run || typeof run !== 'object' || run.version !== STORAGE_VERSION) return null;

        const area = normalizeAreaState(run.area);

        if (!area) return null;

        return {
            area,
            attackEncounters: normalizeAttackEncounters(run.attackEncounters),
            battleEncounters: normalizeBattleEncounters(run.battleEncounters),
            cash: Number.isFinite(run.cash) ? run.cash : STARTING_CASH,
            captureEncounters: normalizeCaptureEncounters(run.captureEncounters),
            collections: normalizeCollections(run.collections),
            eventEncounters: normalizeEventEncounters(run.eventEncounters),
            level: clampLevel(run.level),
            location: normalizeLocationSnapshot(run.location),
            martEncounters: normalizeMartEncounters(run.martEncounters),
            musicTrackId: typeof run.musicTrackId === 'string' && run.musicTrackId ? run.musicTrackId : null,
            nextCardId: Number.isFinite(run.nextCardId) ? run.nextCardId : 1,
            runCompleted: Boolean(run.runCompleted),
            runCompletedAt: run.runCompletedAt || null,
            runStatsRecorded: Boolean(run.runStatsRecorded),
            savedAt: run.savedAt || null,
            starterId: typeof run.starterId === 'string' && run.starterId ? run.starterId : DEFAULT_STARTER_ID,
            usedEventIds: normalizeIdList(run.usedEventIds),
            usedTrainerNames: normalizeIdList(run.usedTrainerNames),
            version: STORAGE_VERSION,
            visitedLocationIds: normalizeIdList(run.visitedLocationIds)
        };
    }

    function normalizeLocationSnapshot(location) {
        if (!location || typeof location !== 'object') return null;
        if (typeof location.id !== 'string' || !location.id) return null;

        const types = Array.isArray(location.types)
            ? location.types.filter(type => typeof type === 'string' && type)
            : [];

        if (types.length === 0) return null;

        const theme = location.theme && typeof location.theme === 'object' ? location.theme : {};

        return {
            id: location.id,
            name: typeof location.name === 'string' && location.name ? location.name : location.id,
            terrain: typeof location.terrain === 'string' && location.terrain ? location.terrain : (location.name || location.id),
            types,
            theme: {
                accent: theme.accent || null,
                glow: theme.glow || null,
                surface: theme.surface || null,
                bgDeep: theme.bgDeep || null,
                bgMid: theme.bgMid || null
            },
            background: typeof location.background === 'string' && location.background ? location.background : null
        };
    }

    function normalizeIdList(ids) {
        if (!Array.isArray(ids)) return [];

        const seen = new Set();

        return ids.filter(id => {
            if (typeof id !== 'string' || !id || seen.has(id)) return false;

            seen.add(id);
            return true;
        });
    }

    function normalizeAreaState(area) {
        if (!area || typeof area !== 'object') return null;
        if (!area.graph || !Array.isArray(area.graph.nodes) || !Array.isArray(area.graph.edges)) return null;

        return {
            activeAttackNodeId: area.activeAttackNodeId || null,
            activeBattleNodeId: area.activeBattleNodeId || null,
            activeCaptureNodeId: area.activeCaptureNodeId || null,
            activeEventNodeId: area.activeEventNodeId || null,
            activeMartNodeId: area.activeMartNodeId || null,
            bossNodeId: area.bossNodeId || DEFAULT_BOSS_NODE_ID,
            completed: Boolean(area.completed),
            completedAt: area.completedAt || null,
            completedBossNodeId: area.completedBossNodeId || null,
            currentNodeId: area.currentNodeId || 'start',
            graph: area.graph,
            traveledPathKeys: Array.isArray(area.traveledPathKeys) ? area.traveledPathKeys : [],
            visitedNodeIds: Array.isArray(area.visitedNodeIds) && area.visitedNodeIds.length > 0
                ? area.visitedNodeIds
                : ['start']
        };
    }

    function normalizeBattleEncounters(battleEncounters) {
        if (!battleEncounters || typeof battleEncounters !== 'object') return {};

        return Object.fromEntries(Object.entries(battleEncounters)
            .filter(([, encounter]) => encounter && typeof encounter === 'object')
            .map(([nodeId, encounter]) => [nodeId, {
                completed: Boolean(encounter.completed),
                completedAt: encounter.completedAt || null,
                createdAt: encounter.createdAt || null,
                finishedAt: encounter.finishedAt || null,
                nodeId: encounter.nodeId || nodeId,
                outcome: encounter.outcome || null,
                rank: encounter.rank || 'Standard',
                rewardCash: Number.isFinite(encounter.rewardCash) ? encounter.rewardCash : 0,
                rewardCollected: Boolean(encounter.rewardCollected),
                rewardEffects: Array.isArray(encounter.rewardEffects) ? encounter.rewardEffects : [],
                rewardSummary: Array.isArray(encounter.rewardSummary) ? encounter.rewardSummary : [],
                sourceEventId: encounter.sourceEventId || null,
                sourceEventNodeId: encounter.sourceEventNodeId || null,
                startedAt: encounter.startedAt || null,
                statsRecorded: Boolean(encounter.statsRecorded),
                trainerName: encounter.trainerName || null
            }]));
    }

    function normalizeMartEncounters(martEncounters) {
        if (!martEncounters || typeof martEncounters !== 'object') return {};

        return Object.fromEntries(Object.entries(martEncounters)
            .filter(([, encounter]) => encounter && typeof encounter === 'object')
            .map(([nodeId, encounter]) => [nodeId, {
                attackNames: normalizeNameList(encounter.attackNames),
                attackRemovalUsed: Boolean(encounter.attackRemovalUsed),
                boughtAttackNames: normalizeNameList(encounter.boughtAttackNames),
                boughtItemNames: normalizeNameList(encounter.boughtItemNames),
                completed: Boolean(encounter.completed),
                completedAt: encounter.completedAt || null,
                createdAt: encounter.createdAt || null,
                itemNames: normalizeNameList(encounter.itemNames),
                nodeId: encounter.nodeId || nodeId,
                releaseUsed: Boolean(encounter.releaseUsed),
                statsRecorded: Boolean(encounter.statsRecorded),
                tradeAcceptedType: encounter.tradeAcceptedType || null,
                tradeOfferedType: encounter.tradeOfferedType || null,
                tradeUsed: Boolean(encounter.tradeUsed)
            }]));
    }

    function normalizeAttackEncounters(attackEncounters) {
        if (!attackEncounters || typeof attackEncounters !== 'object') return {};

        return Object.fromEntries(Object.entries(attackEncounters)
            .filter(([, encounter]) => encounter && typeof encounter === 'object')
            .map(([nodeId, encounter]) => [nodeId, {
                completed: Boolean(encounter.completed),
                createdAt: encounter.createdAt || null,
                nodeId: encounter.nodeId || nodeId,
                options: Array.isArray(encounter.options) ? encounter.options.filter(Boolean) : [],
                selectedAttackName: encounter.selectedAttackName || null,
                statsRecorded: Boolean(encounter.statsRecorded),
                terrain: encounter.terrain || null
            }]));
    }

    function normalizeCaptureEncounters(captureEncounters) {
        if (!captureEncounters || typeof captureEncounters !== 'object') return {};

        return Object.fromEntries(Object.entries(captureEncounters)
            .filter(([, encounter]) => encounter && typeof encounter === 'object')
            .map(([nodeId, encounter]) => [nodeId, {
                completed: Boolean(encounter.completed),
                createdAt: encounter.createdAt || null,
                nodeId: encounter.nodeId || nodeId,
                options: Array.isArray(encounter.options) ? encounter.options.filter(Boolean) : [],
                rewardAttackName: encounter.rewardAttackName || null,
                rewardDragonGemName: encounter.rewardDragonGemName || null,
                selectedPokemonName: encounter.selectedPokemonName || null,
                statsRecorded: Boolean(encounter.statsRecorded),
                terrain: encounter.terrain || null
            }]));
    }

    function normalizeEventEncounters(eventEncounters) {
        if (!eventEncounters || typeof eventEncounters !== 'object') return {};

        return Object.fromEntries(Object.entries(eventEncounters)
            .filter(([, encounter]) => encounter && typeof encounter === 'object')
            .map(([nodeId, encounter]) => [nodeId, {
                battleCompleted: Boolean(encounter.battleCompleted),
                completed: Boolean(encounter.completed),
                completedAt: encounter.completedAt || null,
                createdAt: encounter.createdAt || null,
                eventId: encounter.eventId || null,
                nodeId: encounter.nodeId || nodeId,
                resultSummary: Array.isArray(encounter.resultSummary) ? encounter.resultSummary : [],
                selectedActionId: encounter.selectedActionId || null,
                startedBattle: Boolean(encounter.startedBattle),
                statsRecorded: Boolean(encounter.statsRecorded)
            }]));
    }

    function normalizeCollections(collections) {
        const normalizedCollections = collections && typeof collections === 'object' ? collections : {};
        const normalizedBench = normalizedCollections.bench && typeof normalizedCollections.bench === 'object'
            ? normalizedCollections.bench
            : {};
        const activePokemon = Array.isArray(normalizedCollections.pokemon) ? normalizedCollections.pokemon : [];
        const benchPokemon = Array.isArray(normalizedBench.pokemon) ? normalizedBench.pokemon : [];
        const pokemonCollections = normalizePokemonCollections(activePokemon, benchPokemon);
        const activeActions = Array.isArray(normalizedCollections.actions) ? normalizedCollections.actions : [];
        const rawBenchActions = Array.isArray(normalizedBench.actions) ? normalizedBench.actions : [];
        const benchActions = rawBenchActions.filter(isAttackCard);
        const promotedActions = rawBenchActions.filter(card => !isAttackCard(card));

        return {
            actions: [...activeActions, ...promotedActions],
            bench: {
                actions: benchActions,
                pokemon: pokemonCollections.bench
            },
            pokemon: pokemonCollections.active
        };
    }

    function normalizePokemonCollections(activePokemon, benchPokemon) {
        const active = activePokemon.slice(0, ACTIVE_POKEMON_LIMIT);
        const bench = [
            ...activePokemon.slice(ACTIVE_POKEMON_LIMIT),
            ...benchPokemon
        ];

        while (active.length < ACTIVE_POKEMON_LIMIT && bench.length > 0) {
            active.push(bench.shift());
        }

        return { active, bench };
    }

    function ensureCollections(run) {
        run.collections = normalizeCollections(run.collections);

        return run.collections;
    }

    function shouldBenchNewAttack(run, card) {
        return !activePokemonCanUseAttack(run, card);
    }

    function activePokemonCanUseAttack(run, attackCard) {
        if (!isAttackCard(attackCard)) return false;

        return run.collections.pokemon.some(pokemonCard => pokemonCanUseAttack(pokemonCard, attackCard));
    }

    function pokemonCanUseAttack(pokemonCard, attackCard) {
        if (!isPokemonCard(pokemonCard) || !isAttackCard(attackCard)) return false;

        const pokemonTypes = getPokemonTypes(pokemonCard.pokemon);
        const requiredTypes = getAttackTypes(attackCard.attack);

        if (requiredTypes.length === 0) return true;

        if (attackCard.attack.full_type_requirements) {
            return requiredTypes.every(type => pokemonTypes.includes(type));
        }

        return requiredTypes.some(type => pokemonTypes.includes(type));
    }

    function getPokemonTypes(pokemon) {
        if (!pokemon) return [];

        return Array.isArray(pokemon.types)
            ? compactTypes(pokemon.types)
            : compactTypes([pokemon.type1, pokemon.type2, pokemon.type3]);
    }

    function getAttackTypes(attack) {
        if (!attack) return [];

        return Array.isArray(attack.types)
            ? compactTypes(attack.types)
            : compactTypes([attack.type1, attack.type2]);
    }

    function compactTypes(types) {
        return types.filter(type => type && type !== 'NONE');
    }

    function isPokemonCard(card) {
        return Boolean(card && (card.kind === 'pokemon' || card.pokemon));
    }

    function isAttackCard(card) {
        return Boolean(card && (card.kind === 'attack' || card.attack));
    }

    function normalizeNameList(names) {
        if (!Array.isArray(names)) return [];

        const seenNames = new Set();

        return names.filter(name => {
            if (!name || seenNames.has(name)) return false;

            seenNames.add(name);
            return true;
        });
    }

    function canUseStorage() {
        return typeof localStorage !== 'undefined';
    }

    function formatId(value) {
        return String(value || 'card')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    global.PokeRun = {
        ACTIVE_POKEMON_LIMIT,
        STORAGE_KEY,
        STORAGE_VERSION,
        addActionCard,
        addPokemonCard,
        allocateCardId,
        applyMegaEvolutions,
        balancePokemonCollections,
        clearRunState,
        copyPokemonVitamins,
        createAttackCard,
        createItemCard,
        createPokemonCard,
        createRunState,
        ensureLevelMusic,
        getActiveAttackEncounter,
        getActiveBattleEncounter,
        getActiveCaptureEncounter,
        getActiveEventEncounter,
        getActiveMartEncounter,
        getExcludedTrainerNames,
        getPendingMegaEvolutions,
        hasSavedRun,
        loadRunState,
        markEventUsed,
        markTrainerUsed,
        normalizeLocationSnapshot,
        rebuildActionDeckForActivePokemon,
        saveRunState,
        swapBenchPokemon
    };
})(window);
