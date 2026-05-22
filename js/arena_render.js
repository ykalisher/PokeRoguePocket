/**
 * Squish - card arena rendering
 */

(function attachArenaRender(arena) {
    'use strict';

    const state = arena.state;

    function render() {
        state.elements.board.innerHTML = `
            ${renderSide('opponent')}
            ${renderStatus()}
            ${renderSide('player')}
        `;
    }

    function renderSide(playerId) {
        const player = state.players[playerId];
        const isOpponent = playerId === 'opponent';
        const handFirst = isOpponent ? renderHand(player) : '';
        const handLast = isOpponent ? '' : renderHand(player);

        return `
            <section class="side-panel side-panel--${playerId}" aria-label="${player.name} arena">
                <header class="side-status">
                    <h2 class="side-title">${player.name}</h2>
                    <div class="side-stats">
                        <span class="stat-pill">Pokemon left ${player.pokemonLeft}</span>
                        <span class="stat-pill">Deck ${player.deck.length}</span>
                        <span class="stat-pill">Hand ${player.hand.length}</span>
                        <span class="stat-pill">Discard ${player.discard.length}</span>
                        <span class="stat-pill">KO ${player.knockout.length}</span>
                    </div>
                </header>
                ${handFirst}
                <div class="battle-row">
                    ${renderPile('Deck', player.deck.length, 'deck')}
                    ${renderPlayedSlots(player)}
                    ${renderPile('Discard', player.discard.length, 'discard')}
                    ${renderPile('KO', player.knockout.length, 'knockout')}
                </div>
                ${handLast}
            </section>
        `;
    }

    function renderPlayedSlots(player) {
        const isGroupTarget = isGroupTargetOption(player.id);
        const groupClass = isGroupTarget ? ' is-group-target' : '';
        const groupAttributes = isGroupTarget ? `data-target-group-owner="${player.id}" role="button" tabindex="0"` : '';

        return `
            <div class="played-slots${groupClass}" aria-label="${player.name} played Pokemon" ${groupAttributes}>
                        ${renderBoardSlot(player, 0)}
                        ${renderBoardSlot(player, 1)}
                    </div>
        `;
    }

    function renderPile(label, count, type) {
        const isEmpty = count === 0 ? ' is-empty' : '';

        return `
            <div class="pile pile--${type}">
                <div class="pile-card${isEmpty}" aria-label="${label} pile, ${count} cards">${count}</div>
                <div class="pile-label">${label}</div>
            </div>
        `;
    }

    function renderBoardSlot(player, slotIndex) {
        const card = player.board[slotIndex];
        const flags = getBoardCardFlags(player.id, card);
        const queued = card && arena.Model.hasQueuedAttack(player.id, card.id);
        const pendingAttackHover = card ? renderPendingAttackHover(player.id, card) : '';

        return `
            <div class="board-slot" data-slot-owner="${player.id}" data-slot-index="${slotIndex}">
                ${card ? renderCard(card, { ...flags, context: 'board', owner: player.id, reveal: card.faceUp, slotIndex }) : '<div class="empty-hand">Open</div>'}
                ${pendingAttackHover}
                ${queued ? '<span class="slot-badge">Ready</span>' : ''}
            </div>
        `;
    }

    function renderPendingAttackHover(playerId, card) {
        if (
            state.phase !== 'selecting-attack-target' ||
            playerId !== 'player' ||
            state.pendingUserCardId !== card.id
        ) {
            return '';
        }

        const attackCard = arena.Model.findHandCard(state.players.player, state.pendingActionCardId);

        if (!arena.Model.isAttackCard(attackCard)) return '';

        return `
            <button class="playing-card hand-card card-kind-${attackCard.kind} attack-hover-card" type="button" data-pending-action-card-id="${attackCard.id}" aria-label="Drag ${arena.Model.getCardName(attackCard)} to a target">
                ${renderCardContent(attackCard, true)}
            </button>
        `;
    }

    function getBoardCardFlags(playerId, card) {
        if (!card) {
            return {
                actionTarget: false,
                singleTarget: false,
                userActive: false,
                userOption: false
            };
        }

        const pendingCard = arena.Model.findHandCard(state.players.player, state.pendingActionCardId);
        const targetOptions = pendingCard
            ? arena.Model.getTargetOptionsForAction(pendingCard, 'player', state.pendingUserCardId)
            : [];
        const singleTarget = isTargetingPhase() && arena.Model.targetOptionsIncludeCard(targetOptions, playerId, card.id);
        const groupTarget = isTargetingPhase() && arena.Model.targetOptionsIncludeGroup(targetOptions, playerId);
        const userOption = (
            state.phase === 'selecting-attack-user' &&
            playerId === 'player' &&
            arena.Model.isAttackCard(pendingCard) &&
            !arena.Model.hasQueuedAttack('player', card.id) &&
            arena.Model.pokemonCanUseAttack(card, pendingCard) &&
            arena.Model.getTargetOptionsForAction(pendingCard, 'player', card.id).length > 0
        );

        return {
            actionTarget: singleTarget || groupTarget,
            singleTarget,
            userActive: state.phase === 'selecting-attack-target' && playerId === 'player' && state.pendingUserCardId === card.id,
            userOption
        };
    }

    function renderHand(player) {
        const isOpponent = player.id === 'opponent';
        const cards = player.hand.map(card => {
            if (shouldHideHandCard(card)) return '';

            if (isOpponent) {
                return renderCard(card, { context: 'hand', reveal: false });
            }

            const selectedClass = state.selectedCardId === card.id || state.pendingActionCardId === card.id ? ' is-selected' : '';

            return `
                <button class="playing-card hand-card card-kind-${card.kind}${selectedClass}" type="button" data-card-id="${card.id}" data-hand-card-id="${card.id}" aria-label="Select ${arena.Model.getCardName(card)}">
                    ${renderCardContent(card, true)}
                </button>
            `;
        }).join('');

        return `
            <div class="hand-row hand-row--${player.id}">
                <div class="hand-label">${isOpponent ? 'Opponent Hand' : 'Your Hand'} (${player.hand.length})</div>
                <div class="hand-cards">
                    ${cards || '<span class="empty-hand">Empty</span>'}
                </div>
            </div>
        `;
    }

    function shouldHideHandCard(card) {
        return (
            state.phase === 'selecting-attack-target' &&
            card.id === state.pendingActionCardId &&
            arena.Model.isAttackCard(card)
        );
    }

    function renderCard(card, options) {
        const reveal = options.reveal;
        const backClass = reveal ? '' : ' card-back';
        const targetClass = options.singleTarget ? ' is-targetable' : '';
        const actionTargetClass = options.actionTarget ? ' is-action-target' : '';
        const userOptionClass = options.userOption ? ' is-user-option' : '';
        const userActiveClass = options.userActive ? ' is-user-active' : '';
        const kindClass = ` card-kind-${card.kind}`;
        const tagName = options.singleTarget || options.userOption ? 'button' : 'div';
        const targetAttributes = options.singleTarget ? `type="button" data-target-card-id="${card.id}" data-target-owner="${options.owner}"` : options.userOption ? 'type="button"' : '';
        const boardAttributes = options.context === 'board' ? `data-board-card-id="${card.id}" data-board-owner="${options.owner}" data-board-slot="${options.slotIndex}"` : '';
        const handAttributes = options.context === 'hand' ? `data-hand-card-id="${card.id}"` : '';
        const ariaLabel = options.singleTarget ? `Target ${arena.Model.getCardName(card)}` : `${reveal ? arena.Model.getCardName(card) : 'Face down card'}`;

        return `
            <${tagName} class="playing-card ${options.context}-card${kindClass}${backClass}${targetClass}${actionTargetClass}${userOptionClass}${userActiveClass}" ${targetAttributes} ${boardAttributes} ${handAttributes} aria-label="${ariaLabel}">
                ${renderCardContent(card, reveal)}
            </${tagName}>
        `;
    }

    function renderCardContent(card, reveal) {
        if (!reveal) {
            return `
                <div class="card-topline">Squish</div>
                <div class="card-body">?</div>
                <div class="card-footer">Back</div>
            `;
        }

        if (arena.Model.isPokemonCard(card)) {
            return renderPokemonCardContent(card);
        }

        if (arena.Model.isAttackCard(card)) {
            return renderActionCardContent(card, 'Attack');
        }

        return renderActionCardContent(card, 'Item');
    }

    function renderCardForAnimation(card, animationClass = 'attack-animation-card', reveal = true) {
        return `
            <div class="playing-card hand-card card-kind-${card.kind} ${animationClass}" aria-hidden="true">
                ${renderCardContent(card, reveal)}
            </div>
        `;
    }

    function renderPokemonCardContent(card) {
        const healthPercent = arena.Model.getHealthPercent(card);
        const species = card.pokemon;

        return `
            <div class="card-top">
                <div class="card-visual">
                    <div class="card-portrait" style="--portrait-hue: ${arena.Model.getPortraitHue(species.id)};">
                        <img class="portrait-img" src="${arena.Model.getPortraitUrl(card)}" alt="">
                        <span>${arena.Model.getPortraitInitials(card)}</span>
                    </div>
                    ${renderStatusTokens(card)}
                    <div class="type-row">${renderTypeIcons(species.types, 'type-row')}</div>
                    <span class="card-name">${species.name}</span>
                </div>
            </div>
            <div class="health-row" aria-label="${healthPercent}% health">
                <div class="health-track">
                    <span style="width: ${healthPercent}%"></span>
                </div>
                <span>${healthPercent}%</span>
            </div>
            <div class="stat-grid">
                <span>HP ${species.baseHealth}</span>
                ${renderStatCell(card, 'attack')}
                ${renderStatCell(card, 'defense')}
                ${renderStatCell(card, 'speed')}
            </div>
        `;
    }

    function renderStatusTokens(card) {
        const statuses = arena.Model.getPokemonStatuses(card);

        if (statuses.length === 0) return '';

        return `
            <div class="status-token-row" aria-label="Statuses: ${statuses.map(status => status.label).join(', ')}">
                ${statuses.map(status => `
                    <span class="status-token status-token--${status.status.toLowerCase()}" title="${status.label}">
                        <img src="${status.iconPath}" alt="${status.label}">
                    </span>
                `).join('')}
            </div>
        `;
    }

    function renderStatCell(card, stat) {
        const labels = {
            attack: 'ATK',
            defense: 'DEF',
            speed: 'SPD'
        };
        const stage = arena.Model.getPokemonStatStage(card, stat);
        const stageClass = stage > 0
            ? ' stat-cell--up'
            : stage < 0
                ? ' stat-cell--down'
                : '';
        const stageLabel = stage === 0
            ? ''
            : `<small class="${stage > 0 ? 'stage-up' : 'stage-down'}">${arena.Model.formatStatStage(stage)}</small>`;

        return `<span class="stat-cell${stageClass}">${labels[stat]} ${arena.Model.getPokemonEffectiveStat(card, stat)}${stageLabel ? ` ${stageLabel}` : ''}</span>`;
    }

    function renderActionCardContent(card, label) {
        const isAttack = arena.Model.isAttackCard(card);
        const types = arena.Model.getCardTypes(card);
        const target = formatTarget(arena.Model.getActionTarget(card));
        const note = formatActionNote(card);
        const allTypesRequired = isAttack && card.attack.full_type_requirements && types.length > 1;
        const typeRowClass = allTypesRequired ? ' action-type-row--all-required' : '';
        const typeRequirementLabel = allTypesRequired ? 'All listed types required' : 'Any listed type required';

        return `
            <div class="action-card-shell">
                <span class="action-card-kind">${label}</span>
                <span class="action-card-name">${arena.Model.getCardName(card)}</span>
                ${types.length > 0 ? `<div class="action-type-row${typeRowClass}" title="${typeRequirementLabel}" aria-label="${typeRequirementLabel}">${renderTypeIcons(types, 'action-type-row')}</div>` : '<div class="action-type-row action-type-row--empty">No type</div>'}
                <span class="action-card-meta">${target}</span>
                <span class="action-card-note">${note}</span>
            </div>
        `;
    }

    function formatActionNote(card) {
        const notes = [];
        const effects = formatEffects(card);

        if (effects !== 'No effect') {
            notes.push(effects);
        }

        return notes.length > 0 ? notes.join(' | ') : 'No effect';
    }

    function renderTypeIcons(types, className) {
        return types.slice(0, 3).map(type => `
            <img class="type-icon" src="assets/types-svgs/${type}.svg" alt="${type}">
        `).join('');
    }

    function renderStatus() {
        const player = state.players.player;
        const pendingActionCard = player.hand.find(card => card.id === state.pendingActionCardId);
        const selectedCard = player.hand.find(card => card.id === state.selectedCardId);
        const selectedText = renderSelectedText(pendingActionCard, selectedCard);
        const isOpeningPlacement = state.phase === 'opening-place';
        const canPlace = isOpeningPlacement
            ? Boolean(selectedCard) && arena.Model.isPokemonCard(selectedCard) && !player.board[0] && arena.Controller.canPlayerSelectCard()
            : arena.Controller.canPlaceSelectedCard();
        const canEnd = arena.Controller.canPlayerEndTurn();

        return `
            <section class="arena-status" aria-label="Turn controls">
                <span class="turn-pill">${renderTurnLabel()}</span>
                <div class="turn-copy">
                    <p>${renderTurnMessage()}</p>
                </div>
                <span class="selected-pill">${selectedText}</span>
                <div class="action-bar">
                    ${renderActionButtons(canPlace, canEnd)}
                </div>
                <ul class="event-log" aria-label="Recent events">
                    ${state.log.map(entry => `<li>${entry}</li>`).join('')}
                </ul>
            </section>
        `;
    }

    function renderTurnLabel() {
        if (state.finished) return 'Finished';
        if (state.phase === 'opening-place') return 'Opening';
        if (state.phase === 'selecting-attack-user') return 'User';
        if (state.phase === 'selecting-attack-target' || state.phase === 'selecting-item-target') return 'Target';
        if (state.phase === 'opponent-planning') return 'Rival';
        if (state.phase === 'resolving') return 'Resolve';
        return `Round ${state.turnNumber}`;
    }

    function renderTurnMessage() {
        if (state.finished) return 'Match finished.';
        if (state.phase === 'opening-place') {
            return state.isResolving ? 'Rival is placing an opening card.' : 'Choose your opening card.';
        }
        if (state.phase === 'selecting-attack-user') return 'Choose which Pokemon will use this attack.';
        if (state.phase === 'selecting-attack-target') return 'Drag the attack to a target or click a target.';
        if (state.phase === 'selecting-item-target') return 'Choose the item target.';
        if (state.phase === 'opponent-planning') return 'Rival is choosing attacks.';
        if (state.phase === 'resolving') return 'Attacks resolve by speed.';
        if (state.currentPlayer === 'opponent') return state.isResolving ? 'Rival is choosing.' : 'Rival turn.';
        if (state.isResolving) return 'Resolving action.';
        return 'Place Pokemon, use one item, and ready attacks.';
    }

    function renderActionButtons(canPlace, canEnd) {
        if (state.finished) {
            return '<button class="arena-button" type="button" data-action="reset">Restart</button>';
        }

        if (state.phase === 'opening-place') {
            return `
                <button class="arena-button" type="button" data-action="place" ${canPlace ? '' : 'disabled'}>Place Active</button>
            `;
        }

        if (['selecting-attack-user', 'selecting-attack-target', 'selecting-item-target'].includes(state.phase)) {
            return `
                <button class="arena-button" type="button" data-action="cancel-action">Cancel</button>
            `;
        }

        if (state.currentPlayer !== 'player') {
            return `
                <button class="arena-button" type="button" disabled>Place</button>
                <button class="arena-button arena-button--danger" type="button" disabled>End Turn</button>
            `;
        }

        return `
            <button class="arena-button" type="button" data-action="place" ${canPlace ? '' : 'disabled'}>Place</button>
            <button class="arena-button arena-button--danger" type="button" data-action="end-turn" ${canEnd ? '' : 'disabled'}>End Turn</button>
        `;
    }

    function renderSelectedText(pendingActionCard, selectedCard) {
        if (state.phase === 'selecting-attack-target' && pendingActionCard) {
            const userCard = arena.Model.getBoardCardById('player', state.pendingUserCardId);
            return `${arena.Model.getCardName(userCard)} using ${arena.Model.getCardName(pendingActionCard)}`;
        }

        if (pendingActionCard) return `Selected ${arena.Model.getCardName(pendingActionCard)}`;
        if (selectedCard) return `Selected ${arena.Model.getCardName(selectedCard)}`;

        return 'No card selected';
    }

    function isGroupTargetOption(playerId) {
        if (!isTargetingPhase()) return false;

        const pendingCard = arena.Model.findHandCard(state.players.player, state.pendingActionCardId);
        const targetOptions = pendingCard
            ? arena.Model.getTargetOptionsForAction(pendingCard, 'player', state.pendingUserCardId)
            : [];

        return arena.Model.targetOptionsIncludeGroup(targetOptions, playerId);
    }

    function isTargetingPhase() {
        return state.phase === 'selecting-attack-target' || state.phase === 'selecting-item-target';
    }

    function formatTarget(target) {
        const labels = {
            ALL_ALLIES: 'All allies',
            ALL_OPPONENTS: 'All opponents',
            ALLY: 'Ally',
            OPPONENT: 'Opponent',
            SELF: 'Self'
        };

        return labels[target] || 'No target';
    }

    function formatStatuses(statuses) {
        if (!statuses.length) return 'No effect';

        return statuses
            .map(status => status.toLowerCase().replace(/_/g, ' '))
            .join(', ');
    }

    function formatEffects(card) {
        const parts = [];
        const statuses = formatStatuses(arena.Model.getActionStatuses(card));
        const statChanges = formatStatChanges(arena.Model.getActionStatChanges(card));

        if (statuses !== 'No effect') parts.push(statuses);
        if (statChanges !== 'No effect') parts.push(statChanges);

        return parts.length > 0 ? parts.join(', ') : 'No effect';
    }

    function formatStatChanges(statChanges) {
        const labels = {
            ATTACK_DOWN: 'ATK -1',
            ATTACK_UP: 'ATK +1',
            DEFENSE_DOWN: 'DEF -1',
            DEFENSE_UP: 'DEF +1',
            SPEED_DOWN: 'SPD -1',
            SPEED_UP: 'SPD +1'
        };
        const formatted = statChanges.map(statChange => labels[statChange]).filter(Boolean);

        return formatted.length > 0 ? formatted.join(', ') : 'No effect';
    }

    arena.Render = {
        render,
        renderCardForAnimation
    };
})(window.CardArena = window.CardArena || {});
