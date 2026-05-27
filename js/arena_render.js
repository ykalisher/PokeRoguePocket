/**
 * Pokemon Rogue Pocket - card arena rendering
 *
 * Render flow: controller mutates arena.state, then calls arena.Render.render()
 * through its render/save wrapper. This module redraws the board from state and
 * emits data-* attributes that controller and drag handlers use as their event
 * routing surface. It does not mutate battle rules or advance phases.
 */

(function attachArenaRender(arena) {
    'use strict';

    const state = arena.state;
    const { KNOCKOUT_LIMIT } = arena.Constants;
    const ACTION_STATUS_ICON_ALIASES = Object.freeze({
        FULL_HEAL: ['HEAL', 'HEAL_STATUS']
    });
    const REFERENCE_TYPES = Object.freeze([
        'ARTIFICIAL',
        'BABY',
        'BUG',
        'DARK',
        'DRAGON',
        'ELECTRIC',
        'FAIRY',
        'FIGHTING',
        'FIRE',
        'FLYING',
        'FOSSIL',
        'GHOST',
        'GOURMET',
        'GRASS',
        'GROUND',
        'HUMAN',
        'ICE',
        'LEGENDARY',
        'MONSTER',
        'NORMAL',
        'POISON',
        'PSYCHIC',
        'ROCK',
        'STEEL',
        'WATER'
    ]);
    const SPECIAL_TYPE_RULES = Object.freeze([
        { type: 'FIGHTING', text: 'While affected by any persistent status, gains 1.5x Attack and ignores Burn\'s Attack penalty.' },
        { type: 'NORMAL', text: 'A single action can only move each stat by a net +1 or -1 stage after other type modifiers.' },
        { type: 'HUMAN', text: 'Doubles the net stat-stage delta received from each action.' },
        { type: 'ICE', text: 'ICE attacks calculate damage from base Attack and base Defense only, ignoring stat stages and status multipliers.' },
        { type: 'STEEL', text: 'STEEL attacks use the attacker\'s Defense instead of Attack as the damage stat.' },
        { type: 'DRAGON', text: 'A played Dragon Gem marks that side. Its damaging DRAGON attacks can apply the active gem\'s paired status using the normal status chance. Playing another Dragon Gem replaces the current one.' },
        { type: 'FOSSIL', text: 'A Fossil already in the knockout pile can revive once at end of turn after another allied Pokemon is knocked out, returning with 60% max HP and Fatigue instead of drawing a replacement.' }
    ]);
    const PERSISTENT_STATUS_REFERENCE = Object.freeze([
        { status: 'BURN', text: 'End of turn: 5% max HP damage. While active: Attack is halved unless the Pokemon is FIGHTING. Protect blocks burn damage.' },
        { status: 'CONFUSION', text: 'Before attacking: 50% chance to recover. If still confused, 50% chance to take 10% max HP self-damage and lose the attack. Protect blocks that damage.' },
        { status: 'FATIGUE', text: 'Lasts 3 end-of-turn cleanup ticks. While active: Defense and Speed are multiplied by 0.75.' },
        { status: 'FLINCH', text: 'Prevents the next attack and expires at end of turn.' },
        { status: 'PARALYSIS', text: 'While active: Speed is halved. Before attacking: 1-in-3 chance to lose the attack.' },
        { status: 'POISON', text: 'End of turn: 10% max HP damage. Protect blocks poison damage.' },
        { status: 'PROTECT', text: 'Gives the action priority, blocks incoming attack and status damage, and expires at end of turn.' },
        { status: 'SLEEP', text: 'Prevents attacks until wake-up. First wake attempt fails, attempts 2 and 3 have a 50% wake chance, and attempt 4 always wakes.' }
    ]);
    const ACTION_EFFECT_REFERENCE = Object.freeze([
        { status: 'FULL_HEAL', text: 'Restores 20% max HP and clears the target\'s persistent status.' },
        { status: 'HEAL', text: 'Restores 20% max HP.' },
        { status: 'HEAL_BURN', text: 'Clears Burn only.' },
        { status: 'HEAL_STATUS', text: 'Clears the target\'s persistent status.' },
        { status: 'MULTI_ATTACK', text: 'Damaging attack hits 2-6 times. Its stat-change effect uses a 20% activation chance.' },
        { status: 'DRAGON_GEM', text: 'Adds or replaces a side marker. Damaging DRAGON attacks from that side can apply this gem\'s paired status.' },
        { status: 'SELF_INFLICT', text: 'Stat changes apply to the attacking Pokemon instead of the selected targets.' },
        { status: 'SWITCH', text: 'Removes the target from the board, clears stat stages, puts it on the bottom of its Pokemon deck, and draws a replacement.' }
    ]);
    const STAGE_REFERENCE = Object.freeze([
        [-6, '0.1x'],
        [-5, '0.2x'],
        [-4, '0.35x'],
        [-3, '0.5x'],
        [-2, '0.67x'],
        [-1, '0.8x'],
        [0, '1x'],
        [1, '1.5x'],
        [2, '2x'],
        [3, '2.5x'],
        [4, '3x'],
        [5, '3.5x'],
        [6, '4x']
    ]);
    const CARD_BACK_PATHS = Object.freeze({
        deck: 'assets/card-backs/ACTION_CARD_BACK.png',
        'pokemon-deck': 'assets/card-backs/POKEMON_CARD_BACK.png'
    });
    const VIEWABLE_PILE_TYPES = Object.freeze(['deck', 'discard', 'pokemon-deck']);

    /**
     * Public full-board render called after meaningful state changes.
     */
    function render() {
        state.elements.board.innerHTML = `
            ${renderSide('opponent')}
            ${renderStatus()}
            ${renderSide('player')}
            ${state.rulesWindowOpen ? renderRulesReferenceWindow() : ''}
            ${state.pileWindow ? renderPileWindow() : ''}
        `;
    }

    /**
     * Renders one player's hand, board slots, piles, and counters.
     */
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
                        <span class="stat-pill">Pkmn deck ${player.pokemonDeck.length}</span>
                        <span class="stat-pill">Action deck ${player.deck.length}</span>
                        <span class="stat-pill">Hand ${player.hand.length}/${arena.Model.getPlayerHandSize(player)}</span>
                        <span class="stat-pill">Discard ${player.discard.length}</span>
                        <span class="stat-pill">KO ${player.knockoutCount}/${KNOCKOUT_LIMIT}</span>
                    </div>
                </header>
                ${handFirst}
                <div class="battle-row">
                    ${renderDragonGemTray(player)}
                    ${renderPile('Pkmn', player.pokemonDeck.length, 'pokemon-deck', player.id)}
                    ${renderPile('Action', player.deck.length, 'deck', player.id)}
                    ${renderPlayedSlots(player)}
                    ${renderPile('Discard', player.discard.length, 'discard', player.id)}
                    ${renderPile('KO', player.knockout.length, 'knockout', player.id)}
                </div>
                ${handLast}
            </section>
        `;
    }

    function renderDragonGemTray(player) {
        const effects = arena.Model.getDragonGemEffects(player.id);

        if (effects.length === 0) return '';

        return `
            <div class="dragon-gem-tray dragon-gem-tray--${player.id}" aria-label="${player.name} Dragon Gems">
                ${effects.map(effect => `
                    <span class="dragon-gem-token" title="${effect.label}: Dragon attacks may apply ${effect.statusLabel}">
                        <img src="${effect.iconPath}" alt="${effect.label}">
                    </span>
                `).join('')}
            </div>
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

    function renderPile(label, count, type, ownerId) {
        const player = state.players[ownerId];
        const cards = getPileCards(player, type);
        const isEmpty = count === 0 ? ' is-empty' : '';
        const canOpen = ownerId === 'player' && VIEWABLE_PILE_TYPES.includes(type);
        const tagName = canOpen ? 'button' : 'div';
        const buttonAttributes = canOpen
            ? `type="button" data-pile-view-owner="${ownerId}" data-pile-view-type="${type}" aria-haspopup="dialog"`
            : '';
        const title = `${getPileTitle(type)} pile, ${count} ${count === 1 ? 'card' : 'cards'}`;

        return `
            <div class="pile pile--${type}" data-pile-owner="${ownerId}" data-pile-type="${type}">
                <${tagName} class="pile-card ${getPileCardClass(type, cards)}${isEmpty}" ${buttonAttributes} aria-label="${title}">
                    ${renderPileCardContent(type, cards, count)}
                </${tagName}>
            </div>
        `;
    }

    function getPileCards(player, type) {
        if (!player) return [];

        if (type === 'pokemon-deck') return player.pokemonDeck || [];
        if (type === 'deck') return player.deck || [];
        if (type === 'discard') return player.discard || [];
        if (type === 'knockout') return player.knockout || [];

        return [];
    }

    function getPileCardClass(type, cards) {
        if ((type === 'pokemon-deck' || type === 'deck') && cards.length > 0) return 'pile-card--card-back';
        if (type === 'discard' && cards.length > 0) return 'pile-card--discard-preview';

        return '';
    }

    function renderPileCardContent(type, cards, count) {
        if ((type === 'pokemon-deck' || type === 'deck') && cards.length > 0) {
            return `
                <img class="pile-card-back-image" src="${CARD_BACK_PATHS[type]}" alt="">
                <span class="pile-count-badge">${count}</span>
            `;
        }

        if (type === 'discard' && cards.length > 0) {
            const topCard = cards[0];

            return `
                <span class="pile-card-kind">${getPileCardKindLabel(topCard)}</span>
                <span class="pile-card-name">${arena.Model.getCardName(topCard)}</span>
                <span class="pile-count-badge">${count}</span>
            `;
        }

        return `<span class="pile-empty-count">${count}</span>`;
    }

    function renderPileWindow() {
        const windowState = state.pileWindow || {};
        const player = state.players[windowState.ownerId];
        const type = windowState.type;
        const rawCards = getPileCards(player, type);
        const cards = shouldSortPileWindow(type) ? rawCards.slice().sort(compareCardsByName) : rawCards;
        const title = `${player ? player.name : ''} ${getPileTitle(type)}`.trim();
        const count = rawCards.length;

        return `
            <section class="pile-window" role="dialog" aria-modal="false" aria-label="${title}">
                <header class="pile-window-header">
                    <div>
                        <h3 class="pile-window-title">${title}</h3>
                        <span class="pile-window-count">${count} ${count === 1 ? 'card' : 'cards'}</span>
                    </div>
                    <button class="pile-window-close" type="button" data-action="close-pile-window" aria-label="Close pile window">&times;</button>
                </header>
                <div class="pile-window-cards">
                    ${cards.length > 0 ? cards.map(renderPileWindowCard).join('') : '<span class="empty-hand">Empty</span>'}
                </div>
            </section>
        `;
    }

    function renderPileWindowCard(card, index) {
        return `
            <article class="pile-window-entry">
                <span class="pile-window-index">${index + 1}</span>
                <span class="pile-window-thumb pile-window-thumb--${card.kind}" aria-hidden="true">
                    ${renderPileWindowThumb(card)}
                </span>
                <div class="pile-window-card-summary">
                    <strong>${arena.Model.getCardName(card)}</strong>
                    <span>${getPileCardKindLabel(card)}</span>
                </div>
            </article>
        `;
    }

    function renderPileWindowThumb(card) {
        if (arena.Model.isPokemonCard(card)) {
            return `<img src="${arena.Model.getPortraitUrl(card)}" alt="">`;
        }

        if (arena.Model.isItemCard(card)) {
            return `<img src="${getItemPictureUrl(card)}" alt="">`;
        }

        const types = arena.Model.getCardTypes(card);

        return types.length > 0
            ? renderTypeIcons(types, 'pile-window-thumb-type')
            : `<span>${getPileCardKindLabel(card).slice(0, 1)}</span>`;
    }

    function shouldSortPileWindow(type) {
        return type === 'deck' || type === 'pokemon-deck';
    }

    function compareCardsByName(leftCard, rightCard) {
        const nameComparison = arena.Model.getCardName(leftCard).localeCompare(arena.Model.getCardName(rightCard));

        if (nameComparison !== 0) return nameComparison;

        return getPileCardKindLabel(leftCard).localeCompare(getPileCardKindLabel(rightCard));
    }

    function getPileTitle(type) {
        if (type === 'pokemon-deck') return 'Pokemon Deck';
        if (type === 'deck') return 'Action Deck';
        if (type === 'discard') return 'Discard';
        if (type === 'knockout') return 'KO';

        return 'Pile';
    }

    function getPileCardKindLabel(card) {
        if (arena.Model.isPokemonCard(card)) return 'Pokemon';
        if (arena.Model.isAttackCard(card)) return 'Attack';
        if (arena.Model.isItemCard(card)) return 'Item';

        return 'Card';
    }

    /**
     * Renders a board slot with targeting/user/queued state derived from the
     * current controller phase.
     */
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

    /**
     * During attack target selection, renders the pending attack card floating
     * over its selected user so it can be dragged to a target.
     */
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

    /**
     * Computes UI flags for board cards based on pending action state and model
     * target options. These flags become classes and clickable attributes.
     */
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

    /**
     * Renders player or opponent hand. Opponent cards stay face down; the
     * player's cards expose data-card-id for click and drag input.
     */
    function renderHand(player) {
        const isOpponent = player.id === 'opponent';
        const cards = player.hand.map(card => {
            if (shouldHideHandCard(card)) return '';

            if (isOpponent) {
                return renderCard(card, { context: 'hand', reveal: false });
            }

            const selectedClass = state.selectedCardId === card.id || state.pendingActionCardId === card.id ? ' is-selected' : '';
            const arrivalClass = isCardArriving(card) ? ' is-arriving-card' : '';

            return `
                <button class="playing-card hand-card card-kind-${card.kind}${selectedClass}${arrivalClass}" type="button" data-card-id="${card.id}" data-hand-card-id="${card.id}" aria-label="Select ${arena.Model.getCardName(card)}">
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

    /**
     * Renders a card shell for hand/board contexts, including data attributes
     * that controller click handling and drag/drop consume.
     */
    function renderCard(card, options) {
        const reveal = options.reveal;
        const backClass = reveal ? '' : ' card-back';
        const targetClass = options.singleTarget ? ' is-targetable' : '';
        const actionTargetClass = options.actionTarget ? ' is-action-target' : '';
        const userOptionClass = options.userOption ? ' is-user-option' : '';
        const userActiveClass = options.userActive ? ' is-user-active' : '';
        const arrivalClass = isCardArriving(card) ? ' is-arriving-card' : '';
        const kindClass = ` card-kind-${card.kind}`;
        const tagName = options.singleTarget || options.userOption ? 'button' : 'div';
        const targetAttributes = options.singleTarget ? `type="button" data-target-card-id="${card.id}" data-target-owner="${options.owner}"` : options.userOption ? 'type="button"' : '';
        const boardAttributes = options.context === 'board' ? `data-board-card-id="${card.id}" data-board-owner="${options.owner}" data-board-slot="${options.slotIndex}"` : '';
        const handAttributes = options.context === 'hand' ? `data-hand-card-id="${card.id}"` : '';
        const ariaLabel = options.singleTarget ? `Target ${arena.Model.getCardName(card)}` : `${reveal ? arena.Model.getCardName(card) : 'Face down card'}`;

        return `
            <${tagName} class="playing-card ${options.context}-card${kindClass}${backClass}${targetClass}${actionTargetClass}${userOptionClass}${userActiveClass}${arrivalClass}" ${targetAttributes} ${boardAttributes} ${handAttributes} aria-label="${ariaLabel}">
                ${renderCardContent(card, reveal)}
            </${tagName}>
        `;
    }

    function isCardArriving(card) {
        return Boolean(card && Array.isArray(state.arrivingCardIds) && state.arrivingCardIds.includes(card.id));
    }

    /**
     * Chooses card face rendering or card back rendering based on visibility.
     */
    function renderCardContent(card, reveal, options = {}) {
        if (!reveal) {
            return `
                <div class="card-topline">Rogue</div>
                <div class="card-body">?</div>
                <div class="card-footer">Pocket</div>
            `;
        }

        if (arena.Model.isPokemonCard(card)) {
            return renderPokemonCardContent(card, options);
        }

        if (arena.Model.isAttackCard(card)) {
            return renderActionCardContent(card, options);
        }

        return renderActionCardContent(card, options);
    }

    /**
     * Public helper used by controller animation code to create temporary card
     * markup without redrawing the arena.
     */
    function renderCardForAnimation(card, animationClass = 'attack-animation-card', reveal = true) {
        const backClass = reveal ? '' : ' card-back';

        return `
            <div class="playing-card hand-card card-kind-${card.kind}${backClass} ${animationClass}" aria-hidden="true">
                ${renderCardContent(card, reveal)}
            </div>
        `;
    }

    /**
     * Renders Pokemon-specific content: portrait, status tokens, types, health,
     * and effective stats.
     */
    function renderPokemonCardContent(card, options = {}) {
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
                    <div class="type-row">${renderTypeIcons(species.types, 'type-row', options)}</div>
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

    /**
     * Renders one effective stat cell. Positive/negative stages are shown by
     * color only so compact cards do not need extra +/- text.
     */
    function renderStatCell(card, stat) {
        const labels = {
            attack: 'ATK',
            defense: 'DF',
            speed: 'SPD'
        };
        const stage = arena.Model.getPokemonStatStage(card, stat);
        const stageClass = stage > 0
            ? ' stat-cell--up'
            : stage < 0
                ? ' stat-cell--down'
                : '';
        return `<span class="stat-cell${stageClass}">${labels[stat]} ${arena.Model.getPokemonEffectiveStat(card, stat)}</span>`;
    }

    /**
     * Renders attack/item-specific content, including requirements, base power,
     * statuses, stat changes, and target text.
     */
    function renderActionCardContent(card, options = {}) {
        const isAttack = arena.Model.isAttackCard(card);
        const types = arena.Model.getCardTypes(card);
        const target = formatTarget(arena.Model.getActionTarget(card));
        const allTypesRequired = isAttack && card.attack.full_type_requirements && types.length > 1;
        const typeRowClass = allTypesRequired ? ' action-type-row--all-required' : '';
        const typeRequirementLabel = allTypesRequired ? 'All listed types required' : 'Any listed type required';

        return `
            <div class="action-card-shell">
                <span class="action-card-name">${arena.Model.getCardName(card)}</span>
                ${isAttack ? renderActionTypeRow(types, typeRowClass, typeRequirementLabel, options) : renderItemPicture(card)}
                ${renderActionDetails(card)}
                <span class="action-card-meta">${target}</span>
            </div>
        `;
    }

    function renderActionTypeRow(types, typeRowClass, typeRequirementLabel, options) {
        return types.length > 0
            ? `<div class="action-type-row${typeRowClass}" title="${typeRequirementLabel}" aria-label="${typeRequirementLabel}">${renderTypeIcons(types, 'action-type-row', options)}</div>`
            : '<div class="action-type-row action-type-row--empty">No type</div>';
    }

    function renderItemPicture(card) {
        return `
            <div class="item-picture-row">
                <img class="item-picture" src="${getItemPictureUrl(card)}" alt="">
            </div>
        `;
    }

    function getItemPictureUrl(card) {
        if (!arena.Model.isItemCard(card)) return '';

        const item = card.item || {};

        return item.imagePath || item.picturePath || item.image || `assets/items/${formatAssetName(item.name)}.png`;
    }

    /**
     * Renders compact attack/item effect badges from model-provided statuses and
     * stat changes.
     */
    function renderActionDetails(card) {
        const parts = [];
        const basePower = arena.Model.isAttackCard(card) ? Number(card.attack.basePower) || 0 : 0;
        const statusIcons = renderActionStatusIcons(arena.Model.getActionStatuses(card));
        const statChanges = renderActionStatChanges(arena.Model.getActionStatChanges(card));

        if (basePower > 0) {
            parts.push(`<span class="attack-power" title="Base power" aria-label="Base power ${basePower}">PWR ${basePower}</span>`);
        }

        if (statusIcons) parts.push(statusIcons);
        if (statChanges) parts.push(statChanges);

        if (parts.length === 0) return '';

        return `<div class="action-card-effects">${parts.join('')}</div>`;
    }

    function renderActionStatusIcons(statuses) {
        const icons = statuses
            .flatMap(getActionStatusIconStatuses)
            .map(status => {
                const iconPath = arena.Model.getStatusIconPath(status);
                const label = arena.Model.formatStatusName(status);

                if (!iconPath) {
                    return `<span class="action-status-token action-status-token--text" title="${label}" aria-label="${label}">${getStatusInitials(label)}</span>`;
                }

                return `
                    <span class="action-status-token" title="${label}">
                        <img src="${iconPath}" alt="${label}">
                    </span>
                `;
            })
            .join('');

        return icons ? `<span class="action-status-list">${icons}</span>` : '';
    }

    function getActionStatusIconStatuses(status) {
        return ACTION_STATUS_ICON_ALIASES[status] || [status];
    }

    function getStatusInitials(label) {
        return label
            .split(/\s+/)
            .filter(Boolean)
            .map(part => part[0])
            .join('')
            .slice(0, 2)
            .toUpperCase();
    }

    /**
     * Groups repeated stat changes into one visual badge per stat.
     */
    function renderActionStatChanges(statChanges) {
        const groups = statChanges.reduce((changesByStat, statChange) => {
            const detail = getStatChangeDetail(statChange);

            if (!detail) return changesByStat;

            if (!changesByStat[detail.stat]) {
                changesByStat[detail.stat] = { down: 0, up: 0 };
            }

            changesByStat[detail.stat][detail.direction] += 1;

            return changesByStat;
        }, {});
        const renderedChanges = ['ATK', 'DEF', 'SPD']
            .map(stat => renderActionStatChange(stat, groups[stat]))
            .filter(Boolean)
            .join('');

        return renderedChanges ? `<span class="action-stat-change-list">${renderedChanges}</span>` : '';
    }

    function getStatChangeDetail(statChange) {
        const details = {
            ATTACK_DOWN: { direction: 'down', stat: 'ATK' },
            ATTACK_UP: { direction: 'up', stat: 'ATK' },
            DEFENSE_DOWN: { direction: 'down', stat: 'DEF' },
            DEFENSE_UP: { direction: 'up', stat: 'DEF' },
            SPEED_DOWN: { direction: 'down', stat: 'SPD' },
            SPEED_UP: { direction: 'up', stat: 'SPD' }
        };

        return details[statChange] || null;
    }

    function renderActionStatChange(stat, counts) {
        if (!counts || (counts.up === 0 && counts.down === 0)) return '';

        const upArrows = renderStatArrows('up', counts.up);
        const downArrows = renderStatArrows('down', counts.down);
        const labelParts = [];

        if (counts.up > 0) labelParts.push(`${counts.up} ${formatStageWord(counts.up)} up`);
        if (counts.down > 0) labelParts.push(`${counts.down} ${formatStageWord(counts.down)} down`);

        return `
            <span class="action-stat-change" title="${stat} ${labelParts.join(', ')}" aria-label="${stat} ${labelParts.join(', ')}">
                <span class="action-stat-name">${stat}</span>
                <span class="stat-arrows">${upArrows}${downArrows}</span>
            </span>
        `;
    }

    function renderStatArrows(direction, count) {
        return Array.from({ length: count }, () => (
            `<span class="stat-arrow stat-arrow--${direction}" aria-hidden="true"></span>`
        )).join('');
    }

    function formatStageWord(count) {
        return count === 1 ? 'stage' : 'stages';
    }

    /**
     * Renders type icons, optionally as filter buttons for overview contexts.
     */
    function renderTypeIcons(types, className, options = {}) {
        return types.slice(0, 3).map(type => `
            ${options.typeButtons
                ? `<button class="type-filter-button" type="button" data-type="${type}" aria-pressed="false" aria-label="Filter by ${formatTypeName(type)} type"><img class="type-icon" src="assets/types-svgs/${type}.svg" alt="${type}"></button>`
                : `<img class="type-icon" src="assets/types-svgs/${type}.svg" alt="${type}">`
            }
        `).join('');
    }

    /**
     * Public card preview renderer used outside the battle board, such as card
     * overview screens.
     */
    function renderCardPreview(card, options = {}) {
        const className = options.className ? ` ${options.className}` : '';
        const attributes = options.attributes || '';
        const kindClass = ` card-kind-${card.kind}`;
        const ariaLabel = arena.Model.getCardName(card);

        return `
            <div class="playing-card overview-card${kindClass}${className}" ${attributes} aria-label="${ariaLabel}">
                ${renderCardContent(card, true, options)}
            </div>
        `;
    }

    /**
     * Renders the central turn/status controls. Buttons expose data-action
     * values that Controller.handleArenaClick() routes.
     */
    function renderStatus() {
        const player = state.players.player;
        const pendingActionCard = player.hand.find(card => card.id === state.pendingActionCardId);
        const selectedCard = player.hand.find(card => card.id === state.selectedCardId);
        const selectedText = renderSelectedText(pendingActionCard, selectedCard);
        const canEnd = arena.Controller.canPlayerEndTurn();
        const canDiscard = arena.Controller.canDiscardSelectedCard();

        return `
            <section class="arena-status" aria-label="Turn controls">
                <span class="turn-pill">${renderTurnLabel()}</span>
                <div class="turn-copy">
                    <p>${renderTurnMessage()}</p>
                </div>
                <span class="selected-pill">${selectedText}</span>
                <div class="action-bar">
                    ${renderActionButtons(canEnd, canDiscard)}
                </div>
                <ul class="event-log" aria-label="Battle log">
                    ${state.log.map(entry => `<li>${entry}</li>`).join('')}
                </ul>
            </section>
        `;
    }

    function renderTurnLabel() {
        if (state.finished) return 'Finished';
        if (state.phase === 'setup') return 'Setup';
        if (state.phase === 'selecting-attack-user') return 'User';
        if (state.phase === 'selecting-attack-target' || state.phase === 'selecting-item-target') return 'Target';
        if (state.phase === 'opponent-planning') return 'Rival';
        if (state.phase === 'resolving') return 'Resolve';
        return `Round ${state.turnNumber}`;
    }

    function renderTurnMessage() {
        if (state.finished) return 'Match finished.';
        if (state.phase === 'setup') return 'Opening Pokemon are entering the arena.';
        if (state.phase === 'selecting-attack-user') return 'Choose which Pokemon will use this attack.';
        if (state.phase === 'selecting-attack-target') return 'Drag the attack to a target or click a target.';
        if (state.phase === 'selecting-item-target') return 'Choose the item target.';
        if (state.phase === 'opponent-planning') return 'Rival is choosing attacks.';
        if (state.phase === 'resolving') return 'Attacks resolve by speed.';
        if (state.currentPlayer === 'opponent') return state.isResolving ? 'Rival is choosing.' : 'Rival turn.';
        if (state.isResolving) return 'Resolving action.';
        return 'Use one item, ready attacks, or discard cards.';
    }

    function renderActionButtons(canEnd, canDiscard) {
        const rulesButton = renderRulesButton();

        if (state.finished) {
            return `
                <button class="arena-button" type="button" data-action="reset">Restart</button>
                ${rulesButton}
            `;
        }

        if (['selecting-attack-user', 'selecting-attack-target', 'selecting-item-target'].includes(state.phase)) {
            return `
                <button class="arena-button" type="button" data-action="cancel-action">Cancel</button>
                <button class="arena-button arena-button--discard" type="button" data-action="discard-selected" ${canDiscard ? '' : 'disabled'}>Discard</button>
                ${rulesButton}
            `;
        }

        if (state.currentPlayer !== 'player') {
            return `
                <button class="arena-button arena-button--discard" type="button" disabled>Discard</button>
                <button class="arena-button arena-button--danger" type="button" disabled>End Turn</button>
                ${rulesButton}
            `;
        }

        return `
            <button class="arena-button arena-button--discard" type="button" data-action="discard-selected" ${canDiscard ? '' : 'disabled'}>Discard</button>
            <button class="arena-button arena-button--danger" type="button" data-action="end-turn" ${canEnd ? '' : 'disabled'}>End Turn</button>
            ${rulesButton}
        `;
    }

    function renderRulesButton() {
        const pressed = state.rulesWindowOpen ? 'true' : 'false';

        return `
            <button class="arena-button arena-button--reference" type="button" data-action="toggle-rules" aria-pressed="${pressed}">
                <span aria-hidden="true">?</span>
                <span>Rules</span>
            </button>
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

    /**
     * Checks whether the side panel should become a group target during an
     * attack/item target phase.
     */
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

    function renderRulesReferenceWindow() {
        return `
            <div class="rules-reference-overlay" role="presentation">
                <section class="rules-reference-window" role="dialog" aria-modal="false" aria-labelledby="rules-reference-title">
                    <header class="rules-reference-header">
                        <div>
                            <h2 id="rules-reference-title">Battle Reference</h2>
                            <p>Types, statuses, and stat stages.</p>
                        </div>
                        <button class="rules-reference-close" type="button" data-action="close-rules" aria-label="Close battle reference" title="Close">x</button>
                    </header>
                    <div class="rules-reference-body">
                        ${renderTypeReferenceSection()}
                        ${renderStatusReferenceSection()}
                        ${renderStageReferenceSection()}
                    </div>
                </section>
            </div>
        `;
    }

    function renderTypeReferenceSection() {
        return `
            <section class="rules-reference-section">
                <h3>Types</h3>
                <div class="rules-reference-copy">
                    <p>Pokemon can use an attack when they share at least one of the attack's listed types.</p>
                    <p>Attacks marked as all required need the Pokemon to have every listed attack type.</p>
                    <p>There is no type matchup damage chart; type rules are requirements and special battle abilities.</p>
                </div>
                <div class="reference-type-grid" aria-label="Available types">
                    ${REFERENCE_TYPES.map(renderReferenceTypeChip).join('')}
                </div>
                <div class="reference-rule-list">
                    ${SPECIAL_TYPE_RULES.map(rule => `
                        <article class="reference-rule-row">
                            ${renderReferenceTypeChip(rule.type)}
                            <p>${rule.text}</p>
                        </article>
                    `).join('')}
                </div>
            </section>
        `;
    }

    function renderStatusReferenceSection() {
        return `
            <section class="rules-reference-section">
                <h3>Statuses</h3>
                <p class="rules-reference-lede">Only one persistent status can be active on a Pokemon at a time. A new persistent status is blocked while another one is active.</p>
                <h4>Persistent Statuses</h4>
                <div class="reference-rule-list">
                    ${PERSISTENT_STATUS_REFERENCE.map(renderReferenceStatusRow).join('')}
                </div>
                <h4>Action Effects</h4>
                <div class="reference-rule-list">
                    ${ACTION_EFFECT_REFERENCE.map(renderReferenceStatusRow).join('')}
                </div>
            </section>
        `;
    }

    function renderStageReferenceSection() {
        return `
            <section class="rules-reference-section">
                <h3>Stat Stages</h3>
                <div class="rules-reference-copy">
                    <p>Attack, Defense, and Speed each track stages from -6 to +6.</p>
                    <p>Each *_UP adds one stage. Each *_DOWN removes one stage. Effective stats are rounded after stage and status/type multipliers, with a minimum of 1.</p>
                    <p>Damaging attacks roll a 1-in-3 stat-change activation chance. MULTI_ATTACK uses 20%. Non-damaging attacks and items apply stat changes immediately.</p>
                </div>
                <div class="stage-reference-table" role="table" aria-label="Stat stage multipliers">
                    <div class="stage-reference-row stage-reference-row--header" role="row">
                        <span role="columnheader">Stage</span>
                        <span role="columnheader">Multiplier</span>
                    </div>
                    ${STAGE_REFERENCE.map(([stage, multiplier]) => `
                        <div class="stage-reference-row" role="row">
                            <span class="${stage > 0 ? 'stage-up' : stage < 0 ? 'stage-down' : ''}" role="cell">${stage > 0 ? `+${stage}` : stage}</span>
                            <span role="cell">${multiplier}</span>
                        </div>
                    `).join('')}
                </div>
            </section>
        `;
    }

    function renderReferenceTypeChip(type) {
        return `
            <span class="reference-type-chip">
                <img class="type-icon" src="assets/types-svgs/${type}.svg" alt="">
                <span>${formatTypeName(type)}</span>
            </span>
        `;
    }

    function renderReferenceStatusRow(entry) {
        return `
            <article class="reference-rule-row">
                ${renderReferenceStatusChip(entry.status)}
                <p>${entry.text}</p>
            </article>
        `;
    }

    function renderReferenceStatusChip(status) {
        const label = arena.Model.formatStatusName(status);
        const iconPath = arena.Model.getStatusIconPath(status);

        return `
            <span class="reference-status-chip">
                ${iconPath
                    ? `<img class="action-status-token" src="${iconPath}" alt="">`
                    : `<span class="action-status-token action-status-token--text" aria-hidden="true">${getStatusInitials(label)}</span>`
                }
                <span>${label}</span>
            </span>
        `;
    }

    function formatTarget(target) {
        const labels = {
            ALL_ALLIES: 'All Allies',
            ALL_OPPONENTS: 'All Opponents',
            ALLY: 'One Ally',
            OPPONENT: 'One Opponent',
            SELF: 'Self',
            SIDE: 'Your Side'
        };

        return labels[target] || 'No target';
    }

    function formatTypeName(type) {
        return String(type || '')
            .toLowerCase()
            .split('_')
            .map(part => part ? part[0].toUpperCase() + part.slice(1) : '')
            .join(' ');
    }

    function formatAssetName(name) {
        return String(name || 'item')
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
    }

    arena.Render = {
        render,
        renderCardPreview,
        renderCardForAnimation
    };
})(window.CardArena = window.CardArena || {});
