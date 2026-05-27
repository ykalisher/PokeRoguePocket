/**
 * Pokemon Rogue Pocket - overworld area map prototype
 */

(function bootAreaMap(arena, area) {
    'use strict';

    const AREA_NODE_COUNT = 12;
    const LANE_COUNT = 5;
    const OPENING_LINEAR_STEPS = 3;
    const START_NODE_ID = 'start';
    const BOSS_NODE_ID = 'boss-12';
    const PLAYER_MONEY = 100;
    const AREA_THEME = Object.freeze({
        areaNumber: 1,
        name: 'Coastal Trail',
        terrain: 'Waterfront'
    });
    const LOCATION_LABELS = Object.freeze({
        battle: 'Trainer Battle',
        boss: 'Boss',
        capture: 'Capture Spot',
        event: 'Event',
        shop: 'Shop',
        start: 'Entrance'
    });
    const RANDOM_LOCATION_TYPES = Object.freeze([
        { type: 'battle', weight: 38 },
        { type: 'capture', weight: 26 },
        { type: 'event', weight: 21 },
        { type: 'shop', weight: 15 }
    ]);
    const CARD_BACKS = Object.freeze({
        actions: 'assets/card-backs/ACTION_CARD_BACK.png',
        pokemon: 'assets/card-backs/POKEMON_CARD_BACK.png'
    });

    const state = {
        area: null,
        cardWindow: null,
        collections: {
            actions: [],
            pokemon: []
        },
        currentNodeId: START_NODE_ID,
        elements: {},
        popupTimer: null,
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

        state.collections = createCardCollections();
        state.area = createAreaGraph();
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

        const cardWindowButton = event.target.closest('[data-card-window]');

        if (cardWindowButton) {
            openCardWindow(cardWindowButton.dataset.cardWindow);
            return;
        }

        const nodeButton = event.target.closest('[data-node-id]');

        if (!nodeButton) return;

        moveToNode(nodeButton.dataset.nodeId);
    }

    function handleKeyDown(event) {
        if (event.key === 'Escape' && state.cardWindow) {
            closeCardWindow();
        }
    }

    function openCardWindow(collectionKey) {
        if (!state.collections[collectionKey]) return;

        state.cardWindow = collectionKey;
        render();
    }

    function closeCardWindow() {
        state.cardWindow = null;
        render();
    }

    function moveToNode(nodeId) {
        const node = getNodeById(nodeId);

        if (!node || !isNodeSelectable(node)) return;

        const previousNodeId = state.currentNodeId;

        state.currentNodeId = node.id;
        state.visitedNodeIds.add(node.id);
        state.traveledPathKeys.add(getPathKey(previousNodeId, node.id));

        render();
        showPopup(`You entered ${getEnteredLocationText(node)}.`);
    }

    function render() {
        const currentNode = getCurrentNode();

        state.elements.root.innerHTML = `
            <header class="area-topbar">
                <div class="area-title-group">
                    <span class="area-kicker">Area ${AREA_THEME.areaNumber} of 4</span>
                    <h1>${AREA_THEME.name}</h1>
                    <div class="area-subrow">
                        <span class="stat-pill">${AREA_THEME.terrain}</span>
                        <span class="stat-pill">${renderCurrentLocationText(currentNode)}</span>
                    </div>
                </div>
                <div class="area-hud" aria-label="Run resources and decks">
                    ${renderMoney()}
                    ${renderDeckButton('actions', 'Action deck', state.collections.actions.length)}
                    ${renderDeckButton('pokemon', 'Pokemon cards', state.collections.pokemon.length)}
                </div>
            </header>
            <section class="area-map-panel" aria-label="Area route">
                <div class="area-map-viewport">
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
        `;
    }

    function renderMoney() {
        return `
            <span class="area-money" aria-label="${PLAYER_MONEY} coins">
                <span class="area-money-icon" aria-hidden="true">C</span>
                <span>${PLAYER_MONEY}</span>
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

    function renderCurrentLocationText(currentNode) {
        if (!currentNode || currentNode.type === 'start') return 'Entrance';

        return `Location ${currentNode.step} of ${AREA_NODE_COUNT}: ${LOCATION_LABELS[currentNode.type]}`;
    }

    function renderRouteStatus() {
        const currentNode = getCurrentNode();
        const nextNodes = getAvailableNextNodes();

        if (!currentNode || currentNode.id === BOSS_NODE_ID) return 'Area boss reached';

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

        return `
            <button class="${className}" type="button" style="--node-x: ${node.x}%; --node-y: ${node.y}%;" data-node-id="${node.id}" ${disabled} aria-label="${getNodeAriaLabel(node, current, selectable)}">
                ${renderLocationIcon(node.type)}
                <span class="area-node-step">${stepText}</span>
            </button>
        `;
    }

    function renderLocationIcon(type) {
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

    function showPopup(message) {
        window.clearTimeout(state.popupTimer);

        state.elements.popup.textContent = message;
        state.elements.popup.hidden = false;
        state.popupTimer = window.setTimeout(() => {
            state.elements.popup.hidden = true;
        }, 1600);
    }

    function createAreaGraph() {
        const edges = [];
        const columns = createAreaColumns(edges);

        return {
            columns,
            edges,
            nodes: columns.flat()
        };
    }

    function createAreaColumns(edges) {
        const columns = [[createNode({
            id: START_NODE_ID,
            lane: 2,
            step: 0,
            type: 'start'
        })]];
        let currentNode = columns[0][0];
        let segmentIndex = 1;

        for (let step = 1; step <= OPENING_LINEAR_STEPS; step += 1) {
            const node = createStepNode(step, 0);

            columns[step] = [node];
            addEdge(edges, currentNode.id, node.id);
            currentNode = node;
        }

        while (currentNode.step < AREA_NODE_COUNT) {
            const remainingSteps = AREA_NODE_COUNT - currentNode.step;

            if (remainingSteps < 3) {
                const node = createStepNode(currentNode.step + 1, 0);

                columns[node.step] = [node];
                addEdge(edges, currentNode.id, node.id);
                currentNode = node;
                continue;
            }

            currentNode = addBranchSegment(columns, edges, currentNode, segmentIndex);
            segmentIndex += 1;
        }

        return columns;
    }

    function createStepNode(step, lane, id = null) {
        return createNode({
            id: id || getSingleNodeId(step),
            lane,
            step,
            type: getForcedLocationType(step) || pickRandomLocationType()
        });
    }

    function addBranchSegment(columns, edges, sourceNode, segmentIndex) {
        const remainingSteps = AREA_NODE_COUNT - sourceNode.step;
        const branchLength = chooseBranchLength(remainingSteps);
        const branchCount = randomInt(2, 3);
        const lanes = getBranchLanes(branchCount);
        let previousBranchNodes = [];

        for (let offset = 1; offset <= branchLength; offset += 1) {
            const step = sourceNode.step + offset;
            const branchNodes = lanes.map((lane, branchIndex) => createNode({
                id: `node-${step}-${branchIndex + 1}`,
                lane,
                step,
                type: pickRandomLocationType()
            }));

            columns[step] = branchNodes;

            branchNodes.forEach((node, branchIndex) => {
                const fromNode = offset === 1 ? sourceNode : previousBranchNodes[branchIndex];

                addEdge(edges, fromNode.id, node.id);
            });

            previousBranchNodes = branchNodes;
        }

        const joinStep = sourceNode.step + branchLength + 1;
        const joinNode = createStepNode(joinStep, 2, getJoinNodeId(joinStep, segmentIndex));

        columns[joinStep] = [joinNode];
        previousBranchNodes.forEach(node => addEdge(edges, node.id, joinNode.id));

        return joinNode;
    }

    function createNode({ id, lane, step, type }) {
        const x = 5 + ((step / AREA_NODE_COUNT) * 90);
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

    function getForcedLocationType(step) {
        if (step === 1 || step === 2) return 'capture';
        if (step === 3) return 'battle';
        if (step === AREA_NODE_COUNT) return 'boss';

        return null;
    }

    function chooseBranchLength(remainingSteps) {
        if (remainingSteps <= 3) return 2;
        if (remainingSteps === 4) return 3;
        if (remainingSteps === 5) return 3;

        return randomInt(2, 3);
    }

    function getBranchLanes(branchCount) {
        if (branchCount === 3) return [0, 2, 4];

        return Math.random() < 0.5 ? [1, 3] : [0, 4];
    }

    function getSingleNodeId(step) {
        if (step === AREA_NODE_COUNT) return BOSS_NODE_ID;

        return `node-${step}-1`;
    }

    function getJoinNodeId(step, segmentIndex) {
        if (step === AREA_NODE_COUNT) return BOSS_NODE_ID;

        return `node-${step}-join-${segmentIndex}`;
    }

    function addEdge(edges, from, to) {
        const key = getPathKey(from, to);

        if (edges.some(edge => getPathKey(edge.from, edge.to) === key)) return false;

        edges.push({ from, to });
        return true;
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
        const parts = [LOCATION_LABELS[node.type]];

        if (node.step > 0) parts.push(`location ${node.step}`);
        if (current) parts.push('current location');
        if (selectable) parts.push('available path');

        return parts.join(', ');
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

    function pickRandomLocationType() {
        const totalWeight = RANDOM_LOCATION_TYPES.reduce((total, entry) => total + entry.weight, 0);
        let roll = Math.random() * totalWeight;

        for (const entry of RANDOM_LOCATION_TYPES) {
            roll -= entry.weight;

            if (roll <= 0) return entry.type;
        }

        return RANDOM_LOCATION_TYPES[0].type;
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
})(window.CardArena = window.CardArena || {}, window.AreaMap = window.AreaMap || {});
