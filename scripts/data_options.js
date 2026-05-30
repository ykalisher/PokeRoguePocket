const PokeType = Object.freeze({
    ARTIFICIAL: 'ARTIFICIAL',
    BABY: 'BABY',
    BUG: 'BUG',
    DARK: 'DARK',
    DRAGON: 'DRAGON',
    ELECTRIC: 'ELECTRIC',
    FAIRY: 'FAIRY',
    FIGHTING: 'FIGHTING',
    FIRE: 'FIRE',
    FLYING: 'FLYING',
    FOSSIL: 'FOSSIL',
    GHOST: 'GHOST',
    GOURMET: 'GOURMET',
    GRASS: 'GRASS',
    GROUND: 'GROUND',
    HUMAN: 'HUMAN',
    ICE: 'ICE',
    LEGENDARY: 'LEGENDARY',
    MONSTER: 'MONSTER',
    NORMAL: 'NORMAL',
    POISON: 'POISON',
    PSYCHIC: 'PSYCHIC',
    ROCK: 'ROCK',
    STEEL: 'STEEL',
    WATER: 'WATER',
    NONE: 'NONE'
});

const Status = Object.freeze({
    BURN: 'BURN',
    CONFUSION: 'CONFUSION',
    DRAGON_GEM: 'DRAGON_GEM',
    FATIGUE: 'FATIGUE',
    FLINCH: 'FLINCH',
    FULL_HEAL: 'FULL_HEAL',
    HEAL: 'HEAL',
    HEAL_BURN: 'HEAL_BURN',
    HEAL_STATUS: 'HEAL_STATUS',
    MULTI_ATTACK: 'MULTI_ATTACK',
    PARALYSIS: 'PARALYSIS',
    POISON: 'POISON',
    PROTECT: 'PROTECT',
    REVERT_STATS: 'REVERT_STATS',
    SELF_INFLICT: 'SELF_INFLICT',
    SLEEP: 'SLEEP',
    SWITCH: 'SWITCH',
    NONE: 'NONE'
});

const StatChange = Object.freeze({
    ATTACK_UP: 'ATTACK_UP',
    DEFENSE_UP: 'DEFENSE_UP',
    SPEED_UP: 'SPEED_UP',
    ATTACK_DOWN: 'ATTACK_DOWN',
    DEFENSE_DOWN: 'DEFENSE_DOWN',
    SPEED_DOWN: 'SPEED_DOWN'
});

const AttackTarget = Object.freeze({
    SELF: 'SELF',
    ALLY: 'ALLY',
    ALL_ALLIES: 'ALL_ALLIES',
    OPPONENT: 'OPPONENT',
    ALL_OPPONENTS: 'ALL_OPPONENTS'
});

const ItemTarget = Object.freeze({
    SELF: 'SELF',
    SIDE: 'SIDE',
    ALLY: 'ALLY',
    ALL_ALLIES: 'ALL_ALLIES',
    OPPONENT: 'OPPONENT',
    ALL_OPPONENTS: 'ALL_OPPONENTS'
});

class Rank {
    static STANDARD = 'Standard';
    static ACE = 'Ace';
    static SPECIAL = 'Special';
    static BOSS = 'Boss';
    static ELITE = 'Elite';
}

Object.freeze(Rank);

module.exports = {
    AttackTarget,
    ItemTarget,
    PokeType,
    Rank,
    StatChange,
    Status
};
