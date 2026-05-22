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
    NONE: 'NONE',
    BURN: 'BURN',
    CONFUSION: 'CONFUSION',
    FATIGUE: 'FATIGUE',
    FLINCH: 'FLINCH',
    HEAL: 'HEAL',
    HEAL_BURN: 'HEAL_BURN',
    HEAL_STATUS: 'HEAL_STATUS',
    MULTI_ATTACK: 'MULTI_ATTACK',
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

function compactTypes(types) {
    return types.filter(type => type && type !== PokeType.NONE);
}

class Pokemon {
    /**
     * @param {string} name
     * @param {PokeType} type1
     * @param {PokeType} type2
     * @param {PokeType} type3
     * @param {string} id
     * @param {number} baseHealth
     * @param {number} baseAttack
     * @param {number} baseDefense
     * @param {number} baseSpeed
     */
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

    get types() {
        return compactTypes([this.type1, this.type2, this.type3]);
    }

    get portraitPath() {
        return `assets/portraits/${encodeURIComponent(this.name)}.png`;
    }
}

class Attack {
    /**
     * @param {string} name
     * @param {PokeType} type1
     * @param {PokeType} type2
     * @param {number} basePower
     * @param {Status} status
     * @param {StatChange[]} statChanges
     * @param {Target} target
     * @param {boolean} full_type_requirements
     */
    constructor(name, type1, type2, basePower, status, statChanges, target, full_type_requirements) {
        this.name = name;
        this.type1 = type1;
        this.type2 = type2;
        this.basePower = basePower;
        this.status = status;
        this.statChanges = statChanges;
        this.target = target;
        this.full_type_requirements = full_type_requirements;
    }

    get types() {
        return compactTypes([this.type1, this.type2]);
    }
}

class Item {
    /**
     * @param {string} name
     * @param {Target} target
     * @param {Status[]} status
     * @param {StatChange[]} statChanges
     */
    constructor(name, target, status, statChanges) {
        this.name = name;
        this.target = target;
        this.status = status;
        this.statChanges = statChanges;
    }
}

class PokemonCard {
    /**
     * @param {Pokemon} species
     * @param {Status[]} currentStatus
     * @param {StatChange[]} statChanges
     */
    constructor(species, currentStatus, statChanges) {
        this.kind = 'pokemon';
        this.species = species;
        this.pokemon = species;
        this.currentHealth = species.baseHealth;
        this.id = Math.floor(Math.random() * 32768).toString().padStart(5, '0');
        this.faceUp = false;
        this.currentStatus = currentStatus;
        this.statChanges = statChanges;
        this.statStages = {
            attack: 0,
            defense: 0,
            speed: 0
        };
    }
}

class Bag {
    /**
     * Represents a player's inventory and deck.
     */
    constructor() {
        this.id = Math.floor(Math.random() * 32768).toString().padStart(5, '0');
        /** @type {Object.<string, number>} */
        this.pokemon = {};
        /** @type {Object.<string, number>} */
        this.items = {};
        /** @type {Object.<string, number>} */
        this.attacks = {};
        /** @type {(PokemonCard|Item|Attack)[]} */
        this.deck = [];
        /** @type {number} */
        this.pokedollars = 0;
    }

    /**
     * Saves the current bag state to localStorage.
     */
    save() {
        const key = `bag_${this.id}`;
        const data = JSON.stringify(this);
        localStorage.setItem(key, data);
    }
}
