/**
 * Pokemon Rogue Pocket - state and model helpers for the card arena prototype
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
        ITEM_CARDS_PER_MAIN_DECK,
        KNOCKOUT_LIMIT
    } = arena.Constants;

    const BATTLE_STORAGE_KEY = 'card-arena-current-battle';
    const BATTLE_STORAGE_VERSION = 3;
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
        DRAGON_GEM: { iconPath: 'assets/status-icons/DRAGON_GEM.svg', label: 'Dragon Gem', showsToken: false },
        EFFECT_BOOST: { iconPath: 'assets/status-icons/EFFECT_BOOST.svg', label: 'Effect Boost', showsToken: false },
        EXTRA_ATTACK: { iconPath: 'assets/status-icons/EXTRA_ATTACK.svg', label: 'Extra Attack', showsToken: false },
        EXTRA_ITEM: { iconPath: 'assets/status-icons/EXTRA_ITEM.svg', label: 'Extra Item', showsToken: false },
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
        INCREASE_CAPACITY: { iconPath: 'assets/status-icons/INCREASE_CAPACITY.svg', label: 'Increase Capacity', showsToken: false },
        HEAL_BURN: { iconPath: 'assets/status-icons/HEAL_BURN.png', label: 'Heal Burn', showsToken: false },
        HEAL_STATUS: { iconPath: 'assets/status-icons/HEAL_STATUS.png', label: 'Heal Status', showsToken: false },
        MULTI_ATTACK: { iconPath: 'assets/status-icons/MULTI_ATTACK.png', label: 'Multi Attack', showsToken: false },
        PARALYSIS: { iconPath: 'assets/status-icons/PARALYSIS.svg', label: 'Paralysis', showsToken: true, statMultipliers: { speed: 0.5 } },
        POISON: { iconPath: 'assets/status-icons/POISON.svg', label: 'Poison', showsToken: true },
        PROTECT: { expires: 'turn', iconPath: 'assets/status-icons/PROTECT.png', label: 'Protect', showsToken: true },
        REFRESH_DECK: { iconPath: 'assets/status-icons/REFRESH_DECK.svg', label: 'Refresh Deck', showsToken: false },
        REVERT_STATS: { iconPath: 'assets/status-icons/REVERT_STATS.png', label: 'Revert Stats', showsToken: false },
        SELF_INFLICT: { iconPath: 'assets/status-icons/SELF_INFLICT.png', label: 'Self-Inflict', showsToken: false },
        SLEEP: { iconPath: 'assets/status-icons/SLEEP.svg', initialState: () => ({ lastWakeAttemptTurn: null, wakeAttempts: 0 }), label: 'Sleep', showsToken: true },
        SWITCH: { iconPath: 'assets/status-icons/SWITCH.png', label: 'Switch', showsToken: false }
    });
    const DRAGON_GEM_EFFECTS_BY_STATUS = Object.freeze({
        BURN: { iconPath: 'assets/items/FIRE_GEM.png', itemName: 'Fire Gem' },
        CONFUSION: { iconPath: 'assets/items/PSYCHIC_GEM.png', itemName: 'Psychic Gem' },
        FLINCH: { iconPath: 'assets/items/DARK_GEM.png', itemName: 'Dark Gem' },
        PARALYSIS: { iconPath: 'assets/items/ELECTRIC_GEM.png', itemName: 'Electric Gem' },
        POISON: { iconPath: 'assets/items/POISON_GEM.png', itemName: 'Poison Gem' },
        SLEEP: { iconPath: 'assets/items/GRASS_GEM.png', itemName: 'Grass Gem' }
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
        extraAttacks: { opponent: {}, player: {} },
        itemAllowance: { opponent: 1, player: 1 },
        itemUsed: { opponent: 0, player: 0 },
        pendingActionCardId: null,
        pendingUserCardId: null,
        pendingPokemonReplacements: [],
        pileWindow: null,
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
            dragonGems: [],
            effectBoost: false,
            hand: [],
            handSize: HAND_SIZE,
            id,
            initialPokemonCount: decks.pokemonDeck.length,
            knockout: [],
            knockoutCount: 0,
            lostByPokemonDeck: false,
            name,
            pokemonDeck: decks.pokemonDeck,
            pokemonLeft: decks.pokemonDeck.length,
            removed: []
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
        state.log = normalizeSavedLog(savedBattle.log);
        state.phase = savedBattle.phase || 'turn';
        state.flowTimer = null;
        state.drag = null;
        state.extraAttacks = normalizeExtraAttacks(savedBattle.extraAttacks);
        state.itemAllowance = normalizeItemAllowance(savedBattle.itemAllowance);
        state.itemUsed = normalizeItemUsed(savedBattle.itemUsed);
        state.pendingActionCardId = savedBattle.pendingActionCardId || null;
        state.pendingUserCardId = savedBattle.pendingUserCardId || null;
        state.pendingPokemonReplacements = [];
        state.pileWindow = null;
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
            extraAttacks: state.extraAttacks,
            finished: state.finished,
            itemAllowance: state.itemAllowance,
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

    function normalizeSavedLog(log) {
        return Array.isArray(log)
            ? log.filter(entry => typeof entry === 'string')
            : [];
    }

    function normalizeItemUsed(itemUsed) {
        return {
            opponent: normalizeCount(itemUsed && itemUsed.opponent, 0),
            player: normalizeCount(itemUsed && itemUsed.player, 0)
        };
    }

    function normalizeItemAllowance(itemAllowance) {
        return {
            opponent: normalizeCount(itemAllowance && itemAllowance.opponent, 1),
            player: normalizeCount(itemAllowance && itemAllowance.player, 1)
        };
    }

    function normalizeExtraAttacks(extraAttacks) {
        return {
            opponent: normalizeExtraAttackMap(extraAttacks && extraAttacks.opponent),
            player: normalizeExtraAttackMap(extraAttacks && extraAttacks.player)
        };
    }

    function normalizeExtraAttackMap(extraAttackMap) {
        if (!extraAttackMap || typeof extraAttackMap !== 'object') return {};

        return Object.keys(extraAttackMap).reduce((extras, cardId) => {
            const count = normalizeCount(extraAttackMap[cardId], 0);

            if (count > 0) extras[cardId] = count;

            return extras;
        }, {});
    }

    function normalizeCount(value, minimum) {
        const count = Math.floor(Number(value));

        return Number.isFinite(count) && count > minimum ? count : minimum;
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
        const removed = Array.isArray(normalizedPlayer.removed)
            ? normalizedPlayer.removed.filter(card => !isPokemonCard(card))
            : [];
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
            dragonGems: normalizeDragonGemEffects(normalizedPlayer.dragonGems),
            effectBoost: Boolean(normalizedPlayer.effectBoost),
            hand,
            handSize: Number.isFinite(normalizedPlayer.handSize) ? normalizedPlayer.handSize : HAND_SIZE,
            id,
            initialPokemonCount: Number.isFinite(normalizedPlayer.initialPokemonCount)
                ? normalizedPlayer.initialPokemonCount
                : countTotalPokemon(normalizedBoard, pokemonDeck, knockout),
            knockout,
            knockoutCount: Number.isFinite(normalizedPlayer.knockoutCount)
                ? normalizedPlayer.knockoutCount
                : knockout.filter(isPokemonCard).length,
            lostByPokemonDeck: Boolean(normalizedPlayer.lostByPokemonDeck),
            name: normalizedPlayer.name || name,
            pokemonDeck,
            pokemonLeft: 0,
            removed
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

    function countTotalPokemon(board, pokemonDeck, knockout) {
        return [
            ...board,
            ...pokemonDeck,
            ...knockout
        ].filter(isPokemonCard).length;
    }

    function updatePokemonLeft(player) {
        if (!player) return 0;

        player.pokemonLeft = countRemainingPokemon(player);

        return player.pokemonLeft;
    }

    function getInitialPokemonCount(player) {
        return Number.isFinite(player && player.initialPokemonCount) && player.initialPokemonCount > 0
            ? player.initialPokemonCount
            : KNOCKOUT_LIMIT;
    }

    /**
     * Knockouts needed to defeat a player: every Pokemon for teams at or below
     * the standard knockout limit, otherwise the standard limit.
     */
    function getEffectiveKnockoutLimit(player) {
        return Math.min(getInitialPokemonCount(player), KNOCKOUT_LIMIT);
    }

    /**
     * Counts knockout-pile Fossils that can still revive during end-of-turn
     * replacement: FOSSIL-typed, revival unused, and not the most recent
     * knockout (a Fossil only revives after another ally is knocked out).
     * Must stay in sync with the eligibility scan in the controller's
     * reviveFossilPokemonFromKnockout().
     */
    function countPendingFossilRevivals(player) {
        if (!player || !Array.isArray(player.knockout)) return 0;

        return player.knockout.filter((card, index) => (
            index > 0 &&
            isPokemonCard(card) &&
            getCardTypes(card).includes('FOSSIL') &&
            !card.hasUsedFossilRevival
        )).length;
    }

    /**
     * Defeat check shared by the controller, render, and page flow. Knockouts
     * that a pending Fossil revival can refund do not count toward the limit,
     * so the battle never ends while an eligible Fossil could still revive at
     * end of turn. Teams larger than the knockout limit also lose when their
     * Pokemon deck cannot supply a replacement.
     */
    function isPlayerDefeated(player) {
        if (!player) return false;

        const countedKnockouts = (Number(player.knockoutCount) || 0) - countPendingFossilRevivals(player);
        const knockoutDefeat = countedKnockouts >= getEffectiveKnockoutLimit(player);
        const deckEmptyDefeat = getInitialPokemonCount(player) > KNOCKOUT_LIMIT && Boolean(player.lostByPokemonDeck);

        return knockoutDefeat || deckEmptyDefeat;
    }

    /**
     * Builds the two-deck battle structure from a configured deck definition, or
     * from the default arena deck when no explicit deck has been supplied.
     */
    function createDecks(playerId) {
        const prefix = playerId === 'player' ? 'YOU' : 'OPP';
        const data = arena.GameData || { attacks: [], items: [], pokemon: [] };
        const definition = getBattleDeckDefinition(playerId);
        const exactDecks = createExactDecks(data, definition, playerId, prefix);

        if (exactDecks) {
            return {
                mainDeck: shuffle(exactDecks.mainDeck),
                pokemonDeck: shuffle(exactDecks.pokemonDeck)
            };
        }

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
        if (!definition || typeof definition !== 'object') return null;

        const hasPokemonDefinitions = Array.isArray(definition.pokemon);
        const hasExactPokemonCards = definition.exactCards && Array.isArray(definition.pokemonCards);

        if (!hasPokemonDefinitions && !hasExactPokemonCards) return null;

        return {
            actionCards: Array.isArray(definition.actionCards) ? definition.actionCards : [],
            exactCards: Boolean(definition.exactCards),
            items: Array.isArray(definition.items) ? definition.items.slice(0, ITEM_CARDS_PER_MAIN_DECK) : [],
            pokemonCards: Array.isArray(definition.pokemonCards) ? definition.pokemonCards : [],
            pokemon: (hasPokemonDefinitions ? definition.pokemon : [])
                .map(entry => typeof entry === 'string' ? { name: entry, attacks: [] } : entry)
                .filter(entry => entry && entry.name)
        };
    }

    function createExactDecks(data, definition, playerId, prefix) {
        if (!definition.exactCards) return null;

        const pokemonDeck = createExactPokemonDeck(data.pokemon, definition.pokemonCards, playerId, prefix);

        if (pokemonDeck.length === 0) return null;

        return {
            mainDeck: createExactMainDeck(data, definition.actionCards, playerId, prefix),
            pokemonDeck
        };
    }

    function createExactPokemonDeck(pokemonRecords, sourceCards, playerId, prefix) {
        return sourceCards
            .map((card, index) => {
                const speciesName = card && card.pokemon ? card.pokemon.name : card && card.name;
                const species = findRecordByName(pokemonRecords, speciesName) || (card && card.pokemon);

                return species ? createPokemonCard(species, playerId, `${prefix}-PKM-${index + 1}`) : null;
            })
            .filter(Boolean);
    }

    function createExactMainDeck(data, sourceCards, playerId, prefix) {
        return sourceCards
            .map((card, index) => {
                if (isAttackCard(card) || card.attack) {
                    const attackName = card.attack ? card.attack.name : card.name;
                    const attack = findRecordByName(data.attacks, attackName) || card.attack;

                    return attack ? createAttackCard(attack, playerId, `${prefix}-ACT-${index + 1}`) : null;
                }

                if (isItemCard(card) || card.item) {
                    const itemName = card.item ? card.item.name : card.name;
                    const item = findRecordByName(data.items, itemName) || card.item;

                    return item ? createItemCard(item, playerId, `${prefix}-ACT-${index + 1}`) : null;
                }

                return null;
            })
            .filter(Boolean);
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

    function isDragonGemItemCard(card) {
        return Boolean(getDragonGemEffectForItem(card));
    }

    function getDragonGemEffectForItem(card) {
        if (!isItemCard(card)) return null;

        const statuses = getActionStatuses(card);

        if (!statuses.includes('DRAGON_GEM')) return null;

        const effectStatus = statuses.find(status => status !== 'DRAGON_GEM' && isDragonGemEffectStatus(status));

        if (!effectStatus) return null;

        return createDragonGemEffect(effectStatus, card.item);
    }

    function addDragonGemEffect(playerId, itemCard) {
        const player = state.players[playerId];
        const effect = getDragonGemEffectForItem(itemCard);

        if (!player || !effect) {
            return { effect: null, replaced: false, replacedEffect: null };
        }

        const dragonGems = ensurePlayerDragonGems(player);
        const replacedEffect = dragonGems[0] || null;

        player.dragonGems = [effect];

        return {
            effect,
            replaced: Boolean(replacedEffect && replacedEffect.status !== effect.status),
            replacedEffect
        };
    }

    function getDragonGemEffects(playerId) {
        const player = state.players[playerId];

        return player ? ensurePlayerDragonGems(player).slice() : [];
    }

    function ensurePlayerDragonGems(player) {
        if (!player) return [];

        player.dragonGems = normalizeDragonGemEffects(player.dragonGems);

        return player.dragonGems;
    }

    /**
     * Standalone effect-boost item (NOT a dragon gem): a SIDE item carrying the
     * EFFECT_BOOST status. It sets a per-side flag that persists for the battle.
     */
    function isEffectBoostItemCard(card) {
        if (!isItemCard(card)) return false;

        return getActionTarget(card) === 'SIDE' && getActionStatuses(card).includes('EFFECT_BOOST');
    }

    function applyEffectBoost(playerId) {
        const player = state.players[playerId];

        if (!player || player.effectBoost) return false;

        player.effectBoost = true;
        return true;
    }

    function hasEffectBoost(playerId) {
        const player = state.players[playerId];

        return Boolean(player && player.effectBoost);
    }

    function normalizeDragonGemEffects(effects) {
        if (!Array.isArray(effects)) return [];

        let normalizedEffect = null;

        effects.forEach(effect => {
            const status = normalizeStatus(effect);

            if (!isDragonGemEffectStatus(status)) return;

            const source = effect && typeof effect === 'object'
                ? { imagePath: effect.iconPath, name: effect.itemName || effect.label }
                : {};
            const nextEffect = createDragonGemEffect(status, source);

            if (nextEffect) normalizedEffect = nextEffect;
        });

        return normalizedEffect ? [normalizedEffect] : [];
    }

    function createDragonGemEffect(status, item = {}) {
        const normalizedStatus = normalizeStatus(status);
        const definition = DRAGON_GEM_EFFECTS_BY_STATUS[normalizedStatus];

        if (!definition) return null;

        const itemName = item.name || definition.itemName;

        return {
            iconPath: item.imagePath || definition.iconPath,
            itemName,
            label: itemName,
            status: normalizedStatus,
            statusLabel: formatStatusName(normalizedStatus)
        };
    }

    function isDragonGemEffectStatus(status) {
        return Boolean(DRAGON_GEM_EFFECTS_BY_STATUS[status] && isBattleStatus(status));
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

        if (normalizedStatus === 'SLEEP') {
            statusEntry.lastWakeAttemptTurn = state.turnNumber;
        }

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
     * delta to +/-1. NORMAL overrides HUMAN — a NORMAL+HUMAN pokemon is
     * clamped and never doubled.
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
        if (pokemonHasType(card, 'NORMAL')) return clampNormalStatChangeDelta(delta);
        if (pokemonHasType(card, 'HUMAN')) return delta * HUMAN_STAT_CHANGE_MULTIPLIER;
        return delta;
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

    /**
     * ARTIFICIAL-typed attacks are trainer-effect attacks: they resolve
     * immediately, ignore the per-Pokemon attack limit, and are removed from
     * play after one use per battle.
     */
    function isArtificialAttackCard(card) {
        return isAttackCard(card) && getCardTypes(card).includes('ARTIFICIAL');
    }

    function isItemCard(card) {
        return Boolean(card && card.kind === 'item');
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

    function hasQueuedAttack(playerId, pokemonCardId) {
        return state.plannedActions[playerId].some(action => action.userCardId === pokemonCardId);
    }

    function getQueuedAttackCount(playerId, pokemonCardId) {
        return state.plannedActions[playerId].filter(action => action.userCardId === pokemonCardId).length;
    }

    function getExtraAttackCount(playerId, pokemonCardId) {
        const extras = state.extraAttacks && state.extraAttacks[playerId];
        const count = extras ? Number(extras[pokemonCardId]) : 0;

        return Number.isFinite(count) && count > 0 ? count : 0;
    }

    /**
     * Checks the per-turn attack limit: one queued attack per Pokemon plus any
     * extra attacks granted this turn by EXTRA_ATTACK trainer effects.
     */
    function canQueueAnotherAttack(playerId, pokemonCardId) {
        return getQueuedAttackCount(playerId, pokemonCardId) < 1 + getExtraAttackCount(playerId, pokemonCardId);
    }

    /**
     * Grants one extra queued attack this turn, cleared when the next player
     * turn resets state.extraAttacks.
     */
    function grantExtraAttack(playerId, pokemonCardId) {
        if (!state.extraAttacks[playerId]) state.extraAttacks[playerId] = {};

        state.extraAttacks[playerId][pokemonCardId] = getExtraAttackCount(playerId, pokemonCardId) + 1;
    }

    /**
     * Counts item plays against the per-turn allowance, which starts at one and
     * can grow through EXTRA_ITEM trainer effects.
     */
    function getItemAllowance(playerId) {
        const allowance = state.itemAllowance ? Number(state.itemAllowance[playerId]) : 1;

        return Number.isFinite(allowance) && allowance > 1 ? allowance : 1;
    }

    function getItemUseCount(playerId) {
        const count = state.itemUsed ? Number(state.itemUsed[playerId]) : 0;

        return Number.isFinite(count) && count > 0 ? count : 0;
    }

    function hasItemUseRemaining(playerId) {
        return getItemUseCount(playerId) < getItemAllowance(playerId);
    }

    function markItemUsed(playerId) {
        state.itemUsed[playerId] = getItemUseCount(playerId) + 1;
    }

    function grantExtraItemUse(playerId) {
        state.itemAllowance[playerId] = getItemAllowance(playerId) + 1;
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
     * still has a legal attack in hand that can target something. Artificial
     * attacks are optional single-use cards, so they never block ending a turn.
     */
    function hasUsableAttackInHand(player, pokemonCard) {
        return player.hand.some(card => (
            isAttackCard(card) &&
            !isArtificialAttackCard(card) &&
            pokemonCanUseAttack(pokemonCard, card) &&
            getTargetOptionsForAction(card, player.id, pokemonCard.id).length > 0
        ));
    }

    /**
     * Full use check for one Pokemon and one attack card right now: type
     * requirements, a live target, and the attack limit. Artificial attacks
     * skip the limit so a Pokemon can use one alongside its normal attack.
     */
    function canPokemonUseAttackNow(playerId, pokemonCard, attackCard) {
        if (!pokemonCanUseAttack(pokemonCard, attackCard)) return false;
        if (getTargetOptionsForAction(attackCard, playerId, pokemonCard.id).length === 0) return false;

        return isArtificialAttackCard(attackCard) || canQueueAnotherAttack(playerId, pokemonCard.id);
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

            if (target === 'TRAINER') {
                return actionCardHasUsableTrainerEffect(actionCard, actorId, userCardId)
                    ? [{ kind: 'trainer', owner: actorId }]
                    : [];
            }

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

    /**
     * TRAINER-target attacks only offer their trainer target while at least one
     * listed trainer effect could do something, so dead single-use cards are
     * never playable.
     */
    function actionCardHasUsableTrainerEffect(actionCard, actorId, userCardId) {
        return getActionStatuses(actionCard).some(status => canApplyTrainerEffect(status, actorId, userCardId));
    }

    function canApplyTrainerEffect(status, actorId, userCardId) {
        const player = state.players[actorId];

        if (!player) return false;

        if (status === 'EXTRA_ATTACK') {
            return getBoardCards(actorId).some(card => card.id !== userCardId);
        }

        if (status === 'REFRESH_DECK') {
            return player.discard.length > 0;
        }

        return status === 'INCREASE_CAPACITY' || status === 'EXTRA_ITEM';
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
     * REFRESH_DECK trainer effect: shuffles the discard pile into the main deck
     * immediately, without waiting for the deck to run empty.
     */
    function shuffleDiscardIntoDeck(player) {
        if (!player || player.discard.length === 0) return false;

        player.discard.forEach(card => {
            card.faceUp = false;
        });
        player.deck = shuffle([...player.deck, ...player.discard]);
        player.discard = [];

        return true;
    }

    /**
     * INCREASE_CAPACITY trainer effect: raises the hand size the player refills
     * to at the start of each turn for the rest of the battle.
     */
    function increasePlayerHandSize(player) {
        player.handSize = getPlayerHandSize(player) + 1;

        return player.handSize;
    }

    /**
     * Sets a used single-use card aside for the rest of the battle. Removed
     * cards never rejoin the deck through discard recycling.
     */
    function removeCardFromPlay(player, card) {
        if (!Array.isArray(player.removed)) player.removed = [];

        player.removed.push(card);
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
        canPokemonUseAttackNow,
        canQueueAnotherAttack,
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
        addDragonGemEffect,
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
        getDragonGemEffectForItem,
        getDragonGemEffects,
        applyEffectBoost,
        hasEffectBoost,
        isEffectBoostItemCard,
        getEffectiveKnockoutLimit,
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
        grantExtraAttack,
        grantExtraItemUse,
        hasItemUseRemaining,
        hasPokemonStatus,
        hasQueuedAttack,
        hasUsableAttackInHand,
        increasePlayerHandSize,
        isArtificialAttackCard,
        isAttackCard,
        isBattleStatus,
        isDragonGemItemCard,
        isItemCard,
        isPlayerDefeated,
        isPokemonCard,
        playOpeningPokemon,
        playerHasCardInHand,
        pokemonCanUseAttack,
        putPokemonOnBottomOfDeck,
        markItemUsed,
        recycleDiscardIntoDeck,
        removeCardFromHand,
        removeCardFromBoard,
        removeCardFromPlay,
        removePokemonStatus,
        restoreSavedBattleState,
        saveBattleState,
        shuffle,
        shuffleDiscardIntoDeck,
        targetOptionsIncludeCard,
        targetOptionsIncludeGroup,
        updatePokemonLeft,
        sleep
    };
})(window.CardArena = window.CardArena || {});
