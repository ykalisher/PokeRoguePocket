/**
 * Squish - game flow and player actions for the arena prototype
 *
 * Battle flow:
 * 1. game.js calls arena.Data.loadGameData(), then either restores a saved
 *    battle through Model.restoreSavedBattleState() or starts fresh through
 *    Controller.resetPrototype().
 * 2. resetPrototype() builds both players, draws two opening Pokemon from each
 *    Pokemon deck into the board slots, animates them, then starts turn 1.
 * 3. startPlayerTurn() increments turnNumber, resets one-item-per-turn and
 *    pending action state, draws up to hand size, renders/saves, then allows input.
 * 4. During the player turn, handleArenaClick() and handleCardDrop() route hand
 *    cards into attack, item, and discard paths:
 *    - Attack cards select a valid allied Pokemon user, then select/drag to a
 *      legal target, then queue through queuePlayerAttack().
 *    - Item cards select/drag to a legal target and resolve immediately through
 *      usePendingItem() -> applyItemCard().
 *    - Unused hand cards can be discarded by button or by dragging to discard.
 * 5. endPlayerTurn() locks input, asks the opponent to act with runOpponentTurn(),
 *    then resolves all queued attacks with resolveQueuedAttacks().
 * 6. runOpponentTurn() refills the rival hand, queues attacks through
 *    chooseOpponentAttacks(), uses one item immediately through
 *    useOpponentItem() -> applyItemCard(), then discards unplayable cards.
 * 7. resolveQueuedAttacks() creates one action per queued attack, sorts them by
 *    priority, effective Speed, then random tie breaker, and resolves each live
 *    action with resolveQueuedAttack().
 * 8. resolveQueuedAttack() checks pre-attack blockers in order: Flinch, Sleep,
 *    Confusion, then Paralysis. If not blocked, missing single targets are
 *    retargeted when possible, Switch/heal/status-heal/damage/stat-change/status
 *    effects are applied, and the attack card is discarded.
 * 9. resolveEndOfTurnStatuses() applies Poison/Burn damage, ticks Sleep for
 *     sleeping Pokemon that did not already attempt to wake this turn, clears
 *     end-of-turn statuses such as Flinch/Protect/Fatigue, then checks game over.
 * 10. Any queued knockout replacements are revived/drawn and animated.
 * 11. If the battle is still active, startPlayerTurn() begins the next turn.
 *
 * Render/save boundary: call the local render() wrapper after state mutations
 * that should be visible and persisted. Animation helpers usually call
 * arena.Render directly only to create temporary card markup.
 */

