/**
 * Card types are used primarily as attack requirements:
 * - A Pokemon can use an attack when it has at least one of the attack's types.
 * - If an attack has full_type_requirements, the Pokemon must have every listed
 *   attack type.
 *
 * Type-specific battle rules:
 * - FIGHTING Pokemon gain 1.5x Attack while affected by any battle status.
 *   Burn does not apply its normal Attack penalty to FIGHTING Pokemon.
 * - NORMAL Pokemon can only receive a net +/-1 stage change per stat from a
 *   single action, after other type modifiers are applied.
 * - HUMAN Pokemon double the net stat-stage delta they receive from each action.
 * - ICE attacks calculate damage from base Attack/Defense only, ignoring stat
 *   stages and status multipliers for both attacker and target.
 * - STEEL attacks use the attacker's Defense instead of Attack as the damage stat.
 * - FOSSIL Pokemon already in the knockout pile can revive once at end of turn
 *   after another allied Pokemon is knocked out. They return to that board slot
 *   with 60% max HP, cleared statuses/stat stages, and Fatigue.
 */
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

/**
 * Status values include both persistent battle statuses and one-shot action
 * effects. A Pokemon can only have one persistent battle status at a time; a new
 * persistent status is blocked while another one is active.
 *
 * Persistent battle statuses:
 * - BURN: Deals 5% max HP damage at end of turn and halves Attack. FIGHTING
 *   Pokemon ignore the Attack penalty. Protect blocks burn damage.
 * - CONFUSION: Before attacking, the Pokemon has a 50% chance to recover. If it
 *   stays confused, it has a 50% chance to hurt itself for 10% max HP damage and
 *   lose the attack. Protect blocks confusion self-damage.
 * - FATIGUE: Lasts for 3 end-of-turn cleanup ticks and multiplies Defense and
 *   Speed by 0.75 while active.
 * - FLINCH: Prevents the Pokemon's next attack and expires at end of turn.
 * - PARALYSIS: Halves Speed and gives a 1-in-3 chance to lose an attack.
 * - POISON: Deals 10% max HP damage at end of turn. Protect blocks poison damage.
 * - PROTECT: Gives the action priority, prevents incoming attack/status damage,
 *   and expires at end of turn.
 * - SLEEP: Prevents attacks until the Pokemon wakes. The first wake attempt
 *   always fails; attempts 2 and 3 have a 50% wake chance; attempt 4 is
 *   guaranteed to wake. Sleeping Pokemon that do not attack still tick once per
 *   turn at end of turn.
 *
 * One-shot action effects:
 * - FULL_HEAL: Heals HP and clears the target's persistent battle status.
 * - HEAL: Restores 20% max HP.
 * - HEAL_BURN: Clears Burn only.
 * - HEAL_STATUS: Clears the target's persistent battle status.
 * - MULTI_ATTACK: A damaging attack hits 2-6 times. Its stat-change effect uses
 *   a 20% activation chance instead of the normal damaging attack chance.
 * - SELF_INFLICT: Stat changes apply to the attacking Pokemon instead of the
 *   selected targets.
 * - SWITCH: Removes the target from the board, clears its stat stages, puts it
 *   on the bottom of its owner's Pokemon deck, and draws a replacement.
 * - NONE: No status or action effect.
 */
const Status = Object.freeze({
    NONE: 'NONE',
    BURN: 'BURN',
    CONFUSION: 'CONFUSION',
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
    SELF_INFLICT: 'SELF_INFLICT',
    SLEEP: 'SLEEP',
    SWITCH: 'SWITCH'
});

/**
 * Stat changes modify attack, defense, and speed stages. Each *_UP adds one
 * stage and each *_DOWN removes one stage. Stages are clamped from -6 to +6.
 *
 * Stage multipliers:
 * -6: 0.1x, -5: 0.2x, -4: 0.35x, -3: 0.5x, -2: 0.67x, -1: 0.8x
 *  0: 1x
 * +1: 1.5x, +2: 2x, +3: 2.5x, +4: 3x, +5: 3.5x, +6: 4x
 *
 * Effective battle stats are rounded after multiplying base stat by the stage
 * multiplier and any status/type multipliers, with a minimum value of 1.
 *
 * Damaging attacks apply their stat changes only when their stat-change effect
 * activates: normally 1-in-3, or 20% for MULTI_ATTACK. Non-damaging attacks and
 * items apply listed stat changes immediately. Repeating a change in the array
 * applies multiple stages before type-specific modifiers are considered.
 */
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
