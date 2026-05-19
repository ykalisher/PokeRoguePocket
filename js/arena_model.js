/**
 * Squish - state and model helpers for the card arena prototype
 */

(function attachArenaModel(arena) {
    'use strict';

    const {
        ATTACK_CARDS_PER_DECK,
        BOARD_SLOT_COUNT,
        ITEM_CARDS_PER_DECK,
        OPENING_HAND_SIZE,
        POKEMON_CARDS_PER_DECK
    } = arena.Constants;

    const BATTLE_STORAGE_KEY = 'card-arena-current-battle';
    const BATTLE_STORAGE_VERSION = 1;
    const STAT_STAGE_MIN = -6;
    const STAT_STAGE_MAX = 6;
    const STAT_STAGE_MULTIPLIERS = Object.freeze({
        '-6': 0.1,
        '-5': 0.2,
        '-4': 0.35,
        '-3': 0.5,
        '-2': 0.67,
        '-1': 0.8,
        0: 1,
        1: 1.5,
        2: 2,
        3: 2.5,
        4: 3,
        5: 3.5,
        6: 4
    });
    const STAT_CHANGE_DELTAS = Object.freeze({
        ATTACK_DOWN: { delta: -1, stat: 'attack' },
        ATTACK_UP: { delta: 1, stat: 'attack' },
        DEFENSE_DOWN: { delta: -1, stat: 'defense' },
        DEFENSE_UP: { delta: 1, stat: 'defense' },
        SPEED_DOWN: { delta: -1, stat: 'speed' },
        SPEED_UP: { delta: 1, stat: 'speed' }
    });
    const STAT_LABELS = Object.freeze({
        attack: { baseKey: 'baseAttack', label: 'Attack', shortLabel: 'ATK' },
        defense: { baseKey: 'baseDefense', label: 'Defense', shortLabel: 'DEF' },
        speed: { baseKey: 'baseSpeed', label: 'Speed', shortLabel: 'SPD' }
    });
    const STATUS_DEFINITIONS = Object.freeze({
        BURN: { iconPath: 'assets/status-icons/BURN.svg', label: 'Burn', showsToken: true, statMultipliers: { attack: 0.5 } },
        CONFUSION: { iconPath: 'assets/status-icons/CONFUSION.svg', label: 'Confusion', showsToken: true },
        FATIGUE: {
            durationTurns: 3,
            iconPath: 'assets/status-icons/FATIGUE.png',
            label: 'Fatigue',
            showsToken: true,
            statMultipliers: { defense: 0.75, speed: 0.75 }
        },
        FLINCH: { expires: 'turn', iconPath: 'assets/status-icons/FLINCH.svg', label: 'Flinch', showsToken: true },
        HEAL: { iconPath: 'assets/status-icons/HEAL.png', label: 'Heal', showsToken: false },
        PARALYSIS: { iconPath: 'assets/status-icons/PARALYSIS.svg', label: 'Paralysis', showsToken: true, statMultipliers: { speed: 0.5 } },
        POISON: { iconPath: 'assets/status-icons/POISON.svg', label: 'Poison', showsToken: true },
        PROTECT: { expires: 'turn', iconPath: 'assets/status-icons/PROTECT.png', label: 'Protect', showsToken: true },
        SLEEP: { iconPath: 'assets/status-icons/SLEEP.svg', initialState: () => ({ lastWakeAttemptTurn: null, wakeAttempts: 0 }), label: 'Sleep', showsToken: true },
        SWITCH: { iconPath: 'assets/status-icons/SWITCH.png', label: 'Switch', showsToken: false }
    });

    const state = {
        currentPlayer: null,
        elements: {},
        finished: false,
        isResolving: true,
        log: [],
        phase: 'setup',
        flowTimer: null,
        drag: null,
        itemUsed: { opponent: false, player: false },
        pendingActionCardId: null,
        pendingUserCardId: null,
        plannedActions: { opponent: [], player: [] },
        players: {},
        popupTimer: null,
        selectedCardId: null,
        suppressNextClick: false,
        turnNumber: 0
    };

    function createPlayer(id, name) {
        const deck = createDeck(id);

        return {
            board: Array.from({ length: BOARD_SLOT_COUNT }, () => null),
            deck,
            discard: [],
            hand: [],
            id,
            knockout: [],
            name,
            pokemonLeft: deck.filter(isPokemonCard).length
        };
    }

    function saveBattleState() {
        if (!canUseStorage() || !shouldSaveBattleState()) return false;

        try {
            localStorage.setItem(BATTLE_STORAGE_KEY, JSON.stringify({
                battle: serializeBattleState(),
                savedAt: new Date().toISOString(),
                version: BATTLE_STORAGE_VERSION
            }));

            return true;
        } catch (error) {
            console.warn('Could not save battle state.', error);
            return false;
        }
    }

    function restoreSavedBattleState() {
        const savedBattle = loadSavedBattleState();

        if (!savedBattle) return false;

        state.currentPlayer = savedBattle.currentPlayer || 'player';
        state.finished = Boolean(savedBattle.finished);
        state.isResolving = false;
        state.log = Array.isArray(savedBattle.log) ? savedBattle.log.slice(0, 3) : [];
        state.phase = savedBattle.phase || 'turn';
        state.flowTimer = null;
        state.drag = null;
        state.itemUsed = normalizeItemUsed(savedBattle.itemUsed);
        state.pendingActionCardId = savedBattle.pendingActionCardId || null;
        state.pendingUserCardId = savedBattle.pendingUserCardId || null;
        state.plannedActions = normalizePlannedActions(savedBattle.plannedActions);
        state.players = {
            opponent: normalizeSavedPlayer(savedBattle.players && savedBattle.players.opponent, 'opponent', 'Rival'),
            player: normalizeSavedPlayer(savedBattle.players && savedBattle.players.player, 'player', 'You')
        };
        state.popupTimer = null;
        state.selectedCardId = savedBattle.selectedCardId || null;
        state.suppressNextClick = false;
        state.turnNumber = Number.isFinite(savedBattle.turnNumber) ? savedBattle.turnNumber : 0;

        if (state.phase === 'resolving' || state.phase === 'opponent-planning') {
            state.currentPlayer = 'player';
            state.phase = 'turn';
            state.plannedActions = { opponent: [], player: [] };
        }

        return true;
    }

    function clearSavedBattleState() {
        if (!canUseStorage()) return false;

        try {
            localStorage.removeItem(BATTLE_STORAGE_KEY);
            return true;
        } catch (error) {
            console.warn('Could not clear battle state.', error);
            return false;
        }
    }

    function hasSavedBattleState() {
        return Boolean(loadSavedBattleState());
    }

    function loadSavedBattleState() {
        if (!canUseStorage()) return null;

        try {
            const rawSavedState = localStorage.getItem(BATTLE_STORAGE_KEY);

            if (!rawSavedState) return null;

            const savedState = JSON.parse(rawSavedState);

            if (!savedState || savedState.version !== BATTLE_STORAGE_VERSION || !savedState.battle) {
                clearSavedBattleState();
                return null;
            }

            return savedState.battle;
        } catch (error) {
            console.warn('Could not load battle state.', error);
            clearSavedBattleState();
            return null;
        }
    }

    function canUseStorage() {
        return typeof localStorage !== 'undefined';
    }

    function shouldSaveBattleState() {
        if (!state.players || !state.players.player || !state.players.opponent) return false;
        if (state.phase === 'setup') return false;
        if (!state.finished && state.isResolving) return false;
        if (state.phase === 'resolving' || state.phase === 'opponent-planning') return false;

        return true;
    }

    function serializeBattleState() {
        return {
            currentPlayer: state.currentPlayer,
            finished: state.finished,
            itemUsed: state.itemUsed,
            log: state.log,
            pendingActionCardId: state.pendingActionCardId,
            pendingUserCardId: state.pendingUserCardId,
            phase: state.phase,
            plannedActions: state.plannedActions,
            players: state.players,
            selectedCardId: state.selectedCardId,
            turnNumber: state.turnNumber
        };
    }

    function normalizeItemUsed(itemUsed) {
        return {
            opponent: Boolean(itemUsed && itemUsed.opponent),
            player: Boolean(itemUsed && itemUsed.player)
        };
    }

    function normalizePlannedActions(plannedActions) {
        return {
            opponent: Array.isArray(plannedActions && plannedActions.opponent) ? plannedActions.opponent : [],
            player: Array.isArray(plannedActions && plannedActions.player) ? plannedActions.player : []
        };
    }

    function normalizeSavedPlayer(player, id, name) {
        const normalizedPlayer = player && typeof player === 'object' ? player : {};
        const board = Array.isArray(normalizedPlayer.board) ? normalizedPlayer.board : [];
        const deck = Array.isArray(normalizedPlayer.deck) ? normalizedPlayer.deck : [];
        const discard = Array.isArray(normalizedPlayer.discard) ? normalizedPlayer.discard : [];
        const hand = Array.isArray(normalizedPlayer.hand) ? normalizedPlayer.hand : [];
        const knockout = Array.isArray(normalizedPlayer.knockout) ? normalizedPlayer.knockout : [];

        return {
            board: Array.from({ length: BOARD_SLOT_COUNT }, (_, index) => board[index] || null),
            deck,
            discard,
            hand,
            id,
            knockout,
            name: normalizedPlayer.name || name,
            pokemonLeft: Number.isFinite(normalizedPlayer.pokemonLeft)
                ? normalizedPlayer.pokemonLeft
                : countRemainingPokemon({ board, deck, discard, hand })
        };
    }

    function countRemainingPokemon(player) {
        return [
            ...player.board,
            ...player.deck,
            ...player.discard,
            ...player.hand
        ].filter(isPokemonCard).length;
    }

    function createDeck(playerId) {
        const prefix = playerId === 'player' ? 'YOU' : 'OPP';
        const data = arena.GameData || { attacks: [], items: [], pokemon: [] };
        const pokemonRecords = [];
        const deck = [];

        for (let index = 0; index < POKEMON_CARDS_PER_DECK && data.pokemon.length > 0; index += 1) {
            const pokemon = data.pokemon[index % data.pokemon.length];

            pokemonRecords.push(pokemon);
            deck.push(createPokemonCard(pokemon, playerId, `${prefix}-PKM-${index + 1}`));
        }

        const attacks = getDemoAttacksForPokemon(data.attacks, pokemonRecords);

        for (let index = 0; index < ATTACK_CARDS_PER_DECK && attacks.length > 0; index += 1) {
            deck.push(createAttackCard(attacks[index % attacks.length], playerId, `${prefix}-ATK-${index + 1}`));
        }

        for (let index = 0; index < ITEM_CARDS_PER_DECK && data.items.length > 0; index += 1) {
            deck.push(createItemCard(data.items[index % data.items.length], playerId, `${prefix}-ITM-${index + 1}`));
        }

        return shuffle(deck);
    }

    function compactTypes(types) {
        return types.filter(type => type && type !== 'NONE');
    }

    function getDemoAttacksForPokemon(attacks, pokemonRecords) {
        const deckTypes = new Set(pokemonRecords.flatMap(pokemon => pokemon.types || compactTypes([
            pokemon.type1,
            pokemon.type2,
            pokemon.type3
        ])));

        return attacks.filter(attack => {
            const attackTypes = attack.types || compactTypes([attack.type1, attack.type2]);

            return attackTypes.length > 0 && attackTypes.every(type => deckTypes.has(type));
        });
    }

    function createPokemonCard(pokemon, owner, id) {
        return {
            currentHealth: pokemon.baseHealth,
            currentStatus: [],
            faceUp: false,
            id,
            kind: 'pokemon',
            owner,
            pokemon,
            statChanges: [],
            statStages: createDefaultStatStages()
        };
    }

    function createAttackCard(attack, owner, id) {
        return {
            attack,
            faceUp: false,
            id,
            kind: 'attack',
            owner
        };
    }

    function createItemCard(item, owner, id) {
        return {
            faceUp: false,
            id,
            item,
            kind: 'item',
            owner
        };
    }

    function shuffle(cards) {
        const shuffled = [...cards];

        for (let index = shuffled.length - 1; index > 0; index -= 1) {
            const swapIndex = Math.floor(Math.random() * (index + 1));
            [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
        }

        return shuffled;
    }

    function drawOpeningHands() {
        Object.values(state.players).forEach(player => {
            for (let count = 0; count < OPENING_HAND_SIZE; count += 1) {
                drawCard(player);
            }

            ensureOpeningHandHasPokemon(player);
        });
    }

    function placeOpeningCard(player) {
        const card = player.hand.find(isPokemonCard);

        if (!card) return;

        removeCardFromHand(player, card.id);
        card.faceUp = false;
        player.board[0] = card;
    }

    function flipOpeningCards() {
        Object.values(state.players).forEach(player => {
            player.board.forEach(card => {
                if (card) card.faceUp = true;
            });
        });
    }

    function drawCard(player) {
        if (player.deck.length === 0) {
            recycleDiscardIntoDeck(player);
        }

        if (player.deck.length === 0) return null;

        const card = player.deck.shift();
        card.faceUp = player.id === 'player';
        player.hand.push(card);

        return card;
    }

    function removeCardFromHand(player, cardId) {
        const cardIndex = player.hand.findIndex(card => card.id === cardId);

        if (cardIndex === -1) return null;

        const [card] = player.hand.splice(cardIndex, 1);
        return card;
    }

    function findHandCard(player, cardId) {
        return player.hand.find(card => card.id === cardId) || null;
    }

    function playerHasCardInHand(cardId) {
        return state.players.player.hand.some(card => card.id === cardId);
    }

    function getHealthPercent(card) {
        if (!isPokemonCard(card)) return 0;

        return Math.max(0, Math.round((card.currentHealth / card.pokemon.baseHealth) * 100));
    }

    function getPortraitHue(speciesId) {
        return String(speciesId).split('').reduce((total, character) => total + character.charCodeAt(0), 0) % 360;
    }

    function getPortraitInitials(card) {
        if (!isPokemonCard(card)) return '';

        return card.pokemon.name
            .split(/\s+/)
            .map(part => part[0])
            .join('')
            .slice(0, 2)
            .toUpperCase();
    }

    function getPortraitUrl(card) {
        if (!isPokemonCard(card)) return '';

        return card.pokemon.portraitPath || `assets/portraits/${encodeURIComponent(card.pokemon.name)}.png`;
    }

    function getCardName(card) {
        if (!card) return 'Unknown card';
        if (isPokemonCard(card)) return card.pokemon.name;
        if (isAttackCard(card)) return card.attack.name;
        if (isItemCard(card)) return card.item.name;

        return 'Unknown card';
    }

    function getCardTypes(card) {
        if (isPokemonCard(card)) return card.pokemon.types || [];
        if (isAttackCard(card)) return card.attack.types || [];

        return [];
    }

    function getActionTarget(card) {
        if (isAttackCard(card)) return card.attack.target;
        if (isItemCard(card)) return card.item.target;

        return null;
    }

    function getActionStatuses(card) {
        const statuses = isAttackCard(card)
            ? [card.attack.status]
            : isItemCard(card)
                ? card.item.status
                : [];

        return statuses.filter(status => status && status !== 'NONE');
    }

    function applyStatus(card, status) {
        const normalizedStatus = normalizeStatus(status);

        if (!isPokemonCard(card) || !isBattleStatus(normalizedStatus)) return null;

        const currentStatuses = ensurePokemonStatuses(card);
        const activeStatus = currentStatuses[0];

        if (activeStatus) {
            return createStatusResult(activeStatus, {
                added: false,
                blocked: true,
                attemptedLabel: formatStatusName(normalizedStatus),
                attemptedStatus: normalizedStatus
            });
        }

        const statusEntry = createStatusEntry(normalizedStatus);

        currentStatuses.push(statusEntry);

        return createStatusResult(statusEntry, { added: true });
    }

    function ensurePokemonStatuses(card) {
        if (!isPokemonCard(card)) return [];

        const seen = new Set();
        const statuses = [];
        const rawStatuses = Array.isArray(card.currentStatus) ? card.currentStatus : [];

        rawStatuses.forEach(statusEntry => {
            const status = normalizeStatus(statusEntry);

            if (!isBattleStatus(status) || seen.has(status)) return;
            if (statuses.length > 0) return;

            seen.add(status);
            statuses.push(statusEntry && typeof statusEntry === 'object'
                ? { ...createStatusEntry(status), ...statusEntry, status }
                : createStatusEntry(status)
            );
        });

        card.currentStatus = statuses;
        return card.currentStatus;
    }

    function getPokemonStatuses(card) {
        return ensurePokemonStatuses(card).map(statusEntry => ({
            ...createStatusResult(statusEntry)
        }));
    }

    function getPokemonStatusEntry(card, status) {
        const normalizedStatus = normalizeStatus(status);

        if (!normalizedStatus) return null;

        return ensurePokemonStatuses(card).find(statusEntry => statusEntry.status === normalizedStatus) || null;
    }

    function hasPokemonStatus(card, status) {
        const normalizedStatus = normalizeStatus(status);

        if (!normalizedStatus) return false;

        return ensurePokemonStatuses(card).some(statusEntry => statusEntry.status === normalizedStatus);
    }

    function removePokemonStatus(card, status) {
        const normalizedStatus = normalizeStatus(status);

        if (!isPokemonCard(card) || !normalizedStatus) return null;

        const statuses = ensurePokemonStatuses(card);
        const statusIndex = statuses.findIndex(statusEntry => statusEntry.status === normalizedStatus);

        if (statusIndex === -1) return null;

        const [removedStatus] = statuses.splice(statusIndex, 1);
        card.currentStatus = statuses;

        return createStatusResult(removedStatus, { removed: true });
    }

    function clearTurnStatuses(card) {
        if (!isPokemonCard(card)) return [];

        const removedStatuses = [];
        const remainingStatuses = ensurePokemonStatuses(card).filter(statusEntry => {
            if (!isExpiringStatus(statusEntry.status)) return true;

            if (isLimitedTurnStatus(statusEntry.status)) {
                statusEntry.turnsRemaining = getNextTurnsRemaining(statusEntry);

                if (statusEntry.turnsRemaining > 0) return true;
            }

            removedStatuses.push({
                ...createStatusResult(statusEntry, { removed: true })
            });

            return false;
        });

        card.currentStatus = remainingStatuses;
        return removedStatuses;
    }

    function isBattleStatus(status) {
        const definition = STATUS_DEFINITIONS[status];

        return Boolean(definition && definition.showsToken);
    }

    function isExpiringStatus(status) {
        return isTurnStatus(status) || isLimitedTurnStatus(status);
    }

    function isTurnStatus(status) {
        const definition = STATUS_DEFINITIONS[status];

        return Boolean(definition && definition.expires === 'turn');
    }

    function isLimitedTurnStatus(status) {
        const definition = STATUS_DEFINITIONS[status];

        return Boolean(definition && Number.isFinite(definition.durationTurns));
    }

    function getNextTurnsRemaining(statusEntry) {
        const definition = STATUS_DEFINITIONS[statusEntry.status];
        const currentTurnsRemaining = Number.isFinite(statusEntry.turnsRemaining)
            ? statusEntry.turnsRemaining
            : definition.durationTurns;

        return Math.max(0, currentTurnsRemaining - 1);
    }

    function createStatusEntry(status) {
        const definition = STATUS_DEFINITIONS[status];
        const durationState = definition && Number.isFinite(definition.durationTurns)
            ? { turnsRemaining: definition.durationTurns }
            : {};
        const initialState = definition && typeof definition.initialState === 'function'
            ? definition.initialState()
            : {};

        return { ...durationState, ...initialState, status };
    }

    function createStatusResult(statusEntry, extra = {}) {
        return {
            ...statusEntry,
            ...extra,
            iconPath: getStatusIconPath(statusEntry.status),
            label: formatStatusName(statusEntry.status)
        };
    }

    function getStatusIconPath(status) {
        const definition = STATUS_DEFINITIONS[status];

        return definition ? definition.iconPath : '';
    }

    function getPokemonStatusMultiplier(card, stat) {
        if (!isPokemonCard(card) || !STAT_LABELS[stat]) return 1;

        return ensurePokemonStatuses(card).reduce((multiplier, statusEntry) => {
            const definition = STATUS_DEFINITIONS[statusEntry.status];
            const statMultipliers = definition && definition.statMultipliers;

            return multiplier * (statMultipliers && Number(statMultipliers[stat]) || 1);
        }, 1);
    }

    function formatStatusName(status) {
        const definition = STATUS_DEFINITIONS[status];

        if (definition) return definition.label;

        return String(status || '')
            .toLowerCase()
            .split('_')
            .map(part => part ? part[0].toUpperCase() + part.slice(1) : '')
            .join(' ');
    }

    function normalizeStatus(status) {
        if (typeof status === 'string') return status && status !== 'NONE' ? status : null;
        if (status && typeof status.status === 'string') return status.status !== 'NONE' ? status.status : null;

        return null;
    }

    function getActionStatChanges(card) {
        const statChanges = isAttackCard(card)
            ? card.attack.statChanges
            : isItemCard(card)
                ? card.item.statChanges
                : [];

        return (Array.isArray(statChanges) ? statChanges : [])
            .filter(statChange => Boolean(STAT_CHANGE_DELTAS[statChange]));
    }

    function createDefaultStatStages() {
        return {
            attack: 0,
            defense: 0,
            speed: 0
        };
    }

    function ensureStatStages(card) {
        if (!isPokemonCard(card)) return createDefaultStatStages();

        if (!card.statStages || typeof card.statStages !== 'object') {
            card.statStages = createDefaultStatStages();
        }

        Object.keys(STAT_LABELS).forEach(stat => {
            if (!Number.isFinite(card.statStages[stat])) {
                card.statStages[stat] = 0;
            }

            card.statStages[stat] = clampStage(card.statStages[stat]);
        });

        return card.statStages;
    }

    function getPokemonStatStage(card, stat) {
        if (!isPokemonCard(card) || !STAT_LABELS[stat]) return 0;

        return ensureStatStages(card)[stat];
    }

    function getPokemonStatMultiplier(card, stat) {
        return STAT_STAGE_MULTIPLIERS[getPokemonStatStage(card, stat)] || 1;
    }

    function getPokemonEffectiveStat(card, stat) {
        if (!isPokemonCard(card) || !STAT_LABELS[stat]) return 0;

        const baseStat = Number(card.pokemon[STAT_LABELS[stat].baseKey]) || 0;
        const stagedStat = baseStat * getPokemonStatMultiplier(card, stat);

        return Math.max(1, Math.round(stagedStat * getPokemonStatusMultiplier(card, stat)));
    }

    function applyStatChange(card, statChange) {
        if (!isPokemonCard(card)) return null;

        const change = STAT_CHANGE_DELTAS[statChange];

        if (!change) return null;

        const stages = ensureStatStages(card);
        const previousStage = stages[change.stat];
        const nextStage = clampStage(previousStage + change.delta);

        stages[change.stat] = nextStage;

        return {
            changed: previousStage !== nextStage,
            delta: change.delta,
            label: STAT_LABELS[change.stat].label,
            nextStage,
            previousStage,
            shortLabel: STAT_LABELS[change.stat].shortLabel,
            stat: change.stat
        };
    }

    function formatStatStage(stage) {
        const normalizedStage = clampStage(stage);

        if (normalizedStage > 0) return `+${normalizedStage}`;

        return String(normalizedStage);
    }

    function clampStage(stage) {
        const numericStage = Number(stage) || 0;

        return Math.max(STAT_STAGE_MIN, Math.min(STAT_STAGE_MAX, numericStage));
    }

    function getPokemonSpeed(card) {
        return getPokemonEffectiveStat(card, 'speed');
    }

    function isPokemonCard(card) {
        return Boolean(card && card.kind === 'pokemon');
    }

    function isAttackCard(card) {
        return Boolean(card && card.kind === 'attack');
    }

    function isItemCard(card) {
        return Boolean(card && card.kind === 'item');
    }

    function hasOpponentBoardTarget() {
        return state.players.opponent.board.some(Boolean);
    }

    function getBoardCards(playerId) {
        return state.players[playerId].board.filter(isPokemonCard);
    }

    function getBoardCardById(playerId, cardId) {
        return state.players[playerId].board.find(card => card && card.id === cardId) || null;
    }

    function getBoardCardOwner(cardId) {
        return Object.values(state.players).find(player => getBoardCardById(player.id, cardId)) || null;
    }

    function removeCardFromBoard(player, cardId) {
        const slotIndex = player.board.findIndex(card => card && card.id === cardId);

        if (slotIndex === -1) return null;

        const card = player.board[slotIndex];
        player.board[slotIndex] = null;
        return card;
    }

    function shuffleCardIntoDeck(player, card) {
        card.faceUp = false;
        player.deck = shuffle([...player.deck, card]);
    }

    function hasQueuedAttack(playerId, pokemonCardId) {
        return state.plannedActions[playerId].some(action => action.userCardId === pokemonCardId);
    }

    function pokemonCanUseAttack(pokemonCard, attackCard) {
        if (!isPokemonCard(pokemonCard) || !isAttackCard(attackCard)) return false;

        const pokemonTypes = getCardTypes(pokemonCard);
        const requiredTypes = getCardTypes(attackCard);

        if (requiredTypes.length === 0) return true;

        if (attackCard.attack.full_type_requirements) {
            return requiredTypes.every(type => pokemonTypes.includes(type));
        }

        return requiredTypes.some(type => pokemonTypes.includes(type));
    }

    function hasUsableAttackInHand(player, pokemonCard) {
        return player.hand.some(card => (
            isAttackCard(card) &&
            pokemonCanUseAttack(pokemonCard, card) &&
            getTargetOptionsForAction(card, player.id, pokemonCard.id).length > 0
        ));
    }

    function getTargetOptionsForAction(actionCard, actorId, userCardId) {
        const target = getActionTarget(actionCard);
        const opponentId = actorId === 'player' ? 'opponent' : 'player';

        if (isAttackCard(actionCard)) {
            if (!userCardId) return [];

            if (target === 'SELF') {
                return getBoardCardById(actorId, userCardId)
                    ? [{ kind: 'single', owner: actorId, cardId: userCardId }]
                    : [];
            }

            if (target === 'ALLY') {
                return getBoardCards(actorId)
                    .filter(card => card.id !== userCardId)
                    .map(card => ({ kind: 'single', owner: actorId, cardId: card.id }));
            }

            if (target === 'ALL_ALLIES') {
                return getBoardCards(actorId).length > 0
                    ? [{ kind: 'group', owner: actorId }]
                    : [];
            }

            if (target === 'OPPONENT') {
                return getBoardCards(opponentId).map(card => ({ kind: 'single', owner: opponentId, cardId: card.id }));
            }

            if (target === 'ALL_OPPONENTS') {
                return getBoardCards(opponentId).length > 0
                    ? [{ kind: 'group', owner: opponentId }]
                    : [];
            }
        }

        if (isItemCard(actionCard)) {
            if (target === 'SELF' || target === 'ALLY') {
                return getBoardCards(actorId).map(card => ({ kind: 'single', owner: actorId, cardId: card.id }));
            }

            if (target === 'ALL_ALLIES') {
                return getBoardCards(actorId).length > 0
                    ? [{ kind: 'group', owner: actorId }]
                    : [];
            }

            if (target === 'OPPONENT') {
                return getBoardCards(opponentId).map(card => ({ kind: 'single', owner: opponentId, cardId: card.id }));
            }

            if (target === 'ALL_OPPONENTS') {
                return getBoardCards(opponentId).length > 0
                    ? [{ kind: 'group', owner: opponentId }]
                    : [];
            }
        }

        return [];
    }

    function targetOptionsIncludeCard(options, owner, cardId) {
        return options.some(option => option.kind === 'single' && option.owner === owner && option.cardId === cardId);
    }

    function targetOptionsIncludeGroup(options, owner) {
        return options.some(option => option.kind === 'group' && option.owner === owner);
    }

    function getCardsForTargetSelection(selection) {
        if (!selection) return [];

        if (selection.kind === 'single') {
            const card = getBoardCardById(selection.owner, selection.cardId);
            return card ? [{ owner: selection.owner, card }] : [];
        }

        if (selection.kind === 'group') {
            return getBoardCards(selection.owner).map(card => ({ owner: selection.owner, card }));
        }

        return [];
    }

    function recycleDiscardIntoDeck(player) {
        if (player.deck.length > 0 || player.discard.length === 0) return false;

        player.discard.forEach(card => {
            card.faceUp = false;
        });
        player.deck = shuffle(player.discard);
        player.discard = [];

        return true;
    }

    function ensureOpeningHandHasPokemon(player) {
        if (player.hand.some(isPokemonCard)) return;

        const pokemonIndex = player.deck.findIndex(isPokemonCard);

        if (pokemonIndex === -1) return;

        const replacementIndex = player.hand.findIndex(card => !isPokemonCard(card));
        const [pokemonCard] = player.deck.splice(pokemonIndex, 1);

        pokemonCard.faceUp = player.id === 'player';

        if (replacementIndex === -1) {
            player.hand.push(pokemonCard);
            return;
        }

        const [replacedCard] = player.hand.splice(replacementIndex, 1, pokemonCard);
        replacedCard.faceUp = false;
        player.deck = shuffle([replacedCard, ...player.deck]);
    }

    function sleep(milliseconds) {
        return new Promise(resolve => {
            setTimeout(resolve, milliseconds);
        });
    }

    arena.state = state;
    arena.Model = {
        applyStatus,
        clearTurnStatuses,
        clearSavedBattleState,
        createPlayer,
        drawCard,
        drawOpeningHands,
        findHandCard,
        flipOpeningCards,
        applyStatChange,
        formatStatStage,
        getActionStatuses,
        getActionStatChanges,
        getActionTarget,
        getBoardCardById,
        getBoardCardOwner,
        getBoardCards,
        getCardName,
        getCardTypes,
        getCardsForTargetSelection,
        getHealthPercent,
        getPokemonEffectiveStat,
        getPokemonStatMultiplier,
        getPokemonStatStage,
        getPokemonSpeed,
        getPokemonStatusEntry,
        getPokemonStatuses,
        getPokemonStatusMultiplier,
        getPortraitHue,
        getPortraitInitials,
        getPortraitUrl,
        getStatusIconPath,
        getTargetOptionsForAction,
        hasOpponentBoardTarget,
        hasPokemonStatus,
        hasSavedBattleState,
        hasQueuedAttack,
        hasUsableAttackInHand,
        isAttackCard,
        isBattleStatus,
        isItemCard,
        isPokemonCard,
        placeOpeningCard,
        playerHasCardInHand,
        pokemonCanUseAttack,
        recycleDiscardIntoDeck,
        removeCardFromHand,
        removeCardFromBoard,
        removePokemonStatus,
        restoreSavedBattleState,
        saveBattleState,
        shuffle,
        shuffleCardIntoDeck,
        targetOptionsIncludeCard,
        targetOptionsIncludeGroup,
        sleep
    };
})(window.CardArena = window.CardArena || {});
