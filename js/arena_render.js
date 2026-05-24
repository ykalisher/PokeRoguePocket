/**
 * Squish - card arena rendering
 *
 * Render flow: controller mutates arena.state, then calls arena.Render.render()
 * through its render/save wrapper. This module redraws the board from state and
 * emits data-* attributes that controller and drag handlers use as their event
 * routing surface. It does not mutate battle rules or advance phases.
 */

(function attachArenaRender(arena) {
    'use strict';

    const state = arena.state;
    const ACTION_STATUS_ICON_ALIASES = Object.freeze({
        FULL_HEAL: ['HEAL', 'HEAL_STATUS']
    });

    /**
     * Public full-board render called after meaningful state changes.
     */
    function render() {
        state.elements.board.innerHTML = `
            ${renderSide('opponent')}
            ${renderStatus()}
            ${renderSide('player')}
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

    /**
     * Chooses card face rendering or card back rendering based on visibility.
     */
    function renderCardContent(card, reveal, options = {}) {
        if (!reveal) {
            return `
                <div class="card-topline">Squish</div>
                <div class="card-body">?</div>
                <div class="card-footer">Back</div>
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
        return `
            <div class="playing-card hand-card card-kind-${card.kind} ${animationClass}" aria-hidden="true">
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
     * Renders one effective stat cell with its current stage indicator.
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
        const stageLabel = stage === 0
            ? ''
            : `<small class="${stage > 0 ? 'stage-up' : 'stage-down'}">${arena.Model.formatStatStage(stage)}</small>`;

        return `<span class="stat-cell${stageClass}">${labels[stat]} ${arena.Model.getPokemonEffectiveStat(card, stat)}${stageLabel ? ` ${stageLabel}` : ''}</span>`;
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

    function formatActionNote(card) {
        const notes = [];
        const effects = formatEffects(card);

        if (effects !== 'No effect') {
            notes.push(effects);
        }

        return notes.length > 0 ? notes.join(' | ') : 'No effect';
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

    function formatTarget(target) {
        const labels = {
            ALL_ALLIES: 'All Allies',
            ALL_OPPONENTS: 'All Opponents',
            ALLY: 'One Ally',
            OPPONENT: 'One Opponent',
            SELF: 'Self'
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

    function formatStatuses(statuses) {
        if (!statuses.length) return 'No effect';

        return statuses
            .map(arena.Model.formatStatusName)
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
        renderCardPreview,
        renderCardForAnimation
    };
})(window.CardArena = window.CardArena || {});
