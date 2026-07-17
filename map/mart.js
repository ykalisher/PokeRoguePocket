/**
 * Pokemon Rogue Pocket - mart page
 */

(function bootMartPage(arena, runStore, locations) {
    'use strict';

    const ATTACK_COUNT = 8;
    const ITEM_COUNT = 4;
    const ATTACK_COST = 70;
    const ITEM_COST = 90;
    const CARD_BACKS = Object.freeze({
        actions: 'assets/card-backs/ACTION_CARD_BACK.png',
        pokemon: 'assets/card-backs/POKEMON_CARD_BACK.png'
    });

    const state = {
        cardWindow: null,
        drag: null,
        elements: {},
        encounter: null,
        message: '',
        pcPokemon: null,
        run: null,
        selectedPokemonId: null,
        suppressNextClick: false
    };

    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        locations.applyLocationTheme(runStore.loadRunState());

        state.elements.root = document.getElementById('mart-root');
        state.elements.root.addEventListener('click', handleMartClick);
        state.elements.root.addEventListener('pointerdown', handleMartPointerDown);
        window.addEventListener('pointermove', handleMartPointerMove);
        window.addEventListener('pointerup', handleMartPointerUp);
        window.addEventListener('pointercancel', handleMartPointerCancel);
        window.addEventListener('keydown', handleKeyDown);

        await arena.Data.loadGameData();

        state.run = runStore.loadRunState();
        state.encounter = runStore.getActiveMartEncounter(state.run);

        if (!state.run || !state.encounter) {
            window.location.href = 'area.html';
            return;
        }

        const actionChanges = runStore.rebuildActionDeckForActivePokemon(state.run);

        if (
            repairMartEncounter() ||
            actionChanges.addedToDeck.length > 0 ||
            actionChanges.movedToBench.length > 0
        ) {
            runStore.saveRunState(state.run);
        }

        refreshPcPokemon();
        render();
    }

    function handleMartClick(event) {
        if (state.suppressNextClick) {
            state.suppressNextClick = false;
            return;
        }

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

        const offerButton = event.target.closest('[data-buy-offer]');

        if (offerButton) {
            buyOffer(offerButton.dataset.offerKind, offerButton.dataset.offerName);
            return;
        }

        const pokemonButton = event.target.closest('[data-pokemon-card-id]');

        if (pokemonButton) {
            selectPokemon(pokemonButton.dataset.pokemonCardId);
            return;
        }

        const pcActionButton = event.target.closest('[data-pc-action]');

        if (pcActionButton) {
            handlePcAction(pcActionButton.dataset.pcAction);
            return;
        }

        const martActionButton = event.target.closest('[data-mart-action]');

        if (martActionButton && martActionButton.dataset.martAction === 'continue') {
            completeMartAndReturnToMap();
        }
    }

    /**
     * Pointer-based drag for depositing a Pokemon into the PC. iOS Safari ignores
     * the HTML5 drag API entirely, so the shop drag uses Pointer Events instead —
     * the same approach as the arena drag engine (movement threshold, floating
     * ghost, elementFromPoint drop detection). Tapping a card still selects it;
     * only crossing the movement threshold begins a drag.
     */
    function handleMartPointerDown(event) {
        if (event.button !== undefined && event.button !== 0) return;

        const pokemonButton = event.target.closest('[data-pokemon-card-id]');
        if (!pokemonButton) return;

        state.drag = {
            cardId: pokemonButton.dataset.pokemonCardId,
            ghost: null,
            isDragging: false,
            offsetX: 0,
            offsetY: 0,
            pointerId: event.pointerId,
            sourceElement: pokemonButton,
            startX: event.clientX,
            startY: event.clientY
        };
    }

    function handleMartPointerMove(event) {
        const drag = state.drag;
        if (!drag || drag.pointerId !== event.pointerId) return;

        const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
        if (!drag.isDragging && distance < 8) return;

        if (!drag.isDragging) startMartDrag(event);

        event.preventDefault();
        positionMartGhost(event.clientX, event.clientY);
        highlightPcDropTarget(event.clientX, event.clientY);
    }

    function handleMartPointerUp(event) {
        const drag = state.drag;
        if (!drag || drag.pointerId !== event.pointerId) return;

        if (drag.isDragging) {
            event.preventDefault();
            const droppedOnPc = Boolean(pcSlotFromPoint(event.clientX, event.clientY));
            const cardId = drag.cardId;

            // Suppress the click the browser synthesizes after the drag so it does
            // not also toggle the card's selection.
            state.suppressNextClick = true;
            setTimeout(() => {
                state.suppressNextClick = false;
            }, 0);
            cleanupMartDrag();

            if (droppedOnPc && cardId) {
                depositPokemonById(cardId);
            }
            return;
        }

        releasePointer(drag.sourceElement, drag.pointerId);
        state.drag = null;
    }

    function handleMartPointerCancel(event) {
        if (state.drag && event.pointerId !== state.drag.pointerId) return;

        cleanupMartDrag();
    }

    function startMartDrag(event) {
        const drag = state.drag;
        const rect = drag.sourceElement.getBoundingClientRect();
        const ghost = drag.sourceElement.cloneNode(true);

        drag.isDragging = true;
        drag.offsetX = event.clientX - rect.left;
        drag.offsetY = event.clientY - rect.top;
        drag.ghost = ghost;
        drag.sourceElement.classList.add('is-source-dragging');
        capturePointer(drag.sourceElement, event);

        ghost.classList.add('drag-ghost', 'mart-drag-ghost');
        ghost.removeAttribute('data-pokemon-card-id');
        ghost.style.width = `${rect.width}px`;
        ghost.style.height = `${rect.height}px`;
        document.body.appendChild(ghost);

        positionMartGhost(event.clientX, event.clientY);
    }

    function positionMartGhost(clientX, clientY) {
        const drag = state.drag;
        if (!drag || !drag.ghost) return;

        drag.ghost.style.left = `${clientX - drag.offsetX}px`;
        drag.ghost.style.top = `${clientY - drag.offsetY}px`;
    }

    function pcSlotFromPoint(clientX, clientY) {
        const element = document.elementFromPoint(clientX, clientY);

        return element ? element.closest('.mart-pc-current') : null;
    }

    function highlightPcDropTarget(clientX, clientY) {
        const pcSlot = document.querySelector('.mart-pc-current');
        if (!pcSlot) return;

        pcSlot.classList.toggle('is-drop-target', Boolean(pcSlotFromPoint(clientX, clientY)));
    }

    function cleanupMartDrag() {
        const pcSlot = document.querySelector('.mart-pc-current');
        if (pcSlot) pcSlot.classList.remove('is-drop-target');

        if (state.drag && state.drag.ghost) {
            state.drag.ghost.remove();
        }
        if (state.drag && state.drag.sourceElement) {
            releasePointer(state.drag.sourceElement, state.drag.pointerId);
            state.drag.sourceElement.classList.remove('is-source-dragging');
        }
        state.drag = null;
    }

    /**
     * Binds the pointer to the drag source so the gesture keeps receiving
     * pointermove/up even if the finger drifts off the card; iOS Safari can
     * otherwise lose the pointer stream mid-drag. Called only once a drag begins
     * (startMartDrag), never on pointerdown — capturing in pointerdown suppresses
     * the synthesized click on iOS Safari and would break tap-to-select. Invalid
     * pointer ids throw and are harmless.
     */
    function capturePointer(element, event) {
        if (!element || typeof element.setPointerCapture !== 'function') return;

        try {
            element.setPointerCapture(event.pointerId);
        } catch (error) {
            // Pointer already released or not capturable.
        }
    }

    function releasePointer(element, pointerId) {
        if (!element || pointerId === undefined || typeof element.releasePointerCapture !== 'function') return;

        try {
            if (typeof element.hasPointerCapture !== 'function' || element.hasPointerCapture(pointerId)) {
                element.releasePointerCapture(pointerId);
            }
        } catch (error) {
            // Already released.
        }
    }

    function handleKeyDown(event) {
        if (event.key === 'Escape' && state.cardWindow) {
            closeCardWindow();
        }
    }

    function openCardWindow(collectionKey) {
        if (!state.run || !state.run.collections || !Array.isArray(state.run.collections[collectionKey])) return;

        state.cardWindow = collectionKey;
        render();
    }

    function closeCardWindow() {
        state.cardWindow = null;
        render();
    }

    function buyOffer(kind, encodedName) {
        const name = decodeURIComponent(encodedName || '');
        const record = findGameRecord(kind === 'attack' ? 'attacks' : 'items', name);
        const cost = getOfferCost(kind);

        if (!record || !offerIsInInventory(kind, name) || offerIsBought(kind, name)) return;

        if (getCash() < cost) {
            setMessage(`You need ${cost} coins to buy ${name}.`);
            return;
        }

        const card = kind === 'attack'
            ? runStore.createAttackCard(record, 'player', runStore.allocateCardId(state.run, 'attack', record.name))
            : runStore.createItemCard(record, 'player', runStore.allocateCardId(state.run, 'item', record.name));

        state.run.cash = getCash() - cost;
        const result = runStore.addActionCard(state.run, card);
        getBoughtNames(kind).push(record.name);
        runStore.saveRunState(state.run);
        setMessage(result.zone === 'bench'
            ? `Bought ${record.name}. It went to the bench.`
            : `Bought ${record.name}.`);
    }

    function selectPokemon(cardId) {
        const selectedCard = getPokemonCardById(cardId);

        state.selectedPokemonId = selectedCard && state.selectedPokemonId !== cardId ? cardId : null;
        state.message = '';
        render();
    }

    function handlePcAction(action) {
        if (action === 'withdraw') {
            withdrawPcPokemon();
        } else if (action === 'deposit') {
            depositSelectedPokemon();
        }
    }

    function withdrawPcPokemon() {
        if (!state.pcPokemon) return;

        const withdrawnCard = createRunPokemonCard(state.pcPokemon);

        const result = runStore.addPokemonCard(state.run, withdrawnCard);
        runStore.clearPcPokemon();
        state.selectedPokemonId = null;
        refreshPcPokemon();
        runStore.rebuildActionDeckForActivePokemon(state.run);
        runStore.saveRunState(state.run);

        state.run = runStore.loadRunState();
        state.encounter = runStore.getActiveMartEncounter(state.run);

        setMessage(result.zone === 'bench'
            ? `Withdrew ${withdrawnCard.pokemon.name} to the bench.`
            : `Withdrew ${withdrawnCard.pokemon.name}.`);
    }

    function depositSelectedPokemon() {
        const selectedCard = getPokemonCardById(state.selectedPokemonId);
        performDeposit(selectedCard);
    }

    function depositPokemonById(cardId) {
        const selectedCard = getPokemonCardById(cardId);
        performDeposit(selectedCard);
    }

    function performDeposit(selectedCard) {
        if (!selectedCard) return;

        const hasPcPokemon = Boolean(state.pcPokemon);

        const totalPokemonCount = state.run.collections.pokemon.length + 
                                 state.run.collections.bench.pokemon.length;

        if (!hasPcPokemon && totalPokemonCount <= 1) {
            setMessage('Keep at least one Pokemon in your deck.');
            return;
        }

        const pcName = hasPcPokemon ? state.pcPokemon.pokemon.name : null;

        state.run.collections.pokemon = state.run.collections.pokemon
            .filter(card => card.id !== selectedCard.id);

        state.run.collections.bench.pokemon = state.run.collections.bench.pokemon
            .filter(card => card.id !== selectedCard.id);

        if (hasPcPokemon) {
            runStore.addPokemonCard(state.run, createRunPokemonCard(state.pcPokemon));
        } else {
            runStore.balancePokemonCollections(state.run);
        }

        runStore.savePcPokemon(selectedCard);
        refreshPcPokemon();
        state.selectedPokemonId = null;
        runStore.rebuildActionDeckForActivePokemon(state.run);
        runStore.saveRunState(state.run);
        setMessage(pcName
            ? `Swapped ${selectedCard.pokemon.name} with ${pcName}.`
            : `Deposited ${selectedCard.pokemon.name}.`);
    }

    function completeMartAndReturnToMap() {
        state.encounter.completed = true;
        state.encounter.completedAt = new Date().toISOString();
        state.run.area.activeMartNodeId = null;
        runStore.saveRunState(state.run);
        window.location.href = 'area.html';
    }

    function render() {
        state.elements.root.innerHTML = `
            <header class="mart-topbar">
                <div class="mart-title-group">
                    <span class="mart-kicker">Shop</span>
                    <h1>Card Mart</h1>
                    <span class="mart-message" role="status" aria-live="polite">${state.message || 'Choose cards, manage the PC, then continue.'}</span>
                </div>
                <div class="mart-hud" aria-label="Run cards and cash">
                    ${renderMoney()}
                    ${renderDeckCounter('pokemon', 'Pokemon cards', state.run.collections.pokemon.length)}
                    ${renderDeckCounter('actions', 'Action deck', state.run.collections.actions.length)}
                </div>
            </header>
            <section class="mart-stage" aria-label="Mart offers and PC">
                <div class="mart-offers">
                    ${renderOfferSection('Attacks', 'attack', getOfferRecords('attack'), ATTACK_COST)}
                    ${renderOfferSection('Items', 'item', getOfferRecords('item'), ITEM_COST)}
                </div>
                ${renderPcPanel()}
            </section>
            ${state.cardWindow ? renderCardWindow() : ''}
        `;
    }

    function renderMoney() {
        const cash = getCash();

        return `
            <span class="mart-money" aria-label="${cash} coins">
                <span class="mart-money-icon" aria-hidden="true">C</span>
                <span>${cash}</span>
            </span>
        `;
    }

    function renderDeckCounter(collectionKey, label, count) {
        return `
            <button class="mart-deck-counter" type="button" data-card-window="${collectionKey}" aria-label="Open ${label}" title="${label}">
                <img src="${CARD_BACKS[collectionKey]}" alt="">
                <span>${count}</span>
            </button>
        `;
    }

    function renderOfferSection(title, kind, records, cost) {
        return `
            <section class="mart-offer-section">
                <header class="mart-section-header">
                    <h2>${title}</h2>
                    <span>${cost} coins each</span>
                </header>
                <div class="mart-offer-grid">
                    ${records.map(record => renderOfferCard(kind, record, cost)).join('')}
                </div>
            </section>
        `;
    }

    function renderOfferCard(kind, record, cost) {
        const card = createOfferCard(kind, record);
        const bought = offerIsBought(kind, record.name);
        const canAfford = getCash() >= cost;
        const disabled = bought || !canAfford ? 'disabled' : '';
        const buttonText = bought ? 'Sold' : canAfford ? `Buy ${cost}` : `Need ${cost}`;

        return `
            <article class="mart-offer-card ${bought ? 'is-sold' : ''}">
                ${arena.Render.renderCardPreview(card, { className: 'mart-card-preview' })}
                <button class="mart-buy-button" type="button" data-buy-offer data-offer-kind="${kind}" data-offer-name="${encodeURIComponent(record.name)}" ${disabled}>
                    ${buttonText}
                </button>
            </article>
        `;
    }

    function renderPcPanel() {
        const selectedCard = getPokemonCardById(state.selectedPokemonId);
        const depositText = state.pcPokemon ? 'Swap Selected' : 'Deposit Selected';
        const depositDisabled = selectedCard && (state.pcPokemon || state.run.collections.pokemon.length > 1) ? '' : 'disabled';

        const allPokemon = [
            ...state.run.collections.pokemon,
            ...state.run.collections.bench.pokemon
        ];

        return `
            <aside class="mart-pc-panel" aria-label="Pokemon PC">
                <header class="mart-section-header">
                    <h2>Pokemon PC</h2>
                    <span>${state.pcPokemon ? '1 stored' : 'Empty'}</span>
                </header>
                <div class="mart-pc-current">
                    ${state.pcPokemon
                        ? arena.Render.renderCardPreview(state.pcPokemon, { className: 'mart-pc-card' })
                        : '<div class="mart-pc-empty">No Pokemon stored</div>'
                    }
                </div>
                <div class="mart-pc-actions">
                    <button class="mart-pc-button" type="button" data-pc-action="withdraw" ${state.pcPokemon ? '' : 'disabled'}>Withdraw</button>
                    <button class="mart-pc-button" type="button" data-pc-action="deposit" ${depositDisabled}>${depositText}</button>
                </div>
                <section class="mart-pokemon-deck" aria-label="Pokemon deck">
                    <header class="mart-mini-header">
                        <h3>Your Pokemon</h3>
                        <span>${allPokemon.length}</span>
                    </header>
                    <div class="mart-pokemon-grid">
                        ${allPokemon.map(renderPokemonChoice).join('')}
                    </div>
                </section>
                <button class="mart-continue-button" type="button" data-mart-action="continue">Continue</button>
            </aside>
        `;
    }

    function renderPokemonChoice(card) {
        const selected = state.selectedPokemonId === card.id;

        return `
            <button class="mart-pokemon-choice ${selected ? 'is-selected' : ''}" type="button" data-pokemon-card-id="${card.id}" aria-pressed="${selected ? 'true' : 'false'}" aria-label="Select ${card.pokemon.name}">
                ${arena.Render.renderCardPreview(card, { className: 'mart-pokemon-card' })}
            </button>
        `;
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
        const benched = getBenchedAttackCards().slice().sort(compareCardsByName);

        return [
            renderCardSection('Attacks', attacks, { highlight: true }),
            benched.length > 0 ? renderCardSection('Benched', benched) : '',
            renderCardSection('Items', items)
        ].join('');
    }

    function renderCardSection(title, cards, options = {}) {
        return `
            <section class="area-card-section">
                <header class="area-card-section-header">
                    <h3>${title}</h3>
                    <span>${cards.length} ${cards.length === 1 ? 'card' : 'cards'}</span>
                </header>
                ${renderCardGrid(cards, options)}
            </section>
        `;
    }

    function renderCardGrid(cards, options = {}) {
        const extraClass = options.highlight ? ' is-active-attack' : '';
        return `
            <div class="area-card-grid">
                ${cards.map(card => arena.Render.renderCardPreview(card, { className: `area-card-preview${extraClass}` })).join('')}
            </div>
        `;
    }

    function getCardWindowCards() {
        return state.run.collections[state.cardWindow]
            .slice()
            .sort(compareCardsByName);
    }

    function getBenchedAttackCards() {
        const bench = state.run.collections.bench;
        const cards = bench && Array.isArray(bench.actions) ? bench.actions : [];
        return cards.filter(arena.Model.isAttackCard);
    }

    function repairMartEncounter() {
        const attackNames = repairOfferNames('attacks', state.encounter.attackNames, ATTACK_COUNT);
        const itemNames = repairOfferNames('items', state.encounter.itemNames, ITEM_COUNT);
        const changed = didNameListChange(state.encounter.attackNames, attackNames) ||
            didNameListChange(state.encounter.itemNames, itemNames);

        state.encounter.attackNames = attackNames;
        state.encounter.itemNames = itemNames;
        state.encounter.boughtAttackNames = repairBoughtNames(state.encounter.boughtAttackNames, attackNames);
        state.encounter.boughtItemNames = repairBoughtNames(state.encounter.boughtItemNames, itemNames);

        return changed;
    }

    function repairOfferNames(collectionKey, names, count) {
        const availableNames = new Set(
            getUniqueGameRecords(collectionKey)
                .filter(record => locations.isMartOfferAllowed(record, collectionKey, state.run))
                .map(record => record.name)
        );
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

        return [
            ...validNames,
            ...chooseOfferNames(collectionKey, count)
                .filter(name => !seenNames.has(name))
                .slice(0, missingCount)
        ];
    }

    function repairBoughtNames(names, offerNames) {
        const offerNameSet = new Set(offerNames);
        const seenNames = new Set();

        return (Array.isArray(names) ? names : []).filter(name => {
            if (!offerNameSet.has(name) || seenNames.has(name)) return false;

            seenNames.add(name);
            return true;
        });
    }

    function chooseOfferNames(collectionKey, count) {
        const eligibleRecords = getUniqueGameRecords(collectionKey)
            .filter(record => locations.isMartOfferAllowed(record, collectionKey, state.run));

        return shuffleRecords(eligibleRecords)
            .slice(0, count)
            .map(record => record.name);
    }

    function getOfferRecords(kind) {
        const collectionKey = kind === 'attack' ? 'attacks' : 'items';
        const records = arena.GameData && Array.isArray(arena.GameData[collectionKey])
            ? arena.GameData[collectionKey]
            : [];
        const recordByName = new Map(records.map(record => [record.name, record]));
        const names = kind === 'attack' ? state.encounter.attackNames : state.encounter.itemNames;

        return names.map(name => recordByName.get(name)).filter(Boolean);
    }

    function createOfferCard(kind, record) {
        return kind === 'attack'
            ? runStore.createAttackCard(record, 'player', `mart-attack-${formatId(record.name)}`)
            : runStore.createItemCard(record, 'player', `mart-item-${formatId(record.name)}`);
    }

    function createRunPokemonCard(sourceCard) {
        const species = findGameRecord('pokemon', sourceCard.pokemon.name) || sourceCard.pokemon;

        return runStore.createPokemonCard(
            species,
            'player',
            runStore.allocateCardId(state.run, 'pokemon', species.name)
        );
    }

    function refreshPcPokemon() {
        const storedCard = runStore.loadPcPokemon();

        if (!storedCard) {
            state.pcPokemon = null;
            return;
        }

        const species = findGameRecord('pokemon', storedCard.pokemon.name) || storedCard.pokemon;

        state.pcPokemon = runStore.createPokemonCard(species, 'player', 'pc-pokemon');
    }

    function getPokemonCardById(cardId) {
        if (!cardId) return null;

        return state.run.collections.pokemon.find(card => card.id === cardId) || 
               state.run.collections.bench.pokemon.find(card => card.id === cardId) || 
               null;
    }

    function getOfferCost(kind) {
        return kind === 'attack' ? ATTACK_COST : ITEM_COST;
    }

    function offerIsBought(kind, name) {
        return getBoughtNames(kind).includes(name);
    }

    function offerIsInInventory(kind, name) {
        const names = kind === 'attack'
            ? state.encounter.attackNames
            : state.encounter.itemNames;

        return names.includes(name);
    }

    function getBoughtNames(kind) {
        return kind === 'attack'
            ? state.encounter.boughtAttackNames
            : state.encounter.boughtItemNames;
    }

    function getCash() {
        return Number.isFinite(state.run && state.run.cash) ? state.run.cash : 0;
    }

    function setMessage(message) {
        state.message = message;
        render();
    }

    function getUniqueGameRecords(collectionKey) {
        const records = arena.GameData && Array.isArray(arena.GameData[collectionKey])
            ? arena.GameData[collectionKey]
            : [];
        const seenNames = new Set();

        return records.filter(record => {
            if (!record || !record.name || seenNames.has(record.name)) return false;

            seenNames.add(record.name);
            return true;
        });
    }

    function findGameRecord(collectionKey, name) {
        const records = arena.GameData && arena.GameData[collectionKey];

        return Array.isArray(records)
            ? records.find(record => record.name === name) || null
            : null;
    }

    function shuffleRecords(records) {
        const shuffled = records.slice();

        for (let index = shuffled.length - 1; index > 0; index -= 1) {
            const swapIndex = randomInt(0, index);

            [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
        }

        return shuffled;
    }

    function didNameListChange(previousNames, nextNames) {
        const names = Array.isArray(previousNames) ? previousNames : [];

        return names.length !== nextNames.length ||
            nextNames.some((name, index) => name !== names[index]);
    }

    function compareCardsByName(leftCard, rightCard) {
        const nameComparison = arena.Model.getCardName(leftCard).localeCompare(arena.Model.getCardName(rightCard));

        if (nameComparison !== 0) return nameComparison;

        return leftCard.id.localeCompare(rightCard.id);
    }

    function randomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function formatId(value) {
        return String(value || 'card')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }
})(window.CardArena = window.CardArena || {}, window.PokeRun, window.PokeLocations);
