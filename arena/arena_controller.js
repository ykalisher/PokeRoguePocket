/**
 * Pokemon Rogue Pocket - game flow and player actions for the arena prototype
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
 *    - Artificial (ARTIFICIAL-typed, TRAINER-target) attacks resolve
 *      immediately after user selection through useArtificialAttackFromHand().
 *      They ignore the one-attack-per-Pokemon limit and are removed from play
 *      for the rest of the battle instead of being discarded.
 *    - Dragon Gem items resolve as side effects immediately; other item cards
 *      select/drag to a legal target and resolve through usePendingItem() ->
 *      applyItemCard(). Every item is single-use: after resolving it is removed
 *      from play for the rest of the battle instead of being discarded.
 *    - Unused hand cards can be discarded by button or by dragging to discard.
 * 5. endPlayerTurn() locks input, asks the opponent to act with runOpponentTurn(),
 *    then resolves all queued attacks with resolveQueuedAttacks().
 * 6. runOpponentTurn() refills the rival hand, queues attacks through
 *    chooseOpponentAttacks() (first usable attack per Pokemon, targeted via
 *    chooseOpponentTarget() for a guaranteed kill, else lowest hits-to-kill,
 *    else the best status target), uses one item immediately through
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
    const LOG_ENTRY_LIMIT = 100;
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
        state.extraAttacks = { opponent: {}, player: {} };
        state.itemAllowance = { opponent: 1, player: 1 };
        state.itemUsed = { opponent: 0, player: 0 };
        state.menuWindowOpen = false;
        state.pendingActionCardId = null;
        state.pendingUserCardId = null;
        state.pendingPokemonReplacements = [];
        state.pileWindow = null;
        state.plannedActions = { opponent: [], player: [] };
        state.players = {
            opponent: model.createPlayer('opponent', getConfiguredPlayerName('opponent', 'Rival')),
            player: model.createPlayer('player', getConfiguredPlayerName('player', 'You'))
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

        await Promise.all(placements.map((placement, index) => (async () => {
            await model.sleep(index * 130);
            await animatePokemonEnterBoard(placement.ownerId, placement.card, 'pokemon-deck');
        })()));

        startPlayerTurn();
    }

    /**
     * Animates a batch of drawn cards with a short stagger so multi-card draws
     * overlap smoothly instead of playing strictly one after another.
     */
    async function animateDrawCards(playerId, cards) {
        await Promise.all(cards.map((card, index) => (async () => {
            await model.sleep(index * 90);
            await animateDrawCard(playerId, card);
        })()));
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
        state.extraAttacks = { opponent: {}, player: {} };
        state.itemAllowance = { opponent: 1, player: 1 };
        state.itemUsed = { opponent: 0, player: 0 };
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

        await animateDrawCards('player', drawnCards);

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

        const pileButton = event.target.closest('[data-pile-view-owner][data-pile-view-type]');

        if (pileButton) {
            openPileWindow(pileButton.dataset.pileViewOwner, pileButton.dataset.pileViewType);
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
            const tappedId = cardButton.dataset.cardId;

            if (tappedId && (tappedId === state.selectedCardId || tappedId === state.pendingActionCardId)) {
                if (state.phase === 'turn') {
                    // The card is only highlighted by an unavailable-action popup
                    // (e.g. no eligible attacker); cancelActionSelection() no-ops
                    // outside the selecting-* phases, so clear the highlight here.
                    state.selectedCardId = null;
                    render();
                } else {
                    cancelActionSelection();
                }
                return;
            }

            selectPlayerCard(tappedId);
            return;
        }

        const actionButton = event.target.closest('[data-action]');

        if (!actionButton) return;

        const action = actionButton.dataset.action;

        if (action === 'cancel-action') {
            cancelActionSelection();
        } else if (action === 'close-pile-window') {
            closePileWindow();
        } else if (action === 'close-menu') {
            closeMenuWindow();
        } else if (action === 'close-rules') {
            closeRulesWindow();
        } else if (action === 'discard-selected') {
            discardSelectedPlayerCard();
        } else if (action === 'end-turn') {
            endPlayerTurn();
        } else if (action === 'reset') {
            resetPrototype();
        } else if (action === 'toggle-menu') {
            toggleMenuWindow();
        } else if (action === 'toggle-rules') {
            toggleRulesWindow();
        }
    }

    /**
     * Opens or closes the battle reference window without changing turn state.
     */
    function toggleRulesWindow() {
        state.rulesWindowOpen = !state.rulesWindowOpen;
        state.menuWindowOpen = false;
        render();
    }

    /**
     * Opens or closes the pause menu (main menu / new game / resume) without
     * changing turn state; the actual navigation happens in game.js's
     * document-level data-battle-flow-action listener.
     */
    function toggleMenuWindow() {
        state.menuWindowOpen = !state.menuWindowOpen;
        state.rulesWindowOpen = false;
        render();
    }

    function closeMenuWindow() {
        if (!state.menuWindowOpen) return;

        state.menuWindowOpen = false;
        render();
    }

    function openPileWindow(ownerId, pileType) {
        if (!state.players[ownerId]) return;
        if (!['deck', 'discard', 'pokemon-deck'].includes(pileType)) return;

        state.pileWindow = {
            ownerId,
            type: pileType
        };
        render();
    }

    function closePileWindow() {
        state.pileWindow = null;
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
     * Stores the Pokemon that will use the pending attack. Artificial attacks
     * resolve immediately on the trainer, self-targeting attacks can queue
     * immediately, and other attacks advance to target selection.
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

        if (model.isArtificialAttackCard(attackCard)) {
            useArtificialAttackFromHand('player', state.pendingActionCardId, userCardId);
            return;
        }

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

        if (!model.hasItemUseRemaining('player')) {
            showPopup('You cannot use another item this turn.');
            state.selectedCardId = cardId;
            render();
            return;
        }

        if (model.isDragonGemItemCard(itemCard)) {
            if (!canUseDragonGemItem('player', itemCard)) {
                const effect = model.getDragonGemEffectForItem(itemCard);

                showPopup(effect ? `${effect.label} is already active.` : `${model.getCardName(itemCard)} cannot be used.`);
                state.selectedCardId = cardId;
                render();
                return;
            }

            useDragonGemItemFromHand('player', cardId);
            return;
        }

        if (model.isEffectBoostItemCard(itemCard)) {
            if (!canUseEffectBoostItem('player')) {
                showPopup(`${model.getCardName(itemCard)} is already active.`);
                state.selectedCardId = cardId;
                render();
                return;
            }

            useEffectBoostItemFromHand('player', cardId);
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
            !model.isArtificialAttackCard(queuedCard) &&
            model.canQueueAnotherAttack('player', userCard.id) &&
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
     * effects immediately, are removed from play for the rest of the battle, and
     * mark the player's item use spent. Every item is single-use.
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
        model.markItemUsed('player');
        clearPendingAction();
        state.phase = 'turn';
        state.isResolving = true;
        render();

        const impactCenter = await animateItemCard(itemCard, sourceCenter, targets);

        await applyItemCard(itemCard, selection, 'player');
        render();
        await model.sleep(180);

        await animateArtificialAttackCard(itemCard, impactCenter || sourceCenter, 'player');

        model.removeCardFromPlay(player, itemCard);
        logEvent(`${model.getCardName(itemCard)} was removed from play for the rest of the battle.`);
        state.isResolving = false;
        render();
    }

    async function useDragonGemItemFromHand(ownerId, cardId) {
        const owner = state.players[ownerId];

        if (!owner) return false;

        const itemCard = model.findHandCard(owner, cardId);

        if (!model.isDragonGemItemCard(itemCard) || !canUseDragonGemItem(ownerId, itemCard)) return false;

        const sourceCenter = getHandCardCenter(ownerId, cardId);
        const removedCard = model.removeCardFromHand(owner, cardId);

        if (!removedCard) return false;

        removedCard.faceUp = true;
        model.markItemUsed(ownerId);

        if (ownerId === 'player') {
            clearPendingAction();
            state.phase = 'turn';
            state.isResolving = true;
        }

        render();

        const impactCenter = await animateDragonGemCard(removedCard, sourceCenter, ownerId);

        applyDragonGemItemEffect(removedCard, ownerId);
        render();
        await model.sleep(180);

        await animateArtificialAttackCard(removedCard, impactCenter || sourceCenter, ownerId);

        model.removeCardFromPlay(owner, removedCard);
        logEvent(`${model.getCardName(removedCard)} was removed from play for the rest of the battle.`);

        if (ownerId === 'player') {
            state.isResolving = false;
        }

        render();
        return true;
    }

    function canUseDragonGemItem(ownerId, itemCard) {
        const effect = model.getDragonGemEffectForItem(itemCard);

        if (!effect) return false;

        return !model.getDragonGemEffects(ownerId).some(activeEffect => activeEffect.status === effect.status);
    }

    function canUseEffectBoostItem(ownerId) {
        return !model.hasEffectBoost(ownerId);
    }

    /**
     * Plays the standalone effect-boost item without target selection (like a gem).
     * Like every item, the physical card is single-use: it is removed from play for
     * the rest of the battle after resolving.
     */
    async function useEffectBoostItemFromHand(ownerId, cardId) {
        const owner = state.players[ownerId];

        if (!owner) return false;

        const itemCard = model.findHandCard(owner, cardId);

        if (!model.isEffectBoostItemCard(itemCard) || !canUseEffectBoostItem(ownerId)) return false;

        const sourceCenter = getHandCardCenter(ownerId, cardId);
        const removedCard = model.removeCardFromHand(owner, cardId);

        if (!removedCard) return false;

        removedCard.faceUp = true;
        model.markItemUsed(ownerId);

        if (ownerId === 'player') {
            clearPendingAction();
            state.phase = 'turn';
            state.isResolving = true;
        }

        render();

        const impactCenter = await animateEffectBoostCard(removedCard, sourceCenter, ownerId);

        applyEffectBoostItemEffect(removedCard, ownerId);
        render();
        await model.sleep(180);

        await animateArtificialAttackCard(removedCard, impactCenter || sourceCenter, ownerId);

        model.removeCardFromPlay(owner, removedCard);
        logEvent(`${model.getCardName(removedCard)} was removed from play for the rest of the battle.`);

        if (ownerId === 'player') {
            state.isResolving = false;
        }

        render();
        return true;
    }

    /**
     * Resolves an artificial attack immediately: a chosen ARTIFICIAL Pokemon
     * uses the card, the effect applies to its trainer, and the single-use card
     * is removed from play for the rest of the battle instead of discarded.
     */
    async function useArtificialAttackFromHand(ownerId, cardId, userCardId) {
        const owner = state.players[ownerId];

        if (!owner) return false;

        const attackCard = model.findHandCard(owner, cardId);
        const userCard = model.getBoardCardById(ownerId, userCardId);

        if (!model.isArtificialAttackCard(attackCard) || !userCard) return false;
        if (!model.canPokemonUseAttackNow(ownerId, userCard, attackCard)) return false;

        const sourceCenter = getHandCardCenter(ownerId, cardId);
        const removedCard = model.removeCardFromHand(owner, cardId);

        if (!removedCard) return false;

        removedCard.faceUp = true;

        if (ownerId === 'player') {
            clearPendingAction();
            state.phase = 'turn';
            state.isResolving = true;
        }

        render();

        await animateArtificialAttackCard(removedCard, sourceCenter, ownerId);

        logEvent(`${model.getCardName(userCard)} used ${model.getCardName(removedCard)}.`);
        showPopup(`${model.getCardName(userCard)} used ${model.getCardName(removedCard)}.`);
        applyTrainerEffects(removedCard, ownerId, userCard);
        model.removeCardFromPlay(owner, removedCard);
        logEvent(`${model.getCardName(removedCard)} was removed from play for the rest of the battle.`);

        if (ownerId === 'player') {
            state.isResolving = false;
        }

        render();
        return true;
    }

    /**
     * Applies an artificial attack's trainer effects to the card user's side.
     */
    function applyTrainerEffects(attackCard, ownerId, userCard) {
        const owner = state.players[ownerId];
        const statuses = model.getActionStatuses(attackCard);

        if (statuses.includes('INCREASE_CAPACITY')) {
            const handSize = model.increasePlayerHandSize(owner);

            logEvent(`${owner.name} will draw up to ${handSize} cards for the rest of the battle.`);
        }

        if (statuses.includes('EXTRA_ITEM')) {
            model.grantExtraItemUse(ownerId);
            logEvent(`${owner.name} can use an additional item this turn.`);
        }

        if (statuses.includes('EXTRA_ATTACK')) {
            const allyCard = model.getBoardCards(ownerId).find(card => card.id !== userCard.id);

            if (allyCard) {
                model.grantExtraAttack(ownerId, allyCard.id);
                logEvent(`${model.getCardName(allyCard)} can use an additional attack this turn.`);
            } else {
                logEvent(`${model.getCardName(attackCard)} had no ally to energize.`);
            }
        }

        if (statuses.includes('REFRESH_DECK')) {
            if (model.shuffleDiscardIntoDeck(owner)) {
                logEvent(`${owner.name} shuffled the discard pile into the action deck.`);
            } else {
                logEvent(`${owner.name}'s discard pile was already empty.`);
            }
        }
    }

    async function animateArtificialAttackCard(attackCard, sourceCenter, ownerId) {
        const deckElement = getPileCardElement(ownerId, 'deck');
        const targetCenter = deckElement ? getElementCenter(deckElement) : getArenaCenter();

        return animateActionCardToTarget(attackCard, sourceCenter, targetCenter);
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

        if (model.isItemCard(card) && model.hasItemUseRemaining('player')) {
            if (model.isDragonGemItemCard(card) && boardOwner === 'player' && canUseDragonGemItem('player', card)) {
                return { kind: 'dragon-gem' };
            }

            if (model.isEffectBoostItemCard(card) && boardOwner === 'player' && canUseEffectBoostItem('player')) {
                return { kind: 'effect-boost' };
            }

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

        if (!model.isItemCard(card) || !model.hasItemUseRemaining('player')) return null;

        if (model.isDragonGemItemCard(card)) {
            return groupOwner === 'player' && canUseDragonGemItem('player', card)
                ? { kind: 'dragon-gem' }
                : null;
        }

        if (model.isEffectBoostItemCard(card)) {
            return groupOwner === 'player' && canUseEffectBoostItem('player')
                ? { kind: 'effect-boost' }
                : null;
        }

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
            return;
        }

        if (candidate.kind === 'dragon-gem') {
            useDragonGemItemFromHand('player', cardId);
            return;
        }

        if (candidate.kind === 'effect-boost') {
            useEffectBoostItemFromHand('player', cardId);
        }
    }

    /**
     * Opponent planning phase called after the player ends their turn. The rival
     * refills to hand size, uses its artificial attacks, uses items up to its
     * item allowance, queues attacks, discards unplayable cards according to
     * next-turn options, then schedules attack resolution.
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
            await animateDrawCards('opponent', drawnCards);
        } else {
            await model.sleep(280);
        }

        await useOpponentArtificialAttacks();

        while (await useOpponentItem());

        chooseOpponentAttacks();
        render();

        await discardOpponentCardsForNextTurn();

        clearTimeout(state.flowTimer);
        state.flowTimer = setTimeout(resolveQueuedAttacks, 720);
    }

    /**
     * Uses every artificial attack the opponent can play this turn. These
     * resolve immediately during planning, so an Energize or Recycle still
     * benefits the attacks and items chosen afterwards.
     */
    async function useOpponentArtificialAttacks() {
        const opponent = state.players.opponent;
        const artificialCards = opponent.hand.filter(model.isArtificialAttackCard);

        for (const attackCard of artificialCards) {
            if (state.finished || state.currentPlayer !== 'opponent') return;

            const userCard = getEligibleAttackUsers('opponent', attackCard)[0];

            if (!userCard) continue;

            await useArtificialAttackFromHand('opponent', attackCard.id, userCard.id);
            await model.sleep(180);
        }
    }

    /**
     * Queues legal attacks for each opponent Pokemon that can attack with a
     * card in hand, up to its attack allowance for this turn. The attacks will
     * resolve later with the player's queued moves.
     */
    function chooseOpponentAttacks() {
        const opponent = state.players.opponent;
        const attackers = model.getBoardCards('opponent');
        let chosenCount = 0;

        attackers.forEach(userCard => {
            while (model.canQueueAnotherAttack('opponent', userCard.id)) {
                const attackCard = opponent.hand.find(card => (
                    model.isAttackCard(card) &&
                    !model.isArtificialAttackCard(card) &&
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
            }
        });

        if (chosenCount === 0) {
            logEvent(`${opponent.name} readied no attacks.`);
        }
    }

    /**
     * Keeps up to three cards the opponent can still play next turn and
     * discards the rest, so the rival redraws instead of hoarding cards its
     * active Pokemon cannot use.
     */
    async function discardOpponentCardsForNextTurn() {
        const opponent = state.players.opponent;
        const playableIds = new Set(getPlayableNextTurnCards('opponent').map(card => card.id));
        const discardCards = opponent.hand.filter(card => !playableIds.has(card.id));

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
            if (model.isArtificialAttackCard(card)) {
                const userCard = model.getBoardCards(playerId).find(pokemonCard => (
                    model.pokemonCanUseAttack(pokemonCard, card) &&
                    model.getTargetOptionsForAction(card, playerId, pokemonCard.id).length > 0
                ));

                if (userCard) playableCards.push(card);

                return;
            }

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

            if (!hasPlayableItem && model.isItemCard(card) && canUseItemNextTurn(playerId, card)) {
                hasPlayableItem = true;
                playableCards.push(card);
            }
        });

        return playableCards.slice(0, 3);
    }

    function canUseItemNextTurn(playerId, itemCard) {
        if (model.isDragonGemItemCard(itemCard)) {
            return canUseDragonGemItem(playerId, itemCard);
        }

        if (model.isEffectBoostItemCard(itemCard)) {
            return canUseEffectBoostItem(playerId);
        }

        return model.getTargetOptionsForAction(itemCard, playerId, null).length > 0;
    }

    /**
     * Uses one opponent item during the opponent planning phase when the item
     * allowance is not spent. Like player items, these resolve immediately
     * instead of being queued.
     */
    async function useOpponentItem() {
        if (!model.hasItemUseRemaining('opponent')) return false;

        const opponent = state.players.opponent;
        const itemPlan = chooseOpponentItem();

        if (!itemPlan) return false;

        if (itemPlan.dragonGem) {
            return useDragonGemItemFromHand('opponent', itemPlan.card.id);
        }

        if (itemPlan.effectBoost) {
            return useEffectBoostItemFromHand('opponent', itemPlan.card.id);
        }

        const sourceCenter = getHandCardCenter('opponent', itemPlan.card.id);
        const targets = model.getCardsForTargetSelection(itemPlan.selection);
        const itemCard = model.removeCardFromHand(opponent, itemPlan.card.id);

        if (!itemCard) return false;

        itemCard.faceUp = true;
        model.markItemUsed('opponent');
        render();

        const impactCenter = await animateItemCard(itemCard, sourceCenter, targets);

        await applyItemCard(itemCard, itemPlan.selection, 'opponent');
        render();
        await model.sleep(180);

        await animateArtificialAttackCard(itemCard, impactCenter || sourceCenter, 'opponent');

        model.removeCardFromPlay(opponent, itemCard);
        logEvent(`${model.getCardName(itemCard)} was removed from play for the rest of the battle.`);
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
            if (model.isDragonGemItemCard(itemCard)) {
                if (canUseDragonGemItem('opponent', itemCard)) return { card: itemCard, dragonGem: true, selection: null };
                continue;
            }

            if (model.isEffectBoostItemCard(itemCard)) {
                if (canUseEffectBoostItem('opponent')) return { card: itemCard, effectBoost: true, selection: null };
                continue;
            }

            const selection = chooseOpponentItemTarget(itemCard);

            if (selection) return { card: itemCard, selection };
        }

        return null;
    }

    /**
     * Chooses an item target based on the item effect: healing/status recovery
     * favors allies, stat-up favors allies, stat-down/status favors the player,
     * and stat reverts favor useful stage resets.
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

        if (statuses.includes('REVERT_STATS')) {
            return chooseStatRevertTarget(options);
        }

        if (statChanges.some(statChange => statChange.endsWith('_UP'))) {
            return chooseTargetOwnedBy(options, 'opponent');
        }

        if (statChanges.some(statChange => statChange.endsWith('_DOWN'))) {
            return chooseTargetOwnedBy(options, 'player');
        }

        if (getBattleStatuses(itemCard).length > 0) {
            return chooseStatusItemTarget(options);
        }

        return null;
    }

    /**
     * Opponent helper for status-inflicting items: a new persistent status is
     * blocked while one is active, so only statusless Pokemon are considered.
     * Statuses aimed at the opponent's own side are only worthwhile on
     * FIGHTING Pokemon, which convert statuses into an Attack boost.
     */
    function chooseStatusItemTarget(options) {
        const candidate = options
            .filter(option => option.kind === 'single')
            .map(option => ({
                option,
                card: model.getBoardCardById(option.owner, option.cardId)
            }))
            .find(target => (
                target.card &&
                model.getPokemonStatuses(target.card).length === 0 &&
                (target.option.owner === 'player' || model.getCardTypes(target.card).includes('FIGHTING'))
            ));

        return candidate ? candidate.option : null;
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

    function chooseStatRevertTarget(options) {
        return chooseTargetWithStatStage(options, 'player', stage => stage > 0)
            || chooseTargetWithStatStage(options, 'opponent', stage => stage < 0);
    }

    function chooseTargetWithStatStage(options, ownerId, predicate) {
        const targets = options
            .filter(option => option.kind === 'single' && option.owner === ownerId)
            .map(option => ({
                option,
                card: model.getBoardCardById(option.owner, option.cardId)
            }))
            .filter(target => target.card && hasMatchingStatStage(target.card, predicate));

        if (targets.length > 0) return targets[0].option;

        const groupTarget = options.find(option => (
            option.kind === 'group' &&
            option.owner === ownerId &&
            model.getBoardCards(ownerId).some(card => hasMatchingStatStage(card, predicate))
        ));

        return groupTarget || null;
    }

    function hasMatchingStatStage(card, predicate) {
        return ['attack', 'defense', 'speed'].some(stat => predicate(model.getPokemonStatStage(card, stat)));
    }

    function chooseTargetOwnedBy(options, ownerId) {
        return options.find(option => option.owner === ownerId) || null;
    }

    /**
     * Chooses attack targets for opponent queued attacks, preferring player
     * group targets, then an intelligently scored player single target, then
     * the first legal fallback. Single-target scoring: pure status attacks
     * (no base power) aim at the highest-Attack non-statused Pokemon, except
     * Paralysis which aims at the highest Speed; damaging attacks prefer a
     * guaranteed kill (highest Attack among lethal targets), else the target
     * closest to dying relative to this hit.
     */
    function chooseOpponentTarget(attackCard, userCard) {
        const options = model.getTargetOptionsForAction(attackCard, 'opponent', userCard.id);
        const preferredGroup = options.find(option => option.kind === 'group' && option.owner === 'player');
        const preferredSingle = chooseOpponentAttackSingleTarget(attackCard, userCard, options);
        const fallback = options[0];

        return preferredGroup || preferredSingle || fallback || null;
    }

    /**
     * Scores the legal single player targets of a queued opponent attack. See
     * chooseOpponentTarget for the rules; PROTECT-ed Pokemon are skipped by
     * the status rule (never statusless) and treated as un-KO-able/worst by
     * the damage rule.
     */
    function chooseOpponentAttackSingleTarget(attackCard, userCard, options) {
        const candidates = options
            .filter(option => option.kind === 'single' && option.owner === 'player')
            .map(option => ({ card: model.getBoardCardById(option.owner, option.cardId), option }))
            .filter(candidate => candidate.card);

        if (candidates.length === 0) return null;

        const basePower = Number(attackCard.attack.basePower) || 0;
        const inflictedStatuses = getBattleStatuses(attackCard);

        if (inflictedStatuses.length > 0 && basePower === 0) {
            const statuslessCandidates = candidates.filter(candidate => model.getPokemonStatuses(candidate.card).length === 0);

            if (statuslessCandidates.length > 0) {
                const scoreFn = inflictedStatuses.includes('PARALYSIS')
                    ? candidate => model.getPokemonSpeed(candidate.card)
                    : candidate => model.getPokemonEffectiveStat(candidate.card, 'attack');

                return pickHighestScoringCandidate(statuslessCandidates, scoreFn).option;
            }
        }

        const koCandidates = candidates.filter(candidate => (
            !model.hasPokemonStatus(candidate.card, 'PROTECT') &&
            computeAttackDamage(userCard, candidate.card, attackCard, 0.35) >= candidate.card.currentHealth
        ));

        if (koCandidates.length > 0) {
            return pickHighestScoringCandidate(koCandidates, candidate => model.getPokemonEffectiveStat(candidate.card, 'attack')).option;
        }

        return pickLowestScoringCandidate(candidates, candidate => (
            model.hasPokemonStatus(candidate.card, 'PROTECT')
                ? Infinity
                : candidate.card.currentHealth / computeAttackDamage(userCard, candidate.card, attackCard, 0.40)
        )).option;
    }

    function pickHighestScoringCandidate(candidates, scoreFn) {
        return pickCandidateByScore(candidates, scoreFn, (score, bestScore) => score > bestScore);
    }

    function pickLowestScoringCandidate(candidates, scoreFn) {
        return pickCandidateByScore(candidates, scoreFn, (score, bestScore) => score < bestScore);
    }

    // Scores each candidate exactly once; strict comparison keeps the earliest
    // candidate on ties, matching the old reduce-over-scoreFn behavior.
    function pickCandidateByScore(candidates, scoreFn, isBetter) {
        const scored = candidates.map(candidate => ({ candidate, score: scoreFn(candidate) }));

        return scored.reduce((best, entry) => (isBetter(entry.score, best.score) ? entry : best)).candidate;
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
            await discardActionCard(action, getBoardCardCenter(action.owner, attacker.id));
            if (attackBlockReason.message) logEvent(attackBlockReason.message);
            if (attackBlockReason.popup) showPopup(attackBlockReason.popup);
            return;
        }

        const targetResolution = resolveActionTargets(action, attacker);
        const targets = targetResolution.targets;

        if (targets.length === 0) {
            await discardActionCard(action, getBoardCardCenter(action.owner, attacker.id));
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
        const dragonGemStatuses = getDragonGemStatusesForAttack(action.owner, action.card, isDamaging);
        const boosted = model.hasEffectBoost(action.owner);
        let handledEffect = false;

        showPopup(`${model.getCardName(attacker)} used ${model.getCardName(action.card)}.`);
        const impactCenter = await animateAttackCard(action, targets);

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
                    await resolveMultiAttackDamage(action.card, targets, attacker, boosted);
                } else {
                    const damageResults = targets.map(target => damagePokemon(target.owner, target.card, attacker, action.card));

                    showDamageNumbers(damageResults);
                    render();
                    await model.sleep(560);
                }
                handledEffect = true;
            }

            handledEffect = maybeApplyAttackStatChanges(
                action.card,
                getStatChangeTargets(action, attacker, targets),
                isDamaging,
                isMultiAttack ? MULTI_ATTACK_STAT_CHANGE_TRIGGER_CHANCE : STAT_CHANGE_TRIGGER_CHANCE,
                boosted
            ) || handledEffect;
            handledEffect = applyStatRevertEffects(statuses, targets) || handledEffect;
            handledEffect = maybeApplyAttackStatuses(action.card, targets, isDamaging, dragonGemStatuses, boosted) || handledEffect;
        }

        if (!handledEffect && statChanges.length === 0) {
            logEvent(`${model.getCardName(action.card)} had no effect.`);
        }

        await discardActionCard(action, impactCenter);
    }

    /**
     * Shared flight for action cards (attacks, items, gems): the card ghost
     * arcs from its source to the target and lands with an impact pulse.
     * Returns the impact center so discard animations can continue from it.
     */
    async function animateActionCardToTarget(card, sourceCenter, targetCenter, extraClass = '') {
        if (!sourceCenter || !targetCenter) {
            await model.sleep(280);
            return null;
        }

        const ghost = createCardAnimationElement(card, `attack-animation-card${extraClass ? ` ${extraClass}` : ''}`, true);

        if (!ghost) {
            await model.sleep(280);
            return null;
        }

        document.body.appendChild(ghost);
        await animateCardFlight(ghost, sourceCenter, targetCenter, {
            duration: 470,
            endRotate: 0,
            impactDuration: 250
        });
        ghost.remove();

        return targetCenter;
    }

    function getTargetElementsCenter(targets) {
        const targetElements = targets
            .map(target => getBoardCardElement(target.owner, target.card.id))
            .filter(Boolean);

        return targetElements.length > 0 ? getElementsCenter(targetElements) : null;
    }

    async function animateAttackCard(action, targets) {
        const sourceCenter = getBoardCardCenter(action.owner, action.userCardId);

        return animateActionCardToTarget(action.card, sourceCenter, getTargetElementsCenter(targets));
    }

    async function animateItemCard(itemCard, sourceCenter, targets) {
        return animateActionCardToTarget(itemCard, sourceCenter, getTargetElementsCenter(targets), 'item-animation-card');
    }

    async function animateDragonGemCard(itemCard, sourceCenter, ownerId) {
        const targetCenter = getDragonGemAnchorCenter(ownerId) || getArenaCenter();

        return animateActionCardToTarget(itemCard, sourceCenter, targetCenter, 'item-animation-card');
    }

    async function animateEffectBoostCard(itemCard, sourceCenter, ownerId) {
        const targetCenter = getEffectBoostAnchorCenter(ownerId) || getArenaCenter();

        return animateActionCardToTarget(itemCard, sourceCenter, targetCenter, 'item-animation-card');
    }

    /**
     * Applies an item's actual effects after the player/opponent item animation.
     * Items share the same healing, status, stat, switch, and targeting helpers
     * as attacks, but they are never placed in the queued attack resolver.
     */
    async function applyItemCard(itemCard, selection, actorId) {
        if (model.isDragonGemItemCard(itemCard)) {
            return applyDragonGemItemEffect(itemCard, actorId);
        }

        if (model.isEffectBoostItemCard(itemCard)) {
            return applyEffectBoostItemEffect(itemCard, actorId);
        }

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

        didSomething = applyStatRevertEffects(statuses, targets) || didSomething;

        if (applyStatusesToTargets(getBattleStatuses(itemCard), targets)) {
            didSomething = true;
        }

        logEvent(`${state.players[actorId].name} used ${model.getCardName(itemCard)}.`);
        showPopup(didSomething
            ? `${model.getCardName(itemCard)} took effect.`
            : `${model.getCardName(itemCard)} had no immediate effect.`
        );
    }

    function applyDragonGemItemEffect(itemCard, actorId) {
        const result = model.addDragonGemEffect(actorId, itemCard);
        const actor = state.players[actorId];

        if (!result.effect || !actor) {
            logEvent(`${model.getCardName(itemCard)} had no immediate effect.`);
            showPopup(`${model.getCardName(itemCard)} had no immediate effect.`);
            return false;
        }

        logEvent(`${actor.name} used ${result.effect.label}.`);

        if (result.replaced) {
            logEvent(`${result.effect.label} replaced ${result.replacedEffect.label}.`);
        }

        logEvent(`${actor.name}'s Dragon attacks can now apply ${result.effect.statusLabel}.`);
        showPopup(`${result.effect.label}: Dragon attacks may apply ${result.effect.statusLabel}.`);
        return true;
    }

    /**
     * Applies the standalone effect-boost item: sets a persistent per-side flag so
     * the side's attacks trigger their secondary effects more often and bias
     * multi-hit toward more hits for the rest of the battle.
     */
    function applyEffectBoostItemEffect(itemCard, actorId) {
        const actor = state.players[actorId];
        const applied = model.applyEffectBoost(actorId);

        if (!actor || !applied) {
            logEvent(`${model.getCardName(itemCard)} had no immediate effect.`);
            showPopup(`${model.getCardName(itemCard)} had no immediate effect.`);
            return false;
        }

        logEvent(`${actor.name} used ${model.getCardName(itemCard)}.`);
        logEvent(`${actor.name}'s attacks now trigger their effects more often.`);
        showPopup(`${model.getCardName(itemCard)}: effect chances boosted for the battle.`);
        return true;
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

        const damage = computeAttackDamage(attackerCard, pokemonCard, actionCard, getDamageVarianceMultiplier());
        const actualDamage = Math.min(pokemonCard.currentHealth, damage);
        const damagePercent = Math.ceil((actualDamage / pokemonCard.pokemon.baseHealth) * 100);

        pokemonCard.currentHealth = Math.max(0, pokemonCard.currentHealth - actualDamage);
        logEvent(`${model.getCardName(pokemonCard)} took ${actualDamage} damage.`);

        if (pokemonCard.currentHealth === 0) {
            knockOutPokemon(ownerId, pokemonCard);
        }

        return {
            cardId: pokemonCard.id,
            damage: actualDamage,
            damagePercent,
            ownerId
        };
    }

    /**
     * Pure damage-formula core shared by damagePokemon and the opponent AI's
     * target scoring: same stat selection and formula, but takes an explicit
     * variance multiplier and never mutates HP or checks Protect.
     */
    function computeAttackDamage(attackerCard, targetCard, actionCard, varianceMultiplier) {
        const attackerDamageStat = attackUsesDefenseAsDamageStat(actionCard) ? 'defense' : 'attack';
        let attackerAttack;
        let targetDefense;

        if (attackUsesBaseStatsOnly(actionCard)) {
            attackerAttack = getPokemonBaseStat(attackerCard, attackerDamageStat);
            targetDefense = getPokemonBaseStat(targetCard, 'defense');
        } else {
            attackerAttack = getBattleStat(attackerCard, attackerDamageStat);
            targetDefense = getBattleStat(targetCard, 'defense');
        }

        const attackBaseDamage = Number(actionCard.attack.basePower) || 0;
        const statRatio = targetDefense > 0 ? attackerAttack / targetDefense : attackerAttack;

        return Math.max(1, Math.ceil(statRatio * attackBaseDamage * varianceMultiplier));
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
        return 0.35 + (Math.random() * 0.1);
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
    async function resolveMultiAttackDamage(actionCard, targets, attacker, boosted = false) {
        const hitCount = getRandomMultiAttackHitCount(boosted);
        let executedHits = 0;

        for (let hitIndex = 0; hitIndex < hitCount; hitIndex += 1) {
            const activeTargets = targets.filter(target => (
                target.card.currentHealth > 0 &&
                model.getBoardCardById(target.owner, target.card.id) === target.card
            ));

            if (activeTargets.length === 0) break;

            const damageResults = activeTargets.map(target => damagePokemon(target.owner, target.card, attacker, actionCard));

            executedHits += 1;
            showDamageNumbers(damageResults);
            render();
            await model.sleep(260);
        }

        logEvent(`${model.getCardName(actionCard)} hit ${executedHits} ${executedHits === 1 ? 'time' : 'times'}.`);
    }

    /**
     * Rolls the number of hits for a MULTI_ATTACK. The unboosted baseline leans
     * toward the low end (2-3 hits); an active effect boost shifts the weight
     * toward the high end (4-5+ hits). Weights are index-aligned to hit counts
     * across MULTI_ATTACK_MIN_HITS..MULTI_ATTACK_MAX_HITS (2..6).
     */
    function getRandomMultiAttackHitCount(boosted = false) {
        const weights = boosted ? [1, 2, 4, 4, 3] : [4, 4, 2, 1, 1];
        const hitRange = MULTI_ATTACK_MAX_HITS - MULTI_ATTACK_MIN_HITS + 1;
        const totalWeight = weights.slice(0, hitRange).reduce((sum, weight) => sum + weight, 0);
        let roll = Math.random() * totalWeight;

        for (let index = 0; index < hitRange; index += 1) {
            roll -= weights[index];

            if (roll < 0) return MULTI_ATTACK_MIN_HITS + index;
        }

        return MULTI_ATTACK_MAX_HITS;
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
    function maybeApplyAttackStatuses(actionCard, targets, isDamaging, extraStatuses = [], boosted = false) {
        const statuses = getBattleStatuses(actionCard, extraStatuses);

        if (statuses.length === 0) return false;

        const triggerChance = boosted ? Math.min(1, STATUS_TRIGGER_CHANCE * 2) : STATUS_TRIGGER_CHANCE;

        if (isDamaging && Math.random() >= triggerChance) {
            logEvent(`${model.getCardName(actionCard)} status did not activate.`);
            return false;
        }

        return applyStatusesToTargets(statuses, targets);
    }

    function getDragonGemStatusesForAttack(ownerId, actionCard, isDamaging) {
        if (!isDamaging || !model.isAttackCard(actionCard) || !model.getCardTypes(actionCard).includes('DRAGON')) {
            return [];
        }

        return model.getDragonGemEffects(ownerId)
            .map(effect => effect.status)
            .filter(model.isBattleStatus);
    }

    function getBattleStatuses(actionCard, extraStatuses = []) {
        const seen = new Set();

        return [...model.getActionStatuses(actionCard), ...extraStatuses]
            .filter(status => {
                if (!model.isBattleStatus(status) || seen.has(status)) return false;

                seen.add(status);
                return true;
            });
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

    /**
     * Applies REVERT_STATS by resetting all target stat stages to neutral.
     */
    function applyStatRevertEffects(statuses, targets) {
        if (!statuses.includes('REVERT_STATS')) return false;

        let revertedAny = false;

        targets.forEach(target => {
            if (model.getBoardCardById(target.owner, target.card.id) !== target.card) return;
            if (!model.clearPokemonStatChanges(target.card)) return;

            revertedAny = true;
            logEvent(`${model.getCardName(target.card)}'s stat changes were reverted.`);
        });

        return revertedAny;
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
    function maybeApplyAttackStatChanges(actionCard, targets, isDamaging, triggerChance = STAT_CHANGE_TRIGGER_CHANCE, boosted = false) {
        const statChanges = model.getActionStatChanges(actionCard);

        if (statChanges.length === 0) return false;

        const effectiveChance = boosted ? Math.min(1, triggerChance * 2) : triggerChance;

        if (isDamaging && Math.random() >= effectiveChance) {
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
     * The defeat check counts pending Fossil revivals, so a knockout at the
     * limit still queues a replacement when a Fossil refund can keep the owner
     * in the battle.
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

        if (model.isPlayerDefeated(owner)) return;

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
     * Its earlier knockout is refunded so revival grants a real extra life.
     * Eligibility lives in the model so the defeat check stays in sync.
     */
    function reviveFossilPokemonFromKnockout(owner, slotIndex) {
        if (slotIndex < 0 || slotIndex >= BOARD_SLOT_COUNT || owner.board[slotIndex]) return null;

        const fossilIndex = model.findRevivableFossilIndex(owner);

        if (fossilIndex === -1) return null;

        const [fossilCard] = owner.knockout.splice(fossilIndex, 1);

        owner.knockoutCount = Math.max(0, (Number(owner.knockoutCount) || 0) - 1);
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
     * battle when either side's whole team has been knocked out.
     */
    function checkGameOver() {
        if (state.finished) return true;

        const playerDefeated = model.isPlayerDefeated(state.players.player);
        const opponentDefeated = model.isPlayerDefeated(state.players.opponent);

        if (!playerDefeated && !opponentDefeated) return false;

        state.finished = true;
        state.isResolving = false;
        state.currentPlayer = null;
        state.phase = 'finished';
        clearPendingAction();

        const outcome = playerDefeated ? 'loss' : 'win';
        const message = playerDefeated && opponentDefeated
            ? 'Both sides are out of Pokemon.'
            : playerDefeated
                ? `${state.players.opponent.name} wins.`
                : 'You win.';

        logEvent(message);
        showPopup(message);
        render();
        notifyBattleFinished(outcome);

        return true;
    }

    function getConfiguredPlayerName(playerId, fallbackName) {
        const config = arena.BattleConfig && arena.BattleConfig[playerId];

        return config && config.name ? config.name : fallbackName;
    }

    function notifyBattleFinished(outcome) {
        if (!arena.BattleFlow || typeof arena.BattleFlow.handleBattleFinished !== 'function') return;

        arena.BattleFlow.handleBattleFinished(outcome);
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
        state.log.unshift(formatLogEvent(message));

        if (state.log.length > LOG_ENTRY_LIMIT) {
            state.log.length = LOG_ENTRY_LIMIT;
        }
    }

    function formatLogEvent(message) {
        const turnLabel = state.turnNumber > 0 ? `Turn ${state.turnNumber}` : 'Setup';

        return `${turnLabel}: ${message}`;
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
        await animateCardFlight(ghost, sourceCenter, targetCenter, {
            duration: playerId === 'player' ? 560 : 520,
            endRotate: playerId === 'player' ? 1 : -1,
            endScale: playerId === 'player' ? 1 : 0.92
        });
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
        await animateCardFlight(ghost, sourceCenter, targetCenter, {
            duration: 560,
            endRotate: 0,
            endScale: 1
        });
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
        await animateCardFlight(ghost, sourceCenter, targetCenter, {
            duration: 500,
            endOpacity: 0.78,
            endRotate: 4,
            endScale: 0.88
        });
        ghost.remove();
    }

    /**
     * Shared ghost-card flight: arcs from source to target using transform
     * keyframes. options.impactDuration appends a landing pulse at the target,
     * used by attack/item flights so the card visibly connects before removal.
     */
    async function animateCardFlight(ghost, sourceCenter, targetCenter, options = {}) {
        placeAnimationElement(ghost, sourceCenter);

        await waitForNextFrame();

        const deltaX = targetCenter.x - sourceCenter.x;
        const deltaY = targetCenter.y - sourceCenter.y;
        const distance = Math.hypot(deltaX, deltaY);
        const arc = Math.min(86, Math.max(24, distance * 0.16));
        const direction = deltaX >= 0 ? 1 : -1;
        const flightDuration = options.duration || 540;
        const impactDuration = options.impactDuration || 0;
        const totalDuration = flightDuration + impactDuration;
        const arrivalOffset = flightDuration / totalDuration;
        const endOpacity = options.endOpacity === undefined ? 1 : options.endOpacity;
        const endRotate = options.endRotate === undefined ? 1 : options.endRotate;
        const endScale = options.endScale === undefined ? 1 : options.endScale;
        const landing = `translate3d(${deltaX}px, ${deltaY}px, 0)`;
        const keyframes = [
            {
                offset: 0,
                opacity: 1,
                transform: 'translate3d(0, 0, 0) rotate(-2deg) scale(0.96)'
            },
            {
                offset: arrivalOffset * 0.45,
                opacity: 1,
                transform: `translate3d(${deltaX * 0.45}px, ${(deltaY * 0.45) - arc}px, 0) rotate(${3 * direction}deg) scale(1.04)`
            },
            {
                offset: arrivalOffset,
                opacity: endOpacity,
                transform: `${landing} rotate(${endRotate}deg) scale(${endScale})`
            }
        ];

        if (impactDuration > 0) {
            keyframes.push(
                {
                    offset: arrivalOffset + ((1 - arrivalOffset) * 0.4),
                    opacity: endOpacity,
                    transform: `${landing} rotate(0deg) scale(${endScale * 1.12})`,
                    boxShadow: '0 0 0 7px rgba(216, 95, 79, 0.55), 0 18px 32px rgba(0, 0, 0, 0.38)'
                },
                {
                    offset: 1,
                    opacity: endOpacity,
                    transform: `${landing} rotate(0deg) scale(${endScale * 0.98})`
                }
            );
        }

        const animation = ghost.animate(keyframes, {
            duration: totalDuration,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            fill: 'forwards'
        });

        await settleAnimation(animation, totalDuration);
    }

    /**
     * Awaits a Web Animation but always settles within a bounded time. iOS Safari
     * pauses/interrupts animations when the page is backgrounded, and its
     * `finished` promise can then stay unresolved indefinitely. Because callers
     * hold state.isResolving true across this await, a hang here would leave all
     * input dead; a timer fallback (duration + buffer) guarantees the resolve
     * flow continues. Cancellation is harmless because the ghost is temporary.
     */
    function settleAnimation(animation, duration) {
        return new Promise(resolve => {
            let settled = false;
            const done = () => {
                if (settled) return;
                settled = true;
                resolve();
            };

            animation.finished.then(done, done);
            setTimeout(done, duration + 200);
        });
    }

    /**
     * Resolves on the next animation frame, but never hangs: iOS Safari stops
     * firing requestAnimationFrame while the page is backgrounded, which would
     * otherwise stall the resolve flow (leaving state.isResolving stuck true and
     * every input dead). A timer fallback settles the wait even when no frame ever
     * arrives.
     */
    function waitForNextFrame() {
        return new Promise(resolve => {
            let settled = false;
            const done = () => {
                if (settled) return;
                settled = true;
                resolve();
            };

            requestAnimationFrame(done);
            setTimeout(done, 100);
        });
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

    function getDragonGemAnchorCenter(ownerId) {
        const trayElement = document.querySelector(`.side-panel--${ownerId} .dragon-gem-tray`);

        if (trayElement) return getElementCenter(trayElement);

        const rowElement = document.querySelector(`.side-panel--${ownerId} .battle-row`);

        if (!rowElement) return null;

        const rect = rowElement.getBoundingClientRect();
        const x = rect.left + 20;
        const y = ownerId === 'opponent'
            ? rect.bottom - 20
            : rect.top + 20;

        return { x, y };
    }

    function getEffectBoostAnchorCenter(ownerId) {
        const trayElement = document.querySelector(`.side-panel--${ownerId} .effect-boost-tray`);

        return trayElement ? getElementCenter(trayElement) : getDragonGemAnchorCenter(ownerId);
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
            model.canPokemonUseAttackNow(playerId, card, attackCard)
        ));
    }

    function getPendingTargetOptions() {
        const pendingCard = model.findHandCard(state.players.player, state.pendingActionCardId);

        if (!pendingCard) return [];

        return model.getTargetOptionsForAction(pendingCard, 'player', state.pendingUserCardId);
    }

    function isTargetingPhase() {
        return state.phase === 'selecting-attack-target' || state.phase === 'selecting-item-target';
    }

    arena.Controller = {
        canPlayerAct,
        canPlayerEndTurn,
        canPlayerSelectCard,
        canDragPendingActionCard,
        canDiscardSelectedCard,
        canDropCardOnDiscard,
        cancelActionSelection,
        getDropActionForBoardCard,
        getDropActionForTargetGroup,
        handleCardDrop,
        handleArenaClick,
        resetPrototype,
        usePendingItem,
        useDragonGemItemFromHand,
        useEffectBoostItemFromHand,
        // Exposed for tests: effect-boost roll sites (phase 20).
        getRandomMultiAttackHitCount,
        maybeApplyAttackStatuses,
        maybeApplyAttackStatChanges,
        // Exposed for tests: sleep wake-ladder timing (phase 21).
        resolveSleepAttempt,
        tickSleepTimersWithoutAttack,
        // Exposed for tests: overkill damage capping and Fossil-aware
        // knockout-limit deferral.
        damagePokemon,
        knockOutPokemon,
        reviveFossilPokemonFromKnockout,
        // Exposed for tests: KO-aware/status-aware opponent attack targeting
        // (phase 40).
        chooseOpponentTarget,
        computeAttackDamage
    };
})(window.CardArena = window.CardArena || {});
