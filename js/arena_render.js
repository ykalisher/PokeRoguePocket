/**
 * Squish - card arena rendering
 */

(function attachArenaRender(arena) {
    'use strict';

    const state = arena.state;
    const { SECOND_SLOT_INDEX } = arena.Constants;

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
                    </div>
                </header>
                ${handFirst}
                <div class="battle-row">
                    ${renderPile('Deck', player.deck.length, 'deck')}
                    <div class="played-slots" aria-label="${player.name} played Pokemon">
                        ${renderBoardSlot(player, 0)}
                        ${renderBoardSlot(player, 1)}
                    </div>
                    ${renderPile('Discard', player.discard.length, 'discard')}
                </div>
                ${handLast}
            </section>
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
        const isTargetable = canTargetBoardCard(player, card);

        return `
            <div class="board-slot" data-slot-owner="${player.id}" data-slot-index="${slotIndex}">
                ${card ? renderCard(card, { context: 'board', owner: player.id, reveal: card.faceUp, slotIndex, targetable: isTargetable }) : '<div class="empty-hand">Open</div>'}
            </div>
        `;
    }

    function canTargetBoardCard(player, card) {
        return Boolean(
            card &&
            player.id === 'opponent' &&
            state.phase === 'targeting-attack' &&
            state.pendingAttackCardId
        );
    }

    function renderHand(player) {
        const isOpponent = player.id === 'opponent';
        const cards = player.hand.map(card => {
            if (isOpponent) {
                return renderCard(card, { context: 'hand', reveal: false });
            }

            const selectedClass = state.selectedCardId === card.id || state.pendingAttackCardId === card.id ? ' is-selected' : '';

            return `
                <button class="playing-card hand-card${selectedClass}" type="button" data-card-id="${card.id}" aria-label="Select ${arena.Model.getCardName(card)}">
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

    function renderCard(card, options) {
        const reveal = options.reveal;
        const backClass = reveal ? '' : ' card-back';
        const targetClass = options.targetable ? ' is-targetable' : '';
        const tagName = options.targetable ? 'button' : 'div';
        const targetAttributes = options.targetable ? `type="button" data-target-card-id="${card.id}"` : '';
        const boardAttributes = options.context === 'board' ? `data-board-card-id="${card.id}" data-board-owner="${options.owner}" data-board-slot="${options.slotIndex}"` : '';
        const ariaLabel = options.targetable ? `Target ${arena.Model.getCardName(card)}` : `${reveal ? arena.Model.getCardName(card) : 'Face down card'}`;

        return `
            <${tagName} class="playing-card ${options.context}-card${backClass}${targetClass}" ${targetAttributes} ${boardAttributes} aria-label="${ariaLabel}">
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

        const healthPercent = arena.Model.getHealthPercent(card);
        const species = card.species;

        return `
            <div class="card-top">
                <div class="card-visual">
                    <div class="card-portrait" style="--portrait-hue: ${arena.Model.getPortraitHue(species.id)};">
                        <span>${species.portrait}</span>
                    </div>
                    <div class="type-row">${renderTypeIcons(species.types)}</div>
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
                <span>ATK ${species.baseAttack}</span>
                <span>DEF ${species.baseDefense}</span>
                <span>SPD ${species.baseSpeed}</span>
            </div>
        `;
    }

    function renderTypeIcons(types) {
        return types.slice(0, 3).map(type => `
            <img class="type-icon" src="assets/types-svgs/${type}.svg" alt="${type}">
        `).join('');
    }

    function renderStatus() {
        const player = state.players.player;
        const pendingAttackCard = player.hand.find(card => card.id === state.pendingAttackCardId);
        const selectedCard = player.hand.find(card => card.id === state.selectedCardId);
        const selectedText = pendingAttackCard ? `Attacking with ${pendingAttackCard.species.name}` : selectedCard ? `Selected ${selectedCard.species.name}` : 'No card selected';
        const isOpeningPlacement = state.phase === 'opening-place';
        const targetSlot = isOpeningPlacement ? 0 : SECOND_SLOT_INDEX;
        const canPlace = Boolean(selectedCard) && !player.board[targetSlot] && arena.Controller.canPlayerSelectCard();
        const canAttack = Boolean(selectedCard) && arena.Controller.canPlayerAttack();

        return `
            <section class="arena-status" aria-label="Turn controls">
                <span class="turn-pill">${renderTurnLabel()}</span>
                <div class="turn-copy">
                    <p>${renderTurnMessage()}</p>
                </div>
                <span class="selected-pill">${selectedText}</span>
                <div class="action-bar">
                    ${renderActionButtons(canAttack, canPlace)}
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
        if (state.phase === 'targeting-attack') return 'Target';
        return `Turn ${state.turnNumber}`;
    }

    function renderTurnMessage() {
        if (state.finished) return 'Both decks are empty.';
        if (state.phase === 'opening-place') {
            return state.isResolving ? 'Rival is placing an opening card.' : 'Choose your opening card.';
        }
        if (state.phase === 'targeting-attack') return 'Choose an opposing card to attack.';
        if (state.currentPlayer === 'opponent') return state.isResolving ? 'Opponent is choosing.' : 'Opponent turn.';
        if (state.isResolving) return 'Resolving action.';
        return 'Your turn.';
    }

    function renderActionButtons(canAttack, canPlace) {
        if (state.finished) {
            return '<button class="arena-button" type="button" data-action="reset">Restart</button>';
        }

        if (state.phase === 'opening-place') {
            return `
                <button class="arena-button" type="button" disabled>Attack</button>
                <button class="arena-button" type="button" data-action="place" ${canPlace ? '' : 'disabled'}>Place Active</button>
            `;
        }

        if (state.phase === 'targeting-attack') {
            return `
                <button class="arena-button" type="button" disabled>Attack</button>
                <button class="arena-button" type="button" disabled>Place</button>
                <button class="arena-button" type="button" data-action="cancel-attack">Cancel</button>
            `;
        }

        if (state.currentPlayer !== 'player') {
            return `
                <button class="arena-button" type="button" disabled>Attack</button>
                <button class="arena-button" type="button" disabled>Place</button>
            `;
        }

        return `
            <button class="arena-button arena-button--danger" type="button" data-action="attack" ${canAttack ? '' : 'disabled'}>Attack</button>
            <button class="arena-button" type="button" data-action="place" ${canPlace ? '' : 'disabled'}>Place</button>
        `;
    }

    arena.Render = {
        render
    };
})(window.CardArena = window.CardArena || {});
