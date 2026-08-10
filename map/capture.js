/**
 * Pocket Nuzlocke - capture encounter page
 */

(function bootCapturePage(arena, runStore, locations) {
    'use strict';

    const CARD_BACKS = Object.freeze({
        actions: 'assets/card-backs/ACTION_CARD_BACK.png',
        pokemon: 'assets/card-backs/POKEMON_CARD_BACK.png'
    });
    const PHASE_DURATIONS = Object.freeze({
        pokemon: 980,
        attacks: 920,
        deck: 920,
        complete: 180
    });

    const state = {
        cardWindow: null,
        elements: {},
        encounter: null,
        phase: 'choosing',
        rewardCards: [],
        run: null,
        selectedIndex: null,
        selectedPokemonCard: null
    };

    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        locations.applyLocationTheme(runStore.loadRunState());

        state.elements.root = document.getElementById('capture-root');
        state.elements.root.addEventListener('click', handleCaptureClick);
        window.addEventListener('keydown', handleKeyDown);

        await arena.Data.loadGameData();
        window.PokeProfile.showPendingUnlocks(arena.GameData.achievements);

        state.run = runStore.loadRunState();
        state.encounter = runStore.getActiveCaptureEncounter(state.run);

        if (!state.run || !state.encounter) {
            window.location.href = 'area.html';
            return;
        }

        runStore.ensureLevelMusic(state.run, arena.GameData.music);

        if (repairEncounterOptions()) {
            runStore.saveRunState(state.run);
        }

        if (state.encounter.options.length === 0) {
            window.location.href = 'area.html';
            return;
        }

        render();
    }

    function handleCaptureClick(event) {
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

        const optionButton = event.target.closest('[data-capture-option]');

        if (!optionButton || state.phase !== 'choosing') return;

        claimPokemon(Number(optionButton.dataset.captureOption));
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

    async function claimPokemon(optionIndex) {
        const pokemon = getPokemonOptions()[optionIndex];

        if (!pokemon) return;

        state.phase = 'pokemon';
        state.selectedIndex = optionIndex;

        const reward = completeCapture(pokemon);

        state.selectedPokemonCard = reward.pokemonCard;
        state.rewardCards = reward.rewardCards;
        render();

        await arena.Model.sleep(PHASE_DURATIONS.pokemon);
        state.phase = 'attacks';
        render();

        await arena.Model.sleep(PHASE_DURATIONS.attacks);
        state.phase = 'deck';
        render();

        await arena.Model.sleep(PHASE_DURATIONS.deck);
        state.phase = 'complete';
        render();

        await arena.Model.sleep(PHASE_DURATIONS.complete);
        window.location.href = 'area.html';
    }

    function completeCapture(pokemon) {
        const attack = chooseRandomLearnableAttack(pokemon);
        const pokemonCard = runStore.createPokemonCard(
            pokemon,
            'player',
            runStore.allocateCardId(state.run, 'pokemon', pokemon.name)
        );
        const rewardCards = [1, 2].map(() => runStore.createAttackCard(
            attack,
            'player',
            runStore.allocateCardId(state.run, 'attack', attack.name)
        ));
        const dragonGemReward = chooseDragonGemReward(attack);

        if (dragonGemReward) {
            rewardCards.push(dragonGemReward);
        }

        runStore.addPokemonCard(state.run, pokemonCard);
        rewardCards.forEach(card => runStore.addActionCard(state.run, card));
        state.encounter.completed = true;
        state.encounter.rewardAttackName = attack.name;
        state.encounter.rewardDragonGemName = dragonGemReward ? dragonGemReward.item.name : null;
        state.encounter.selectedPokemonName = pokemon.name;
        state.run.area.activeCaptureNodeId = null;

        if (!state.encounter.statsRecorded) {
            state.encounter.statsRecorded = true;
            window.PokeProfile.record({ 'captures.completed': 1 }, arena.GameData.achievements);
        }

        runStore.saveRunState(state.run);

        return {
            pokemonCard,
            rewardCards
        };
    }

    function render() {
        const pokemonOptions = getPokemonOptions();
        const terrain = state.encounter.terrain || 'Current Terrain';
        const selectedPokemon = state.selectedPokemonCard
            ? state.selectedPokemonCard.pokemon.name
            : null;

        state.elements.root.innerHTML = `
            <header class="capture-topbar">
                <div class="capture-title-group">
                    <span class="capture-kicker">${terrain}</span>
                    <h1>${getPhaseTitle(selectedPokemon)}</h1>
                </div>
                <div class="capture-hud" aria-label="Run cards">
                    ${renderDeckCounter('pokemon', 'Pokemon cards', state.run.collections.pokemon.length)}
                    ${renderDeckCounter('actions', 'Action deck', state.run.collections.actions.length)}
                </div>
            </header>
            <section class="capture-stage" aria-label="Capture choices">
                <div class="capture-options">
                    ${pokemonOptions.map(renderPokemonOption).join('')}
                </div>
                ${renderRewardTray()}
            </section>
            ${state.cardWindow ? renderCardWindow() : ''}
        `;
    }

    function renderDeckCounter(collectionKey, label, count) {
        return `
            <button class="capture-deck-counter" type="button" data-card-window="${collectionKey}" aria-label="Open ${label}" title="${label}">
                <img src="${CARD_BACKS[collectionKey]}" alt="">
                <span>${count}</span>
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

    function renderPokemonOption(pokemon, index) {
        const card = runStore.createPokemonCard(pokemon, 'player', `capture-option-${formatId(pokemon.name)}`);
        const selected = state.selectedIndex === index;
        const disabled = state.phase === 'choosing' ? '' : 'disabled';
        const className = [
            'capture-option',
            selected ? 'is-selected' : '',
            state.phase === 'pokemon' && selected ? 'is-catching' : '',
            state.phase !== 'choosing' && !selected ? 'is-dimmed' : ''
        ].filter(Boolean).join(' ');

        return `
            <button class="${className}" type="button" data-capture-option="${index}" ${disabled} aria-label="Choose ${pokemon.name}">
                ${arena.Render.renderCardPreview(card, { className: 'capture-pokemon-card' })}
            </button>
        `;
    }

    function renderRewardTray() {
        const showRewards = state.rewardCards.length > 0 && ['attacks', 'deck', 'complete'].includes(state.phase);
        const className = [
            'capture-rewards',
            state.phase === 'attacks' ? 'is-revealed' : '',
            state.phase === 'deck' || state.phase === 'complete' ? 'is-decking' : ''
        ].filter(Boolean).join(' ');

        return `
            <div class="${className}" ${showRewards ? '' : 'hidden'} aria-label="Action rewards">
                <div class="capture-reward-cards">
                    ${state.rewardCards.map((card, index) => `
                        <div class="capture-reward-card" style="--reward-index: ${index};">
                            ${arena.Render.renderCardPreview(card, { className: 'capture-action-card' })}
                        </div>
                    `).join('')}
                </div>
                <div class="capture-deck-target" aria-label="Action deck">
                    <img src="${CARD_BACKS.actions}" alt="">
                    <span>Action deck</span>
                </div>
            </div>
        `;
    }

    function getPhaseTitle(selectedPokemon) {
        if (state.phase === 'pokemon' && selectedPokemon) return `${selectedPokemon} joined`;
        if (state.phase === 'attacks' || state.phase === 'deck') return `Added ${getRewardText()}`;
        if (state.phase === 'complete') return 'Returning to map';

        return 'Choose one Pokemon';
    }

    function getRewardText() {
        const rewardNames = state.rewardCards.map(card => arena.Model.getCardName(card));

        if (rewardNames.length === 0) return 'an attack';

        const uniqueNames = [...new Set(rewardNames)];

        if (uniqueNames.length === 1) return uniqueNames[0];
        if (uniqueNames.length === 2) return `${uniqueNames[0]} and ${uniqueNames[1]}`;

        return `${uniqueNames.slice(0, -1).join(', ')}, and ${uniqueNames[uniqueNames.length - 1]}`;
    }

    function getPokemonOptions() {
        return state.encounter.options
            .map(name => findGameRecord('pokemon', name))
            .filter(Boolean);
    }

    function repairEncounterOptions() {
        const originalOptions = Array.isArray(state.encounter.options) ? state.encounter.options : [];
        const availablePokemonNames = new Set(getAvailablePokemonForCurrentTerrain().map(pokemon => pokemon.name));
        const seenNames = new Set();

        let nextOptions = originalOptions.filter(name => {
            if (!availablePokemonNames.has(name) || seenNames.has(name)) return false;

            seenNames.add(name);
            return true;
        });

        if (nextOptions.length === 0) {
            nextOptions = chooseCapturePokemonOptions().map(pokemon => pokemon.name);
        }

        const changed = nextOptions.length !== originalOptions.length ||
            nextOptions.some((name, index) => name !== originalOptions[index]);

        state.encounter.options = nextOptions;

        return changed;
    }

    function chooseCapturePokemonOptions() {
        const availablePokemon = getAvailablePokemonForCurrentTerrain();

        if (availablePokemon.length === 0) return [];

        const optionCount = randomInt(1, Math.min(3, availablePokemon.length));

        return shuffleRecords(availablePokemon).slice(0, optionCount);
    }

    function getAvailablePokemonForCurrentTerrain() {
        return locations.getWildPokemonPool(arena.GameData, getLocationTypes());
    }

    function getLocationTypes() {
        return state.run && state.run.location && Array.isArray(state.run.location.types)
            ? state.run.location.types
            : [];
    }

    function shuffleRecords(records) {
        const shuffled = records.slice();

        for (let index = shuffled.length - 1; index > 0; index -= 1) {
            const swapIndex = randomInt(0, index);

            [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
        }

        return shuffled;
    }

    function chooseRandomLearnableAttack(pokemon) {
        const attacks = arena.GameData && Array.isArray(arena.GameData.attacks)
            ? arena.GameData.attacks
            : [];

        const learnableAttacks = attacks.filter(attack => pokemonCanLearnCaptureAttack(pokemon, attack));
        const fallbackAttacks = attacks.filter(attack => !requiresBothAttackTypes(attack));
        const options = learnableAttacks.length > 0 ? learnableAttacks : fallbackAttacks;

        if (options.length > 0) {
            return options[randomInt(0, options.length - 1)];
        }

        return createFallbackAttack();
    }

    function chooseDragonGemReward(attack) {
        if (!getRecordTypes(attack, ['type1', 'type2']).includes('DRAGON')) return null;
        if (actionDeckHasDragonGem()) return null;

        const dragonGems = getDragonGemItems();

        if (dragonGems.length === 0) return null;

        const item = dragonGems[randomInt(0, dragonGems.length - 1)];

        return runStore.createItemCard(
            item,
            'player',
            runStore.allocateCardId(state.run, 'item', item.name)
        );
    }

    function actionDeckHasDragonGem() {
        return state.run.collections.actions.some(card => (
            card && card.kind === 'item' && itemIsDragonGem(card.item)
        ));
    }

    function getDragonGemItems() {
        const items = arena.GameData && Array.isArray(arena.GameData.items)
            ? arena.GameData.items
            : [];

        return items.filter(itemIsDragonGem);
    }

    function itemIsDragonGem(item) {
        return getItemStatuses(item).includes('DRAGON_GEM');
    }

    function getItemStatuses(item) {
        if (!item) return [];

        const status = Array.isArray(item.status) ? item.status : [item.status];
        const statChanges = Array.isArray(item.statChanges) ? item.statChanges : [];

        return [...status, ...statChanges].filter(value => value && value !== 'NONE');
    }

    function pokemonCanLearnCaptureAttack(pokemon, attack) {
        if (!pokemon || !attack || requiresBothAttackTypes(attack)) return false;

        const pokemonTypes = getRecordTypes(pokemon, ['type1', 'type2', 'type3']);
        const attackTypes = getRecordTypes(attack, ['type1', 'type2']);

        if (attackTypes.length === 0) return true;

        return attackTypes.some(type => pokemonTypes.includes(type));
    }

    function requiresBothAttackTypes(attack) {
        return Boolean(attack.full_type_requirements && getRecordTypes(attack, ['type1', 'type2']).length > 1);
    }

    function getRecordTypes(record, keys = ['type1', 'type2', 'type3']) {
        return keys
            .map(key => record[key])
            .filter(type => type && type !== 'NONE');
    }

    function findGameRecord(collectionKey, name) {
        const records = arena.GameData && arena.GameData[collectionKey];

        return Array.isArray(records)
            ? records.find(record => record.name === name) || null
            : null;
    }

    function createFallbackAttack() {
        return {
            basePower: 70,
            full_type_requirements: false,
            name: 'Waterfall',
            statChanges: [],
            status: 'FLINCH',
            target: 'OPPONENT',
            type1: 'WATER',
            type2: 'NONE',
            types: ['WATER']
        };
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

    function compareCardsByName(leftCard, rightCard) {
        const nameComparison = arena.Model.getCardName(leftCard).localeCompare(arena.Model.getCardName(rightCard));

        if (nameComparison !== 0) return nameComparison;

        return leftCard.id.localeCompare(rightCard.id);
    }
})(window.CardArena = window.CardArena || {}, window.PokeRun, window.PokeLocations);
