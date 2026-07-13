/**
 * Pokemon Rogue Pocket - overworld area map prototype
 */

(function bootAreaMap(arena, area, runStore, locations) {
    'use strict';

    const START_NODE_ID = 'start';
    const DEFAULT_BOSS_NODE_ID = 'boss-12';
    const LOCATION_LABELS = Object.freeze({
        battle: 'Trainer Battle',
        boss: 'Boss',
        capture: 'Capture Spot',
        event: 'Event',
        shop: 'Shop',
        start: 'Entrance'
    });
    const LEGENDARY_CAPTURE_CHANCE = 0.3;
    const CARD_BACKS = Object.freeze({
        actions: 'assets/card-backs/ACTION_CARD_BACK.png',
        pokemon: 'assets/card-backs/POKEMON_CARD_BACK.png'
    });

    const state = {
        area: null,
        benchSummary: null,
        benchWindowOpen: false,
        cardWindow: null,
        collections: {
            actions: [],
            bench: {
                actions: [],
                pokemon: []
            },
            pokemon: []
        },
        currentNodeId: START_NODE_ID,
        elements: {},
        popupTimer: null,
        run: null,
        selectedActivePokemonId: null,
        selectedBenchPokemonId: null,
        traveledPathKeys: new Set(),
        visitedNodeIds: new Set([START_NODE_ID])
    };

    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        state.elements.root = document.getElementById('area-root');
        state.elements.popup = document.getElementById('area-popup');

        state.elements.root.addEventListener('click', handleAreaClick);
        window.addEventListener('keydown', handleKeyDown);

        await arena.Data.loadGameData();

        restoreOrCreateRunState();

        if (redirectToActiveEncounter()) return;

        render();
    }

    function handleAreaClick(event) {
        const closeButton = event.target.closest('[data-close-card-window]');

        if (closeButton) {
            closeCardWindow();
            return;
        }

        if (event.target.matches('[data-card-window-overlay]')) {
            closeCardWindow();
            return;
        }

        const closeBenchButton = event.target.closest('[data-close-bench-window]');

        if (closeBenchButton) {
            closeBenchWindow();
            return;
        }

        if (event.target.matches('[data-bench-window-overlay]')) {
            closeBenchWindow();
            return;
        }

        const cardWindowButton = event.target.closest('[data-card-window]');

        if (cardWindowButton) {
            openCardWindow(cardWindowButton.dataset.cardWindow);
            return;
        }

        const benchWindowButton = event.target.closest('[data-bench-window]');

        if (benchWindowButton) {
            openBenchWindow();
            return;
        }

        const summaryDoneButton = event.target.closest('[data-bench-summary-done]');

        if (summaryDoneButton) {
            state.benchSummary = null;
            render();
            return;
        }

        const activePokemonButton = event.target.closest('[data-active-pokemon-id]');

        if (activePokemonButton) {
            selectActivePokemon(activePokemonButton.dataset.activePokemonId);
            return;
        }

        const benchPokemonButton = event.target.closest('[data-bench-pokemon-id]');

        if (benchPokemonButton) {
            selectBenchPokemon(benchPokemonButton.dataset.benchPokemonId);
            return;
        }

        const swapButton = event.target.closest('[data-bench-swap]');

        if (swapButton) {
            swapSelectedBenchPokemon();
            return;
        }

        const nodeButton = event.target.closest('[data-node-id]');

        if (!nodeButton) return;

        moveToNode(nodeButton.dataset.nodeId);
    }

    function handleKeyDown(event) {
        if (event.key === 'Escape' && state.cardWindow) {
            closeCardWindow();
        } else if (event.key === 'Escape' && state.benchWindowOpen) {
            closeBenchWindow();
        }
    }

    function openCardWindow(collectionKey) {
        if (!state.collections[collectionKey]) return;

        state.cardWindow = collectionKey;
        state.benchWindowOpen = false;
        render();
    }

    function closeCardWindow() {
        state.cardWindow = null;
        render();
    }

    function openBenchWindow() {
        state.cardWindow = null;
        state.benchWindowOpen = true;
        state.benchSummary = null;
        render();
    }

    function closeBenchWindow() {
        state.benchWindowOpen = false;
        state.benchSummary = null;
        state.selectedActivePokemonId = null;
        state.selectedBenchPokemonId = null;
        render();
    }

    function selectActivePokemon(cardId) {
        state.selectedActivePokemonId = state.selectedActivePokemonId === cardId ? null : cardId;
        state.benchSummary = null;
        render();
    }

    function selectBenchPokemon(cardId) {
        state.selectedBenchPokemonId = state.selectedBenchPokemonId === cardId ? null : cardId;
        state.benchSummary = null;
        render();
    }

    function swapSelectedBenchPokemon() {
        const result = runStore.swapBenchPokemon(
            state.run,
            state.selectedActivePokemonId,
            state.selectedBenchPokemonId
        );

        if (!result) return;

        state.collections = state.run.collections;
        state.selectedActivePokemonId = null;
        state.selectedBenchPokemonId = null;
        state.benchSummary = result;
        saveRunState();
        render();
    }

    function moveToNode(nodeId) {
        const node = getNodeById(nodeId);

        if (!node || !isNodeSelectable(node)) return;

        const previousNodeId = state.currentNodeId;

        state.currentNodeId = node.id;
        state.visitedNodeIds.add(node.id);
        state.traveledPathKeys.add(getPathKey(previousNodeId, node.id));

        if (node.type === 'battle' || node.type === 'boss') {
            const encounter = getOrCreateTrainerEncounter(node);

            if (!encounter) {
                state.currentNodeId = previousNodeId;
                state.visitedNodeIds.delete(node.id);
                state.traveledPathKeys.delete(getPathKey(previousNodeId, node.id));
                render();
                showPopup(node.type === 'boss'
                    ? 'No Boss trainers are available.'
                    : 'No trainers are available.');
                return;
            }

            saveRunState();
            arena.Model.clearSavedBattleState();
            window.location.href = 'game.html';
            return;
        }

        if (node.type === 'capture') {
            getOrCreateCaptureEncounter(node);
            saveRunState();
            window.location.href = 'capture.html';
            return;
        }

        if (node.type === 'shop') {
            getOrCreateMartEncounter(node);
            saveRunState();
            window.location.href = 'mart.html';
            return;
        }

        if (node.type === 'event') {
            const encounter = getOrCreateEventEncounter(node);

            if (!encounter) {
                state.currentNodeId = previousNodeId;
                state.visitedNodeIds.delete(node.id);
                state.traveledPathKeys.delete(getPathKey(previousNodeId, node.id));
                render();
                showPopup('No events are available.');
                return;
            }

            saveRunState();
            window.location.href = 'event.html';
            return;
        }

        saveRunState();
        render();
        showPopup(`You entered ${getEnteredLocationText(node)}.`);
    }

    function render() {
        const currentNode = getCurrentNode();

        state.elements.root.innerHTML = `
            <header class="area-topbar">
                <div class="area-title-group">
                    <span class="area-kicker">Level ${getRunLevel()} of ${locations.TOTAL_LEVELS}</span>
                    <h1>${getLocationName()}</h1>
                    <div class="area-subrow">
                        <span class="stat-pill">${getLocationTerrain()}</span>
                        <span class="stat-pill">${renderCurrentLocationText(currentNode)}</span>
                        ${isRunComplete() ? '<span class="stat-pill">Champion</span>' : (isAreaComplete() ? '<span class="stat-pill">Cleared</span>' : '')}
                    </div>
                </div>
                <div class="area-hud" aria-label="Run resources and decks">
                    ${renderMoney()}
                    ${renderDeckButton('actions', 'Action deck', state.collections.actions.length)}
                    ${renderDeckButton('pokemon', 'Pokemon cards', state.collections.pokemon.length)}
                    ${renderBenchButton()}
                </div>
            </header>
            <section class="area-map-panel" aria-label="Area route">
                <div class="area-map-viewport">
                    ${isRunComplete() ? '<div class="area-victory-banner" role="status">Champion! You cleared all 4 levels.</div>' : ''}
                    <div class="area-map-canvas">
                        ${renderMapLinks()}
                        ${state.area.nodes.map(renderNode).join('')}
                    </div>
                </div>
                <footer class="area-map-footer">
                    ${renderLegend()}
                    <span class="area-route-status">${renderRouteStatus()}</span>
                </footer>
            </section>
            ${state.cardWindow ? renderCardWindow() : ''}
            ${state.benchWindowOpen ? renderBenchWindow() : ''}
        `;
    }

    function renderMoney() {
        const cash = Number.isFinite(state.run && state.run.cash) ? state.run.cash : 0;

        return `
            <span class="area-money" aria-label="${cash} coins">
                <span class="area-money-icon" aria-hidden="true">C</span>
                <span>${cash}</span>
            </span>
        `;
    }

    function renderDeckButton(collectionKey, label, count) {
        return `
            <button class="area-deck-button" type="button" data-card-window="${collectionKey}" aria-label="Open ${label}" title="${label}">
                <img src="${CARD_BACKS[collectionKey]}" alt="">
                <span class="area-deck-count">${count}</span>
            </button>
        `;
    }

    function renderBenchButton() {
        const benchCount = getBenchPokemon().length;

        return `
            <button class="area-bench-button" type="button" data-bench-window aria-label="Open Pokemon bench" title="Pokemon bench">
                <span class="area-bench-icon" aria-hidden="true">B</span>
                <span class="area-bench-text">Bench</span>
                <span class="area-bench-count">${benchCount}</span>
            </button>
        `;
    }

    function renderCurrentLocationText(currentNode) {
        if (!currentNode || currentNode.type === 'start') return 'Entrance';

        return `Location ${currentNode.step} of ${getMaxStep()}: ${LOCATION_LABELS[currentNode.type]}`;
    }

    function renderRouteStatus() {
        const currentNode = getCurrentNode();
        const nextNodes = getAvailableNextNodes();

        if (isRunComplete()) return 'Run complete — Champion!';
        if (isAreaComplete()) return 'Area complete';
        if (!currentNode || currentNode.id === getBossNodeId()) return 'Area boss reached';

        return `${nextNodes.length} path${nextNodes.length === 1 ? '' : 's'} available`;
    }

    function renderMapLinks() {
        return `
            <svg class="area-map-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                ${state.area.edges.map(renderMapLink).join('')}
            </svg>
        `;
    }

    function renderMapLink(edge) {
        const fromNode = getNodeById(edge.from);
        const toNode = getNodeById(edge.to);
        const available = edge.from === state.currentNodeId && !state.visitedNodeIds.has(edge.to);
        const traveled = state.traveledPathKeys.has(getPathKey(edge.from, edge.to));
        const className = [
            'area-map-link',
            available ? 'is-available' : '',
            traveled ? 'is-traveled' : ''
        ].filter(Boolean).join(' ');

        return `<line class="${className}" x1="${fromNode.x}" y1="${fromNode.y}" x2="${toNode.x}" y2="${toNode.y}"></line>`;
    }

    function renderNode(node) {
        const current = state.currentNodeId === node.id;
        const visited = state.visitedNodeIds.has(node.id);
        const selectable = isNodeSelectable(node);
        const className = [
            'area-node',
            `area-node--${node.type}`,
            current ? 'is-current' : '',
            visited ? 'is-visited' : '',
            selectable ? 'is-selectable' : ''
        ].filter(Boolean).join(' ');
        const disabled = selectable ? '' : 'disabled';
        const stepText = node.step > 0 ? node.step : 'Start';

        const trainer = isTrainerNodeType(node.type) ? getBattleNodeTrainer(node) : null;

        return `
            <button class="${className}" type="button" style="--node-x: ${node.x}%; --node-y: ${node.y}%;" data-node-id="${node.id}" ${disabled} aria-label="${getNodeAriaLabel(node, current, selectable)}">
                ${renderLocationIcon(node, trainer)}
                <span class="area-node-step">${stepText}</span>
            </button>
        `;
    }

    function renderLocationIcon(node, trainer = null) {
        const type = typeof node === 'string' ? node : node.type;

        if (isTrainerNodeType(type) && trainer) {
            return `
                <span class="area-node-icon area-icon--${type} area-icon--trainer-sprite" aria-hidden="true">
                    <img class="area-node-trainer-sprite" src="${trainer.spritePath}" alt="">
                </span>
            `;
        }

        if (type === 'event') {
            return '<span class="area-node-icon area-icon--event" aria-hidden="true">!</span>';
        }

        if (type === 'shop') {
            return '<span class="area-node-icon area-icon--shop" aria-hidden="true">C</span>';
        }

        return `<span class="area-node-icon area-icon--${type}" aria-hidden="true"></span>`;
    }

    function renderLegend() {
        return `
            <div class="area-legend" aria-label="Location types">
                ${['capture', 'battle', 'shop', 'event', 'boss'].map(type => `
                    <span class="area-legend-item">
                        ${renderLegendIcon(type)}
                        <span>${LOCATION_LABELS[type]}</span>
                    </span>
                `).join('')}
            </div>
        `;
    }

    function renderLegendIcon(type) {
        if (type === 'event') {
            return '<span class="area-legend-icon area-icon--event" aria-hidden="true">!</span>';
        }

        if (type === 'shop') {
            return '<span class="area-legend-icon area-icon--shop" aria-hidden="true">C</span>';
        }

        return `<span class="area-legend-icon area-icon--${type}" aria-hidden="true"></span>`;
    }

    function renderCardWindow() {
        const cards = getCardWindowCards();
        const title = state.cardWindow === 'pokemon' ? 'Pokemon Cards' : 'Action Deck';
        const countText = `${cards.length} ${cards.length === 1 ? 'card' : 'cards'}`;
        const content = state.cardWindow === 'actions'
            ? renderActionCardSections(cards)
            : renderCardGrid(cards);

        return `
            <div class="area-overlay" data-card-window-overlay>
                <section class="area-card-window" role="dialog" aria-modal="true" aria-labelledby="area-card-window-title">
                    <header class="area-card-window-header">
                        <div>
                            <h2 class="area-card-window-title" id="area-card-window-title">${title}</h2>
                            <span class="area-card-window-count">${countText}</span>
                        </div>
                        <button class="area-card-window-close" type="button" data-close-card-window aria-label="Close card window">x</button>
                    </header>
                    <div class="area-card-window-body">${content}</div>
                </section>
            </div>
        `;
    }

    function renderBenchWindow() {
        return `
            <div class="area-overlay" data-bench-window-overlay>
                <section class="area-card-window area-bench-window" role="dialog" aria-modal="true" aria-labelledby="area-bench-window-title">
                    <header class="area-card-window-header">
                        <div>
                            <h2 class="area-card-window-title" id="area-bench-window-title">${state.benchSummary ? 'Swap Summary' : 'Pokemon Bench'}</h2>
                            <span class="area-card-window-count">${renderBenchWindowCount()}</span>
                        </div>
                        <button class="area-card-window-close" type="button" data-close-bench-window aria-label="Close bench window">x</button>
                    </header>
                    <div class="area-card-window-body">
                        ${state.benchSummary ? renderBenchSummary() : renderBenchManager()}
                    </div>
                </section>
            </div>
        `;
    }

    function renderBenchWindowCount() {
        return `${state.collections.pokemon.length}/${runStore.ACTIVE_POKEMON_LIMIT} active, ${getBenchPokemon().length} benched`;
    }

    function renderBenchManager() {
        const activePokemon = state.collections.pokemon;
        const benchPokemon = getBenchPokemon();
        const canSwap = state.selectedActivePokemonId && state.selectedBenchPokemonId;

        return `
            <div class="area-bench-layout">
                <section class="area-bench-section">
                    <header class="area-card-section-header">
                        <h3>Active Pokemon</h3>
                        <span>${activePokemon.length}/${runStore.ACTIVE_POKEMON_LIMIT}</span>
                    </header>
                    <div class="area-bench-card-grid">
                        ${activePokemon.map(card => renderBenchPokemonButton(card, 'active')).join('')}
                    </div>
                </section>
                <section class="area-bench-section">
                    <header class="area-card-section-header">
                        <h3>Bench Pokemon</h3>
                        <span>${benchPokemon.length}</span>
                    </header>
                    ${benchPokemon.length > 0
                        ? `<div class="area-bench-card-grid">${benchPokemon.map(card => renderBenchPokemonButton(card, 'bench')).join('')}</div>`
                        : '<div class="area-bench-empty">No benched Pokemon</div>'
                    }
                </section>
            </div>
            <footer class="area-bench-footer">
                <span>${renderSelectedSwapText()}</span>
                <button class="area-bench-swap-button" type="button" data-bench-swap ${canSwap ? '' : 'disabled'}>Swap</button>
            </footer>
        `;
    }

    function renderBenchPokemonButton(card, zone) {
        const selected = zone === 'active'
            ? state.selectedActivePokemonId === card.id
            : state.selectedBenchPokemonId === card.id;
        const dataAttribute = zone === 'active'
            ? `data-active-pokemon-id="${card.id}"`
            : `data-bench-pokemon-id="${card.id}"`;

        return `
            <button class="area-bench-card-button ${selected ? 'is-selected' : ''}" type="button" ${dataAttribute} aria-pressed="${selected ? 'true' : 'false'}" aria-label="Select ${arena.Model.getCardName(card)}">
                ${arena.Render.renderCardPreview(card, { className: 'area-bench-card-preview' })}
            </button>
        `;
    }

    function renderSelectedSwapText() {
        const activePokemon = state.collections.pokemon.find(card => card.id === state.selectedActivePokemonId);
        const benchPokemon = getBenchPokemon().find(card => card.id === state.selectedBenchPokemonId);

        if (activePokemon && benchPokemon) {
            return `${arena.Model.getCardName(benchPokemon)} replaces ${arena.Model.getCardName(activePokemon)}`;
        }

        return 'Select one active Pokemon and one bench Pokemon';
    }

    function renderBenchSummary() {
        const summary = state.benchSummary;

        return `
            <section class="area-bench-summary">
                <p>${arena.Model.getCardName(summary.activePokemon)} moved into the active deck. ${arena.Model.getCardName(summary.benchedPokemon)} moved to the bench.</p>
                ${renderAttackChangeSection('Added to Action Deck', summary.actionChanges.addedToDeck, 'No attacks were added.')}
                ${renderAttackChangeSection('Moved to Attack Bench', summary.actionChanges.movedToBench, 'No attacks were moved.')}
                <button class="area-bench-swap-button" type="button" data-bench-summary-done>Done</button>
            </section>
        `;
    }

    function renderAttackChangeSection(title, cards, emptyText) {
        const entries = summarizeCardsByName(cards);

        return `
            <section class="area-bench-change-section">
                <header class="area-card-section-header">
                    <h3>${title}</h3>
                    <span>${cards.length}</span>
                </header>
                ${entries.length > 0
                    ? `<ul class="area-bench-change-list">${entries.map(entry => `<li>${entry}</li>`).join('')}</ul>`
                    : `<div class="area-bench-empty">${emptyText}</div>`
                }
            </section>
        `;
    }

    function summarizeCardsByName(cards) {
        const countsByName = cards.reduce((counts, card) => {
            const name = arena.Model.getCardName(card);

            counts.set(name, (counts.get(name) || 0) + 1);
            return counts;
        }, new Map());

        return Array.from(countsByName.entries())
            .sort(([leftName], [rightName]) => leftName.localeCompare(rightName))
            .map(([name, count]) => count > 1 ? `${name} x${count}` : name);
    }

    function renderActionCardSections(cards) {
        const attacks = cards.filter(arena.Model.isAttackCard).sort(compareCardsByName);
        const items = cards.filter(arena.Model.isItemCard).sort(compareCardsByName);

        return [
            renderCardSection('Attacks', attacks),
            renderCardSection('Items', items)
        ].join('');
    }

    function renderCardSection(title, cards) {
        return `
            <section class="area-card-section">
                <header class="area-card-section-header">
                    <h3>${title}</h3>
                    <span>${cards.length} ${cards.length === 1 ? 'card' : 'cards'}</span>
                </header>
                ${renderCardGrid(cards)}
            </section>
        `;
    }

    function renderCardGrid(cards) {
        return `
            <div class="area-card-grid">
                ${cards.map(card => arena.Render.renderCardPreview(card, { className: 'area-card-preview' })).join('')}
            </div>
        `;
    }

    function getCardWindowCards() {
        return state.collections[state.cardWindow]
            .slice()
            .sort(compareCardsByName);
    }

    function getBenchPokemon() {
        return state.collections.bench && Array.isArray(state.collections.bench.pokemon)
            ? state.collections.bench.pokemon
            : [];
    }

    function showPopup(message) {
        window.clearTimeout(state.popupTimer);

        state.elements.popup.textContent = message;
        state.elements.popup.hidden = false;
        state.popupTimer = window.setTimeout(() => {
            state.elements.popup.hidden = true;
        }, 1600);
    }

    function restoreOrCreateRunState() {
        if (consumeNewRunRequest()) {
            runStore.clearRunState();
            arena.Model.clearSavedBattleState();
            createFreshRunState();
            return;
        }

        const savedRun = runStore.loadRunState();

        if (savedRun) {
            applyRunState(savedRun);
            const advanced = advanceLevelIfNeeded();
            const changed = [
                repairRunLocation(),
                repairRunCollections(),
                sanitizeCaptureEncounters(),
                sanitizeEventEncounters(),
                ensureBattleNodeEncounters(),
                sanitizeBattleEncounters()
            ].some(Boolean);

            if (changed || advanced) saveRunState();
            return;
        }

        createFreshRunState();
    }

    function createFreshRunState() {
        // Phase 4 threads the real starter choice through here; for now level 1
        // always uses the water starter, so pick a location that has WATER.
        const starterId = 'water';
        const location = chooseLevelLocation({
            requiredType: getStarterType(starterId)
        });
        const level = 1;

        applyRunState(runStore.createRunState({
            area: locations.createAreaGraph(level, { includeEvents: hasAvailableEvents() }),
            bossNodeId: locations.bossNodeIdForLevel(level),
            collections: createCardCollections(),
            location,
            starterId,
            level
        }));
        ensureBattleNodeEncounters();
        saveRunState();
    }

    /**
     * When the current area's boss has been cleared but the run is not over,
     * advance to the next level: regenerate the map/location and refresh the
     * in-memory state. Returns true when an advance happened.
     */
    function advanceLevelIfNeeded() {
        if (!state.run || !state.run.area) return false;
        if (!state.run.area.completed || state.run.runCompleted) return false;
        if (getRunLevel() >= locations.TOTAL_LEVELS) return false;

        locations.advanceRunToNextLevel(state.run, arena.GameData, {
            includeEvents: hasAvailableEvents()
        });
        applyRunState(state.run);
        ensureBattleNodeEncounters();
        saveRunState();
        showPopup(`Entering ${getLocationName()} — Level ${getRunLevel()} of ${locations.TOTAL_LEVELS}`);

        return true;
    }

    function chooseLevelLocation(options) {
        const location = locations.chooseNextLocation(arena.GameData, options || {});

        return locations.createLocationSnapshot(location);
    }

    function getStarterType(starterId) {
        const deck = locations.STARTER_DECKS[starterId] || locations.STARTER_DECKS.water;

        return deck.type;
    }

    function getRunLevel() {
        return state.run && Number.isFinite(state.run.level) ? state.run.level : 1;
    }

    function getBossNodeId() {
        return (state.run && state.run.area && state.run.area.bossNodeId) || DEFAULT_BOSS_NODE_ID;
    }

    function getMaxStep() {
        return state.area && Array.isArray(state.area.nodes) && state.area.nodes.length > 0
            ? state.area.nodes.reduce((max, node) => Math.max(max, Number(node.step) || 0), 0)
            : 12;
    }

    function isRunComplete() {
        return Boolean(state.run && state.run.runCompleted);
    }

    function getRunLocation() {
        return state.run && state.run.location ? state.run.location : null;
    }

    function getLocationName() {
        const location = getRunLocation();

        return location && location.name ? location.name : 'Unknown Region';
    }

    function getLocationTerrain() {
        const location = getRunLocation();

        return location && location.terrain ? location.terrain : 'Wilds';
    }

    function getLocationTypes() {
        const location = getRunLocation();

        return location && Array.isArray(location.types) ? location.types : [];
    }

    function consumeNewRunRequest() {
        const params = new URLSearchParams(window.location.search);

        if (params.get('newRun') !== '1') return false;

        window.history.replaceState(null, '', 'area.html');
        return true;
    }

    function applyRunState(run) {
        state.run = run;
        state.area = run.area.graph;
        state.collections = run.collections;
        state.currentNodeId = run.area.currentNodeId || START_NODE_ID;
        state.traveledPathKeys = new Set(run.area.traveledPathKeys || []);
        state.visitedNodeIds = new Set(run.area.visitedNodeIds || [START_NODE_ID]);
    }

    function saveRunState() {
        syncRunState();
        runStore.saveRunState(state.run);
    }

    function syncRunState() {
        if (!state.run) return;

        state.run.area.graph = state.area;
        state.run.area.currentNodeId = state.currentNodeId;
        state.run.area.traveledPathKeys = Array.from(state.traveledPathKeys);
        state.run.area.visitedNodeIds = Array.from(state.visitedNodeIds);
        state.run.collections = state.collections;
    }

    function isAreaComplete() {
        return Boolean(state.run && state.run.area && state.run.area.completed);
    }

    function repairRunLocation() {
        if (!state.run || state.run.location) return false;

        // A v2 save written before a location was assigned (mid-development).
        // Assign one now the same way a fresh run would, so it stays playable.
        const location = chooseLevelLocation({
            requiredType: getStarterType(state.run.starterId)
        });

        state.run.location = location;
        state.run.visitedLocationIds = location ? [location.id] : [];

        return true;
    }

    function repairRunCollections() {
        const balanceResult = runStore.balancePokemonCollections(state.run);
        const actionChanges = runStore.rebuildActionDeckForActivePokemon(state.run);

        state.collections = state.run.collections;

        return Boolean(balanceResult.changed) ||
            actionChanges.addedToDeck.length > 0 ||
            actionChanges.movedToBench.length > 0;
    }

    function redirectToActiveEncounter() {
        if (runStore.getActiveBattleEncounter(state.run)) {
            window.location.href = 'game.html';
            return true;
        }

        if (runStore.getActiveCaptureEncounter(state.run)) {
            window.location.href = 'capture.html';
            return true;
        }

        if (runStore.getActiveMartEncounter(state.run)) {
            window.location.href = 'mart.html';
            return true;
        }

        if (!runStore.getActiveEventEncounter(state.run)) return false;

        window.location.href = 'event.html';
        return true;
    }

    function getOrCreateCaptureEncounter(node) {
        const existingEncounter = state.run.captureEncounters[node.id];

        if (existingEncounter && !existingEncounter.completed) {
            state.run.area.activeCaptureNodeId = node.id;
            state.run.area.activeBattleNodeId = null;
            state.run.area.activeEventNodeId = null;
            state.run.area.activeMartNodeId = null;
            sanitizeCaptureEncounter(existingEncounter);
            return existingEncounter;
        }

        const pokemonOptions = chooseCapturePokemonOptions(node);
        const encounter = {
            completed: false,
            createdAt: new Date().toISOString(),
            nodeId: node.id,
            options: pokemonOptions.map(pokemon => pokemon.name),
            rewardAttackName: null,
            selectedPokemonName: null,
            terrain: getLocationTerrain()
        };

        state.run.captureEncounters[node.id] = encounter;
        state.run.area.activeCaptureNodeId = node.id;
        state.run.area.activeBattleNodeId = null;
        state.run.area.activeEventNodeId = null;
        state.run.area.activeMartNodeId = null;

        return encounter;
    }

    function getOrCreateTrainerEncounter(node) {
        const existingEncounter = state.run.battleEncounters[node.id];

        if (existingEncounter && !existingEncounter.completed) {
            state.run.area.activeBattleNodeId = node.id;
            state.run.area.activeCaptureNodeId = null;
            state.run.area.activeEventNodeId = null;
            state.run.area.activeMartNodeId = null;
            sanitizeBattleEncounter(existingEncounter, node);
            return existingEncounter;
        }

        const trainer = chooseTrainerForNode(node);

        if (!trainer) return null;

        const encounter = createBattleEncounter(node, trainer);

        state.run.battleEncounters[node.id] = encounter;
        state.run.area.activeBattleNodeId = node.id;
        state.run.area.activeCaptureNodeId = null;
        state.run.area.activeEventNodeId = null;
        state.run.area.activeMartNodeId = null;

        return encounter;
    }

    function createBattleEncounter(node, trainer) {
        return {
            completed: false,
            completedAt: null,
            createdAt: new Date().toISOString(),
            finishedAt: null,
            nodeId: node.id,
            outcome: null,
            rank: trainer.rank,
            rewardCash: trainer.cash,
            rewardCollected: false,
            startedAt: null,
            trainerName: trainer.name
        };
    }

    function getOrCreateMartEncounter(node) {
        const existingEncounter = state.run.martEncounters[node.id];

        if (existingEncounter && !existingEncounter.completed) {
            state.run.area.activeMartNodeId = node.id;
            state.run.area.activeBattleNodeId = null;
            state.run.area.activeCaptureNodeId = null;
            state.run.area.activeEventNodeId = null;
            sanitizeMartEncounter(existingEncounter);
            return existingEncounter;
        }

        const encounter = {
            attackNames: chooseMartCardNames('attacks', 8),
            boughtAttackNames: [],
            boughtItemNames: [],
            completed: false,
            completedAt: null,
            createdAt: new Date().toISOString(),
            itemNames: chooseMartCardNames('items', 4),
            nodeId: node.id
        };

        state.run.martEncounters[node.id] = encounter;
        state.run.area.activeMartNodeId = node.id;
        state.run.area.activeBattleNodeId = null;
        state.run.area.activeCaptureNodeId = null;
        state.run.area.activeEventNodeId = null;

        return encounter;
    }

    function getOrCreateEventEncounter(node) {
        state.run.eventEncounters = state.run.eventEncounters || {};

        const existingEncounter = state.run.eventEncounters[node.id];

        if (existingEncounter && !existingEncounter.completed) {
            state.run.area.activeEventNodeId = node.id;
            state.run.area.activeBattleNodeId = null;
            state.run.area.activeCaptureNodeId = null;
            state.run.area.activeMartNodeId = null;
            sanitizeEventEncounter(existingEncounter);
            return existingEncounter;
        }

        const eventRecord = window.PokeEvents && window.PokeEvents.chooseEvent
            ? window.PokeEvents.chooseEvent(arena.GameData, state.run)
            : null;

        if (!eventRecord) return null;

        const encounter = {
            battleCompleted: false,
            completed: false,
            completedAt: null,
            createdAt: new Date().toISOString(),
            eventId: eventRecord.id,
            nodeId: node.id,
            resultSummary: [],
            selectedActionId: null,
            startedBattle: false
        };

        state.run.eventEncounters[node.id] = encounter;
        state.run.area.activeEventNodeId = node.id;
        state.run.area.activeBattleNodeId = null;
        state.run.area.activeCaptureNodeId = null;
        state.run.area.activeMartNodeId = null;

        return encounter;
    }

    function sanitizeMartEncounter(encounter) {
        const attackNames = sanitizeMartCardNames('attacks', encounter.attackNames, 8);
        const itemNames = sanitizeMartCardNames('items', encounter.itemNames, 4);
        const changed = didNameListChange(encounter.attackNames, attackNames) ||
            didNameListChange(encounter.itemNames, itemNames);

        encounter.attackNames = attackNames;
        encounter.itemNames = itemNames;
        encounter.boughtAttackNames = sanitizeBoughtNames(encounter.boughtAttackNames, attackNames);
        encounter.boughtItemNames = sanitizeBoughtNames(encounter.boughtItemNames, itemNames);

        return changed;
    }

    function sanitizeMartCardNames(collectionKey, names, count) {
        const availableNames = new Set(getUniqueGameRecords(collectionKey).map(record => record.name));
        const seenNames = new Set();
        const validNames = Array.isArray(names)
            ? names.filter(name => {
                if (!availableNames.has(name) || seenNames.has(name)) return false;

                seenNames.add(name);
                return true;
            })
            : [];
        const missingCount = Math.max(0, count - validNames.length);

        if (missingCount === 0) return validNames;

        const replacementNames = chooseMartCardNames(collectionKey, count)
            .filter(name => !seenNames.has(name))
            .slice(0, missingCount);

        return [...validNames, ...replacementNames];
    }

    function sanitizeBoughtNames(names, inventoryNames) {
        const inventorySet = new Set(inventoryNames);
        const seenNames = new Set();

        return (Array.isArray(names) ? names : []).filter(name => {
            if (!inventorySet.has(name) || seenNames.has(name)) return false;

            seenNames.add(name);
            return true;
        });
    }

    function didNameListChange(previousNames, nextNames) {
        const names = Array.isArray(previousNames) ? previousNames : [];

        return names.length !== nextNames.length ||
            nextNames.some((name, index) => name !== names[index]);
    }

    function chooseMartCardNames(collectionKey, count) {
        return shuffleRecords(getUniqueGameRecords(collectionKey))
            .slice(0, count)
            .map(record => record.name);
    }

    function getUniqueGameRecords(collectionKey) {
        const records = arena.GameData && Array.isArray(arena.GameData[collectionKey])
            ? arena.GameData[collectionKey]
            : [];

        return getUniqueRecordsByName(records);
    }

    function chooseCapturePokemonOptions(node = null) {
        if (shouldChooseLegendaryCaptureEncounter(node)) {
            const legendaryPokemon = chooseLegendaryPokemon();

            if (legendaryPokemon) return [legendaryPokemon];
        }

        const availablePokemon = getAvailablePokemonForCurrentTerrain();

        if (availablePokemon.length === 0) return [];

        const optionCount = randomInt(1, Math.min(3, availablePokemon.length));

        return shuffleRecords(availablePokemon).slice(0, optionCount);
    }

    function getAvailablePokemonForCurrentTerrain() {
        return locations.getWildPokemonPool(arena.GameData, getLocationTypes());
    }

    function shouldChooseLegendaryCaptureEncounter(node) {
        return isLastThirdMapNode(node) && Math.random() < LEGENDARY_CAPTURE_CHANCE;
    }

    function isLastThirdMapNode(node) {
        return Boolean(node && Number(node.step) > (getMaxStep() * 2 / 3));
    }

    function chooseLegendaryPokemon() {
        const legendaryPokemon = getAvailableLegendaryPokemon();

        if (legendaryPokemon.length === 0) return null;

        return legendaryPokemon[randomInt(0, legendaryPokemon.length - 1)];
    }

    function getAvailableLegendaryPokemon() {
        return getUniqueGameRecords('pokemon').filter(isLegendaryPokemon);
    }

    function sanitizeCaptureEncounters() {
        if (!state.run || !state.run.captureEncounters) return false;

        return Object.values(state.run.captureEncounters).reduce((changed, encounter) => {
            if (!encounter || encounter.completed) return changed;

            return sanitizeCaptureEncounter(encounter) || changed;
        }, false);
    }

    function sanitizeCaptureEncounter(encounter) {
        const originalOptions = Array.isArray(encounter.options) ? encounter.options : [];
        const node = getNodeById(encounter.nodeId);
        const legendaryOptionName = getFirstValidLegendaryOptionName(originalOptions, node);
        let nextOptions = [];

        if (legendaryOptionName) {
            nextOptions = [legendaryOptionName];
        } else {
            const availablePokemonNames = new Set(getAvailablePokemonForCurrentTerrain().map(pokemon => pokemon.name));
            const seenNames = new Set();

            nextOptions = originalOptions.filter(name => {
                if (!availablePokemonNames.has(name) || seenNames.has(name)) return false;

                seenNames.add(name);
                return true;
            });
        }

        if (nextOptions.length === 0) {
            nextOptions = chooseCapturePokemonOptions(node).map(pokemon => pokemon.name);
        }

        const changed = nextOptions.length !== originalOptions.length ||
            nextOptions.some((name, index) => name !== originalOptions[index]);

        encounter.options = nextOptions;

        return changed;
    }

    function sanitizeEventEncounters() {
        if (!state.run || !state.run.eventEncounters) return false;

        return Object.values(state.run.eventEncounters).reduce((changed, encounter) => {
            if (!encounter || encounter.completed) return changed;

            return sanitizeEventEncounter(encounter) || changed;
        }, false);
    }

    function sanitizeEventEncounter(encounter) {
        if (
            window.PokeEvents &&
            typeof window.PokeEvents.getEventById === 'function' &&
            window.PokeEvents.getEventById(arena.GameData, encounter.eventId)
        ) {
            return false;
        }

        const replacementEvent = window.PokeEvents && typeof window.PokeEvents.chooseEvent === 'function'
            ? window.PokeEvents.chooseEvent(arena.GameData, state.run)
            : null;

        if (!replacementEvent) return false;

        encounter.eventId = replacementEvent.id;
        encounter.resultSummary = [];
        encounter.selectedActionId = null;
        encounter.startedBattle = false;

        return true;
    }

    function getFirstValidLegendaryOptionName(optionNames, node) {
        if (!isLastThirdMapNode(node)) return null;

        return optionNames.find(name => {
            const pokemon = findGameRecord('pokemon', name);

            return pokemon && isLegendaryPokemon(pokemon);
        }) || null;
    }

    function sanitizeBattleEncounters() {
        if (!state.run || !state.run.battleEncounters) return false;

        return Object.values(state.run.battleEncounters).reduce((changed, encounter) => {
            if (!encounter || encounter.completed) return changed;

            return sanitizeBattleEncounter(encounter) || changed;
        }, false);
    }

    function ensureBattleNodeEncounters() {
        if (!state.run || !state.area || !Array.isArray(state.area.nodes)) return false;

        state.run.battleEncounters = state.run.battleEncounters || {};

        return state.area.nodes.reduce((changed, node) => {
            if (!node || !isTrainerNodeType(node.type)) return changed;

            const existingEncounter = state.run.battleEncounters[node.id];

            if (existingEncounter) return changed;

            const trainer = chooseTrainerForNode(node);

            if (!trainer) return changed;

            state.run.battleEncounters[node.id] = createBattleEncounter(node, trainer);

            return true;
        }, false);
    }

    function sanitizeBattleEncounter(encounter, node = null) {
        const encounterNode = node || getNodeById(encounter.nodeId);
        const existingTrainer = encounter.trainerName ? getTrainerByName(encounter.trainerName) : null;

        // Only the trainer's RANK is an invariant; a type mismatch is just a
        // selection preference and must not force a re-roll (which would churn
        // the encounter on every page load).
        if (existingTrainer && isRankAllowedAtNode(existingTrainer, encounterNode)) return false;

        const trainer = chooseTrainerForNode(encounterNode);

        if (!trainer) return false;

        encounter.rank = trainer.rank;
        encounter.rewardCash = trainer.cash;
        encounter.trainerName = trainer.name;

        return true;
    }

    function isRankAllowedAtNode(trainer, node) {
        if (!trainer || !node || !isTrainerNodeType(node.type)) return true;

        return locations.isAllowedTrainerRank(trainer, node.type, getRunLevel());
    }

    function chooseTrainerForNode(node) {
        return locations.chooseTrainer(arena.GameData, {
            level: getRunLevel(),
            nodeType: node ? node.type : 'battle',
            locationTypes: getLocationTypes(),
            excludeNames: getAssignedTrainerNames(node)
        });
    }

    // Trainer names already assigned to other battle encounters in this area.
    // Passed as excludeNames so siblings (and the L4 gauntlet) prefer variety;
    // chooseTrainer drops the exclusion when the pool is too small.
    function getAssignedTrainerNames(excludeNode) {
        if (!state.run || !state.run.battleEncounters) return [];

        const excludeId = excludeNode ? excludeNode.id : null;
        const names = new Set();

        Object.values(state.run.battleEncounters).forEach(encounter => {
            if (!encounter || encounter.nodeId === excludeId || !encounter.trainerName) return;
            names.add(encounter.trainerName);
        });

        return Array.from(names);
    }

    function isTrainerNodeType(type) {
        return type === 'battle' || type === 'boss';
    }

    function getTrainerByName(name) {
        const trainers = arena.GameData && Array.isArray(arena.GameData.trainers)
            ? arena.GameData.trainers
            : [];

        return trainers.find(trainer => trainer.name === name) || null;
    }

    function getBattleNodeTrainer(node) {
        const encounter = state.run && state.run.battleEncounters
            ? state.run.battleEncounters[node.id]
            : null;

        return encounter && encounter.trainerName
            ? getTrainerByName(encounter.trainerName)
            : null;
    }

    function getUniqueRecordsByName(records) {
        const seenNames = new Set();

        return records.filter(record => {
            if (!record || !record.name || seenNames.has(record.name)) return false;

            seenNames.add(record.name);
            return true;
        });
    }

    function getRecordTypes(record) {
        return [record.type1, record.type2, record.type3]
            .filter(type => type && type !== 'NONE');
    }

    function isLegendaryPokemon(pokemon) {
        return getRecordTypes(pokemon).includes('LEGENDARY');
    }

    function shuffleRecords(records) {
        const shuffled = records.slice();

        for (let index = shuffled.length - 1; index > 0; index -= 1) {
            const swapIndex = randomInt(0, index);

            [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
        }

        return shuffled;
    }

    function createCardCollections() {
        const blastoise = findGameRecord('pokemon', 'Blastoise') || createFallbackPokemon('Blastoise');
        const waterfall = findGameRecord('attacks', 'Waterfall') || createFallbackAttack('Waterfall');
        const rainDance = findGameRecord('attacks', 'Rain Dance') || createFallbackAttack('Rain Dance');
        const sitrusBerry = findGameRecord('items', 'Sitrus Berry') || createFallbackItem('Sitrus Berry');
        const lumBerry = findGameRecord('items', 'Lum Berry') || createFallbackItem('Lum Berry');

        return {
            actions: [
                createAttackCard(waterfall, 1),
                createAttackCard(waterfall, 2),
                createAttackCard(rainDance, 1),
                createAttackCard(rainDance, 2),
                createItemCard(sitrusBerry, 1),
                createItemCard(lumBerry, 1)
            ],
            pokemon: [
                createPokemonCard(blastoise, 1),
                createPokemonCard(blastoise, 2)
            ]
        };
    }

    function createPokemonCard(pokemon, index) {
        return {
            currentHealth: pokemon.baseHealth,
            currentStatus: [],
            faceUp: true,
            hasUsedFossilRevival: false,
            id: `area-pokemon-${index}`,
            kind: 'pokemon',
            owner: 'player',
            pokemon,
            statChanges: [],
            statStages: {
                attack: 0,
                defense: 0,
                speed: 0
            }
        };
    }

    function createAttackCard(attack, index) {
        return {
            attack,
            faceUp: true,
            id: `area-attack-${formatId(attack.name)}-${index}`,
            kind: 'attack',
            owner: 'player'
        };
    }

    function createItemCard(item, index) {
        return {
            faceUp: true,
            id: `area-item-${formatId(item.name)}-${index}`,
            item,
            kind: 'item',
            owner: 'player'
        };
    }

    function findGameRecord(collectionKey, name) {
        const records = arena.GameData && arena.GameData[collectionKey];

        return Array.isArray(records)
            ? records.find(record => record.name === name) || null
            : null;
    }

    function createFallbackPokemon(name) {
        return {
            baseAttack: 90,
            baseDefense: 100,
            baseHealth: 80,
            baseSpeed: 80,
            id: '0009',
            name,
            portraitPath: `assets/portraits/${encodeURIComponent(name)}.png`,
            type1: 'WATER',
            type2: 'MONSTER',
            type3: 'NONE',
            types: ['WATER', 'MONSTER']
        };
    }

    function createFallbackAttack(name) {
        const rainDance = name === 'Rain Dance';

        return {
            basePower: rainDance ? 0 : 70,
            full_type_requirements: false,
            name,
            statChanges: rainDance ? ['DEFENSE_UP'] : [],
            status: rainDance ? 'HEAL_STATUS' : 'FLINCH',
            target: rainDance ? 'ALL_ALLIES' : 'OPPONENT',
            type1: 'WATER',
            type2: 'NONE',
            types: ['WATER']
        };
    }

    function createFallbackItem(name) {
        const lumBerry = name === 'Lum Berry';

        return {
            imagePath: `assets/items/${formatAssetName(name)}.png`,
            name,
            statChanges: [],
            status: [lumBerry ? 'HEAL_STATUS' : 'HEAL'],
            target: 'ALLY'
        };
    }

    function getAvailableNextNodes() {
        return state.area.edges
            .filter(edge => edge.from === state.currentNodeId)
            .map(edge => getNodeById(edge.to))
            .filter(node => node && !state.visitedNodeIds.has(node.id));
    }

    function isNodeSelectable(node) {
        return getAvailableNextNodes().some(nextNode => nextNode.id === node.id);
    }

    function getCurrentNode() {
        return getNodeById(state.currentNodeId);
    }

    function getNodeById(nodeId) {
        return state.area.nodes.find(node => node.id === nodeId) || null;
    }

    function getNodeAriaLabel(node, current, selectable) {
        const trainer = isTrainerNodeType(node.type) ? getBattleNodeTrainer(node) : null;
        const parts = [trainer
            ? `${getTrainerDisplayName(trainer)} ${node.type === 'boss' ? 'boss battle' : 'battle'}`
            : LOCATION_LABELS[node.type]];

        if (node.step > 0) parts.push(`location ${node.step}`);
        if (current) parts.push('current location');
        if (selectable) parts.push('available path');

        return parts.join(', ');
    }

    function getTrainerDisplayName(trainer) {
        return trainer && trainer.displayName ? trainer.displayName : trainer.name;
    }

    function getEnteredLocationText(node) {
        if (node.type === 'boss') return 'the Boss';
        if (node.type === 'event') return 'an Event';

        return `a ${LOCATION_LABELS[node.type]}`;
    }

    function compareCardsByName(leftCard, rightCard) {
        const nameComparison = arena.Model.getCardName(leftCard).localeCompare(arena.Model.getCardName(rightCard));

        if (nameComparison !== 0) return nameComparison;

        return leftCard.id.localeCompare(rightCard.id);
    }

    function hasAvailableEvents() {
        return Boolean(
            window.PokeEvents &&
            typeof window.PokeEvents.getAvailableEvents === 'function' &&
            window.PokeEvents.getAvailableEvents(arena.GameData).length > 0
        );
    }

    function randomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function getPathKey(from, to) {
        return `${from}->${to}`;
    }

    function formatId(value) {
        return String(value || 'card')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    function formatAssetName(value) {
        return String(value || 'item')
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
    }
})(window.CardArena = window.CardArena || {}, window.AreaMap = window.AreaMap || {}, window.PokeRun, window.PokeLocations);