(function attachArenaController(arena) {
    'use strict';

    const state = arena.state;
    const {
        BOARD_SLOT_COUNT,
        BURN_DAMAGE_PERCENT,
        CONFUSION_DAMAGE_PERCENT,
        CONFUSION_RECOVERY_CHANCE,
        CONFUSION_SELF_DAMAGE_CHANCE,
        DAMAGE_PERCENT,
        KNOCKOUT_LIMIT,
        MULTI_ATTACK_MAX_HITS,
        MULTI_ATTACK_MIN_HITS,
        MULTI_ATTACK_STAT_CHANGE_TRIGGER_CHANCE,
        PARALYSIS_SKIP_CHANCE,
        POISON_DAMAGE_PERCENT,
        SLEEP_GUARANTEED_WAKE_ATTEMPT,
        SLEEP_WAKE_CHANCE,
        STAT_CHANGE_TRIGGER_CHANCE,
        STATUS_TRIGGER_CHANCE
    } = arena.Constants;
    const model = arena.Model;
    const FOSSIL_REVIVAL_HEALTH_PERCENT = 0.6;
    const render = () => {
        arena.Render.render();
        model.saveBattleState();
    };

    /**
     * Starts a brand-new battle after the page decides not to restore saved state.
     * This is the only fresh-game entry point: it resets phase, hands, queues,
     * timers, logs, players, then auto-plays and animates each side's opening
     * Pokemon.
     */
    function resetPrototype() {
        clearTimeout(state.flowTimer);
        clearTimeout(state.popupTimer);
        model.clearSavedBattleState();
        state.elements.popup.hidden = true;

        state.currentPlayer = 'player';
        state.arrivingCardIds = [];
        state.finished = false;
        state.isResolving = true;
        state.log = [];
        state.phase = 'setup';
        state.itemUsed = { opponent: false, player: false };
        state.pendingActionCardId = null;
        state.pendingUserCardId = null;
        state.pendingPokemonReplacements = [];
        state.plannedActions = { opponent: [], player: [] };
        state.players = {
            opponent: model.createPlayer('opponent', 'Rival'),
            player: model.createPlayer('player', 'You')
        };
        state.rulesWindowOpen = false;
        state.selectedCardId = null;
        state.turnNumber = 0;

        const openingPlacements = model.playOpeningPokemon();

        markCardsArriving(openingPlacements.map(placement => placement.card));
        logEvent('Both sides drew their opening Pokemon.');
        render();

        state.flowTimer = setTimeout(() => runOpeningPokemonAnimations(openingPlacements), 240);
    }

    async function runOpeningPokemonAnimations(placements) {
        if (state.finished || state.phase !== 'setup') return;

        for (const placement of placements) {
            await animatePokemonEnterBoard(placement.ownerId, placement.card, 'pokemon-deck');
        }

        startPlayerTurn();
    }

    /**
     * Begins each player-controlled turn after setup or end-of-turn cleanup.
     * It advances turnNumber, clears pending/queued turn state, refills the
     * player's hand to its current hand size, then releases input unless the
     * game has ended.
     */
    async function startPlayerTurn() {
        if (checkGameOver()) return;
        if (await resolvePendingPokemonReplacements()) return;

        const player = state.players.player;
        state.currentPlayer = 'player';
        state.isResolving = true;
        state.phase = 'turn';
        state.itemUsed = { opponent: false, player: false };
        state.pendingActionCardId = null;
        state.pendingUserCardId = null;
        state.plannedActions = { opponent: [], player: [] };
        state.selectedCardId = null;
        state.turnNumber += 1;

        const drawnCards = model.drawCardsUpToHandSize(player);

        markCardsArriving(drawnCards);

        if (drawnCards.length > 0) {
            logEvent(`${player.name} drew ${drawnCards.length} ${drawnCards.length === 1 ? 'card' : 'cards'}.`);
        } else {
            logEvent(`${player.name} kept their hand.`);
        }

        render();

        for (const drawnCard of drawnCards) {
            await animateDrawCard('player', drawnCard);
        }

        state.isResolving = false;
        render();

        checkGameOver();
    }

    /**
     * Central click router for the rendered arena. The render layer exposes
     * data-* attributes, and this function translates those clicks into setup
     * placement, action selection, targeting, command buttons, or cancellation.
     */
    function handleArenaClick(event) {
        if (state.suppressNextClick) {
            state.suppressNextClick = false;

            if (!event.target.closest('[data-action]')) return;
        }

        const targetGroup = event.target.closest('[data-target-group-owner]');

        if (targetGroup && isTargetingPhase()) {
            chooseTargetGroup(targetGroup.dataset.targetGroupOwner);
            return;
        }

        const boardCard = event.target.closest('[data-board-card-id]');

        if (boardCard) {
            handleBoardCardClick(boardCard.dataset.boardOwner, boardCard.dataset.boardCardId);
            return;
        }

        const targetButton = event.target.closest('[data-target-card-id]');

        if (targetButton) {
            chooseTargetCard(targetButton.dataset.targetOwner, targetButton.dataset.targetCardId);
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

        if (action === 'cancel-action') {
            cancelActionSelection();
        } else if (action === 'close-rules') {
            closeRulesWindow();
        } else if (action === 'discard-selected') {
            discardSelectedPlayerCard();
        } else if (action === 'end-turn') {
            endPlayerTurn();
        } else if (action === 'place') {
            placeSelectedCard();
        } else if (action === 'reset') {
            resetPrototype();
        } else if (action === 'toggle-rules') {
            toggleRulesWindow();
        }
    }

    /**
     * Opens or closes the battle reference window without changing turn state.
     */
    function toggleRulesWindow() {
        state.rulesWindowOpen = !state.rulesWindowOpen;
        render();
    }

    /**
     * Closes the battle reference window from the floating window close button.
     */
    function closeRulesWindow() {
        if (!state.rulesWindowOpen) return;

        state.rulesWindowOpen = false;
        render();
    }

    /**
     * Handles hand-card selection during player turns. Pokemon cards are no
     * longer selectable because the Pokemon deck plays them automatically;
     * attacks move into user selection, and items move directly into targeting.
     */
    function selectPlayerCard(cardId) {
        if (!canPlayerSelectCard()) return;

        const player = state.players.player;
        const card = model.findHandCard(player, cardId);

        if (!card) return;

        if (model.isPokemonCard(card)) {
            showPopup('Pokemon are played automatically.');
            render();
            return;
        }

        if (model.isAttackCard(card)) {
            beginAttackUserSelection(cardId);
            return;
        }

        if (model.isItemCard(card)) {
            beginItemTargeting(cardId);
        }
    }

    /**
     * Starts the attack flow for a selected hand attack. This validates that at
     * least one active player Pokemon can use the attack before asking which
     * Pokemon should perform it.
     */
    function beginAttackUserSelection(cardId) {
        if (!canPlayerAct()) return;

        const attackCard = model.findHandCard(state.players.player, cardId);

        if (!model.isAttackCard(attackCard)) return;

        const users = getEligibleAttackUsers('player', attackCard);

        if (users.length === 0) {
            showPopup(`No active Pokemon can use ${model.getCardName(attackCard)}.`);
            state.selectedCardId = cardId;
            render();
            return;
        }

        state.pendingActionCardId = cardId;
        state.pendingUserCardId = null;
        state.selectedCardId = cardId;
        state.phase = 'selecting-attack-user';

        logEvent(`Choose a Pokemon to use ${model.getCardName(attackCard)}.`);
        render();
    }

    /**
     * Stores the Pokemon that will use the pending attack. Self-targeting
     * attacks can queue immediately; other attacks advance to target selection.
     */
    function chooseAttackUser(userCardId) {
        if (state.phase !== 'selecting-attack-user' || !state.pendingActionCardId) return;

        const attackCard = model.findHandCard(state.players.player, state.pendingActionCardId);
        const userCard = model.getBoardCardById('player', userCardId);
        const users = attackCard ? getEligibleAttackUsers('player', attackCard) : [];

        if (!userCard || !users.some(card => card.id === userCardId)) return;

        const targets = model.getTargetOptionsForAction(attackCard, 'player', userCardId);

        if (targets.length === 0) {
            showPopup(`${model.getCardName(attackCard)} has no valid target.`);
            cancelActionSelection();
            return;
        }

        state.pendingUserCardId = userCardId;

        if (isSelfTargetSelection(attackCard, targets, userCardId)) {
            queuePlayerAttack(targets[0]);
            return;
        }

        state.phase = 'selecting-attack-target';

        logEvent(`Choose a target for ${model.getCardName(attackCard)}.`);
        render();
    }

    /**
     * Starts the item flow for a selected hand item. Items resolve immediately
     * after target selection and are limited to one use per player turn.
     */
    function beginItemTargeting(cardId) {
        if (!canPlayerAct()) return;

        const itemCard = model.findHandCard(state.players.player, cardId);

        if (!model.isItemCard(itemCard)) return;

        if (state.itemUsed.player) {
            showPopup('You already used an item this turn.');
            state.selectedCardId = cardId;
            render();
            return;
        }

        const targets = model.getTargetOptionsForAction(itemCard, 'player', null);

        if (targets.length === 0) {
            showPopup(`${model.getCardName(itemCard)} has no valid target.`);
            state.selectedCardId = cardId;
            render();
            return;
        }

        state.pendingActionCardId = cardId;
        state.pendingUserCardId = null;
        state.selectedCardId = cardId;
        state.phase = 'selecting-item-target';

        logEvent(`Choose a target for ${model.getCardName(itemCard)}.`);
        render();
    }

    /**
     * Routes board-card clicks according to the current selection phase:
     * choose an attack user, choose an action target, or cancel stray clicks.
     */
    function handleBoardCardClick(owner, cardId) {
        if (state.phase === 'selecting-attack-user') {
            if (owner === 'player') chooseAttackUser(cardId);
            return;
        }

        if (isTargetingPhase()) {
            chooseTargetCard(owner, cardId);
        }
    }

    /**
     * Validates a clicked board card against the pending action's legal targets.
     * Group-target actions can be committed by clicking any card in that group.
     */
    function chooseTargetCard(owner, cardId) {
        if (!isTargetingPhase()) return;

        const options = getPendingTargetOptions();

        if (model.targetOptionsIncludeCard(options, owner, cardId)) {
            commitPendingTarget({ kind: 'single', owner, cardId });
            return;
        }

        if (model.targetOptionsIncludeGroup(options, owner)) {
            commitPendingTarget({ kind: 'group', owner });
        }
    }

    /**
     * Commits an all-allies or all-opponents target selected through a group
     * target affordance rendered on the side panel.
     */
    function chooseTargetGroup(owner) {
        if (!isTargetingPhase()) return;

        const options = getPendingTargetOptions();

        if (!model.targetOptionsIncludeGroup(options, owner)) return;

        commitPendingTarget({ kind: 'group', owner });
    }

    /**
     * Final target-selection switch: attacks are queued for end-of-turn
     * resolution, while items resolve immediately during the player turn.
     */
    function commitPendingTarget(selection) {
        if (state.phase === 'selecting-attack-target') {
            queuePlayerAttack(selection);
            return;
        }

        if (state.phase === 'selecting-item-target') {
            usePendingItem(selection);
        }
    }

    /**
     * Removes the pending attack from the player's hand and stores a planned
     * action. Queued attacks do not affect the board until resolveQueuedAttacks().
     */
    function queuePlayerAttack(selection) {
        return queuePlayerAttackForUser(state.pendingActionCardId, state.pendingUserCardId, selection);
    }

    /**
     * Shared final queue path for click-selected attacks and direct drag-to-target
     * attacks. It revalidates the user and target at drop time before moving the
     * attack card out of hand.
     */
    function queuePlayerAttackForUser(cardId, userCardId, selection) {
        const player = state.players.player;
        const queuedCard = model.findHandCard(player, cardId);
        const userCard = model.getBoardCardById('player', userCardId);
        const userCanQueue = queuedCard && userCard && (
            !model.hasQueuedAttack('player', userCard.id) &&
            model.pokemonCanUseAttack(userCard, queuedCard)
        );
        const targetOptions = userCanQueue
            ? model.getTargetOptionsForAction(queuedCard, 'player', userCard.id)
            : [];
        const targetAllowed = selection && (
            selection.kind === 'group'
                ? model.targetOptionsIncludeGroup(targetOptions, selection.owner)
                : model.targetOptionsIncludeCard(targetOptions, selection.owner, selection.cardId)
        );

        if (!queuedCard || !userCard || !userCanQueue || !targetAllowed) {
            cancelActionSelection();
            return false;
        }

        const attackCard = model.removeCardFromHand(player, cardId);

        attackCard.faceUp = true;
        state.plannedActions.player.push({
            card: attackCard,
            owner: 'player',
            selection: { ...selection },
            speed: model.getPokemonSpeed(userCard),
            userCardId: userCard.id
        });

        logEvent(`${model.getCardName(userCard)} readied ${model.getCardName(attackCard)}.`);
        clearPendingAction();
        state.phase = 'turn';
        render();

        return true;
    }

    function isSelfTargetSelection(attackCard, targets, userCardId) {
        return (
            model.getActionTarget(attackCard) === 'SELF' &&
            targets.length === 1 &&
            targets[0].kind === 'single' &&
            targets[0].owner === 'player' &&
            targets[0].cardId === userCardId
        );
    }

    /**
     * Resolves a player item after target selection. Items animate, apply their
     * effects immediately, move to discard, and mark the player's item use spent.
     */
    async function usePendingItem(selection) {
        const player = state.players.player;
        const sourceCenter = getHandCardCenter('player', state.pendingActionCardId);
        const targets = model.getCardsForTargetSelection(selection);
        const itemCard = model.removeCardFromHand(player, state.pendingActionCardId);

        if (!itemCard) {
            cancelActionSelection();
            return;
        }

        itemCard.faceUp = true;
        state.itemUsed.player = true;
        clearPendingAction();
        state.phase = 'turn';
        state.isResolving = true;
        render();

        const impactCenter = await animateItemCard(itemCard, sourceCenter, targets);

        await applyItemCard(itemCard, selection, 'player');
        render();
        await model.sleep(180);

        await animateDiscardCard('player', itemCard, impactCenter || sourceCenter);

        player.discard.unshift(itemCard);
        state.isResolving = false;
        render();
    }

    function discardSelectedPlayerCard() {
        const cardId = state.pendingActionCardId || state.selectedCardId;

        if (!cardId) return;

        discardPlayerHandCard(cardId);
    }

    async function discardPlayerHandCard(cardId) {
        if (!canPlayerDiscardHandCard(cardId)) return false;

        return discardHandCardFromHand('player', cardId, `${state.players.player.name} discarded`);
    }

    async function discardHandCardFromHand(ownerId, cardId, messagePrefix = null, options = {}) {
        const owner = state.players[ownerId];
        const sourceCenter = getHandCardCenter(ownerId, cardId) || getArenaCenter();
        const card = model.removeCardFromHand(owner, cardId);
        const shouldReleaseInput = options.releaseInput !== undefined
            ? options.releaseInput
            : ownerId === 'player';

        if (!card) return false;

        card.faceUp = true;
        clearPendingAction();
        state.phase = ownerId === 'player' && state.currentPlayer === 'player'
            ? 'turn'
            : state.phase;
        state.isResolving = true;
        render();

        await animateDiscardCard(ownerId, card, sourceCenter);

        owner.discard.unshift(card);

        if (messagePrefix) {
            logEvent(`${messagePrefix} ${model.getCardName(card)}.`);
        }

        state.isResolving = !shouldReleaseInput;
        render();

        return true;
    }

    function canPlayerDiscardHandCard(cardId) {
        if (state.currentPlayer !== 'player' || state.finished || state.isResolving) return false;
        if (!model.playerHasCardInHand(cardId)) return false;

        if (state.phase === 'turn') return true;

        return (
            ['selecting-attack-user', 'selecting-attack-target', 'selecting-item-target'].includes(state.phase) &&
            state.pendingActionCardId === cardId
        );
    }

    function canDiscardSelectedCard() {
        const cardId = state.pendingActionCardId || state.selectedCardId;

        return Boolean(cardId) && canPlayerDiscardHandCard(cardId);
    }

    /**
     * Leaves any attack-user, attack-target, or item-target phase and returns to
     * the normal player turn without moving cards.
     */
    function cancelActionSelection() {
        if (!['selecting-attack-user', 'selecting-attack-target', 'selecting-item-target'].includes(state.phase)) return;

        clearPendingAction();
        state.phase = 'turn';
        render();
    }

    function clearPendingAction() {
        state.pendingActionCardId = null;
        state.pendingUserCardId = null;
        state.selectedCardId = null;
    }

    /**
     * Legacy manual Pokemon placement path. Main battle flow now plays and
     * replaces Pokemon from the Pokemon deck automatically.
     */
    function placeSelectedCard(slotIndex = getFirstOpenSlot(state.players.player)) {
        if (!canPlayerAct() || !state.selectedCardId) return;

        const player = state.players.player;
        const selectedCard = model.findHandCard(player, state.selectedCardId);

        if (!model.isPokemonCard(selectedCard)) return;
        if (slotIndex < 0 || slotIndex >= BOARD_SLOT_COUNT || player.board[slotIndex]) return;

        const card = model.removeCardFromHand(player, state.selectedCardId);

        if (!card) return;

        card.faceUp = true;
        player.board[slotIndex] = card;
        state.selectedCardId = null;

        logEvent(`${player.name} placed ${model.getCardName(card)}.`);
        render();
    }

    /**
     * True only during the player's unlocked main-turn phase. Most mutating
     * player actions use this as their first guard.
     */
    function canPlayerAct() {
        return state.currentPlayer === 'player' && state.phase === 'turn' && !state.finished && !state.isResolving;
    }

    /**
     * True when the player can select cards in hand during a normal unlocked turn.
     */
    function canPlayerSelectCard() {
        const selectablePhase = state.phase === 'turn';
        return state.currentPlayer === 'player' && selectablePhase && !state.finished && !state.isResolving;
    }

    /**
     * Legacy manual-placement affordance. Pokemon no longer enter the main hand,
     * so this normally returns false in the two-deck arena flow.
     */
    function canPlaceSelectedCard() {
        if (!state.selectedCardId) return false;

        const player = state.players.player;
        const selectedCard = model.findHandCard(player, state.selectedCardId);

        return canPlayerAct() && model.isPokemonCard(selectedCard) && getFirstOpenSlot(player) !== -1;
    }

    /**
     * Prevents ending the turn while an active Pokemon still has a usable attack
     * in hand that has not been queued.
     */
    function canPlayerEndTurn() {
        return canPlayerAct() && getBlockingAttackers('player').length === 0;
    }

    /**
     * Allows the floating selected attack card to be dragged only while choosing
     * that attack's target.
     */
    function canDragPendingActionCard(cardId) {
        return (
            state.currentPlayer === 'player' &&
            state.phase === 'selecting-attack-target' &&
            !state.finished &&
            !state.isResolving &&
            state.pendingActionCardId === cardId &&
            Boolean(model.findHandCard(state.players.player, cardId))
        );
    }

    /**
     * Finds active Pokemon that still need an attack queued before that player
     * can finish planning.
     */
    function getBlockingAttackers(playerId) {
        const player = state.players[playerId];

        return model.getBoardCards(playerId).filter(card => (
            !model.hasQueuedAttack(playerId, card.id) &&
            model.hasUsableAttackInHand(player, card)
        ));
    }

    /**
     * Legacy drag guard for dropping a hand Pokemon into a board slot.
     */
    function canDropCardOnSlot(cardId, slotOwner, slotIndex) {
        if (slotOwner !== 'player' || !model.playerHasCardInHand(cardId)) return false;

        const player = state.players.player;
        const card = model.findHandCard(player, cardId);

        if (!model.isPokemonCard(card)) return false;

        return canPlayerAct() && slotIndex >= 0 && slotIndex < BOARD_SLOT_COUNT && !player.board[slotIndex];
    }

    function canDropCardOnDiscard(cardId, pileOwner) {
        return pileOwner === 'player' && canPlayerDiscardHandCard(cardId);
    }

    /**
     * Converts a hand-card drag over a board card into a semantic action:
     * choose attack user, target a card/group, or use an item on that card/group.
     */
    function getDropActionForBoardCard(cardId, boardOwner, boardCardId) {
        if (canDragPendingActionCard(cardId)) {
            const options = getPendingTargetOptions();

            if (model.targetOptionsIncludeCard(options, boardOwner, boardCardId)) {
                return { kind: 'target-card', owner: boardOwner, cardId: boardCardId };
            }

            if (model.targetOptionsIncludeGroup(options, boardOwner)) {
                return { kind: 'target-group', owner: boardOwner };
            }

            return null;
        }

        if (!canPlayerAct() || !model.playerHasCardInHand(cardId)) return null;

        const card = model.findHandCard(state.players.player, cardId);

        if (model.isAttackCard(card)) {
            const userCard = model.getBoardCardById(boardOwner, boardCardId);

            if (
                boardOwner === 'player' &&
                userCard &&
                getEligibleAttackUsers('player', card).some(pokemonCard => pokemonCard.id === boardCardId)
            ) {
                return { kind: 'attack-user', owner: boardOwner, userCardId: boardCardId };
            }

            const directAttackDrop = getDirectAttackDropForCardTarget(card, boardOwner, boardCardId);

            if (directAttackDrop) return directAttackDrop;
        }

        if (model.isItemCard(card) && !state.itemUsed.player) {
            const options = model.getTargetOptionsForAction(card, 'player', null);

            if (model.targetOptionsIncludeCard(options, boardOwner, boardCardId)) {
                return { kind: 'target-card', owner: boardOwner, cardId: boardCardId };
            }

            if (model.targetOptionsIncludeGroup(options, boardOwner)) {
                return { kind: 'target-group', owner: boardOwner };
            }
        }

        return null;
    }

    /**
     * Converts a drag over a side-level group target into a semantic target
     * action for pending attack cards or item cards.
     */
    function getDropActionForTargetGroup(cardId, groupOwner) {
        if (canDragPendingActionCard(cardId)) {
            const options = getPendingTargetOptions();

            if (!model.targetOptionsIncludeGroup(options, groupOwner)) return null;

            return { kind: 'target-group', owner: groupOwner };
        }

        if (!canPlayerAct() || !model.playerHasCardInHand(cardId)) return null;

        const card = model.findHandCard(state.players.player, cardId);

        if (model.isAttackCard(card)) {
            return getDirectAttackDropForGroupTarget(card, groupOwner);
        }

        if (!model.isItemCard(card) || state.itemUsed.player) return null;

        const options = model.getTargetOptionsForAction(card, 'player', null);

        if (!model.targetOptionsIncludeGroup(options, groupOwner)) return null;

        return { kind: 'target-group', owner: groupOwner };
    }

    function getDirectAttackDropForCardTarget(attackCard, targetOwner, targetCardId) {
        const userCard = getEligibleAttackUsers('player', attackCard).find(card => (
            model.targetOptionsIncludeCard(
                model.getTargetOptionsForAction(attackCard, 'player', card.id),
                targetOwner,
                targetCardId
            )
        ));

        if (!userCard) return null;

        return {
            kind: 'attack-target',
            selection: { kind: 'single', owner: targetOwner, cardId: targetCardId },
            userCardId: userCard.id
        };
    }

    function getDirectAttackDropForGroupTarget(attackCard, targetOwner) {
        const userCard = getEligibleAttackUsers('player', attackCard).find(card => (
            model.targetOptionsIncludeGroup(
                model.getTargetOptionsForAction(attackCard, 'player', card.id),
                targetOwner
            )
        ));

        if (!userCard) return null;

        return {
            kind: 'attack-target',
            selection: { kind: 'group', owner: targetOwner },
            userCardId: userCard.id
        };
    }

    /**
     * Receives the semantic drop candidate from arena_drag.js and forwards it
     * into the same placement/selection functions used by click handling.
     */
    function handleCardDrop(cardId, candidate) {
        if (!candidate) return;

        if (candidate.kind === 'slot') {
            state.selectedCardId = cardId;
            placeSelectedCard(candidate.slotIndex);
            return;
        }

        if (candidate.kind === 'discard') {
            discardPlayerHandCard(cardId);
            return;
        }

        if (candidate.kind === 'attack-user') {
            beginAttackUserSelection(cardId);
            chooseAttackUser(candidate.userCardId);
            return;
        }

        if (candidate.kind === 'attack-target') {
            queuePlayerAttackForUser(cardId, candidate.userCardId, candidate.selection);
            return;
        }

        if (candidate.kind === 'target-card') {
            if (canDragPendingActionCard(cardId)) {
                chooseTargetCard(candidate.owner, candidate.cardId);
                return;
            }

            beginItemTargeting(cardId);
            chooseTargetCard(candidate.owner, candidate.cardId);
            return;
        }

        if (candidate.kind === 'target-group') {
            if (canDragPendingActionCard(cardId)) {
                chooseTargetGroup(candidate.owner);
                return;
            }

            beginItemTargeting(cardId);
            chooseTargetGroup(candidate.owner);
        }
    }

    /**
     * Opponent planning phase called after the player ends their turn. The rival
     * refills to hand size, may use one item immediately, queues attacks,
     * discards unplayable cards according to next-turn options, then schedules
     * attack resolution.
     */
    async function runOpponentTurn() {
        if (state.finished || state.currentPlayer !== 'opponent') return;

        const opponent = state.players.opponent;
        const drawnCards = model.drawCardsUpToHandSize(opponent);

        markCardsArriving(drawnCards);

        if (drawnCards.length > 0) {
            logEvent(`${opponent.name} drew ${drawnCards.length} ${drawnCards.length === 1 ? 'card' : 'cards'}.`);
        } else {
            logEvent(`${opponent.name} kept their hand.`);
        }

        render();

        if (drawnCards.length > 0) {
            for (const drawnCard of drawnCards) {
                await animateDrawCard('opponent', drawnCard);
            }
        } else {
            await model.sleep(280);
        }

        await useOpponentItem();

        chooseOpponentAttacks();
        render();

        await discardOpponentCardsForNextTurn();

        clearTimeout(state.flowTimer);
        state.flowTimer = setTimeout(resolveQueuedAttacks, 720);
    }

    /**
     * Queues one legal attack for each opponent Pokemon that can attack with a
     * card in hand. The attack will resolve later with the player's queued moves.
     */
    function chooseOpponentAttacks() {
        const opponent = state.players.opponent;
        const attackers = model.getBoardCards('opponent');
        let chosenCount = 0;

        attackers.forEach(userCard => {
            const attackCard = opponent.hand.find(card => (
                model.isAttackCard(card) &&
                model.pokemonCanUseAttack(userCard, card) &&
                model.getTargetOptionsForAction(card, 'opponent', userCard.id).length > 0
            ));

            if (!attackCard) return;

            const selection = chooseOpponentTarget(attackCard, userCard);

            if (!selection) return;

            model.removeCardFromHand(opponent, attackCard.id);
            attackCard.faceUp = true;
            state.plannedActions.opponent.push({
                card: attackCard,
                owner: 'opponent',
                selection,
                speed: model.getPokemonSpeed(userCard),
                userCardId: userCard.id
            });
            chosenCount += 1;
            logEvent(`${opponent.name} readied ${model.getCardName(attackCard)}.`);
        });

        if (chosenCount === 0) {
            logEvent(`${opponent.name} readied no attacks.`);
        }
    }

    async function discardOpponentCardsForNextTurn() {
        const opponent = state.players.opponent;
        const playableCards = getPlayableNextTurnCards('opponent');
        const playableCount = Math.min(3, playableCards.length);
        const discardCount = Math.min(3 - playableCount, opponent.hand.length);

        if (discardCount <= 0) return;

        const playableIds = new Set(playableCards.map(card => card.id));
        const discardCards = opponent.hand
            .filter(card => !playableIds.has(card.id))
            .slice(0, discardCount);

        for (const card of discardCards) {
            if (state.finished || state.currentPlayer !== 'opponent') return;

            await discardHandCardFromHand('opponent', card.id, `${opponent.name} discarded`, { releaseInput: false });
            await model.sleep(120);
        }
    }

    function getPlayableNextTurnCards(playerId) {
        const player = state.players[playerId];
        const playableCards = [];
        const usedAttackers = new Set();
        let hasPlayableItem = false;

        player.hand.forEach(card => {
            if (model.isAttackCard(card)) {
                const userCard = model.getBoardCards(playerId).find(pokemonCard => (
                    !usedAttackers.has(pokemonCard.id) &&
                    model.pokemonCanUseAttack(pokemonCard, card) &&
                    model.getTargetOptionsForAction(card, playerId, pokemonCard.id).length > 0
                ));

                if (!userCard) return;

                usedAttackers.add(userCard.id);
                playableCards.push(card);
                return;
            }

            if (!hasPlayableItem && model.isItemCard(card) && model.getTargetOptionsForAction(card, playerId, null).length > 0) {
                hasPlayableItem = true;
                playableCards.push(card);
            }
        });

        return playableCards.slice(0, 3);
    }

    /**
     * Uses at most one opponent item during the opponent planning phase. Like
     * player items, these resolve immediately instead of being queued.
     */
    async function useOpponentItem() {
        if (state.itemUsed.opponent) return false;

        const opponent = state.players.opponent;
        const itemPlan = chooseOpponentItem();

        if (!itemPlan) return false;

        const sourceCenter = getHandCardCenter('opponent', itemPlan.card.id);
        const targets = model.getCardsForTargetSelection(itemPlan.selection);
        const itemCard = model.removeCardFromHand(opponent, itemPlan.card.id);

        if (!itemCard) return false;

        itemCard.faceUp = true;
        state.itemUsed.opponent = true;
        render();

        const impactCenter = await animateItemCard(itemCard, sourceCenter, targets);

        await applyItemCard(itemCard, itemPlan.selection, 'opponent');
        render();
        await model.sleep(180);

        await animateDiscardCard('opponent', itemCard, impactCenter || sourceCenter);

        opponent.discard.unshift(itemCard);
        render();
        await model.sleep(180);

        return true;
    }

    /**
     * Scans opponent item cards and returns the first item with a useful target.
     */
    function chooseOpponentItem() {
        const opponent = state.players.opponent;

        for (const itemCard of opponent.hand.filter(model.isItemCard)) {
            const selection = chooseOpponentItemTarget(itemCard);

            if (selection) return { card: itemCard, selection };
        }

        return null;
    }

    /**
     * Chooses an item target based on the item effect: healing/status recovery
     * favors allies, stat-up favors allies, stat-down/status favors the player.
     */
    function chooseOpponentItemTarget(itemCard) {
        const options = model.getTargetOptionsForAction(itemCard, 'opponent', null);

        if (options.length === 0) return null;

        const statuses = model.getActionStatuses(itemCard);
        const statChanges = model.getActionStatChanges(itemCard);

        if (statuses.includes('FULL_HEAL')) {
            return chooseRecoverableAllyTarget(options, 'opponent');
        }

        if (statuses.includes('HEAL')) {
            return chooseDamagedAllyTarget(options, 'opponent');
        }

        if (statuses.includes('HEAL_STATUS')) {
            return chooseStatusedAllyTarget(options, 'opponent');
        }

        if (statuses.includes('HEAL_BURN')) {
            return chooseStatusedAllyTarget(options, 'opponent', 'BURN');
        }

        if (statChanges.some(statChange => statChange.endsWith('_UP'))) {
            return chooseTargetOwnedBy(options, 'opponent');
        }

        if (statChanges.some(statChange => statChange.endsWith('_DOWN'))) {
            return chooseTargetOwnedBy(options, 'player');
        }

        if (getBattleStatuses(itemCard).length > 0) {
            return options[0];
        }

        return null;
    }

    /**
     * Opponent helper for healing items: choose the most damaged eligible ally,
     * falling back to a group target only when the group has damaged Pokemon.
     */
    function chooseDamagedAllyTarget(options, ownerId) {
        const damagedTargets = options
            .filter(option => option.kind === 'single' && option.owner === ownerId)
            .map(option => ({
                option,
                card: model.getBoardCardById(option.owner, option.cardId)
            }))
            .filter(target => target.card && target.card.currentHealth < target.card.pokemon.baseHealth)
            .sort((left, right) => left.card.currentHealth - right.card.currentHealth);

        if (damagedTargets.length > 0) return damagedTargets[0].option;

        const groupTarget = options.find(option => (
            option.kind === 'group' &&
            option.owner === ownerId &&
            model.getBoardCards(ownerId).some(card => card.currentHealth < card.pokemon.baseHealth)
        ));

        return groupTarget || null;
    }

    /**
     * Opponent helper for full recovery effects: prefer allies missing HP or
     * carrying a status, weighted by missing HP plus status presence.
     */
    function chooseRecoverableAllyTarget(options, ownerId) {
        const recoverableTargets = options
            .filter(option => option.kind === 'single' && option.owner === ownerId)
            .map(option => ({
                option,
                card: model.getBoardCardById(option.owner, option.cardId)
            }))
            .filter(target => target.card && (
                target.card.currentHealth < target.card.pokemon.baseHealth ||
                model.getPokemonStatuses(target.card).length > 0
            ))
            .sort((left, right) => getRecoveryTargetScore(right.card) - getRecoveryTargetScore(left.card));

        if (recoverableTargets.length > 0) return recoverableTargets[0].option;

        const groupTarget = options.find(option => (
            option.kind === 'group' &&
            option.owner === ownerId &&
            model.getBoardCards(ownerId).some(card => (
                card.currentHealth < card.pokemon.baseHealth ||
                model.getPokemonStatuses(card).length > 0
            ))
        ));

        return groupTarget || null;
    }

    function getRecoveryTargetScore(card) {
        const missingHealth = Math.max(0, card.pokemon.baseHealth - card.currentHealth);
        const hasStatus = model.getPokemonStatuses(card).length > 0 ? card.pokemon.baseHealth : 0;

        return missingHealth + hasStatus;
    }

    /**
     * Opponent helper for status-clearing items: choose an ally with any status,
     * or with a specific status when one is supplied.
     */
    function chooseStatusedAllyTarget(options, ownerId, status = null) {
        const hasStatus = card => status
            ? model.hasPokemonStatus(card, status)
            : model.getPokemonStatuses(card).length > 0;
        const statusedTargets = options
            .filter(option => option.kind === 'single' && option.owner === ownerId)
            .map(option => ({
                option,
                card: model.getBoardCardById(option.owner, option.cardId)
            }))
            .filter(target => target.card && hasStatus(target.card));

        if (statusedTargets.length > 0) return statusedTargets[0].option;

        const groupTarget = options.find(option => (
            option.kind === 'group' &&
            option.owner === ownerId &&
            model.getBoardCards(ownerId).some(hasStatus)
        ));

        return groupTarget || null;
    }

    function chooseTargetOwnedBy(options, ownerId) {
        return options.find(option => option.owner === ownerId) || null;
    }

    /**
     * Chooses attack targets for opponent queued attacks, preferring player
     * group targets, then player single targets, then the first legal fallback.
     */
    function chooseOpponentTarget(attackCard, userCard) {
        const options = model.getTargetOptionsForAction(attackCard, 'opponent', userCard.id);
        const preferredGroup = options.find(option => option.kind === 'group' && option.owner === 'player');
        const preferredSingle = options.find(option => option.kind === 'single' && option.owner === 'player');
        const fallback = options[0];

        return preferredGroup || preferredSingle || fallback || null;
    }

    async function animateOpponentMoveToSlot(slotIndex) {
        const sourceElement = document.querySelector('.hand-row--opponent .playing-card');
        const targetElement = document.querySelector(`.side-panel--opponent [data-slot-index="${slotIndex}"]`);

        await animateOpponentCardMotion(sourceElement, targetElement, 'opponent-place');
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

    /**
     * Locks player input and hands control to the opponent. This is triggered by
     * the End Turn button after all required player attacks have been queued.
     */
    function endPlayerTurn() {
        if (!canPlayerEndTurn()) return;

        if (checkGameOver()) return;

        const skippedAttackers = model.getBoardCards('player').filter(card => (
            !model.hasQueuedAttack('player', card.id) &&
            !model.hasUsableAttackInHand(state.players.player, card)
        ));

        skippedAttackers.forEach(card => {
            logEvent(`${model.getCardName(card)} has no usable attack.`);
        });

        state.currentPlayer = 'opponent';
        state.isResolving = true;
        state.phase = 'opponent-planning';
        clearPendingAction();
        render();

        clearTimeout(state.flowTimer);
        state.flowTimer = setTimeout(runOpponentTurn, 650);
    }

    /**
     * Resolves all player and opponent queued attacks after opponent planning.
     * Actions are re-sorted before each attack because Speed/status can change
     * during resolution. End-of-turn statuses run after the queue empties.
     */
    async function resolveQueuedAttacks() {
        if (checkGameOver()) return;

        state.currentPlayer = null;
        state.isResolving = true;
        state.phase = 'resolving';
        render();

        const actions = createResolutionActions();

        if (actions.length === 0) {
            logEvent('No attacks were chosen.');
            render();
            await model.sleep(650);
        } else {
            while (actions.length > 0) {
                if (checkGameOver()) return;

                sortResolutionActions(actions);

                const action = actions.shift();

                await resolveQueuedAttack(action);
                render();

                if (checkGameOver()) return;

                await model.sleep(180);
            }
        }

        state.plannedActions = { opponent: [], player: [] };

        if (await resolveEndOfTurnStatuses()) return;

        if (checkGameOver()) return;

        if (await resolvePendingPokemonReplacements()) return;

        if (checkGameOver()) return;

        clearTimeout(state.flowTimer);
        state.flowTimer = setTimeout(startPlayerTurn, 620);
    }

    /**
     * Builds the mutable resolution queue from both players' plannedActions and
     * adds priority, current Speed, and a random tie breaker.
     */
    function createResolutionActions() {
        return [
            ...state.plannedActions.player,
            ...state.plannedActions.opponent
        ].map(action => ({
            ...action,
            priority: getActionPriority(action),
            speed: getActionSpeed(action),
            tieBreaker: Math.random()
        }));
    }

    /**
     * Recomputes priority and Speed for unresolved actions, then orders highest
     * priority first, highest Speed second, random tie breaker last.
     */
    function sortResolutionActions(actions) {
        actions.forEach(action => {
            action.priority = getActionPriority(action);
            action.speed = getActionSpeed(action);
        });

        actions.sort(compareResolutionActions);
    }

    function compareResolutionActions(left, right) {
        return (
            right.priority - left.priority ||
            right.speed - left.speed ||
            left.tieBreaker - right.tieBreaker
        );
    }

    function getActionSpeed(action) {
        const attacker = model.getBoardCardById(action.owner, action.userCardId);

        return attacker ? model.getPokemonSpeed(attacker) : -1;
    }

    function getActionPriority(action) {
        return model.getActionStatuses(action.card).includes('PROTECT') ? 1 : 0;
    }

    /**
     * Runs before an attack can fire. Blocking checks happen in this order:
     * Flinch, Sleep, Confusion, then Paralysis.
     */
    async function resolvePreAttackStatuses(action, attacker) {
        const flinchReason = getFlinchBlockReason(attacker);

        if (flinchReason) return flinchReason;

        const sleepResult = resolveSleepAttempt(attacker);

        if (sleepResult.blocked || sleepResult.changed) {
            render();
        }

        if (sleepResult.blocked) return sleepResult;

        const confusionResult = await resolveConfusionAttempt(action.owner, attacker);

        if (confusionResult.blocked) return confusionResult;

        return getParalysisBlockReason(attacker) || confusionResult;
    }

    function getFlinchBlockReason(attacker) {
        if (model.hasPokemonStatus(attacker, 'FLINCH')) {
            return {
                blocked: true,
                message: `${model.getCardName(attacker)} flinched and could not attack.`,
                popup: `${model.getCardName(attacker)} flinched.`
            };
        }

        return null;
    }

    function getParalysisBlockReason(attacker) {
        if (model.hasPokemonStatus(attacker, 'PARALYSIS') && Math.random() < PARALYSIS_SKIP_CHANCE) {
            return {
                blocked: true,
                message: `${model.getCardName(attacker)} is paralyzed and could not attack.`,
                popup: `${model.getCardName(attacker)} is paralyzed.`
            };
        }

        return null;
    }

    /**
     * Handles a sleeping attacker's wake attempt. The first attempt fails,
     * attempts 2-3 can wake, and attempt 4 always wakes.
     */
    function resolveSleepAttempt(attacker) {
        const sleepStatus = model.getPokemonStatusEntry(attacker, 'SLEEP');

        if (!sleepStatus) return { blocked: false };

        sleepStatus.wakeAttempts = (Number(sleepStatus.wakeAttempts) || 0) + 1;
        sleepStatus.lastWakeAttemptTurn = state.turnNumber;

        const canWake = sleepStatus.wakeAttempts > 1;
        const mustWake = sleepStatus.wakeAttempts >= SLEEP_GUARANTEED_WAKE_ATTEMPT;
        const wokeUp = mustWake || (canWake && Math.random() < SLEEP_WAKE_CHANCE);

        if (wokeUp) {
            model.removePokemonStatus(attacker, 'SLEEP');
            logEvent(`${model.getCardName(attacker)} woke up.`);
            return { blocked: false, changed: true };
        }

        logEvent(sleepStatus.wakeAttempts === 1
            ? `${model.getCardName(attacker)} is fast asleep.`
            : `${model.getCardName(attacker)} is still asleep.`
        );
        showPopup(`${model.getCardName(attacker)} is asleep.`);

        return { blocked: true, changed: true };
    }

    /**
     * Runs during end-of-turn cleanup for sleeping Pokemon that did not try to
     * attack this turn, so Sleep still progresses even without a queued action.
     */
    function tickSleepTimersWithoutAttack() {
        const results = [];

        ['player', 'opponent'].forEach(ownerId => {
            model.getBoardCards(ownerId).forEach(pokemonCard => {
                const sleepStatus = model.getPokemonStatusEntry(pokemonCard, 'SLEEP');

                if (!sleepStatus || pokemonCard.currentHealth <= 0 || sleepStatus.lastWakeAttemptTurn === state.turnNumber) return;

                sleepStatus.wakeAttempts = (Number(sleepStatus.wakeAttempts) || 0) + 1;
                sleepStatus.lastWakeAttemptTurn = state.turnNumber;

                const canWake = sleepStatus.wakeAttempts > 1;
                const mustWake = sleepStatus.wakeAttempts >= SLEEP_GUARANTEED_WAKE_ATTEMPT;
                const wokeUp = mustWake || (canWake && Math.random() < SLEEP_WAKE_CHANCE);

                if (wokeUp) {
                    model.removePokemonStatus(pokemonCard, 'SLEEP');
                    logEvent(`${model.getCardName(pokemonCard)} woke up.`);
                } else {
                    logEvent(sleepStatus.wakeAttempts === 1
                        ? `${model.getCardName(pokemonCard)} is fast asleep.`
                        : `${model.getCardName(pokemonCard)} is still asleep.`
                    );
                }

                results.push({ card: pokemonCard, ownerId, wokeUp });
            });
        });

        return results;
    }

    /**
     * Handles confusion before an attack: first try to recover, otherwise either
     * fight through or take self-damage and lose the queued attack.
     */
    async function resolveConfusionAttempt(ownerId, attacker) {
        if (!model.hasPokemonStatus(attacker, 'CONFUSION')) return { blocked: false };

        if (Math.random() < CONFUSION_RECOVERY_CHANCE) {
            model.removePokemonStatus(attacker, 'CONFUSION');
            logEvent(`${model.getCardName(attacker)} snapped out of confusion.`);
            render();
            await model.sleep(180);
            return { blocked: false, changed: true };
        }

        if (Math.random() >= CONFUSION_SELF_DAMAGE_CHANCE) {
            logEvent(`${model.getCardName(attacker)} fought through confusion.`);
            return { blocked: false };
        }

        const damageResult = damagePokemonByStatus(ownerId, attacker, CONFUSION_DAMAGE_PERCENT, 'confusion');

        render();
        showDamageNumbers([damageResult]);
        showPopup(damageResult && damageResult.damage > 0
            ? `${model.getCardName(attacker)} hurt itself in confusion.`
            : `${model.getCardName(attacker)} is confused.`
        );

        if (damageResult && damageResult.damage > 0) {
            await model.sleep(560);
        } else {
            await model.sleep(220);
        }

        const pokemonCard = model.getBoardCardById(ownerId, attacker.id);

        if (pokemonCard && pokemonCard.currentHealth === 0) {
            knockOutPokemon(ownerId, pokemonCard);
            render();
        }

        return { blocked: true, changed: true };
    }

    /**
     * Converts a queued target selection into live card targets. If a single
     * target disappeared before this attack resolves, it tries one legal
     * single-target fallback. Group targets naturally re-read the current board,
     * so they still hit whichever targets remain active.
     */
    function resolveActionTargets(action, attacker) {
        const currentTargets = model.getCardsForTargetSelection(action.selection);

        if (currentTargets.length > 0 || !action.selection || action.selection.kind !== 'single') {
            return {
                retargeted: false,
                targets: currentTargets
            };
        }

        const fallbackSelection = model.getTargetOptionsForAction(action.card, action.owner, attacker.id)
            .find(option => option.kind === 'single' && option.cardId !== action.selection.cardId);

        if (!fallbackSelection) {
            return {
                retargeted: false,
                targets: []
            };
        }

        return {
            retargeted: true,
            targets: model.getCardsForTargetSelection(fallbackSelection)
        };
    }

    /**
     * Resolves one queued attack from pre-attack checks through effects and
     * discard. This is the main combat effect pipeline for attack cards.
     */
    async function resolveQueuedAttack(action) {
        const attacker = model.getBoardCardById(action.owner, action.userCardId);

        if (!attacker) {
            await discardActionCard(action);
            logEvent(`${model.getCardName(action.card)} could not be used.`);
            return;
        }

        const attackBlockReason = await resolvePreAttackStatuses(action, attacker);

        if (attackBlockReason.blocked) {
            await discardActionCard(action);
            if (attackBlockReason.message) logEvent(attackBlockReason.message);
            if (attackBlockReason.popup) showPopup(attackBlockReason.popup);
            return;
        }

        const targetResolution = resolveActionTargets(action, attacker);
        const targets = targetResolution.targets;

        if (targets.length === 0) {
            await discardActionCard(action);
            logEvent(`${model.getCardName(attacker)} used ${model.getCardName(action.card)}, but there was no target.`);
            return;
        }

        if (targetResolution.retargeted) {
            logEvent(`${model.getCardName(action.card)} changed target to ${model.getCardName(targets[0].card)}.`);
        }

        const statuses = model.getActionStatuses(action.card);
        const statChanges = model.getActionStatChanges(action.card);
        const isDamaging = isDamagingAttack(action.card);
        const isMultiAttack = statuses.includes('MULTI_ATTACK');
        let handledEffect = false;

        showPopup(`${model.getCardName(attacker)} used ${model.getCardName(action.card)}.`);
        const impactCenter = isSelfTargetResolution(action, targets, attacker)
            ? getBoardCardCenter(action.owner, attacker.id)
            : await animateAttackCard(action, targets);

        if (statuses.includes('SWITCH')) {
            for (const target of targets) {
                await switchPokemon(target.owner, target.card);
            }
            handledEffect = true;
        } else {
            if (hasHealthHealing(statuses)) {
                targets.forEach(target => healPokemon(target.card));
                handledEffect = true;
            }

            handledEffect = applyStatusHealingEffects(statuses, targets) || handledEffect;

            if (isDamaging) {
                if (isMultiAttack) {
                    await resolveMultiAttackDamage(action.card, targets, attacker);
                } else {
                    const damageResults = targets.map(target => damagePokemon(target.owner, target.card, attacker, action.card));

                    showDamageNumbers(damageResults);
                    await model.sleep(560);
                }
                handledEffect = true;
            }

            handledEffect = maybeApplyAttackStatChanges(
                action.card,
                getStatChangeTargets(action, attacker, targets),
                isDamaging,
                isMultiAttack ? MULTI_ATTACK_STAT_CHANGE_TRIGGER_CHANCE : STAT_CHANGE_TRIGGER_CHANCE
            ) || handledEffect;
            handledEffect = maybeApplyAttackStatuses(action.card, targets, isDamaging) || handledEffect;
        }

        if (!handledEffect && statChanges.length === 0) {
            logEvent(`${model.getCardName(action.card)} had no effect.`);
        }

        await discardActionCard(action, impactCenter);
    }

    function isSelfTargetResolution(action, targets, attacker) {
        return (
            model.getActionTarget(action.card) === 'SELF' &&
            targets.length === 1 &&
            targets[0].owner === action.owner &&
            targets[0].card === attacker
        );
    }

    async function animateAttackCard(action, targets) {
        const sourceElement = getBoardCardElement(action.owner, action.userCardId);
        const targetElements = targets
            .map(target => getBoardCardElement(target.owner, target.card.id))
            .filter(Boolean);

        if (!sourceElement || targetElements.length === 0) {
            await model.sleep(280);
            return null;
        }

        const template = document.createElement('template');

        template.innerHTML = arena.Render.renderCardForAnimation(action.card).trim();

        const ghost = template.content.firstElementChild;

        if (!ghost) {
            await model.sleep(280);
            return null;
        }

        document.body.appendChild(ghost);

        const sourceCenter = getElementCenter(sourceElement);
        const middleCenter = getArenaCenter();
        const targetCenter = getElementsCenter(targetElements);

        placeAnimationElement(ghost, sourceCenter);
        ghost.classList.add('is-attack-windup');

        await model.sleep(40);
        ghost.classList.add('is-attack-moving');
        placeAnimationElement(ghost, middleCenter);

        await model.sleep(360);
        ghost.classList.add('is-attack-impact');
        placeAnimationElement(ghost, targetCenter);

        await model.sleep(430);
        ghost.remove();

        return targetCenter;
    }

    async function animateItemCard(itemCard, sourceCenter, targets) {
        const targetElements = targets
            .map(target => getBoardCardElement(target.owner, target.card.id))
            .filter(Boolean);

        if (!sourceCenter || targetElements.length === 0) {
            await model.sleep(280);
            return null;
        }

        const ghost = createCardAnimationElement(itemCard, 'attack-animation-card item-animation-card', true);

        if (!ghost) {
            await model.sleep(280);
            return null;
        }

        document.body.appendChild(ghost);

        const middleCenter = getArenaCenter();
        const targetCenter = getElementsCenter(targetElements);

        placeAnimationElement(ghost, sourceCenter);
        ghost.classList.add('is-attack-windup');

        await model.sleep(40);
        ghost.classList.add('is-attack-moving');
        placeAnimationElement(ghost, middleCenter);

        await model.sleep(300);
        ghost.classList.add('is-attack-impact');
        placeAnimationElement(ghost, targetCenter);

        await model.sleep(360);
        ghost.remove();

        return targetCenter;
    }

    /**
     * Applies an item's actual effects after the player/opponent item animation.
     * Items share the same healing, status, stat, switch, and targeting helpers
     * as attacks, but they are never placed in the queued attack resolver.
     */
    async function applyItemCard(itemCard, selection, actorId) {
        const targets = model.getCardsForTargetSelection(selection);
        const statuses = model.getActionStatuses(itemCard);
        const statChanges = model.getActionStatChanges(itemCard);
        let didSomething = false;

        if (statuses.includes('SWITCH')) {
            for (const target of targets) {
                await switchPokemon(target.owner, target.card);
            }
            didSomething = true;
        }

        if (hasHealthHealing(statuses)) {
            targets.forEach(target => healPokemon(target.card));
            didSomething = true;
        }

        didSomething = applyStatusHealingEffects(statuses, targets) || didSomething;

        if (statChanges.length > 0) {
            applyStatChangesToTargets(statChanges, targets);
            didSomething = true;
        }

        if (applyStatusesToTargets(getBattleStatuses(itemCard), targets)) {
            didSomething = true;
        }

        logEvent(`${state.players[actorId].name} used ${model.getCardName(itemCard)}.`);
        showPopup(didSomething
            ? `${model.getCardName(itemCard)} took effect.`
            : `${model.getCardName(itemCard)} had no immediate effect.`
        );
    }

    /**
     * Applies direct attack damage. It checks Protect first, chooses the damage
     * stat based on attack type rules, applies stat/status multipliers unless
     * the attack is ICE, then knocks out the target at 0 HP.
     */
    function damagePokemon(ownerId, pokemonCard, attackerCard, actionCard) {
        if (isProtectedFromDamage(pokemonCard)) {
            logEvent(`${model.getCardName(pokemonCard)} was protected from damage.`);
            return {
                cardId: pokemonCard.id,
                damage: 0,
                damagePercent: 0,
                ownerId
            };
        }

        const attackerDamageStat = attackUsesDefenseAsDamageStat(actionCard) ? 'defense' : 'attack';
        let attackerAttack;
        let targetDefense;

        if (attackUsesBaseStatsOnly(actionCard)) {
            attackerAttack = getPokemonBaseStat(attackerCard, attackerDamageStat);
            targetDefense = getPokemonBaseStat(pokemonCard, 'defense');
        } else {
            attackerAttack = getBattleStat(attackerCard, attackerDamageStat);
            targetDefense = getBattleStat(pokemonCard, 'defense');
        }

        const attackBaseDamage = Number(actionCard.attack.basePower) || 0;
        const statRatio = targetDefense > 0 ? attackerAttack / targetDefense : attackerAttack;
        const damage = Math.max(1, Math.ceil(statRatio * attackBaseDamage * getDamageVarianceMultiplier()));
        const damagePercent = Math.ceil((damage / pokemonCard.pokemon.baseHealth) * 100);

        pokemonCard.currentHealth = Math.max(0, pokemonCard.currentHealth - damage);
        logEvent(`${model.getCardName(pokemonCard)} took ${damage} damage.`);

        if (pokemonCard.currentHealth === 0) {
            knockOutPokemon(ownerId, pokemonCard);
        }

        return {
            cardId: pokemonCard.id,
            damage,
            damagePercent,
            ownerId
        };
    }

    function getBattleStatMultiplier(pokemonCard, stat) {
        return model.getPokemonStatMultiplier(pokemonCard, stat) * model.getPokemonStatusMultiplier(pokemonCard, stat);
    }

    function getBattleStat(pokemonCard, stat) {
        return Math.max(1, Math.round(getPokemonBaseStat(pokemonCard, stat) * getBattleStatMultiplier(pokemonCard, stat)));
    }

    function getPokemonBaseStat(pokemonCard, stat) {
        const baseStatKeys = {
            attack: 'baseAttack',
            defense: 'baseDefense',
            speed: 'baseSpeed'
        };
        const baseStatKey = baseStatKeys[stat];

        if (!model.isPokemonCard(pokemonCard) || !baseStatKey) return 0;

        return Math.max(1, Number(pokemonCard.pokemon[baseStatKey]) || 0);
    }

    function getDamageVarianceMultiplier() {
        return 0.95 + (Math.random() * 0.1);
    }

    function attackUsesBaseStatsOnly(actionCard) {
        return model.isAttackCard(actionCard) && model.getCardTypes(actionCard).includes('ICE');
    }

    function attackUsesDefenseAsDamageStat(actionCard) {
        return model.isAttackCard(actionCard) && model.getCardTypes(actionCard).includes('STEEL');
    }

    function isProtectedFromDamage(pokemonCard) {
        return model.hasPokemonStatus(pokemonCard, 'PROTECT');
    }

    /**
     * Applies fixed-percent status damage from Poison, Burn, or Confusion. This
     * damage is also blocked by Protect.
     */
    function damagePokemonByStatus(ownerId, pokemonCard, damagePercent, damageLabel) {
        if (!pokemonCard || pokemonCard.currentHealth <= 0) return null;

        if (isProtectedFromDamage(pokemonCard)) {
            logEvent(`${model.getCardName(pokemonCard)} was protected from ${damageLabel} damage.`);
            return {
                cardId: pokemonCard.id,
                damage: 0,
                damagePercent: 0,
                ownerId
            };
        }

        const damage = Math.max(1, Math.ceil(pokemonCard.pokemon.baseHealth * damagePercent));
        const actualDamage = Math.min(pokemonCard.currentHealth, damage);

        if (actualDamage <= 0) return null;

        pokemonCard.currentHealth = Math.max(0, pokemonCard.currentHealth - actualDamage);
        logEvent(`${model.getCardName(pokemonCard)} took ${actualDamage} ${damageLabel} damage.`);

        return {
            cardId: pokemonCard.id,
            damage: actualDamage,
            damagePercent: Math.round((actualDamage / pokemonCard.pokemon.baseHealth) * 100),
            ownerId
        };
    }

    /**
     * Resolves MULTI_ATTACK damage, rolling one hit count and applying normal
     * attack damage repeatedly to targets that remain active and alive.
     */
    async function resolveMultiAttackDamage(actionCard, targets, attacker) {
        const hitCount = getRandomMultiAttackHitCount();

        for (let hitIndex = 0; hitIndex < hitCount; hitIndex += 1) {
            const activeTargets = targets.filter(target => (
                target.card.currentHealth > 0 &&
                model.getBoardCardById(target.owner, target.card.id) === target.card
            ));

            if (activeTargets.length === 0) break;

            const damageResults = activeTargets.map(target => damagePokemon(target.owner, target.card, attacker, actionCard));

            showDamageNumbers(damageResults);
            await model.sleep(260);
        }

        logEvent(`${model.getCardName(actionCard)} hit ${hitCount} times.`);
    }

    function getRandomMultiAttackHitCount() {
        const hitRange = MULTI_ATTACK_MAX_HITS - MULTI_ATTACK_MIN_HITS + 1;

        return MULTI_ATTACK_MIN_HITS + Math.floor(Math.random() * hitRange);
    }

    /**
     * Final cleanup after all queued attacks resolve. Poison/Burn damage happens
     * first, then non-attacking Sleep ticks, then expiring turn statuses clear.
     * Knockout replacements are queued here and drawn after all cleanup is done.
     */
    async function resolveEndOfTurnStatuses() {
        const damageResults = applyEndOfTurnStatusDamage();

        if (damageResults.length > 0) {
            render();
            showDamageNumbers(damageResults);
            await model.sleep(620);
        }

        const sleepTickResults = tickSleepTimersWithoutAttack();
        const removedStatuses = clearTurnStatuses();

        if (damageResults.length > 0) {
            damageResults.forEach(result => {
                const pokemonCard = model.getBoardCardById(result.ownerId, result.cardId);

                if (pokemonCard && pokemonCard.currentHealth === 0) {
                    knockOutPokemon(result.ownerId, pokemonCard);
                }
            });
        }

        if (damageResults.length === 0 && sleepTickResults.length === 0 && removedStatuses.length === 0) return false;

        render();

        return checkGameOver();
    }

    /**
     * Applies Poison and Burn damage to every active Pokemon at end of turn.
     */
    function applyEndOfTurnStatusDamage() {
        const results = [];
        const damageStatuses = [
            { label: 'poison', percent: POISON_DAMAGE_PERCENT, status: 'POISON' },
            { label: 'burn', percent: BURN_DAMAGE_PERCENT, status: 'BURN' }
        ];

        ['player', 'opponent'].forEach(ownerId => {
            model.getBoardCards(ownerId).forEach(pokemonCard => {
                damageStatuses.forEach(statusDamage => {
                    if (!model.hasPokemonStatus(pokemonCard, statusDamage.status)) return;

                    const result = damagePokemonByStatus(ownerId, pokemonCard, statusDamage.percent, statusDamage.label);

                    if (result && result.damage > 0) results.push(result);
                });
            });
        });

        return results;
    }

    /**
     * Clears statuses whose duration expires at end of turn, such as Protect,
     * Flinch, and limited-duration Fatigue.
     */
    function clearTurnStatuses() {
        const removedStatuses = [];

        ['player', 'opponent'].forEach(ownerId => {
            model.getBoardCards(ownerId).forEach(pokemonCard => {
                const removed = model.clearTurnStatuses(pokemonCard);

                if (removed.length === 0) return;

                removedStatuses.push(...removed.map(status => ({
                    card: pokemonCard,
                    ownerId,
                    status
                })));
                logEvent(`${model.getCardName(pokemonCard)}'s ${removed.map(status => status.label).join(', ')} ended.`);
            });
        });

        return removedStatuses;
    }

    /**
     * Applies persistent battle statuses from an attack. Damaging attacks roll
     * the global status trigger chance; non-damaging attacks always apply.
     */
    function maybeApplyAttackStatuses(actionCard, targets, isDamaging) {
        const statuses = getBattleStatuses(actionCard);

        if (statuses.length === 0) return false;

        if (isDamaging && Math.random() >= STATUS_TRIGGER_CHANCE) {
            logEvent(`${model.getCardName(actionCard)} status did not activate.`);
            return false;
        }

        return applyStatusesToTargets(statuses, targets);
    }

    function getBattleStatuses(actionCard) {
        return model.getActionStatuses(actionCard).filter(model.isBattleStatus);
    }

    /**
     * Attempts to add persistent statuses to live target cards and logs whether
     * each status was added or blocked by an existing status.
     */
    function applyStatusesToTargets(statuses, targets) {
        let appliedAny = false;

        targets.forEach(target => {
            if (model.getBoardCardById(target.owner, target.card.id) !== target.card) return;

            const results = statuses
                .map(status => model.applyStatus(target.card, status))
                .filter(Boolean);

            if (results.length === 0) return;

            appliedAny = true;
            logStatusResult(target.card, results);
        });

        return appliedAny;
    }

    function logStatusResult(pokemonCard, results) {
        const addedResults = results.filter(result => result.added);
        const blockedResults = results.filter(result => result.blocked);

        if (addedResults.length > 0) {
            const statusNames = addedResults
                .map(result => result.label)
                .join(', ');

            logEvent(`${model.getCardName(pokemonCard)} gained ${statusNames}.`);
            return;
        }

        if (blockedResults.length > 0) {
            const activeStatusNames = [...new Set(blockedResults.map(result => result.label))].join(', ');
            const attemptedStatusNames = [...new Set(blockedResults.map(result => result.attemptedLabel))].join(', ');

            if (activeStatusNames === attemptedStatusNames) {
                logEvent(`${model.getCardName(pokemonCard)} already has ${activeStatusNames}.`);
                return;
            }

            logEvent(`${model.getCardName(pokemonCard)} already has ${activeStatusNames} and could not gain ${attemptedStatusNames}.`);
            return;
        }

        const statusNames = results
            .map(result => result.label)
            .join(', ');

        logEvent(`${model.getCardName(pokemonCard)} already has ${statusNames}.`);
    }

    /**
     * Applies action effects that remove statuses. FULL_HEAL and HEAL_STATUS
     * clear the current persistent status; HEAL_BURN only clears Burn.
     */
    function applyStatusHealingEffects(statuses, targets) {
        let didSomething = false;

        if (hasStatusHealing(statuses)) {
            didSomething = clearStatusesFromTargets(targets) || didSomething;
        }

        if (statuses.includes('HEAL_BURN')) {
            didSomething = clearBurnFromTargets(targets) || didSomething;
        }

        return didSomething;
    }

    function hasHealthHealing(statuses) {
        return statuses.includes('HEAL') || statuses.includes('FULL_HEAL');
    }

    function hasStatusHealing(statuses) {
        return statuses.includes('HEAL_STATUS') || statuses.includes('FULL_HEAL');
    }

    function clearStatusesFromTargets(targets) {
        let removedAny = false;

        targets.forEach(target => {
            const removedStatuses = model.clearPokemonStatuses(target.card);

            if (removedStatuses.length === 0) return;

            removedAny = true;
            logRemovedStatuses(target.card, removedStatuses);
        });

        return removedAny;
    }

    function clearBurnFromTargets(targets) {
        let removedAny = false;

        targets.forEach(target => {
            const removedStatus = model.removePokemonStatus(target.card, 'BURN');

            if (!removedStatus) return;

            removedAny = true;
            logRemovedStatuses(target.card, [removedStatus]);
        });

        return removedAny;
    }

    function logRemovedStatuses(pokemonCard, removedStatuses) {
        const statusNames = removedStatuses
            .map(status => status.label)
            .join(', ');

        logEvent(`${model.getCardName(pokemonCard)} recovered from ${statusNames}.`);
    }

    /**
     * Applies attack stat changes after damage. Damaging attacks roll the given
     * trigger chance; non-damaging attacks always apply their listed changes.
     */
    function maybeApplyAttackStatChanges(actionCard, targets, isDamaging, triggerChance = STAT_CHANGE_TRIGGER_CHANCE) {
        const statChanges = model.getActionStatChanges(actionCard);

        if (statChanges.length === 0) return false;

        if (isDamaging && Math.random() >= triggerChance) {
            logEvent(`${model.getCardName(actionCard)} stat changes did not activate.`);
            return false;
        }

        return applyStatChangesToTargets(statChanges, targets);
    }

    /**
     * Redirects stat changes to the attacker for SELF_INFLICT actions; otherwise
     * stat changes affect the selected targets.
     */
    function getStatChangeTargets(action, attacker, targets) {
        if (!model.getActionStatuses(action.card).includes('SELF_INFLICT')) return targets;

        return [{ owner: action.owner, card: attacker }];
    }

    /**
     * Applies stat stages to live targets after model-level type adjustments
     * such as NORMAL limiting and HUMAN doubling.
     */
    function applyStatChangesToTargets(statChanges, targets) {
        let appliedAny = false;

        targets.forEach(target => {
            if (model.getBoardCardById(target.owner, target.card.id) !== target.card) return;

            const targetStatChanges = model.getStatChangesForPokemon(target.card, statChanges);
            const results = targetStatChanges
                .map(statChange => model.applyStatChange(target.card, statChange))
                .filter(Boolean);

            if (results.length === 0) return;

            appliedAny = true;
            logStatChangeResult(target.card, results);
            showStatChangeAnimations(target.owner, target.card.id, results);
        });

        return appliedAny;
    }

    function logStatChangeResult(pokemonCard, results) {
        const changedResults = results.filter(result => result.changed);

        if (changedResults.length === 0) {
            logEvent(`${model.getCardName(pokemonCard)}'s affected stats are already at their limits.`);
            return;
        }

        const summary = changedResults
            .map(result => `${result.shortLabel} ${model.formatStatStage(result.nextStage)}`)
            .join(', ');

        logEvent(`${model.getCardName(pokemonCard)}'s ${summary}.`);
    }

    function showStatChangeAnimations(ownerId, cardId, results) {
        const changedResults = results.filter(result => result.changed);
        const targetElement = getBoardCardElement(ownerId, cardId);

        if (!targetElement || changedResults.length === 0) return;

        const rect = targetElement.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        changedResults.forEach((result, index) => {
            const marker = document.createElement('div');
            const offset = (index - (changedResults.length - 1) / 2) * 34;

            marker.className = `stat-change-float stat-change-float--${result.delta > 0 ? 'up' : 'down'}`;
            marker.textContent = result.shortLabel;
            marker.style.left = `${centerX + offset}px`;
            marker.style.top = `${centerY}px`;
            document.body.appendChild(marker);

            setTimeout(() => marker.remove(), 920);
        });
    }

    /**
     * Restores the standard healing amount to a Pokemon without exceeding max HP.
     */
    function healPokemon(pokemonCard) {
        const healing = Math.ceil(pokemonCard.pokemon.baseHealth * DAMAGE_PERCENT);

        pokemonCard.currentHealth = Math.min(pokemonCard.pokemon.baseHealth, pokemonCard.currentHealth + healing);
        logEvent(`${model.getCardName(pokemonCard)} healed ${healing} HP.`);
    }

    /**
     * Resolves SWITCH by removing the target from the board, clearing stat
     * stages, placing it on the bottom of its owner's Pokemon deck, and drawing
     * a replacement Pokemon immediately.
     */
    async function switchPokemon(ownerId, pokemonCard) {
        const owner = state.players[ownerId];
        const slotIndex = owner.board.findIndex(card => card && card.id === pokemonCard.id);
        const removedCard = model.removeCardFromBoard(owner, pokemonCard.id);

        if (!removedCard) return;

        model.clearPokemonStatChanges(removedCard);
        model.putPokemonOnBottomOfDeck(owner, removedCard);
        logEvent(`${model.getCardName(removedCard)} went to the bottom of ${owner.name}'s Pokemon deck.`);

        const replacementCard = model.drawPokemonToBoard(owner, slotIndex);

        if (replacementCard) {
            markCardArriving(replacementCard);
            logEvent(`${owner.name} drew ${model.getCardName(replacementCard)} into the open slot.`);
            render();
            await animatePokemonEnterBoard(ownerId, replacementCard, 'pokemon-deck');
        }
    }

    /**
     * Removes a Pokemon at 0 HP, moves it to the knockout pile, increments the
     * owner's knockout count, then queues replacement for end-of-turn. Delaying
     * replacement keeps later queued attacks from hitting a newly drawn Pokemon.
     */
    function knockOutPokemon(ownerId, pokemonCard) {
        const owner = state.players[ownerId];
        const slotIndex = owner.board.findIndex(card => card && card.id === pokemonCard.id);
        const removedCard = model.removeCardFromBoard(owner, pokemonCard.id);

        if (!removedCard) return;

        removedCard.faceUp = true;
        owner.knockout.unshift(removedCard);
        owner.knockoutCount = (Number(owner.knockoutCount) || 0) + 1;
        model.updatePokemonLeft(owner);
        logEvent(`${model.getCardName(removedCard)} was knocked out.`);

        if (owner.knockoutCount >= KNOCKOUT_LIMIT) return;

        queuePokemonReplacement(ownerId, slotIndex);
    }

    function queuePokemonReplacement(ownerId, slotIndex) {
        if (slotIndex < 0 || slotIndex >= BOARD_SLOT_COUNT) return false;

        const owner = state.players[ownerId];

        if (!owner || owner.board[slotIndex]) return false;

        const existingReplacement = state.pendingPokemonReplacements.some(replacement => (
            replacement.ownerId === ownerId && replacement.slotIndex === slotIndex
        ));

        if (existingReplacement) return false;

        state.pendingPokemonReplacements.push({ ownerId, slotIndex });

        return true;
    }

    async function resolvePendingPokemonReplacements() {
        if (!Array.isArray(state.pendingPokemonReplacements) || state.pendingPokemonReplacements.length === 0) return false;

        const replacements = state.pendingPokemonReplacements.slice();

        state.pendingPokemonReplacements = [];

        for (const replacement of replacements) {
            if (checkGameOver()) return true;

            const owner = state.players[replacement.ownerId];

            if (!owner || owner.board[replacement.slotIndex]) continue;

            const fossilCard = reviveFossilPokemonFromKnockout(owner, replacement.slotIndex);

            if (fossilCard) {
                markCardArriving(fossilCard);
                render();
                await animatePokemonEnterBoard(owner.id, fossilCard, 'knockout');
                continue;
            }

            const replacementCard = drawReplacementPokemon(owner, replacement.slotIndex);

            if (replacementCard) {
                markCardArriving(replacementCard);
            }

            render();

            if (replacementCard) {
                await animatePokemonEnterBoard(owner.id, replacementCard, 'pokemon-deck');
            }

            if (checkGameOver()) return true;
        }

        render();

        return checkGameOver();
    }

    function drawReplacementPokemon(owner, slotIndex) {
        if (slotIndex < 0 || slotIndex >= BOARD_SLOT_COUNT || owner.board[slotIndex]) return null;

        const replacementCard = model.drawPokemonToBoard(owner, slotIndex);

        if (!replacementCard) {
            owner.lostByPokemonDeck = true;
            model.updatePokemonLeft(owner);
            logEvent(`${owner.name} had no Pokemon left to draw.`);
            return null;
        }

        logEvent(`${owner.name} drew ${model.getCardName(replacementCard)} into the open slot.`);

        return replacementCard;
    }

    /**
     * FOSSIL special rule: during end-of-turn replacement, a once-per-card
     * Fossil already in the knockout pile can return to the vacated slot.
     */
    function reviveFossilPokemonFromKnockout(owner, slotIndex) {
        if (slotIndex < 0 || slotIndex >= BOARD_SLOT_COUNT || owner.board[slotIndex]) return null;

        const fossilIndex = owner.knockout.findIndex((card, index) => (
            index > 0 &&
            model.isPokemonCard(card) &&
            model.getCardTypes(card).includes('FOSSIL') &&
            !card.hasUsedFossilRevival
        ));

        if (fossilIndex === -1) return null;

        const [fossilCard] = owner.knockout.splice(fossilIndex, 1);

        fossilCard.faceUp = true;
        fossilCard.hasUsedFossilRevival = true;
        fossilCard.currentHealth = Math.max(1, Math.ceil(fossilCard.pokemon.baseHealth * FOSSIL_REVIVAL_HEALTH_PERCENT));
        model.clearPokemonStatChanges(fossilCard);
        model.clearPokemonStatuses(fossilCard);
        model.applyStatus(fossilCard, 'FATIGUE');

        owner.board[slotIndex] = fossilCard;
        model.updatePokemonLeft(owner);
        logEvent(`${model.getCardName(fossilCard)} revived from the knockout pile with Fatigue.`);

        return fossilCard;
    }

    /**
     * Moves a resolved, blocked, or failed queued attack to its owner's discard
     * pile after the discard animation.
     */
    async function discardActionCard(action, startCenter = null) {
        const owner = state.players[action.owner];

        action.card.faceUp = true;
        await animateDiscardCard(action.owner, action.card, startCenter);
        owner.discard.unshift(action.card);
    }

    /**
     * Called after major state changes and during resolution loops. It ends the
     * battle when either side reaches the knockout limit or cannot replace a KO.
     */
    function checkGameOver() {
        if (state.finished) return true;

        const playerDefeated = isPlayerDefeated(state.players.player);
        const opponentDefeated = isPlayerDefeated(state.players.opponent);

        if (!playerDefeated && !opponentDefeated) return false;

        state.finished = true;
        state.isResolving = false;
        state.currentPlayer = null;
        state.phase = 'finished';
        clearPendingAction();

        const message = playerDefeated && opponentDefeated
            ? 'Both sides are out of Pokemon.'
            : playerDefeated
                ? 'Rival wins.'
                : 'You win.';

        logEvent(message);
        showPopup(message);
        render();

        return true;
    }

    function isPlayerDefeated(player) {
        if (!player) return false;

        return Boolean(player.lostByPokemonDeck) || (Number(player.knockoutCount) || 0) >= KNOCKOUT_LIMIT;
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

    function markCardsArriving(cards) {
        cards.filter(Boolean).forEach(markCardArriving);
    }

    function markCardArriving(card) {
        if (!card || !card.id) return;
        if (!Array.isArray(state.arrivingCardIds)) state.arrivingCardIds = [];
        if (!state.arrivingCardIds.includes(card.id)) state.arrivingCardIds.push(card.id);
    }

    function clearCardArriving(card) {
        if (!card || !Array.isArray(state.arrivingCardIds)) return;

        state.arrivingCardIds = state.arrivingCardIds.filter(cardId => cardId !== card.id);
    }

    function releaseArrivingCard(card, getElement) {
        clearCardArriving(card);

        const element = getElement ? getElement() : null;

        if (element) {
            element.classList.remove('is-arriving-card');
        } else {
            arena.Render.render();
        }
    }

    function showDamageNumbers(damageResults) {
        damageResults.forEach(result => {
            if (!result || result.damage <= 0) return;

            const targetElement = getBoardCardElement(result.ownerId, result.cardId);

            if (!targetElement) return;

            const rect = targetElement.getBoundingClientRect();
            const marker = document.createElement('div');

            marker.className = 'damage-float';
            marker.textContent = `-${result.damagePercent}%`;
            marker.style.left = `${rect.left + rect.width / 2}px`;
            marker.style.top = `${Math.max(8, rect.top - 10)}px`;
            document.body.appendChild(marker);

            setTimeout(() => marker.remove(), 880);
        });
    }

    async function animateDrawCard(playerId, card) {
        const deckElement = getPileCardElement(playerId, 'deck');
        const handElement = getHandCardElement(playerId, card.id);

        if (!deckElement || !handElement) {
            releaseArrivingCard(card, () => getHandCardElement(playerId, card.id));
            await model.sleep(240);
            return;
        }

        const ghost = createCardAnimationElement(card, 'draw-animation-card', playerId === 'player');

        if (!ghost) {
            releaseArrivingCard(card, () => getHandCardElement(playerId, card.id));
            await model.sleep(240);
            return;
        }

        const sourceCenter = getElementCenter(deckElement);
        const targetCenter = getElementCenter(handElement);

        handElement.classList.add('is-arriving-card');
        document.body.appendChild(ghost);
        placeAnimationElement(ghost, sourceCenter);

        await model.sleep(40);
        ghost.classList.add('is-card-moving');
        placeAnimationElement(ghost, targetCenter);

        await model.sleep(430);
        releaseArrivingCard(card, () => getHandCardElement(playerId, card.id));
        ghost.remove();
    }

    async function animatePokemonEnterBoard(playerId, card, sourcePileType = 'pokemon-deck') {
        const sourceElement = getPileCardElement(playerId, sourcePileType);
        const boardElement = getBoardCardElement(playerId, card.id);

        if (!sourceElement || !boardElement) {
            releaseArrivingCard(card, () => getBoardCardElement(playerId, card.id));
            await model.sleep(260);
            return;
        }

        const ghost = createCardAnimationElement(card, 'draw-animation-card pokemon-draw-animation-card', true);

        if (!ghost) {
            releaseArrivingCard(card, () => getBoardCardElement(playerId, card.id));
            await model.sleep(260);
            return;
        }

        const sourceCenter = getElementCenter(sourceElement);
        const targetCenter = getElementCenter(boardElement);

        boardElement.classList.add('is-arriving-card');
        document.body.appendChild(ghost);
        placeAnimationElement(ghost, sourceCenter);

        await model.sleep(40);
        ghost.classList.add('is-card-moving');
        placeAnimationElement(ghost, targetCenter);

        await model.sleep(430);
        releaseArrivingCard(card, () => getBoardCardElement(playerId, card.id));
        ghost.remove();
    }

    async function animateDiscardCard(playerId, card, startCenter = null) {
        const discardElement = getPileCardElement(playerId, 'discard');

        if (!discardElement) {
            await model.sleep(220);
            return;
        }

        const ghost = createCardAnimationElement(card, 'discard-animation-card', true);

        if (!ghost) {
            await model.sleep(220);
            return;
        }

        const sourceCenter = startCenter || getArenaCenter();
        const targetCenter = getElementCenter(discardElement);

        document.body.appendChild(ghost);
        placeAnimationElement(ghost, sourceCenter);

        await model.sleep(30);
        ghost.classList.add('is-card-moving');
        placeAnimationElement(ghost, targetCenter);

        await model.sleep(420);
        ghost.remove();
    }

    function createCardAnimationElement(card, animationClass, reveal) {
        const template = document.createElement('template');

        template.innerHTML = arena.Render.renderCardForAnimation(card, animationClass, reveal).trim();

        return template.content.firstElementChild;
    }

    function isDamagingAttack(card) {
        return model.isAttackCard(card) && Number(card.attack.basePower) > 0;
    }

    function getBoardCardElement(ownerId, cardId) {
        return document.querySelector(`.side-panel--${ownerId} [data-board-card-id="${cardId}"]`);
    }

    function getBoardCardCenter(ownerId, cardId) {
        const element = getBoardCardElement(ownerId, cardId);

        return element ? getElementCenter(element) : null;
    }

    function getHandCardElement(ownerId, cardId) {
        return document.querySelector(`.hand-row--${ownerId} [data-hand-card-id="${cardId}"]`);
    }

    function getHandCardCenter(ownerId, cardId) {
        const element = getHandCardElement(ownerId, cardId);

        return element ? getElementCenter(element) : null;
    }

    function getPileCardElement(ownerId, pileType) {
        return document.querySelector(`.side-panel--${ownerId} .pile--${pileType} .pile-card`);
    }

    function getElementCenter(element) {
        const rect = element.getBoundingClientRect();

        return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
        };
    }

    function getArenaCenter() {
        const board = state.elements.board;
        const rect = board.getBoundingClientRect();

        return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
        };
    }

    function getElementsCenter(elements) {
        const bounds = elements.reduce((box, element) => {
            const rect = element.getBoundingClientRect();

            return {
                bottom: Math.max(box.bottom, rect.bottom),
                left: Math.min(box.left, rect.left),
                right: Math.max(box.right, rect.right),
                top: Math.min(box.top, rect.top)
            };
        }, {
            bottom: -Infinity,
            left: Infinity,
            right: -Infinity,
            top: Infinity
        });

        return {
            x: bounds.left + (bounds.right - bounds.left) / 2,
            y: bounds.top + (bounds.bottom - bounds.top) / 2
        };
    }

    function placeAnimationElement(element, center) {
        const rect = element.getBoundingClientRect();

        element.style.left = `${center.x - rect.width / 2}px`;
        element.style.top = `${center.y - rect.height / 2}px`;
    }

    function getEligibleAttackUsers(playerId, attackCard) {
        return model.getBoardCards(playerId).filter(card => (
            !model.hasQueuedAttack(playerId, card.id) &&
            model.pokemonCanUseAttack(card, attackCard) &&
            model.getTargetOptionsForAction(attackCard, playerId, card.id).length > 0
        ));
    }

    function getPendingTargetOptions() {
        const pendingCard = model.findHandCard(state.players.player, state.pendingActionCardId);

        if (!pendingCard) return [];

        return model.getTargetOptionsForAction(pendingCard, 'player', state.pendingUserCardId);
    }

    function getFirstOpenSlot(player) {
        return player.board.findIndex(card => !card);
    }

    function isTargetingPhase() {
        return state.phase === 'selecting-attack-target' || state.phase === 'selecting-item-target';
    }

    arena.Controller = {
        canDropCardOnSlot,
        canPlayerAct,
        canPlayerEndTurn,
        canPlayerSelectCard,
        canPlaceSelectedCard,
        canDragPendingActionCard,
        canDiscardSelectedCard,
        canDropCardOnDiscard,
        cancelActionSelection,
        getDropActionForBoardCard,
        getDropActionForTargetGroup,
        handleCardDrop,
        handleArenaClick,
        placeSelectedCard,
        resetPrototype
    };
})(window.CardArena = window.CardArena || {});
