/**
 * Pokemon Rogue Pocket - persistent run state helpers
 */

(function attachRunState(global) {
    'use strict';

    const STORAGE_KEY = 'pokemon-rogue-pocket-run';
    const STORAGE_VERSION = 1;
    const PC_STORAGE_KEY = 'pokemon-rogue-pocket-pc';
    const PC_STORAGE_VERSION = 1;
    const STARTING_CASH = 100;

    function createRunState({ area, collections }) {
        return {
            area: {
                activeBattleNodeId: null,
                activeCaptureNodeId: null,
                activeMartNodeId: null,
                currentNodeId: 'start',
                graph: area,
                traveledPathKeys: [],
                visitedNodeIds: ['start']
            },
            battleEncounters: {},
            cash: STARTING_CASH,
            captureEncounters: {},
            collections: normalizeCollections(collections),
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
            activeMartNodeId: area.activeMartNodeId || null,
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

    function normalizeCollections(collections) {
        const normalizedCollections = collections && typeof collections === 'object' ? collections : {};

        return {
            actions: Array.isArray(normalizedCollections.actions) ? normalizedCollections.actions : [],
            pokemon: Array.isArray(normalizedCollections.pokemon) ? normalizedCollections.pokemon : []
        };
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
        PC_STORAGE_KEY,
        STORAGE_KEY,
        allocateCardId,
        clearPcPokemon,
        clearRunState,
        createAttackCard,
        createItemCard,
        createPokemonCard,
        createRunState,
        getActiveBattleEncounter,
        getActiveCaptureEncounter,
        getActiveMartEncounter,
        hasSavedRun,
        loadPcPokemon,
        loadRunState,
        savePcPokemon,
        saveRunState
    };
})(window);
