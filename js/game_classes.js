const PokeType = Object.freeze({
    AMORPHOUS: 'AMORPHOUS',
    AQUATIC: 'AQUATIC',
    ARTIFICIAL: 'ARTIFICIAL',
    BABY: 'BABY',
    BUG: 'BUG',
    DARK: 'DARK',
    DRAGON: 'DRAGON',
    ELECTRIC: 'ELECTRIC',
    FAIRY: 'FAIRY',
    FIELD: 'FIELD',
    FIGHTING: 'FIGHTING',
    FIRE: 'FIRE',
    FLORA: 'FLORA',
    FLYING: 'FLYING',
    FOSSIL: 'FOSSIL',
    GHOST: 'GHOST',
    GROURMET: 'GROURMET',
    GRASS: 'GRASS',
    GROUND: 'GROUND',
    HUMAN: 'HUMAN',
    ICE: 'ICE',
    LIGHT: 'LIGHT',
    MONSTER: 'MONSTER',
    NORMAL: 'NORMAL',
    POISON: 'POISON',
    PSYCHIC: 'PSYCHIC',
    ROCK: 'ROCK',
    SOUND: 'SOUND',
    STEEL: 'STEEL',
    WATER: 'WATER',
    WILD: 'WILD',
    NONE: 'NONE'
});

const Status = Object.freeze({
    BURN: 'BURN',
    CONFUSION: 'CONFUSION',
    FATIGUE: 'FATIGUE',
    FLINCH: 'FLINCH',
    HEAL: 'HEAL',
    PARALYSIS: 'PARALYSIS',
    POISON: 'POISON',
    PROTECT: 'PROTECT',
    SLEEP: 'SLEEP',
    SWITCH: 'SWITCH'
});

const StatChange = Object.freeze({
    ATTACK_UP: 'ATTACK_UP',
    DEFENSE_UP: 'DEFENSE_UP',
    SPEED_UP: 'SPEED_UP',
    ATTACK_DOWN: 'ATTACK_DOWN',
    DEFENSE_DOWN: 'DEFENSE_DOWN',
    SPEED_DOWN: 'SPEED_DOWN'
});

const Target = Object.freeze({
    SELF: 'SELF',
    ALLY: 'ALLY',
    ALL_ALLIES: 'ALL_ALLIES',
    OPPONENT: 'OPPONENT',
    ALL_OPPONENTS: 'ALL_OPPONENTS'
});

class Pokemon {
    constructor(name, type1, type2, type3, id, baseHealth, baseAttack, baseDefense, baseSpeed) {
        this.name = name;
        this.type1 = type1;
        this.type2 = type2;
        this.type3 = type3;
        this.id = id;
        this.baseHealth = baseHealth;
        this.baseAttack = baseAttack;
        this.baseDefense = baseDefense;
        this.baseSpeed = baseSpeed;
    }
}

class Attack {
    constructor(name, type1, type2, basePower, status, statChanges, target) {
        this.name = name;
        this.type1 = type1;
        this.type2 = type2;
        this.basePower = basePower;
        this.status = status;
        this.statChanges = statChanges;
        this.target = target;
    }
}

class Item {
    constructor(name, target, status, statChanges) {
        this.name = name;
        this.target = target;
        this.status = status;
        this.statChanges = statChanges;
    }
}

class PokemonCard {
    constructor(species, currentStatus, statChanges) {
        this.species = species;
        this.currentHealth = species.baseHealth;
        this.id = Math.floor(Math.random() * 10000000000).toString().padStart(10, '0');
        this.currentStatus = currentStatus;
        this.statChanges = statChanges;
    }
}
