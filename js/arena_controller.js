/**
 * Squish - game flow and player actions for the arena prototype
 */

(function attachArenaController(arena) {
    'use strict';

    const state = arena.state;
    const { SECOND_SLOT_INDEX } = arena.Constants;
    const model = arena.Model;
    const render = () => arena.Render.render();

    function resetPrototype() {
        clearTimeout(state.flowTimer);
        clearTimeout(state.popupTimer);
        state.elements.popup.hidden = true;

        state.currentPlayer = 'player';
        state.finished = false;
        state.isResolving = true;
        state.log = [];
        state.phase = 'opening-place';
        state.pendingAttackCardId = null;
        state.players = {
            opponent: model.createPlayer('opponent', 'Rival'),
            player: model.createPlayer('player', 'You')
        };
        state.selectedCardId = null;
        state.turnNumber = 0;

        model.drawOpeningHands();
        logEvent('Rival is placing an opening card.');
        render();

        state.flowTimer = setTimeout(runOpponentOpeningPlacement, 300);
    }

    async function runOpponentOpeningPlacement() {
        if (state.finished || state.phase !== 'opening-place') return;

        await animateOpponentMoveToSlot(0);

        if (state.finished || state.phase !== 'opening-place') return;

        model.placeOpeningCard(state.players.opponent);
        state.isResolving = false;
        logEvent('Rival placed an opening card face down.');
        logEvent('Choose your opening card.');
        render();
    }

    function startTurn(playerId) {
        if (checkGameOver()) return;

        const player = state.players[playerId];
        state.currentPlayer = playerId;
        state.isResolving = false;
        state.phase = 'turn';
        state.pendingAttackCardId = null;
        state.selectedCardId = null;
        state.turnNumber += 1;

        const drawnCard = model.drawCard(player);

        if (drawnCard) {
            logEvent(`${player.name} drew ${model.getCardName(drawnCard)}.`);
        } else {
            logEvent(`${player.name} could not draw.`);
        }

        render();

        if (checkGameOver()) return;

        if (playerId === 'opponent') {
            state.isResolving = true;
            render();
            clearTimeout(state.flowTimer);
            state.flowTimer = setTimeout(runOpponentTurn, 650);
            return;
        }

        if (!hasAvailablePlayerAction()) {
            state.isResolving = true;
            logEvent('You have no card available.');
            render();
            endTurnAfterDelay(520);
        }
    }

    function handleArenaClick(event) {
        if (state.suppressNextClick) {
            state.suppressNextClick = false;
            return;
        }

        const targetButton = event.target.closest('[data-target-card-id]');

        if (targetButton) {
            attackTargetCard(targetButton.dataset.targetCardId);
            return;
        }

        const cardButton = event.target.closest('[data-card-id]');

        if (cardButton) {
            selectPlayerCard(cardButton.dataset.cardId);
            return;
        }

        const actionButton = event.target.closest('[data-action]');

        if (!actionButton) return;

        const action = actionButton.dataset.action;

        if (action === 'attack') {
            attackWithSelectedCard();
        } else if (action === 'cancel-attack') {
            cancelAttackTargeting();
        } else if (action === 'place') {
            if (state.phase === 'opening-place') {
                placeSelectedOpeningCard();
            } else {
                placeSelectedCard();
            }
        } else if (action === 'reset') {
            resetPrototype();
        }
    }

    function selectPlayerCard(cardId) {
        if (!canPlayerSelectCard()) return;

        const player = state.players.player;
        const cardExists = player.hand.some(card => card.id === cardId);

        if (!cardExists) return;

        state.selectedCardId = state.selectedCardId === cardId ? null : cardId;
        render();
    }

    function placeSelectedOpeningCard() {
        if (!canPlayerSelectCard() || !state.selectedCardId) return;

        const player = state.players.player;

        if (player.board[0]) return;

        const card = model.removeCardFromHand(player, state.selectedCardId);

        if (!card) return;

        card.faceUp = false;
        player.board[0] = card;
        state.selectedCardId = null;
        state.isResolving = true;

        logEvent(`${player.name} placed ${model.getCardName(card)} face down.`);
        render();

        clearTimeout(state.flowTimer);
        state.flowTimer = setTimeout(() => {
            model.flipOpeningCards();
            logEvent('Opening cards flipped.');
            startTurn('player');
        }, 700);
    }

    function attackWithSelectedCard() {
        if (!canPlayerAttack() || !state.selectedCardId) return;

        const attackingCard = state.players.player.hand.find(card => card.id === state.selectedCardId);

        if (!attackingCard) return;

        state.pendingAttackCardId = state.selectedCardId;
        state.selectedCardId = null;
        state.phase = 'targeting-attack';

        logEvent(`Choose a target for ${model.getCardName(attackingCard)}.`);
        render();
    }

    function attackTargetCard(targetCardId) {
        if (state.phase !== 'targeting-attack' || !state.pendingAttackCardId) return;

        resolveAttack(state.pendingAttackCardId, targetCardId);
    }

    function attackWithDraggedCard(attackingCardId, targetCardId) {
        if (!canPlayerAttack()) return;

        resolveAttack(attackingCardId, targetCardId);
    }

    function resolveAttack(attackingCardId, targetCardId) {
        const targetCard = state.players.opponent.board.find(card => card && card.id === targetCardId);

        if (!targetCard) return;

        const player = state.players.player;
        const attackingCard = model.removeCardFromHand(player, attackingCardId);

        if (!attackingCard) {
            cancelAttackTargeting();
            return;
        }

        attackingCard.faceUp = true;
        player.discard.unshift(attackingCard);
        state.pendingAttackCardId = null;
        state.selectedCardId = null;
        state.isResolving = true;
        state.phase = 'turn';

        logEvent(`${player.name} attacked ${model.getCardName(targetCard)} with ${model.getCardName(attackingCard)}.`);
        showPopup(`${model.getCardName(attackingCard)} attacks ${model.getCardName(targetCard)}. No damage is resolved yet.`);
        render();
        endTurnAfterDelay(900);
    }

    function cancelAttackTargeting() {
        if (state.phase !== 'targeting-attack') return;

        state.selectedCardId = state.pendingAttackCardId;
        state.pendingAttackCardId = null;
        state.phase = 'turn';
        render();
    }

    function placeSelectedCard() {
        if (!canPlayerAct() || !state.selectedCardId) return;

        const player = state.players.player;

        if (player.board[SECOND_SLOT_INDEX]) return;

        const card = model.removeCardFromHand(player, state.selectedCardId);

        if (!card) return;

        card.faceUp = true;
        player.board[SECOND_SLOT_INDEX] = card;
        state.selectedCardId = null;
        state.isResolving = true;

        logEvent(`${player.name} placed ${model.getCardName(card)}.`);
        render();
        endTurnAfterDelay(520);
    }

    function canPlayerAct() {
        return state.currentPlayer === 'player' && state.phase === 'turn' && !state.finished && !state.isResolving;
    }

    function canPlayerAttack() {
        return canPlayerAct() && model.hasOpponentBoardTarget();
    }

    function canPlayerSelectCard() {
        const selectablePhase = state.phase === 'opening-place' || state.phase === 'turn';
        return state.currentPlayer === 'player' && selectablePhase && !state.finished && !state.isResolving;
    }

    function hasAvailablePlayerAction() {
        const player = state.players.player;

        if (!canPlayerAct() || player.hand.length === 0) return false;

        return !player.board[SECOND_SLOT_INDEX] || model.hasOpponentBoardTarget();
    }

    function canDropCardOnSlot(cardId, slotOwner, slotIndex) {
        if (slotOwner !== 'player' || !model.playerHasCardInHand(cardId)) return false;

        const player = state.players.player;

        if (state.phase === 'opening-place') {
            return canPlayerSelectCard() && slotIndex === 0 && !player.board[0];
        }

        return canPlayerAct() && slotIndex === SECOND_SLOT_INDEX && !player.board[SECOND_SLOT_INDEX];
    }

    function canDropCardOnOpponentCard(cardId, targetCardId) {
        const targetExists = state.players.opponent.board.some(card => card && card.id === targetCardId);

        return canPlayerAttack() && model.playerHasCardInHand(cardId) && targetExists;
    }

    async function runOpponentTurn() {
        if (state.finished || state.currentPlayer !== 'opponent') return;

        const opponent = state.players.opponent;
        const secondSlotOpen = !opponent.board[SECOND_SLOT_INDEX];

        if (secondSlotOpen && opponent.hand.length > 0) {
            await animateOpponentMoveToSlot(SECOND_SLOT_INDEX);

            if (state.finished || state.currentPlayer !== 'opponent') return;

            const card = opponent.hand.shift();
            card.faceUp = true;
            opponent.board[SECOND_SLOT_INDEX] = card;
            logEvent(`${opponent.name} placed ${model.getCardName(card)}.`);
            render();
            endTurnAfterDelay(650);
            return;
        }

        if (opponent.hand.length > 0) {
            const targetCard = chooseOpponentAttackTarget();
            await animateOpponentAttack(targetCard);

            if (state.finished || state.currentPlayer !== 'opponent') return;

            const card = opponent.hand.shift();
            card.faceUp = true;
            opponent.discard.unshift(card);
            logEvent(`${opponent.name} attacked ${targetCard ? model.getCardName(targetCard) : 'your side'} with ${model.getCardName(card)}.`);
            showPopup(`${opponent.name} attacks ${targetCard ? model.getCardName(targetCard) : 'your side'} with ${model.getCardName(card)}.`);
            render();
            endTurnAfterDelay(900);
            return;
        }

        logEvent(`${opponent.name} has no card available.`);
        render();
        endTurnAfterDelay(520);
    }

    function chooseOpponentAttackTarget() {
        return state.players.player.board.find(card => card) || null;
    }

    async function animateOpponentMoveToSlot(slotIndex) {
        const sourceElement = document.querySelector('.hand-row--opponent .playing-card');
        const targetElement = document.querySelector(`.side-panel--opponent [data-slot-index="${slotIndex}"]`);

        await animateOpponentCardMotion(sourceElement, targetElement, 'opponent-place');
    }

    async function animateOpponentAttack(targetCard) {
        const sourceElement = document.querySelector('.hand-row--opponent .playing-card');
        const targetElement = targetCard
            ? document.querySelector(`.side-panel--player [data-board-card-id="${targetCard.id}"]`)
            : document.querySelector('.side-panel--player .played-slots');

        await animateOpponentCardMotion(sourceElement, targetElement, 'opponent-attack');
    }

    async function animateOpponentCardMotion(sourceElement, targetElement, animationClass) {
        if (!sourceElement || !targetElement) {
            await model.sleep(260);
            return;
        }

        const sourceRect = sourceElement.getBoundingClientRect();
        const targetRect = targetElement.getBoundingClientRect();
        const ghost = sourceElement.cloneNode(true);
        const targetX = targetRect.left + (targetRect.width - sourceRect.width) / 2;
        const targetY = targetRect.top + (targetRect.height - sourceRect.height) / 2;

        ghost.classList.add('opponent-ghost', animationClass);
        ghost.style.width = `${sourceRect.width}px`;
        ghost.style.height = `${sourceRect.height}px`;
        ghost.style.left = `${sourceRect.left}px`;
        ghost.style.top = `${sourceRect.top}px`;
        document.body.appendChild(ghost);

        await model.sleep(30);
        ghost.style.left = `${targetX}px`;
        ghost.style.top = `${targetY}px`;

        await model.sleep(520);
        ghost.remove();
    }

    function endTurnAfterDelay(delay) {
        if (checkGameOver()) return;

        const nextPlayer = state.currentPlayer === 'player' ? 'opponent' : 'player';

        clearTimeout(state.flowTimer);
        state.flowTimer = setTimeout(() => {
            startTurn(nextPlayer);
        }, delay);
    }

    function checkGameOver() {
        if (state.finished) return true;

        const playerDeckEmpty = state.players.player.deck.length === 0;
        const opponentDeckEmpty = state.players.opponent.deck.length === 0;

        if (!playerDeckEmpty || !opponentDeckEmpty) return false;

        state.finished = true;
        state.isResolving = false;
        state.currentPlayer = null;
        state.phase = 'finished';
        state.pendingAttackCardId = null;
        state.selectedCardId = null;

        logEvent('Both decks are empty. Prototype run complete.');
        showPopup('Both decks are empty. Prototype run complete.');
        render();

        return true;
    }

    function showPopup(message) {
        const popup = state.elements.popup;

        popup.textContent = message;
        popup.hidden = false;

        clearTimeout(state.popupTimer);
        state.popupTimer = setTimeout(() => {
            popup.hidden = true;
        }, 1500);
    }

    function logEvent(message) {
        state.log.unshift(message);
        state.log = state.log.slice(0, 3);
    }

    arena.Controller = {
        attackWithDraggedCard,
        canDropCardOnOpponentCard,
        canDropCardOnSlot,
        canPlayerAct,
        canPlayerAttack,
        canPlayerSelectCard,
        cancelAttackTargeting,
        handleArenaClick,
        placeSelectedCard,
        placeSelectedOpeningCard,
        resetPrototype
    };
})(window.CardArena = window.CardArena || {});
