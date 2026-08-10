/**
 * Pocket Nuzlocke - attack encounter page
 */

(function bootAttackPage(arena, runStore, locations) {
    'use strict';

    const CARD_BACKS = Object.freeze({
        actions: 'assets/card-backs/ACTION_CARD_BACK.png',
        pokemon: 'assets/card-backs/POKEMON_CARD_BACK.png'
    });
    const PHASE_DURATIONS = Object.freeze({
        claimed: 920,
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
        selectedIndex: null
    };

    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        locations.applyLocationTheme(runStore.loadRunState());

        state.elements.root = document.getElementById('attack-root');
        state.elements.root.addEventListener('click', handleAttackClick);
        window.addEventListener('keydown', handleKeyDown);

        await arena.Data.loadGameData();
        window.PokeProfile.showPendingUnlocks(arena.GameData.achievements);

        state.run = runStore.loadRunState();
        state.encounter = runStore.getActiveAttackEncounter(state.run);

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

    function handleAttackClick(event) {
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

        const optionButton = event.target.closest('[data-attack-option]');

        if (!optionButton || state.phase !== 'choosing') return;

        claimAttack(Number(optionButton.dataset.attackOption));
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

    async function claimAttack(optionIndex) {
        const attack = getAttackOptions()[optionIndex];

        if (!attack) return;

        state.phase = 'claimed';
        state.selectedIndex = optionIndex;
        state.rewardCards = completeAttackClaim(attack);
        render();

        await arena.Model.sleep(PHASE_DURATIONS.claimed);
        state.phase = 'deck';
        render();

        await arena.Model.sleep(PHASE_DURATIONS.deck);
        state.phase = 'complete';
        render();

        await arena.Model.sleep(PHASE_DURATIONS.complete);
        window.location.href = 'area.html';
    }

    function completeAttackClaim(attack) {
        const rewardCards = [1, 2].map(() => runStore.createAttackCard(
            attack,
            'player',
            runStore.allocateCardId(state.run, 'attack', attack.name)
        ));

        rewardCards.forEach(card => runStore.addActionCard(state.run, card));
        state.encounter.completed = true;
        state.encounter.selectedAttackName = attack.name;
        state.run.area.activeAttackNodeId = null;

        if (!state.encounter.statsRecorded) {
            state.encounter.statsRecorded = true;
            window.PokeProfile.record({ 'attacks.claimed': 1 }, arena.GameData.achievements);
        }

        runStore.saveRunState(state.run);

        return rewardCards;
    }

    function render() {
        const attackOptions = getAttackOptions();
        const terrain = state.encounter.terrain || 'Current Terrain';

        state.elements.root.innerHTML = `
            <header class="attack-topbar">
                <div class="attack-title-group">
                    <span class="attack-kicker">${terrain}</span>
                    <h1>${getPhaseTitle()}</h1>
                </div>
                <div class="attack-hud" aria-label="Run cards">
                    ${renderDeckCounter('pokemon', 'Pokemon cards', state.run.collections.pokemon.length)}
                    ${renderDeckCounter('actions', 'Action deck', state.run.collections.actions.length)}
                </div>
            </header>
            <section class="attack-stage" aria-label="Attack choices">
                <div class="attack-options">
                    ${attackOptions.map(renderAttackOption).join('')}
                </div>
                ${renderRewardTray()}
            </section>
            ${state.cardWindow ? renderCardWindow() : ''}
        `;
    }

    function renderDeckCounter(collectionKey, label, count) {
        return `
            <button class="attack-deck-counter" type="button" data-card-window="${collectionKey}" aria-label="Open ${label}" title="${label}">
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

    function renderAttackOption(attack, index) {
        const card = runStore.createAttackCard(attack, 'player', 'attack-option-' + formatId(attack.name));
        const selected = state.selectedIndex === index;
        const disabled = state.phase === 'choosing' ? '' : 'disabled';
        const className = [
            'attack-option',
            selected ? 'is-selected' : '',
            state.phase !== 'choosing' && !selected ? 'is-dimmed' : ''
        ].filter(Boolean).join(' ');

        return `
            <button class="${className}" type="button" data-attack-option="${index}" ${disabled} aria-label="Choose ${attack.name}">
                ${arena.Render.renderCardPreview(card, { className: 'attack-option-card' })}
            </button>
        `;
    }

    function renderRewardTray() {
        const showRewards = state.rewardCards.length > 0 && ['claimed', 'deck', 'complete'].includes(state.phase);
        const className = [
            'attack-rewards',
            state.phase === 'claimed' ? 'is-revealed' : '',
            state.phase === 'deck' || state.phase === 'complete' ? 'is-decking' : ''
        ].filter(Boolean).join(' ');

        return `
            <div class="${className}" ${showRewards ? '' : 'hidden'} aria-label="Action rewards">
                <div class="attack-reward-cards">
                    ${state.rewardCards.map((card, index) => `
                        <div class="attack-reward-card" style="--reward-index: ${index};">
                            ${arena.Render.renderCardPreview(card, { className: 'attack-action-card' })}
                        </div>
                    `).join('')}
                </div>
                <div class="attack-deck-target" aria-label="Action deck">
                    <img src="${CARD_BACKS.actions}" alt="">
                    <span>Action deck</span>
                </div>
            </div>
        `;
    }

    function getPhaseTitle() {
        if (state.phase === 'claimed' || state.phase === 'deck') return `Added ${getRewardText()}`;
        if (state.phase === 'complete') return 'Returning to map';

        return 'Choose one attack';
    }

    function getRewardText() {
        if (state.rewardCards.length === 0) return 'an attack';

        return `${arena.Model.getCardName(state.rewardCards[0])} x2`;
    }

    function getAttackOptions() {
        return state.encounter.options
            .map(name => findGameRecord('attacks', name))
            .filter(Boolean);
    }

    function repairEncounterOptions() {
        const originalOptions = Array.isArray(state.encounter.options) ? state.encounter.options : [];
        const availableAttackNames = new Set(getAttackCardPool().map(record => record.name));
        const seenNames = new Set();

        let nextOptions = originalOptions.filter(name => {
            if (!availableAttackNames.has(name) || seenNames.has(name)) return false;

            seenNames.add(name);
            return true;
        });

        if (nextOptions.length === 0) {
            nextOptions = locations.chooseAttackCardOptions(arena.GameData, getLocationTypes()).map(record => record.name);
        }

        const changed = nextOptions.length !== originalOptions.length ||
            nextOptions.some((name, index) => name !== originalOptions[index]);

        state.encounter.options = nextOptions;

        return changed;
    }

    function getAttackCardPool() {
        return locations.getAttackCardPool(arena.GameData, getLocationTypes());
    }

    function getLocationTypes() {
        return state.run && state.run.location && Array.isArray(state.run.location.types)
            ? state.run.location.types
            : [];
    }

    function findGameRecord(collectionKey, name) {
        const records = arena.GameData && arena.GameData[collectionKey];

        return Array.isArray(records)
            ? records.find(record => record.name === name) || null
            : null;
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
