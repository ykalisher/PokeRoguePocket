/**
 * Pokemon Rogue Pocket - event page
 */

(function bootEventPage(arena, runStore, eventSystem, locations) {
    'use strict';

    const CARD_BACKS = Object.freeze({
        actions: 'assets/card-backs/ACTION_CARD_BACK.png',
        pokemon: 'assets/card-backs/POKEMON_CARD_BACK.png'
    });

    const state = {
        activeAction: null,
        cardWindow: null,
        elements: {},
        encounter: null,
        eventRecord: null,
        message: '',
        resultSummary: [],
        run: null,
        selections: {}
    };

    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        locations.applyLocationTheme(runStore.loadRunState());

        state.elements.root = document.getElementById('event-root');
        state.elements.root.addEventListener('click', handleEventClick);
        window.addEventListener('keydown', handleKeyDown);

        await arena.Data.loadGameData();

        state.run = runStore.loadRunState();
        state.encounter = runStore.getActiveEventEncounter(state.run);

        if (!state.run || !state.encounter) {
            window.location.href = 'area.html';
            return;
        }

        state.eventRecord = eventSystem.getEventById(arena.GameData, state.encounter.eventId);

        const actionChanges = runStore.rebuildActionDeckForActivePokemon(state.run);

        if (actionChanges.addedToDeck.length > 0 || actionChanges.movedToBench.length > 0) {
            runStore.saveRunState(state.run);
        }

        render();
    }

    function handleEventClick(event) {
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

        const continueButton = event.target.closest('[data-event-continue]');

        if (continueButton) {
            window.location.href = 'area.html';
            return;
        }

        const unavailableButton = event.target.closest('[data-complete-unavailable-event]');

        if (unavailableButton) {
            completeEvent('unavailable', ['The event was no longer available.']);
            return;
        }

        const cancelButton = event.target.closest('[data-cancel-event-action]');

        if (cancelButton) {
            clearActiveAction();
            return;
        }

        const selectionButton = event.target.closest('[data-selection-id][data-selection-card-id]');

        if (selectionButton) {
            selectRequirementCard(selectionButton.dataset.selectionId, selectionButton.dataset.selectionCardId);
            return;
        }

        const confirmButton = event.target.closest('[data-confirm-event-action]');

        if (confirmButton && state.activeAction) {
            completeAction(state.activeAction);
            return;
        }

        const actionButton = event.target.closest('[data-event-action-id]');

        if (actionButton) {
            const action = getActionById(actionButton.dataset.eventActionId);

            if (action) startAction(action);
            return;
        }

        const trainerActionButton = event.target.closest('[data-trainer-event-action]');

        if (!trainerActionButton) return;

        if (trainerActionButton.dataset.trainerEventAction === 'battle') {
            startTrainerBattle();
        } else if (trainerActionButton.dataset.trainerEventAction === 'pay') {
            const paymentAction = eventSystem.getTrainerPaymentAction(state.eventRecord);

            if (paymentAction) startAction(paymentAction);
        }
    }

    function handleKeyDown(event) {
        if (event.key === 'Escape' && state.cardWindow) {
            closeCardWindow();
        } else if (event.key === 'Escape' && state.activeAction) {
            clearActiveAction();
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

    function startAction(action) {
        state.message = '';
        state.activeAction = action;
        state.selections = {};

        if (!eventSystem.actionNeedsSelection(action)) {
            completeAction(action);
            return;
        }

        render();
    }

    function clearActiveAction() {
        state.activeAction = null;
        state.selections = {};
        state.message = '';
        render();
    }

    function selectRequirementCard(requirementId, cardId) {
        const currentCardId = state.selections[requirementId];

        state.selections = {
            ...state.selections,
            [requirementId]: currentCardId === cardId ? null : cardId
        };
        state.message = '';
        render();
    }

    function completeAction(action) {
        const result = eventSystem.applyAction(state.run, action, state.selections, {
            gameData: arena.GameData,
            runStore
        });

        if (!result.ok) {
            state.message = result.message;
            render();
            return;
        }

        completeEvent(action.id, result.summary);
    }

    function completeEvent(actionId, summary) {
        state.encounter.completed = true;
        state.encounter.completedAt = new Date().toISOString();
        state.encounter.resultSummary = Array.isArray(summary) ? summary : [];
        state.encounter.selectedActionId = actionId;
        state.resultSummary = state.encounter.resultSummary;
        state.run.area.activeEventNodeId = null;

        if (!state.encounter.statsRecorded) {
            // The record is missing when the event was completed as unavailable,
            // which still counts as an event seen but has no id to attribute it to.
            const bumps = { 'events.seen': 1 };

            if (state.eventRecord) bumps[`events.seen.${state.eventRecord.id}`] = 1;

            state.encounter.statsRecorded = true;
            window.PokeProfile.record(bumps, arena.GameData.achievements);
        }

        runStore.saveRunState(state.run);
        state.activeAction = null;
        state.selections = {};
        state.message = '';
        render();
    }

    function startTrainerBattle() {
        const trainer = getTrainerForEvent();

        if (!trainer) {
            state.message = 'Trainer unavailable.';
            render();
            return;
        }

        const nodeId = state.encounter.nodeId;
        const encounter = createTrainerBattleEncounter(nodeId, trainer);

        state.run.battleEncounters[nodeId] = encounter;
        state.encounter.startedBattle = true;
        state.run.area.activeBattleNodeId = nodeId;
        state.run.area.activeCaptureNodeId = null;
        state.run.area.activeMartNodeId = null;
        state.run.area.activeEventNodeId = nodeId;
        runStore.saveRunState(state.run);

        if (arena.Model && typeof arena.Model.clearSavedBattleState === 'function') {
            arena.Model.clearSavedBattleState();
        }

        window.location.href = 'game.html';
    }

    function createTrainerBattleEncounter(nodeId, trainer) {
        return {
            completed: false,
            completedAt: null,
            createdAt: new Date().toISOString(),
            finishedAt: null,
            nodeId,
            outcome: null,
            rank: trainer.rank,
            rewardCash: getTrainerRewardCash(trainer),
            rewardCollected: false,
            rewardEffects: eventSystem.getTrainerBattleRewardEffects(state.eventRecord),
            rewardSummary: [],
            sourceEventId: state.eventRecord.id,
            sourceEventNodeId: state.encounter.nodeId,
            startedAt: null,
            trainerName: trainer.name
        };
    }

    function render() {
        if (state.encounter.completed) {
            renderCompletedEvent();
            return;
        }

        if (!state.eventRecord) {
            renderUnavailableEvent();
            return;
        }

        state.elements.root.innerHTML = `
            ${renderTopbar()}
            ${state.eventRecord.type === 'trainer' ? renderTrainerEvent() : renderStandardEvent()}
            ${state.cardWindow ? renderCardWindow() : ''}
        `;
    }

    function renderTopbar() {
        return `
            <header class="event-topbar">
                <div class="event-title-group">
                    <span class="event-kicker">${escapeHtml(state.eventRecord.kicker || getEventTypeLabel(state.eventRecord.type))}</span>
                    <h1>${escapeHtml(state.eventRecord.title || 'Event')}</h1>
                    <span class="event-message" role="status" aria-live="polite">${escapeHtml(state.message || state.eventRecord.subtitle || '')}</span>
                </div>
                <div class="event-hud" aria-label="Run cards and cash">
                    ${renderMoney()}
                    ${renderDeckCounter('pokemon', 'Pokemon cards', state.run.collections.pokemon.length)}
                    ${renderDeckCounter('actions', 'Action deck', state.run.collections.actions.length)}
                </div>
            </header>
        `;
    }

    function renderStandardEvent() {
        const actions = eventSystem.getEventActions(state.eventRecord);

        return `
            <section class="event-stage" aria-label="Event choices">
                <article class="event-copy-panel">
                    ${renderEventBody()}
                    ${renderEffectList(getPreviewEffects(actions))}
                </article>
                <aside class="event-action-panel">
                    ${state.activeAction ? renderActiveAction() : renderActionList(actions)}
                </aside>
            </section>
        `;
    }

    function renderTrainerEvent() {
        const trainer = getTrainerForEvent();
        const paymentAction = eventSystem.getTrainerPaymentAction(state.eventRecord);

        return `
            <section class="event-stage event-stage--trainer" aria-label="Special trainer encounter">
                <article class="event-copy-panel">
                    ${trainer ? `<img class="event-trainer-sprite" src="${trainer.spritePath}" alt="${escapeHtml(getTrainerDisplayName(trainer))}">` : ''}
                    ${renderEventBody()}
                    ${renderEffectList(eventSystem.getTrainerBattleRewardEffects(state.eventRecord), 'Prize')}
                </article>
                <aside class="event-action-panel">
                    ${state.activeAction ? renderActiveAction() : renderTrainerActions(trainer, paymentAction)}
                </aside>
            </section>
        `;
    }

    function renderEventBody() {
        const paragraphs = [state.eventRecord.body, state.eventRecord.text, state.eventRecord.description]
            .filter(Boolean)
            .join('\n\n');

        return `
            <div class="event-copy">
                ${renderParagraphs(paragraphs)}
            </div>
        `;
    }

    function renderActionList(actions) {
        if (actions.length === 0) {
            return '<div class="event-empty">This event has no available actions.</div>';
        }

        return `
            <div class="event-action-list">
                ${actions.map(renderActionCard).join('')}
            </div>
        `;
    }

    function renderActionCard(action) {
        const unavailableReason = getActionAvailabilityReason(action);
        const disabled = unavailableReason ? 'disabled' : '';

        return `
            <article class="event-choice-card">
                <div>
                    <h2>${escapeHtml(action.title)}</h2>
                    ${action.description ? `<p>${escapeHtml(action.description)}</p>` : ''}
                    ${renderEffectList(action.effects)}
                    ${unavailableReason ? `<span class="event-action-note">${escapeHtml(unavailableReason)}</span>` : ''}
                </div>
                <button class="event-primary-button" type="button" data-event-action-id="${escapeHtml(action.id)}" ${disabled}>
                    ${escapeHtml(action.buttonText || 'Choose')}
                </button>
            </article>
        `;
    }

    function renderTrainerActions(trainer, paymentAction) {
        const battleDisabled = trainer ? '' : 'disabled';
        const paymentUnavailable = paymentAction ? getActionAvailabilityReason(paymentAction) : '';

        return `
            <div class="event-action-list">
                <article class="event-choice-card">
                    <div>
                        <h2>${escapeHtml(state.eventRecord.battleTitle || 'Battle')}</h2>
                        <p>${escapeHtml(state.eventRecord.battleText || 'Challenge the trainer for the prize.')}</p>
                    </div>
                    <button class="event-primary-button" type="button" data-trainer-event-action="battle" ${battleDisabled}>
                        ${escapeHtml(state.eventRecord.battleButtonText || 'Battle')}
                    </button>
                </article>
                ${paymentAction ? `
                    <article class="event-choice-card">
                        <div>
                            <h2>${escapeHtml(paymentAction.title)}</h2>
                            ${paymentAction.description ? `<p>${escapeHtml(paymentAction.description)}</p>` : ''}
                            ${renderEffectList(paymentAction.effects)}
                            ${paymentUnavailable ? `<span class="event-action-note">${escapeHtml(paymentUnavailable)}</span>` : ''}
                        </div>
                        <button class="event-secondary-button" type="button" data-trainer-event-action="pay" ${paymentUnavailable ? 'disabled' : ''}>
                            ${escapeHtml(paymentAction.buttonText)}
                        </button>
                    </article>
                ` : ''}
            </div>
        `;
    }

    function renderActiveAction() {
        const blockedReason = eventSystem.getBlockedReason(state.run, state.activeAction, state.selections, {
            gameData: arena.GameData,
            runStore
        });
        const disabled = blockedReason ? 'disabled' : '';

        return `
            <section class="event-selection-panel">
                <header class="event-selection-header">
                    <div>
                        <h2>${escapeHtml(state.activeAction.title)}</h2>
                        ${state.activeAction.description ? `<p>${escapeHtml(state.activeAction.description)}</p>` : ''}
                    </div>
                    <button class="event-icon-button" type="button" data-cancel-event-action aria-label="Cancel">x</button>
                </header>
                ${eventSystem.getActionRequirements(state.activeAction).map(renderRequirement).join('')}
                <footer class="event-selection-footer">
                    <span>${escapeHtml(blockedReason || state.message || '')}</span>
                    <button class="event-primary-button" type="button" data-confirm-event-action ${disabled}>Confirm</button>
                </footer>
            </section>
        `;
    }

    function renderRequirement(requirement) {
        const cards = eventSystem.getSelectableCards(state.run, requirement);

        return `
            <section class="event-requirement">
                <header class="event-mini-header">
                    <h3>${escapeHtml(requirement.label || requirement.prompt || 'Choose a card')}</h3>
                    <span>${cards.length}</span>
                </header>
                ${cards.length > 0
                    ? `<div class="event-card-select-grid">${cards.map(card => renderSelectableCard(requirement, card)).join('')}</div>`
                    : `<div class="event-empty">${escapeHtml(requirement.emptyText || 'No cards available')}</div>`
                }
            </section>
        `;
    }

    function renderSelectableCard(requirement, card) {
        const selected = state.selections[requirement.id] === card.id;

        return `
            <button class="event-card-choice ${selected ? 'is-selected' : ''}" type="button" data-selection-id="${escapeHtml(requirement.id)}" data-selection-card-id="${escapeHtml(card.id)}" aria-pressed="${selected ? 'true' : 'false'}" aria-label="Select ${escapeHtml(arena.Model.getCardName(card))}">
                ${arena.Render.renderCardPreview(card, { className: 'event-card-preview' })}
            </button>
        `;
    }

    function renderCompletedEvent() {
        const summary = state.resultSummary.length > 0 ? state.resultSummary : state.encounter.resultSummary;
        const eventType = state.eventRecord ? state.eventRecord.type : 'event';

        state.elements.root.innerHTML = `
            <section class="event-result-screen" aria-label="Event complete">
                <article class="event-result-card">
                    <span class="event-kicker">${escapeHtml((state.eventRecord && state.eventRecord.kicker) || getEventTypeLabel(eventType))}</span>
                    <h1>${escapeHtml((state.eventRecord && state.eventRecord.resultTitle) || 'Event complete')}</h1>
                    ${summary && summary.length > 0
                        ? `<ul class="event-result-list">${summary.map(entry => `<li>${escapeHtml(entry)}</li>`).join('')}</ul>`
                        : '<p>You moved on.</p>'
                    }
                    <button class="event-primary-button" type="button" data-event-continue>Continue</button>
                </article>
            </section>
        `;
    }

    function renderUnavailableEvent() {
        state.elements.root.innerHTML = `
            <section class="event-result-screen" aria-label="Event unavailable">
                <article class="event-result-card">
                    <span class="event-kicker">Event</span>
                    <h1>Event unavailable</h1>
                    <p>This saved event no longer exists.</p>
                    <button class="event-primary-button" type="button" data-complete-unavailable-event>Continue</button>
                </article>
            </section>
        `;
    }

    function renderMoney() {
        const cash = Number.isFinite(state.run && state.run.cash) ? state.run.cash : 0;

        return `
            <span class="event-money" aria-label="${cash} coins">
                <span class="event-money-icon" aria-hidden="true">C</span>
                <span>${cash}</span>
            </span>
        `;
    }

    function renderDeckCounter(collectionKey, label, count) {
        return `
            <button class="event-deck-counter" type="button" data-card-window="${collectionKey}" aria-label="Open ${label}" title="${label}">
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
                <section class="area-card-window" role="dialog" aria-modal="true" aria-labelledby="event-card-window-title">
                    <header class="area-card-window-header">
                        <div>
                            <h2 class="area-card-window-title" id="event-card-window-title">${title}</h2>
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

    function renderEffectList(effects, title = 'Outcome') {
        const entries = (effects || []).map(describeEffect).filter(Boolean);

        if (entries.length === 0) return '';

        return `
            <section class="event-effect-list" aria-label="${escapeHtml(title)}">
                <h3>${escapeHtml(title)}</h3>
                <ul>${entries.map(entry => `<li>${escapeHtml(entry)}</li>`).join('')}</ul>
            </section>
        `;
    }

    function getPreviewEffects(actions) {
        if (!Array.isArray(actions) || actions.length !== 1) return [];

        return actions[0].effects || [];
    }

    function describeEffect(effect) {
        const amount = Number(effect.amount || effect.count) || 0;
        const cardKind = effect.cardKind || effect.kind || 'card';
        const countSuffix = amount > 1 ? ` x${amount}` : '';

        if (effect.type === 'gain-cash') return `Gain ${amount} coins`;
        if (effect.type === 'lose-cash') return `Pay ${amount} coins`;
        if (effect.type === 'gain-card') return `Gain ${effect.name}${countSuffix}`;
        if (effect.type === 'gain-random-card') return `Gain ${amount} random ${cardKind} card${amount === 1 ? '' : 's'}${effect.locationTypes === true ? ' from this area' : ''}`;
        if (effect.type === 'lose-random-cards') return `Lose ${amount} random ${cardKind} card${amount === 1 ? '' : 's'}`;
        if (effect.type === 'lose-random-pokemon') return `Lose ${amount} random Pokemon`;
        if (effect.type === 'remove-selected-card') return 'Lose the selected card';
        if (effect.type === 'duplicate-selected-card') return 'Duplicate the selected card';
        if (effect.type === 'duplicate-random-card') return `Duplicate ${amount} random ${cardKind} card${amount === 1 ? '' : 's'}`;
        if (effect.type === 'replace-selected-card') return 'Replace the selected card';
        if (effect.type === 'replace-random-card') return `Replace ${amount} random ${cardKind} card${amount === 1 ? '' : 's'}`;
        if (effect.type === 'trade-selected-pokemon') return 'Trade the selected Pokemon';
        if (effect.type === 'trade-random-pokemon') return 'Trade a random Pokemon';
        if (effect.type === 'gain-random-baby') return `Gain a random baby Pokemon${effect.locationTypes === true ? ' from this area' : ''}`;

        return '';
    }

    function getActionAvailabilityReason(action) {
        const unmetConditionReason = eventSystem.getUnmetConditionReason(state.run, action);

        if (unmetConditionReason) return unmetConditionReason;

        const requirements = eventSystem.getActionRequirements(action);

        for (const requirement of requirements) {
            if (eventSystem.getSelectableCards(state.run, requirement).length === 0) {
                return requirement.emptyText || 'No cards available.';
            }
        }

        if (requirements.length > 0) return '';

        return eventSystem.getBlockedReason(state.run, action, {}, {
            gameData: arena.GameData,
            runStore
        });
    }

    function getActionById(actionId) {
        return eventSystem.getEventActions(state.eventRecord)
            .find(action => action.id === actionId) || null;
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

    function getTrainerForEvent() {
        if (!state.eventRecord || !state.eventRecord.trainerName) return null;

        const trainers = arena.GameData && Array.isArray(arena.GameData.trainers)
            ? arena.GameData.trainers
            : [];

        return trainers.find(trainer => trainer.name === state.eventRecord.trainerName) || null;
    }

    function getTrainerRewardCash(trainer) {
        if (Number.isFinite(state.eventRecord.rewardCash)) return state.eventRecord.rewardCash;

        return Number.isFinite(trainer.cash) ? trainer.cash : 0;
    }

    function getTrainerDisplayName(trainer) {
        return trainer.displayName || trainer.name;
    }

    function getEventTypeLabel(type) {
        if (type === 'gift') return 'Discovery';
        if (type === 'choice') return 'Decision';
        if (type === 'trainer') return 'Special Trainer';

        return 'Event';
    }

    function renderParagraphs(text) {
        const paragraphs = String(text || '')
            .split(/\n{2,}/)
            .map(paragraph => paragraph.trim())
            .filter(Boolean);

        if (paragraphs.length === 0) return '<p>Something happens on the trail.</p>';

        return paragraphs.map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join('');
    }

    function compareCardsByName(leftCard, rightCard) {
        const nameComparison = arena.Model.getCardName(leftCard).localeCompare(arena.Model.getCardName(rightCard));

        if (nameComparison !== 0) return nameComparison;

        return leftCard.id.localeCompare(rightCard.id);
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
})(window.CardArena = window.CardArena || {}, window.PokeRun, window.PokeEvents, window.PokeLocations);
