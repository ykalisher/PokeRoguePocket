/**
 * Pocket Nuzlocke - mart page
 */

(function bootMartPage(arena, runStore, locations) {
    'use strict';

    const ATTACK_COUNT = 8;
    const ITEM_COUNT = 4;
    const ATTACK_COST = 70;
    const ITEM_COST = 90;
    const ATTACK_REMOVAL_COST = 50;
    const CARD_BACKS = Object.freeze({
        actions: 'assets/card-backs/ACTION_CARD_BACK.png',
        pokemon: 'assets/card-backs/POKEMON_CARD_BACK.png'
    });

    const state = {
        attackRemovalPicker: false,
        cardWindow: null,
        elements: {},
        encounter: null,
        message: '',
        run: null,
        selectedPokemonId: null
    };

    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        locations.applyLocationTheme(runStore.loadRunState());

        state.elements.root = document.getElementById('mart-root');
        state.elements.root.addEventListener('click', handleMartClick);
        window.addEventListener('keydown', handleKeyDown);

        await arena.Data.loadGameData();
        window.PokeProfile.showPendingUnlocks(arena.GameData.achievements);

        state.run = runStore.loadRunState();
        state.encounter = runStore.getActiveMartEncounter(state.run);

        if (!state.run || !state.encounter) {
            window.location.href = 'area.html';
            return;
        }

        runStore.ensureLevelMusic(state.run, arena.GameData.music);

        const actionChanges = runStore.rebuildActionDeckForActivePokemon(state.run);

        if (
            repairMartEncounter() ||
            actionChanges.addedToDeck.length > 0 ||
            actionChanges.movedToBench.length > 0
        ) {
            runStore.saveRunState(state.run);
        }

        render();
    }

    function handleMartClick(event) {
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

        const closeAttackRemovalButton = event.target.closest('[data-close-attack-removal]');

        if (closeAttackRemovalButton) {
            closeAttackRemovalPicker();
            return;
        }

        if (event.target.matches('[data-attack-removal-overlay]')) {
            closeAttackRemovalPicker();
            return;
        }

        const removeAttackButton = event.target.closest('[data-remove-attack-id]');

        if (removeAttackButton) {
            removeAttackCard(removeAttackButton.dataset.removeAttackId);
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

        const serviceButton = event.target.closest('[data-mart-service]');

        if (serviceButton) {
            handleMartService(serviceButton.dataset.martService);
            return;
        }

        const martActionButton = event.target.closest('[data-mart-action]');

        if (martActionButton && martActionButton.dataset.martAction === 'continue') {
            completeMartAndReturnToMap();
        }
    }

    function handleKeyDown(event) {
        if (event.key !== 'Escape') return;

        if (state.cardWindow) {
            closeCardWindow();
        } else if (state.attackRemovalPicker) {
            closeAttackRemovalPicker();
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

    function handleMartService(service) {
        if (service === 'release') {
            releaseSelectedPokemon();
        } else if (service === 'remove-attack') {
            openAttackRemovalPicker();
        } else if (service === 'trade') {
            tradeSelectedPokemon();
        }
    }

    function releaseSelectedPokemon() {
        const selectedCard = getPokemonCardById(state.selectedPokemonId);

        if (!canReleasePokemon()) return;

        state.run.collections.pokemon = state.run.collections.pokemon
            .filter(card => card.id !== selectedCard.id);
        state.run.collections.bench.pokemon = state.run.collections.bench.pokemon
            .filter(card => card.id !== selectedCard.id);

        runStore.balancePokemonCollections(state.run);
        runStore.rebuildActionDeckForActivePokemon(state.run);
        state.encounter.releaseUsed = true;
        // Releasing can be the pokemon that made the trade's accepted type
        // ownable — re-roll rather than leaving a permanently dead trade.
        repairMartTradeTypes();
        runStore.saveRunState(state.run);
        state.selectedPokemonId = null;
        setMessage(`Released ${selectedCard.pokemon.name}.`);
    }

    function canReleasePokemon() {
        return Boolean(getPokemonCardById(state.selectedPokemonId)) &&
            !state.encounter.releaseUsed &&
            getTotalPokemonCount() >= 4;
    }

    function tradeSelectedPokemon() {
        const selectedCard = getPokemonCardById(state.selectedPokemonId);

        if (!canTradePokemon()) return;

        const resultRecord = locations.chooseTradeResultRecord(
            arena.GameData,
            state.encounter.tradeOfferedType,
            selectedCard.pokemon.name
        );

        if (!resultRecord) return;

        state.run.collections.pokemon = state.run.collections.pokemon
            .filter(card => card.id !== selectedCard.id);
        state.run.collections.bench.pokemon = state.run.collections.bench.pokemon
            .filter(card => card.id !== selectedCard.id);

        const newCard = runStore.createPokemonCard(
            resultRecord,
            'player',
            runStore.allocateCardId(state.run, 'pokemon', resultRecord.name)
        );

        runStore.addPokemonCard(state.run, newCard);
        runStore.balancePokemonCollections(state.run);
        runStore.rebuildActionDeckForActivePokemon(state.run);
        state.encounter.tradeUsed = true;
        runStore.saveRunState(state.run);
        state.selectedPokemonId = null;
        setMessage(`Traded ${selectedCard.pokemon.name} for ${resultRecord.name}.`);
    }

    function canTradePokemon() {
        const selectedCard = getPokemonCardById(state.selectedPokemonId);

        return Boolean(selectedCard) &&
            !state.encounter.tradeUsed &&
            Boolean(state.encounter.tradeAcceptedType) &&
            getRecordTypes(selectedCard.pokemon).includes(state.encounter.tradeAcceptedType);
    }

    /**
     * Re-rolls the mart's trade types when stale (mirrors
     * map/area.js sanitizeMartTradeTypes): missing fields, the player no
     * longer owning a pokemon of tradeAcceptedType, or the offered type's
     * obtainable pool having gone empty. No-op once used.
     */
    function repairMartTradeTypes() {
        if (state.encounter.tradeUsed) return false;

        const allPokemon = [...state.run.collections.pokemon, ...state.run.collections.bench.pokemon];
        const stillValid = Boolean(state.encounter.tradeAcceptedType) &&
            Boolean(state.encounter.tradeOfferedType) &&
            allPokemon.some(card => getRecordTypes(card.pokemon).includes(state.encounter.tradeAcceptedType)) &&
            locations.getObtainablePokemonPool(arena.GameData)
                .some(record => getRecordTypes(record).includes(state.encounter.tradeOfferedType));

        if (stillValid) return false;

        const rolled = locations.rollMartTradeTypes(state.run, arena.GameData);
        state.encounter.tradeAcceptedType = rolled ? rolled.acceptedType : null;
        state.encounter.tradeOfferedType = rolled ? rolled.offeredType : null;
        return true;
    }

    function getTotalPokemonCount() {
        return state.run.collections.pokemon.length + state.run.collections.bench.pokemon.length;
    }

    function openAttackRemovalPicker() {
        if (!canRemoveAttack()) return;

        state.attackRemovalPicker = true;
        render();
    }

    function closeAttackRemovalPicker() {
        state.attackRemovalPicker = false;
        render();
    }

    function removeAttackCard(cardId) {
        const card = getOwnedAttackCards().find(attackCard => attackCard.id === cardId);

        if (!card || !canRemoveAttack()) return;

        state.run.collections.actions = state.run.collections.actions
            .filter(attackCard => attackCard.id !== cardId);
        state.run.collections.bench.actions = state.run.collections.bench.actions
            .filter(attackCard => attackCard.id !== cardId);

        state.run.cash = getCash() - ATTACK_REMOVAL_COST;
        runStore.rebuildActionDeckForActivePokemon(state.run);
        state.encounter.attackRemovalUsed = true;
        runStore.saveRunState(state.run);
        state.attackRemovalPicker = false;
        setMessage(`Removed ${card.attack.name}.`);
    }

    function canRemoveAttack() {
        return !state.encounter.attackRemovalUsed &&
            getCash() >= ATTACK_REMOVAL_COST &&
            getOwnedAttackCards().length > 0;
    }

    function getOwnedAttackCards() {
        const activeAttacks = state.run.collections.actions.filter(arena.Model.isAttackCard);

        return [...activeAttacks, ...getBenchedAttackCards()];
    }

    function completeMartAndReturnToMap() {
        state.encounter.completed = true;
        state.encounter.completedAt = new Date().toISOString();
        state.run.area.activeMartNodeId = null;

        if (!state.encounter.statsRecorded) {
            state.encounter.statsRecorded = true;
            window.PokeProfile.record({ 'marts.visited': 1 }, arena.GameData.achievements);
        }

        runStore.saveRunState(state.run);
        window.location.href = 'area.html';
    }

    function render() {
        state.elements.root.innerHTML = `
            <header class="mart-topbar">
                <div class="mart-title-group">
                    <span class="mart-kicker">Shop</span>
                    <h1>Card Mart</h1>
                    <span class="mart-message" role="status" aria-live="polite">${state.message || 'Buy cards, use the services, then continue.'}</span>
                </div>
                <div class="mart-hud" aria-label="Run cards and cash">
                    ${renderMoney()}
                    ${renderDeckCounter('pokemon', 'Pokemon cards', state.run.collections.pokemon.length)}
                    ${renderDeckCounter('actions', 'Action deck', state.run.collections.actions.length)}
                </div>
            </header>
            <section class="mart-stage" aria-label="Mart offers and services">
                <div class="mart-offers">
                    ${renderOfferSection('Attacks', 'attack', getOfferRecords('attack'), ATTACK_COST)}
                    ${renderOfferSection('Items', 'item', getOfferRecords('item'), ITEM_COST)}
                </div>
                ${renderServicesPanel()}
            </section>
            ${state.cardWindow ? renderCardWindow() : ''}
            ${state.attackRemovalPicker ? renderAttackRemovalPicker() : ''}
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

    function renderServicesPanel() {
        const allPokemon = [
            ...state.run.collections.pokemon,
            ...state.run.collections.bench.pokemon
        ];

        return `
            <aside class="mart-services-panel" aria-label="Mart services">
                <header class="mart-section-header">
                    <h2>Services</h2>
                </header>
                <div class="mart-service-list">
                    ${renderReleaseService()}
                    ${renderAttackRemovalService()}
                    ${renderTradeService()}
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

    function renderReleaseService() {
        const used = Boolean(state.encounter.releaseUsed);
        const disabled = used || !canReleasePokemon() ? 'disabled' : '';
        const buttonText = used ? 'Used' : 'Release';

        return `
            <article class="mart-service-row ${used ? 'is-used' : ''}">
                <div class="mart-service-info">
                    <h3>Release a Pokemon</h3>
                    <span class="mart-service-requirement">Needs at least 4 Pokemon</span>
                </div>
                <button class="mart-service-button" type="button" data-mart-service="release" ${disabled}>${buttonText}</button>
            </article>
        `;
    }

    function renderAttackRemovalService() {
        const used = Boolean(state.encounter.attackRemovalUsed);
        const ownedCount = getOwnedAttackCards().length;
        const disabled = used || getCash() < ATTACK_REMOVAL_COST || ownedCount === 0 ? 'disabled' : '';
        const buttonText = used
            ? 'Used'
            : getCash() < ATTACK_REMOVAL_COST
                ? `Need ${ATTACK_REMOVAL_COST}`
                : ownedCount === 0
                    ? 'No attacks'
                    : `Remove ${ATTACK_REMOVAL_COST}`;

        return `
            <article class="mart-service-row ${used ? 'is-used' : ''}">
                <div class="mart-service-info">
                    <h3>Remove an Attack</h3>
                    <span class="mart-service-requirement">Permanently remove one attack card</span>
                </div>
                <button class="mart-service-button" type="button" data-mart-service="remove-attack" ${disabled}>${buttonText}</button>
            </article>
        `;
    }

    function renderTradeService() {
        const used = Boolean(state.encounter.tradeUsed);
        const acceptedType = state.encounter.tradeAcceptedType;
        const offeredType = state.encounter.tradeOfferedType;
        const canTrade = canTradePokemon();
        const disabled = used || !canTrade ? 'disabled' : '';
        const buttonText = used ? 'Used' : 'Trade';
        const helperText = used
            ? `Traded for a ${offeredType}-type Pokemon.`
            : !acceptedType || !offeredType
                ? 'No trade available.'
                : !state.selectedPokemonId
                    ? `Select a ${acceptedType}-type Pokemon to trade.`
                    : !canTrade
                        ? `Selected Pokemon must be ${acceptedType}-type.`
                        : `Trade for a random ${offeredType}-type Pokemon.`;

        return `
            <article class="mart-service-row ${used ? 'is-used' : ''}">
                <div class="mart-service-info">
                    <h3>Trade: Wanted ${acceptedType || '?'} -&gt; Offered ${offeredType || '?'}</h3>
                    <span class="mart-service-requirement">${helperText}</span>
                </div>
                <button class="mart-service-button" type="button" data-mart-service="trade" ${disabled}>${buttonText}</button>
            </article>
        `;
    }

    function renderAttackRemovalPicker() {
        const cards = getOwnedAttackCards().slice().sort(compareCardsByName);

        return `
            <div class="area-overlay" data-attack-removal-overlay>
                <section class="area-card-window" role="dialog" aria-modal="true" aria-labelledby="attack-removal-title">
                    <header class="area-card-window-header">
                        <div>
                            <h2 class="area-card-window-title" id="attack-removal-title">Remove an Attack</h2>
                            <span class="area-card-window-count">Choose one to remove for ${ATTACK_REMOVAL_COST} coins</span>
                        </div>
                        <button class="area-card-window-close" type="button" data-close-attack-removal aria-label="Cancel">x</button>
                    </header>
                    <div class="area-card-window-body">
                        <div class="mart-attack-picker-grid">
                            ${cards.map(renderAttackRemovalChoice).join('')}
                        </div>
                    </div>
                </section>
            </div>
        `;
    }

    function renderAttackRemovalChoice(card) {
        return `
            <button class="mart-attack-choice" type="button" data-remove-attack-id="${card.id}" aria-label="Remove ${card.attack.name}">
                ${arena.Render.renderCardPreview(card, { className: 'mart-pokemon-card' })}
            </button>
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
        const namesChanged = didNameListChange(state.encounter.attackNames, attackNames) ||
            didNameListChange(state.encounter.itemNames, itemNames);
        const tradeChanged = repairMartTradeTypes();

        state.encounter.attackNames = attackNames;
        state.encounter.itemNames = itemNames;
        state.encounter.boughtAttackNames = repairBoughtNames(state.encounter.boughtAttackNames, attackNames);
        state.encounter.boughtItemNames = repairBoughtNames(state.encounter.boughtItemNames, itemNames);

        return namesChanged || tradeChanged;
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

    function getRecordTypes(record) {
        return [record.type1, record.type2, record.type3]
            .filter(type => type && type !== 'NONE');
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
