/**
 * Pokemon Rogue Pocket - persistent run state helpers
 */

(function attachRunState(global) {
    'use strict';

    const STORAGE_KEY = 'pokemon-rogue-pocket-run';
    const STORAGE_VERSION = 1;
    const PC_STORAGE_KEY = 'pokemon-rogue-pocket-pc';
    const PC_STORAGE_VERSION = 1;
    const ACTIVE_POKEMON_LIMIT = 6;
    const STARTING_CASH = 100;

    function createRunState({ area, collections }) {
        return {
            area: {
                activeBattleNodeId: null,
                activeCaptureNodeId: null,
                activeEventNodeId: null,
                activeMartNodeId: null,
                completed: false,
                completedAt: null,
                completedBossNodeId: null,
                currentNodeId: 'start',
                graph: area,
                traveledPathKeys: [],
                visitedNodeIds: ['start']
            },
            battleEncounters: {},
            cash: STARTING_CASH,
            captureEncounters: {},
            collections: normalizeCollections(collections),
            eventEncounters: {},
            martEncounters: {},
            nextCardId: 1,
            savedAt: null,
            version: STORAGE_VERSION
        };
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
        if (!canUseStorage()) return false;

        try {
            localStorage.removeItem(STORAGE_KEY);
            return true;
        } catch (error) {
            console.warn('Could not clear run state.', error);
            return false;
        }
    }

    function hasSavedRun() {
        return Boolean(loadRunState());
    }

    function loadPcPokemon() {
        if (!canUseStorage()) return null;

        try {
            const rawState = localStorage.getItem(PC_STORAGE_KEY);

            if (!rawState) return null;

            const parsedState = JSON.parse(rawState);

            if (!parsedState || parsedState.version !== PC_STORAGE_VERSION) {
                clearPcPokemon();
                return null;
            }

            return normalizePcPokemonCard(parsedState.card);
        } catch (error) {
            console.warn('Could not load PC Pokemon.', error);
            clearPcPokemon();
            return null;
        }
    }

    function savePcPokemon(card) {
        if (!canUseStorage()) return false;

        try {
            const normalizedCard = normalizePcPokemonCard(card);

            if (!normalizedCard) return clearPcPokemon();

            localStorage.setItem(PC_STORAGE_KEY, JSON.stringify({
                card: normalizedCard,
                savedAt: new Date().toISOString(),
                version: PC_STORAGE_VERSION
            }));

            return true;
        } catch (error) {
            console.warn('Could not save PC Pokemon.', error);
            return false;
        }
    }

    function clearPcPokemon() {
        if (!canUseStorage()) return false;

        try {
            localStorage.removeItem(PC_STORAGE_KEY);
            return true;
        } catch (error) {
            console.warn('Could not clear PC Pokemon.', error);
            return false;
        }
    }

    function getActiveCaptureEncounter(run) {
        const nodeId = run && run.area ? run.area.activeCaptureNodeId : null;

        if (!nodeId || !run.captureEncounters) return null;

        const encounter = run.captureEncounters[nodeId];

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
            statChanges: [],
            statStages: {
                attack: 0,
                defense: 0,
                speed: 0
            }
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
            battleEncounters: normalizeBattleEncounters(run.battleEncounters),
            cash: Number.isFinite(run.cash) ? run.cash : STARTING_CASH,
            captureEncounters: normalizeCaptureEncounters(run.captureEncounters),
            collections: normalizeCollections(run.collections),
            eventEncounters: normalizeEventEncounters(run.eventEncounters),
            martEncounters: normalizeMartEncounters(run.martEncounters),
            nextCardId: Number.isFinite(run.nextCardId) ? run.nextCardId : 1,
            savedAt: run.savedAt || null,
            version: STORAGE_VERSION
        };
    }

    function normalizeAreaState(area) {
        if (!area || typeof area !== 'object') return null;
        if (!area.graph || !Array.isArray(area.graph.nodes) || !Array.isArray(area.graph.edges)) return null;

        return {
            activeBattleNodeId: area.activeBattleNodeId || null,
            activeCaptureNodeId: area.activeCaptureNodeId || null,
            activeEventNodeId: area.activeEventNodeId || null,
            activeMartNodeId: area.activeMartNodeId || null,
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
                trainerName: encounter.trainerName || null
            }]));
    }

    function normalizeMartEncounters(martEncounters) {
        if (!martEncounters || typeof martEncounters !== 'object') return {};

        return Object.fromEntries(Object.entries(martEncounters)
            .filter(([, encounter]) => encounter && typeof encounter === 'object')
            .map(([nodeId, encounter]) => [nodeId, {
                attackNames: normalizeNameList(encounter.attackNames),
                boughtAttackNames: normalizeNameList(encounter.boughtAttackNames),
                boughtItemNames: normalizeNameList(encounter.boughtItemNames),
                completed: Boolean(encounter.completed),
                completedAt: encounter.completedAt || null,
                createdAt: encounter.createdAt || null,
                itemNames: normalizeNameList(encounter.itemNames),
                nodeId: encounter.nodeId || nodeId
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
                startedBattle: Boolean(encounter.startedBattle)
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
        return run.collections.pokemon.length >= ACTIVE_POKEMON_LIMIT &&
            !activePokemonCanUseAttack(run, card);
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

    function normalizePcPokemonCard(card) {
        if (!card || typeof card !== 'object' || card.kind !== 'pokemon' || !card.pokemon) return null;

        return createPokemonCard(card.pokemon, 'player', 'pc-pokemon');
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
        PC_STORAGE_KEY,
        STORAGE_KEY,
        addActionCard,
        addPokemonCard,
        allocateCardId,
        balancePokemonCollections,
        clearPcPokemon,
        clearRunState,
        createAttackCard,
        createItemCard,
        createPokemonCard,
        createRunState,
        getActiveBattleEncounter,
        getActiveCaptureEncounter,
        getActiveEventEncounter,
        getActiveMartEncounter,
        hasSavedRun,
        loadPcPokemon,
        loadRunState,
        rebuildActionDeckForActivePokemon,
        savePcPokemon,
        saveRunState,
        swapBenchPokemon
    };
})(window);
