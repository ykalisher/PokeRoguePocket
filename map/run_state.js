/**
 * Pokemon Rogue Pocket - persistent run state helpers
 */

(function attachRunState(global) {
    'use strict';

    const STORAGE_KEY = 'pokemon-rogue-pocket-run';
    const STORAGE_VERSION = 1;

    function createRunState({ area, collections }) {
        return {
            area: {
                activeCaptureNodeId: null,
                currentNodeId: 'start',
                graph: area,
                traveledPathKeys: [],
                visitedNodeIds: ['start']
            },
            captureEncounters: {},
            collections: normalizeCollections(collections),
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

    function getActiveCaptureEncounter(run) {
        const nodeId = run && run.area ? run.area.activeCaptureNodeId : null;

        if (!nodeId || !run.captureEncounters) return null;

        const encounter = run.captureEncounters[nodeId];

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
            captureEncounters: normalizeCaptureEncounters(run.captureEncounters),
            collections: normalizeCollections(run.collections),
            nextCardId: Number.isFinite(run.nextCardId) ? run.nextCardId : 1,
            savedAt: run.savedAt || null,
            version: STORAGE_VERSION
        };
    }

    function normalizeAreaState(area) {
        if (!area || typeof area !== 'object') return null;
        if (!area.graph || !Array.isArray(area.graph.nodes) || !Array.isArray(area.graph.edges)) return null;

        return {
            activeCaptureNodeId: area.activeCaptureNodeId || null,
            currentNodeId: area.currentNodeId || 'start',
            graph: area.graph,
            traveledPathKeys: Array.isArray(area.traveledPathKeys) ? area.traveledPathKeys : [],
            visitedNodeIds: Array.isArray(area.visitedNodeIds) && area.visitedNodeIds.length > 0
                ? area.visitedNodeIds
                : ['start']
        };
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
        STORAGE_KEY,
        allocateCardId,
        clearRunState,
        createAttackCard,
        createPokemonCard,
        createRunState,
        getActiveCaptureEncounter,
        hasSavedRun,
        loadRunState,
        saveRunState
    };
})(window);
