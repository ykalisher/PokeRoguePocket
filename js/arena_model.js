/**
 * Squish - state and model helpers for the card arena prototype
 */

(function attachArenaModel(arena) {
    'use strict';

    const { CARD_COUNT, OPENING_HAND_SIZE, POKEMON_LEFT_START } = arena.Constants;
    const roster = arena.PokemonRoster;

    const state = {
        currentPlayer: null,
        elements: {},
        finished: false,
        isResolving: true,
        log: [],
        phase: 'setup',
        flowTimer: null,
        drag: null,
        pendingAttackCardId: null,
        players: {},
        popupTimer: null,
        selectedCardId: null,
        suppressNextClick: false,
        turnNumber: 0
    };

    function createPlayer(id, name) {
        return {
            board: [null, null],
            deck: createDeck(id),
            discard: [],
            hand: [],
            id,
            name,
            pokemonLeft: POKEMON_LEFT_START
        };
    }

    function createDeck(playerId) {
        const prefix = playerId === 'player' ? 'YOU' : 'OPP';
        const rosterOffset = playerId === 'player' ? 0 : 3;
        const deck = Array.from({ length: CARD_COUNT }, (_, index) => {
            const species = roster[(index + rosterOffset) % roster.length];

            return {
                faceUp: false,
                id: `${prefix}-${String(index + 1).padStart(2, '0')}`,
                owner: playerId,
                species,
                currentHealth: species.baseHealth,
                currentStatus: [],
                statChanges: []
            };
        });

        return shuffle(deck);
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
        });
    }

    function placeOpeningCard(player) {
        const card = player.hand.shift();

        if (!card) return;

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

    function playerHasCardInHand(cardId) {
        return state.players.player.hand.some(card => card.id === cardId);
    }

    function getHealthPercent(card) {
        return Math.max(0, Math.round((card.currentHealth / card.species.baseHealth) * 100));
    }

    function getPortraitHue(speciesId) {
        return speciesId.split('').reduce((total, character) => total + character.charCodeAt(0), 0) % 360;
    }

    function getCardName(card) {
        return card.species.name;
    }

    function hasOpponentBoardTarget() {
        return state.players.opponent.board.some(Boolean);
    }

    function sleep(milliseconds) {
        return new Promise(resolve => {
            setTimeout(resolve, milliseconds);
        });
    }

    arena.state = state;
    arena.Model = {
        createPlayer,
        drawCard,
        drawOpeningHands,
        flipOpeningCards,
        getCardName,
        getHealthPercent,
        getPortraitHue,
        hasOpponentBoardTarget,
        placeOpeningCard,
        playerHasCardInHand,
        removeCardFromHand,
        sleep
    };
})(window.CardArena = window.CardArena || {});
