/**
 * Squish - state and model helpers for the card arena prototype
 *
 * Model responsibilities: own the shared arena.state object, create decks and
 * cards from arena.GameData, persist/restore safe battle states, normalize card
 * data during old-save recovery, answer targeting/type questions, and apply
 * status/stat state changes requested by arena_controller.js. The model does
 * not animate, log battle events, or decide whose turn advances.
 */

(function attachArenaModel(arena) {
    'use strict';

    const {
        ATTACK_COPIES_PER_MAIN_DECK,
        BOARD_SLOT_COUNT,
        DEFAULT_BATTLE_DECK,
        HAND_SIZE,
        ITEM_CARDS_PER_MAIN_DECK
    } = arena.Constants;

    const BATTLE_STORAGE_KEY = 'card-arena-current-battle';
    const BATTLE_STORAGE_VERSION = 2;
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
    const NORMAL_STAT_CHANGE_LIMIT = 1;
    const HUMAN_STAT_CHANGE_MULTIPLIER = 2;
    const FIGHTING_STATUS_ATTACK_MULTIPLIER = 1.5;
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
        FULL_HEAL: { label: 'Full Heal', showsToken: false },
        HEAL: { iconPath: 'assets/status-icons/HEAL.png', label: 'Heal', showsToken: false },
        HEAL_BURN: { iconPath: 'assets/status-icons/HEAL_BURN.png', label: 'Heal Burn', showsToken: false },
        HEAL_STATUS: { iconPath: 'assets/status-icons/HEAL_STATUS.png', label: 'Heal Status', showsToken: false },
        MULTI_ATTACK: { iconPath: 'assets/status-icons/MULTI_ATTACK.png', label: 'Multi Attack', showsToken: false },
        PARALYSIS: { iconPath: 'assets/status-icons/PARALYSIS.svg', label: 'Paralysis', showsToken: true, statMultipliers: { speed: 0.5 } },
        POISON: { iconPath: 'assets/status-icons/POISON.svg', label: 'Poison', showsToken: true },
        PROTECT: { expires: 'turn', iconPath: 'assets/status-icons/PROTECT.png', label: 'Protect', showsToken: true },
        SELF_INFLICT: { iconPath: 'assets/status-icons/SELF_INFLICT.png', label: 'Self-Inflict', showsToken: false },
        SLEEP: { iconPath: 'assets/status-icons/SLEEP.svg', initialState: () => ({ lastWakeAttemptTurn: null, wakeAttempts: 0 }), label: 'Sleep', showsToken: true },
        SWITCH: { iconPath: 'assets/status-icons/SWITCH.png', label: 'Switch', showsToken: false }
    });

    const state = {
        currentPlayer: null,
        arrivingCardIds: [],
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
        pendingPokemonReplacements: [],
        plannedActions: { opponent: [], player: [] },
        players: {},
        popupTimer: null,
        rulesWindowOpen: false,
        selectedCardId: null,
        suppressNextClick: false,
        turnNumber: 0
    };

    /**
     * Creates a player object with freshly shuffled Pokemon and main decks. Called by
     * Controller.resetPrototype() when starting a new battle.
     */
    function createPlayer(id, name) {
        const decks = createDecks(id);

        return {
            board: Array.from({ length: BOARD_SLOT_COUNT }, () => null),
            deck: decks.mainDeck,
            discard: [],
            hand: [],
            handSize: HAND_SIZE,
            id,
            knockout: [],
            knockoutCount: 0,
            lostByPokemonDeck: false,
            name,
            pokemonDeck: decks.pokemonDeck,
            pokemonLeft: decks.pokemonDeck.length
        };
    }

    /**
     * Persists the current battle after render-visible player-safe states.
     * Controller's render() wrapper calls this after most state changes.
     */
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

    /**
     * Restores a saved battle during game.js boot. Unsafe transient phases like
     * resolving/opponent-planning are rolled back to the player's turn.
     */
    function restoreSavedBattleState() {
        const savedBattle = loadSavedBattleState();

        if (!savedBattle) return false;

        state.currentPlayer = savedBattle.currentPlayer || 'player';
        state.arrivingCardIds = [];
        state.finished = Boolean(savedBattle.finished);
        state.isResolving = false;
        state.log = Array.isArray(savedBattle.log) ? savedBattle.log.slice(0, 3) : [];
        state.phase = savedBattle.phase || 'turn';
        state.flowTimer = null;
        state.drag = null;
        state.itemUsed = normalizeItemUsed(savedBattle.itemUsed);
        state.pendingActionCardId = savedBattle.pendingActionCardId || null;
        state.pendingUserCardId = savedBattle.pendingUserCardId || null;
        state.pendingPokemonReplacements = [];
        state.plannedActions = normalizePlannedActions(savedBattle.plannedActions);
        state.players = {
            opponent: normalizeSavedPlayer(savedBattle.players && savedBattle.players.opponent, 'opponent', 'Rival'),
            player: normalizeSavedPlayer(savedBattle.players && savedBattle.players.player, 'player', 'You')
        };
        state.popupTimer = null;
        state.rulesWindowOpen = false;
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

    /**
     * Removes the persisted battle, used when resetting or when saved data is
     * invalid for the current storage version.
     */
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

    /**
     * Prevents saving during setup, animations, and resolver phases where a
     * reload would resume in the middle of an effect sequence.
     */
    function shouldSaveBattleState() {
        if (!state.players || !state.players.player || !state.players.opponent) return false;
        if (state.phase === 'setup') return false;
        if (!state.finished && state.isResolving) return false;
        if (state.phase === 'resolving' || state.phase === 'opponent-planning') return false;

        return true;
    }

    /**
     * Picks the state fields that are stable enough to store in localStorage.
     */
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

    /**
     * Rehydrates a saved player defensively so old or partial saves still have
     * the arrays and counters the controller/render code expects.
     */
    function normalizeSavedPlayer(player, id, name) {
        const normalizedPlayer = player && typeof player === 'object' ? player : {};
        const board = Array.isArray(normalizedPlayer.board) ? normalizedPlayer.board : [];
        const deck = Array.isArray(normalizedPlayer.deck)
            ? normalizedPlayer.deck.filter(card => !isPokemonCard(card))
            : [];
        const discard = Array.isArray(normalizedPlayer.discard)
            ? normalizedPlayer.discard.filter(card => !isPokemonCard(card))
            : [];
        const hand = Array.isArray(normalizedPlayer.hand)
            ? normalizedPlayer.hand.filter(card => !isPokemonCard(card))
            : [];
        const knockout = Array.isArray(normalizedPlayer.knockout) ? normalizedPlayer.knockout : [];
        const pokemonDeck = Array.isArray(normalizedPlayer.pokemonDeck)
            ? normalizedPlayer.pokemonDeck.filter(isPokemonCard)
            : [];
        const normalizedBoard = Array.from({ length: BOARD_SLOT_COUNT }, (_, index) => (
            isPokemonCard(board[index]) ? board[index] : null
        ));
        const playerState = {
            board: normalizedBoard,
            deck,
            discard,
            hand,
            handSize: Number.isFinite(normalizedPlayer.handSize) ? normalizedPlayer.handSize : HAND_SIZE,
            id,
            knockout,
            knockoutCount: Number.isFinite(normalizedPlayer.knockoutCount)
                ? normalizedPlayer.knockoutCount
                : knockout.filter(isPokemonCard).length,
            lostByPokemonDeck: Boolean(normalizedPlayer.lostByPokemonDeck),
            name: normalizedPlayer.name || name,
            pokemonDeck,
            pokemonLeft: 0
        };

        updatePokemonLeft(playerState);

        return playerState;
    }

    function countRemainingPokemon(player) {
        return [
            ...player.board,
            ...player.pokemonDeck
        ].filter(isPokemonCard).length;
    }

    function updatePokemonLeft(player) {
        if (!player) return 0;

        player.pokemonLeft = countRemainingPokemon(player);

        return player.pokemonLeft;
    }

    /**
     * Builds the two-deck battle structure from a configured deck definition, or
     * from the default arena deck when no explicit deck has been supplied.
     */
    function createDecks(playerId) {
        const prefix = playerId === 'player' ? 'YOU' : 'OPP';
        const data = arena.GameData || { attacks: [], items: [], pokemon: [] };
        const definition = getBattleDeckDefinition(playerId);
        const pokemonDeck = createPokemonDeck(data.pokemon, definition, playerId, prefix);
        const mainDeck = createMainDeck(data, definition, pokemonDeck.map(card => card.pokemon), playerId, prefix);

        return {
            mainDeck: shuffle(mainDeck),
            pokemonDeck: shuffle(pokemonDeck)
        };
    }

    function getBattleDeckDefinition(playerId) {
        const configuredDeck = arena.BattleDecks && arena.BattleDecks[playerId];

        return normalizeBattleDeckDefinition(configuredDeck) || DEFAULT_BATTLE_DECK;
    }

    function normalizeBattleDeckDefinition(definition) {
        if (!definition || typeof definition !== 'object' || !Array.isArray(definition.pokemon)) return null;

        return {
            items: Array.isArray(definition.items) ? definition.items.slice(0, ITEM_CARDS_PER_MAIN_DECK) : [],
            pokemon: definition.pokemon
                .map(entry => typeof entry === 'string' ? { name: entry, attacks: [] } : entry)
                .filter(entry => entry && entry.name)
        };
    }

    function createPokemonDeck(pokemonRecords, definition, playerId, prefix) {
        const selectedPokemon = definition.pokemon
            .map(entry => findRecordByName(pokemonRecords, entry.name))
            .filter(Boolean);
        const records = selectedPokemon.length > 0 ? selectedPokemon : pokemonRecords.slice(0, BOARD_SLOT_COUNT);

        return records.map((pokemon, index) => (
            createPokemonCard(pokemon, playerId, `${prefix}-PKM-${index + 1}`)
        ));
    }

    function createMainDeck(data, definition, pokemonRecords, playerId, prefix) {
        const deck = [];
        const attackSelections = getSelectedAttacksForDeck(data.attacks, definition, pokemonRecords);
        const itemSelections = getSelectedItemsForDeck(data.items, definition);

        attackSelections.forEach((attack, selectionIndex) => {
            for (let copyIndex = 0; copyIndex < ATTACK_COPIES_PER_MAIN_DECK; copyIndex += 1) {
                const cardIndex = (selectionIndex * ATTACK_COPIES_PER_MAIN_DECK) + copyIndex + 1;

                deck.push(createAttackCard(attack, playerId, `${prefix}-ATK-${cardIndex}`));
            }
        });

        itemSelections.forEach((item, index) => {
            deck.push(createItemCard(item, playerId, `${prefix}-ITM-${index + 1}`));
        });

        return deck;
    }

    function getSelectedAttacksForDeck(attacks, definition, pokemonRecords) {
        const pokemonByName = new Map(pokemonRecords.map(pokemon => [pokemon.name, pokemon]));
        const selectedAttacks = [];

        definition.pokemon.forEach(entry => {
            const species = pokemonByName.get(entry.name);
            const attackNames = Array.isArray(entry.attacks) ? entry.attacks : [];

            attackNames.forEach(attackName => {
                const attack = findRecordByName(attacks, attackName);

                if (!attack || (species && !speciesCanUseAttack(species, attack))) return;

                selectedAttacks.push(attack);
            });
        });

        return selectedAttacks.length > 0
            ? selectedAttacks
            : getDemoAttacksForPokemon(attacks, pokemonRecords).slice(0, pokemonRecords.length * 2);
    }

    function getSelectedItemsForDeck(items, definition) {
        const selectedItems = definition.items
            .slice(0, ITEM_CARDS_PER_MAIN_DECK)
            .map(itemName => findRecordByName(items, itemName))
            .filter(Boolean);

        return selectedItems.length > 0 ? selectedItems : items.slice(0, ITEM_CARDS_PER_MAIN_DECK);
    }

    function findRecordByName(records, name) {
        return records.find(record => record && record.name === name) || null;
    }

    function speciesCanUseAttack(species, attack) {
        const pokemonTypes = species.types || compactTypes([species.type1, species.type2, species.type3]);
        const requiredTypes = attack.types || compactTypes([attack.type1, attack.type2]);

        if (requiredTypes.length === 0) return true;

        if (attack.full_type_requirements) {
            return requiredTypes.every(type => pokemonTypes.includes(type));
        }

        return requiredTypes.some(type => pokemonTypes.includes(type));
    }

    function compactTypes(types) {
        return types.filter(type => type && type !== 'NONE');
    }

    /**
     * Limits generated deck attacks to attacks whose listed types are all
     * present among that deck's Pokemon species.
     */
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
            hasUsedFossilRevival: false,
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

    /**
     * Draws two opening Pokemon from each player's Pokemon deck and plays them
     * directly into the active board slots.
     */
    function playOpeningPokemon() {
        const placements = [];

        Object.values(state.players).forEach(player => {
            for (let slotIndex = 0; slotIndex < BOARD_SLOT_COUNT; slotIndex += 1) {
                const card = drawPokemonToBoard(player, slotIndex);

                if (card) {
                    placements.push({ card, ownerId: player.id, slotIndex });
                }
            }
        });

        return placements;
    }

    /**
     * Draws main-deck cards until the player's hand reaches its current hand
     * size, recycling discard into the main deck as needed.
     */
    function drawCardsUpToHandSize(player) {
        const drawnCards = [];
        const handSize = getPlayerHandSize(player);

        while (player.hand.length < handSize) {
            const card = drawCard(player);

            if (!card) break;

            drawnCards.push(card);
        }

        return drawnCards;
    }

    /**
     * Draws one card from the main deck, recycling discard into the main deck
     * first if the deck is empty.
     */
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

    function drawPokemonToBoard(player, slotIndex) {
        if (slotIndex < 0 || slotIndex >= BOARD_SLOT_COUNT || player.board[slotIndex]) return null;

        const card = drawPokemonCard(player);

        if (!card) return null;

        card.faceUp = true;
        player.board[slotIndex] = card;
        updatePokemonLeft(player);

        return card;
    }

    function drawPokemonCard(player) {
        if (!player || !Array.isArray(player.pokemonDeck) || player.pokemonDeck.length === 0) return null;

        const card = player.pokemonDeck.shift();

        card.faceUp = true;
        updatePokemonLeft(player);

        return card;
    }

    function putPokemonOnBottomOfDeck(player, card) {
        if (!player || !isPokemonCard(card)) return false;

        card.faceUp = false;
        player.pokemonDeck.push(card);
        updatePokemonLeft(player);

        return true;
    }

    function getPlayerHandSize(player) {
        return Number.isFinite(player && player.handSize) ? player.handSize : HAND_SIZE;
    }

    /**
     * Removes a specific hand card when a card is placed, queued, or used.
     */
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

    /**
     * Returns compact type arrays for Pokemon and attacks. Controller uses this
     * for attack eligibility and special type rules.
     */
    function getCardTypes(card) {
        if (isPokemonCard(card)) {
            return card.pokemon.types || compactTypes([
                card.pokemon.type1,
                card.pokemon.type2,
                card.pokemon.type3
            ]);
        }

        if (isAttackCard(card)) {
            return card.attack.types || compactTypes([
                card.attack.type1,
                card.attack.type2
            ]);
        }

        return [];
    }

    function getActionTarget(card) {
        if (isAttackCard(card)) return card.attack.target;
        if (isItemCard(card)) return card.item.target;

        return null;
    }

    /**
     * Returns non-NONE statuses/action effects listed on an attack or item card.
     */
    function getActionStatuses(card) {
        const statuses = isAttackCard(card)
            ? card.attack.status
            : isItemCard(card)
                ? card.item.status
                : [];

        return (Array.isArray(statuses) ? statuses : [statuses])
            .filter(status => status && status !== 'NONE');
    }

    /**
     * Adds one persistent battle status to a Pokemon. Called by controller when
     * status effects activate; returns a result object for battle log wording.
     */
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

    /**
     * Normalizes currentStatus so each Pokemon has at most one valid persistent
     * status entry, including duration or initial status state.
     */
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

    /**
     * Removes a specific persistent status, used by recovery effects and wake /
     * confusion recovery checks.
     */
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

    /**
     * Clears all persistent statuses from a Pokemon, used by HEAL_STATUS,
     * FULL_HEAL, and Fossil revival.
     */
    function clearPokemonStatuses(card) {
        if (!isPokemonCard(card)) return [];

        const removedStatuses = ensurePokemonStatuses(card).map(statusEntry => ({
            ...createStatusResult(statusEntry, { removed: true })
        }));

        card.currentStatus = [];
        return removedStatuses;
    }

    /**
     * Advances and clears statuses that expire during end-of-turn cleanup.
     */
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

    /**
     * Calculates the status/type multiplier for an effective stat. Controller
     * uses this for damage and speed ordering; render uses it for displayed stats.
     */
    function getPokemonStatusMultiplier(card, stat) {
        if (!isPokemonCard(card) || !STAT_LABELS[stat]) return 1;

        const statuses = ensurePokemonStatuses(card);
        const typeAbilityMultiplier = getPokemonTypeStatusMultiplier(card, stat, statuses);

        return statuses.reduce((multiplier, statusEntry) => (
            multiplier * getStatusStatMultiplier(card, statusEntry.status, stat)
        ), typeAbilityMultiplier);
    }

    function getStatusStatMultiplier(card, status, stat) {
        if (stat === 'attack' && status === 'BURN' && pokemonHasType(card, 'FIGHTING')) {
            return 1;
        }

        const definition = STATUS_DEFINITIONS[status];
        const statMultipliers = definition && definition.statMultipliers;
        const statMultiplier = statMultipliers ? Number(statMultipliers[stat]) : NaN;

        return Number.isFinite(statMultiplier) ? statMultiplier : 1;
    }

    function getPokemonTypeStatusMultiplier(card, stat, statuses) {
        if (stat !== 'attack' || statuses.length === 0 || !pokemonHasType(card, 'FIGHTING')) {
            return 1;
        }

        return FIGHTING_STATUS_ATTACK_MULTIPLIER;
    }

    function pokemonHasType(card, type) {
        return getCardTypes(card).includes(type);
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

    /**
     * Returns valid stat-stage changes listed on an attack or item card.
     */
    function getActionStatChanges(card) {
        const statChanges = isAttackCard(card)
            ? card.attack.statChanges
            : isItemCard(card)
                ? card.item.statChanges
                : [];

        return (Array.isArray(statChanges) ? statChanges : [])
            .filter(statChange => Boolean(STAT_CHANGE_DELTAS[statChange]));
    }

    /**
     * Applies type-specific stat-change rules before the controller mutates
     * stages: HUMAN doubles each net stat delta; NORMAL clamps each net stat
     * delta to +/-1.
     */
    function getStatChangesForPokemon(card, statChanges) {
        const validStatChanges = (Array.isArray(statChanges) ? statChanges : [])
            .filter(statChange => Boolean(STAT_CHANGE_DELTAS[statChange]));

        if (!isPokemonCard(card) || (!pokemonHasType(card, 'NORMAL') && !pokemonHasType(card, 'HUMAN'))) {
            return validStatChanges;
        }

        const deltasByStat = validStatChanges.reduce((deltas, statChange) => {
            const change = STAT_CHANGE_DELTAS[statChange];
            const currentDelta = deltas[change.stat] || 0;

            deltas[change.stat] = currentDelta + change.delta;

            return deltas;
        }, {});

        return Object.keys(deltasByStat)
            .flatMap(stat => getStatChangesForDelta(stat, getAdjustedStatChangeDelta(card, deltasByStat[stat])))
            .filter(Boolean);
    }

    function getAdjustedStatChangeDelta(card, delta) {
        const humanAdjustedDelta = pokemonHasType(card, 'HUMAN')
            ? delta * HUMAN_STAT_CHANGE_MULTIPLIER
            : delta;

        return pokemonHasType(card, 'NORMAL')
            ? clampNormalStatChangeDelta(humanAdjustedDelta)
            : humanAdjustedDelta;
    }

    function clampNormalStatChangeDelta(delta) {
        return Math.max(
            -NORMAL_STAT_CHANGE_LIMIT,
            Math.min(NORMAL_STAT_CHANGE_LIMIT, delta)
        );
    }

    function getStatChangesForDelta(stat, delta) {
        const direction = delta > 0
            ? '_UP'
            : delta < 0
                ? '_DOWN'
                : null;

        if (!direction) return [];

        return Array.from({ length: Math.abs(delta) }, () => `${stat.toUpperCase()}${direction}`);
    }

    function createDefaultStatStages() {
        return {
            attack: 0,
            defense: 0,
            speed: 0
        };
    }

    /**
     * Ensures a Pokemon has finite attack/defense/speed stages and clamps them
     * before any display, damage, speed, or mutation code reads them.
     */
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

    /**
     * Returns the displayed/effective battle stat after stage, status, and type
     * multipliers. Used by render, damage math, and speed ordering.
     */
    function getPokemonEffectiveStat(card, stat) {
        if (!isPokemonCard(card) || !STAT_LABELS[stat]) return 0;

        const baseStat = Number(card.pokemon[STAT_LABELS[stat].baseKey]) || 0;
        const stagedStat = baseStat * getPokemonStatMultiplier(card, stat);

        return Math.max(1, Math.round(stagedStat * getPokemonStatusMultiplier(card, stat)));
    }

    /**
     * Mutates one stat stage by one step and reports whether the clamped stage
     * actually changed for logging/animation.
     */
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

    /**
     * Resets all stat stages to zero. Called when cards switch out and when
     * Fossil revival returns a card to the board.
     */
    function clearPokemonStatChanges(card) {
        if (!isPokemonCard(card)) return false;

        const stages = ensureStatStages(card);
        const hadChanges = Object.keys(STAT_LABELS).some(stat => stages[stat] !== 0);

        card.statChanges = [];
        card.statStages = createDefaultStatStages();

        return hadChanges;
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

    /**
     * Removes a board card from its slot without deciding where it goes next.
     * Controller uses this for switch, knockout, and Fossil revival.
     */
    function removeCardFromBoard(player, cardId) {
        const slotIndex = player.board.findIndex(card => card && card.id === cardId);

        if (slotIndex === -1) return null;

        const card = player.board[slotIndex];
        player.board[slotIndex] = null;
        return card;
    }

    /**
     * Places a card face down into the main deck and shuffles it. Kept for
     * older deck effects that may still target the main deck.
     */
    function shuffleCardIntoDeck(player, card) {
        card.faceUp = false;
        player.deck = shuffle([...player.deck, card]);
    }

    function hasQueuedAttack(playerId, pokemonCardId) {
        return state.plannedActions[playerId].some(action => action.userCardId === pokemonCardId);
    }

    /**
     * Checks attack type requirements. Most attacks need any shared type; attacks
     * marked full_type_requirements require every listed attack type.
     */
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

    /**
     * Used by turn-ending rules and UI affordances to know whether a Pokemon
     * still has a legal attack in hand that can target something.
     */
    function hasUsableAttackInHand(player, pokemonCard) {
        return player.hand.some(card => (
            isAttackCard(card) &&
            pokemonCanUseAttack(pokemonCard, card) &&
            getTargetOptionsForAction(card, player.id, pokemonCard.id).length > 0
        ));
    }

    /**
     * Converts an attack/item target enum into legal target selections for the
     * current board. Controller and Drag use these options for clicks, drops,
     * opponent AI, and retargeting.
     */
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

    /**
     * Resolves a stored target selection into live board cards at effect time.
     */
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

    /**
     * When a player must draw from an empty deck, turns the discard pile face
     * down, shuffles it, and makes it the new deck.
     */
    function recycleDiscardIntoDeck(player) {
        if (player.deck.length > 0 || player.discard.length === 0) return false;

        player.discard.forEach(card => {
            card.faceUp = false;
        });
        player.deck = shuffle(player.discard);
        player.discard = [];

        return true;
    }

    /**
     * Small Promise-based delay helper used by controller animations.
     */
    function sleep(milliseconds) {
        return new Promise(resolve => {
            setTimeout(resolve, milliseconds);
        });
    }

    arena.state = state;
    arena.Model = {
        applyStatus,
        clearPokemonStatChanges,
        clearPokemonStatuses,
        clearTurnStatuses,
        clearSavedBattleState,
        createPlayer,
        drawCard,
        drawCardsUpToHandSize,
        drawPokemonToBoard,
        findHandCard,
        applyStatChange,
        formatStatusName,
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
        getStatChangesForPokemon,
        getPokemonStatusEntry,
        getPokemonStatuses,
        getPokemonStatusMultiplier,
        getPlayerHandSize,
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
        playOpeningPokemon,
        playerHasCardInHand,
        pokemonCanUseAttack,
        putPokemonOnBottomOfDeck,
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
        updatePokemonLeft,
        sleep
    };
})(window.CardArena = window.CardArena || {});
