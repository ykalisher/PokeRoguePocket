/**
 * Squish - static card arena data
 */

(function attachArenaData(arena) {
    'use strict';

    arena.Constants = Object.freeze({
        CARD_COUNT: 20,
        OPENING_HAND_SIZE: 3,
        POKEMON_LEFT_START: 6,
        SECOND_SLOT_INDEX: 1
    });

    arena.PokemonRoster = [
        {
            baseAttack: 102,
            baseDefense: 54,
            baseHealth: 118,
            baseSpeed: 71,
            id: 'SQ-001',
            name: 'Sprigglow',
            portrait: 'SG',
            types: ['GRASS', 'LIGHT']
        },
        {
            baseAttack: 112,
            baseDefense: 48,
            baseHealth: 70,
            baseSpeed: 82,
            id: 'SQ-002',
            name: 'Embermite',
            portrait: 'EM',
            types: ['FIRE', 'BUG']
        },
        {
            baseAttack: 56,
            baseDefense: 104,
            baseHealth: 86,
            baseSpeed: 45,
            id: 'SQ-003',
            name: 'Shellfin',
            portrait: 'SF',
            types: ['WATER', 'AQUATIC']
        },
        {
            baseAttack: 101,
            baseDefense: 60,
            baseHealth: 74,
            baseSpeed: 68,
            id: 'SQ-004',
            name: 'Voltlynx',
            portrait: 'VL',
            types: ['ELECTRIC', 'FIELD']
        },
        {
            baseAttack: 58,
            baseDefense: 113,
            baseHealth: 92,
            baseSpeed: 38,
            id: 'SQ-005',
            name: 'Mossguard',
            portrait: 'MG',
            types: ['ROCK', 'FLORA', 'GROUND']
        },
        {
            baseAttack: 76,
            baseDefense: 57,
            baseHealth: 73,
            baseSpeed: 106,
            id: 'SQ-006',
            name: 'Mistwing',
            portrait: 'MW',
            types: ['FLYING', 'ICE']
        },
        {
            baseAttack: 66,
            baseDefense: 66,
            baseHealth: 120,
            baseSpeed: 64,
            id: 'SQ-007',
            name: 'Noctuff',
            portrait: 'NT',
            types: ['DARK', 'NORMAL']
        },
        {
            baseAttack: 52,
            baseDefense: 69,
            baseHealth: 76,
            baseSpeed: 108,
            id: 'SQ-008',
            name: 'Psybloom',
            portrait: 'PB',
            types: ['PSYCHIC', 'FAIRY', 'FLORA']
        }
    ];
})(window.CardArena = window.CardArena || {});
