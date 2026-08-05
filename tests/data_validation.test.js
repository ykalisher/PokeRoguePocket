'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, loadRealGameData } = require('./helpers/arena_env');
const { AttackTarget, ItemTarget, PokeType, Rank, StatChange, Status } = require('../scripts/data_options');

// The engine supports a few values beyond the data_options enums:
// TRAINER-target artificial attacks (arena_model.js getTargetOptionsForAction)
// and their effect statuses (arena_controller.js useArtificialAttackFromHand).
const ARTIFICIAL_ATTACK_TARGETS = ['TRAINER'];
const ARTIFICIAL_ATTACK_STATUSES = ['EXTRA_ATTACK', 'EXTRA_ITEM', 'INCREASE_CAPACITY', 'REFRESH_DECK'];

const VALID_ATTACK_TARGETS = new Set([...Object.values(AttackTarget), ...ARTIFICIAL_ATTACK_TARGETS]);
const VALID_ATTACK_STATUSES = new Set([...Object.values(Status), ...ARTIFICIAL_ATTACK_STATUSES]);
const VALID_ITEM_TARGETS = new Set(Object.values(ItemTarget));
const VALID_ITEM_STATUSES = new Set(Object.values(Status));
const VALID_STAT_CHANGES = new Set(Object.values(StatChange));
const VALID_TYPES = new Set(Object.values(PokeType));
const VALID_RANKS = new Set([Rank.STANDARD, Rank.ACE, Rank.SPECIAL, Rank.BOSS, Rank.ELITE]);

function readData(fileName) {
    return JSON.parse(fs.readFileSync(path.join(ROOT, fileName), 'utf8'));
}

function assertUniqueNames(records, fileName) {
    const seen = new Set();
    records.forEach(record => {
        assert.ok(record.name && typeof record.name === 'string', `${fileName}: entry missing name`);
        assert.ok(!seen.has(record.name), `${fileName}: duplicate name ${record.name}`);
        seen.add(record.name);
    });
}

const pokemon = readData('pokemon.json');
const attacks = readData('attacks.json');
const items = readData('items.json');
const trainers = readData('trainers.json');
const events = readData('events.json');
const locations = readData('locations.json');
const starterDecks = readData('starter_decks.json');
const achievements = readData('achievements.json');

const HEX_PATTERN = /^#[0-9a-f]{6}$/i;

test('pokemon.json entries are well-formed', () => {
    assertUniqueNames(pokemon, 'pokemon.json');
    pokemon.forEach(record => {
        ['type1', 'type2', 'type3'].forEach(slot => {
            assert.ok(VALID_TYPES.has(record[slot]), `${record.name}: bad ${slot} ${record[slot]}`);
        });
        assert.notEqual(record.type1, 'NONE', `${record.name}: type1 must be a real type`);
        ['baseHealth', 'baseAttack', 'baseDefense', 'baseSpeed'].forEach(stat => {
            assert.ok(Number.isFinite(record[stat]) && record[stat] > 0, `${record.name}: bad ${stat}`);
        });
        assert.match(String(record.id), /^\d{4}$/, `${record.name}: bad id ${record.id}`);
    });
});

// evolvesInto (baby -> mega) stays optional even on babies — runtime code
// (map/locations.js isMegaPokemon/getMegaTargetKeys) guards its absence.
test('BABY pokemon have a non-BABY type and evolvesInto resolves to a real record', () => {
    const pokemonByName = new Set(pokemon.map(record => record.name));
    const pokemonById = new Set(pokemon.map(record => record.id));

    pokemon.forEach(record => {
        const types = [record.type1, record.type2, record.type3].filter(type => type && type !== 'NONE');
        if (types.includes('BABY')) {
            assert.ok(types.some(type => type !== 'BABY'), `${record.name}: BABY pokemon needs >=1 non-BABY type`);
        }

        if (record.evolvesInto !== undefined) {
            const resolves = pokemonByName.has(record.evolvesInto) || pokemonById.has(record.evolvesInto);
            assert.ok(resolves, `${record.name}: evolvesInto "${record.evolvesInto}" does not resolve to a real pokemon`);
        }
    });
});

test('attacks.json entries are well-formed', () => {
    assertUniqueNames(attacks, 'attacks.json');
    attacks.forEach(record => {
        ['type1', 'type2'].forEach(slot => {
            assert.ok(VALID_TYPES.has(record[slot]), `${record.name}: bad ${slot} ${record[slot]}`);
        });
        assert.notEqual(record.type1, 'NONE', `${record.name}: type1 must be a real type`);
        assert.notEqual(record.type1, 'BABY', `${record.name}: BABY is not a valid attack type`);
        assert.notEqual(record.type2, 'BABY', `${record.name}: BABY is not a valid attack type`);
        assert.ok(Number.isFinite(record.basePower) && record.basePower >= 0, `${record.name}: bad basePower`);
        assert.ok(VALID_ATTACK_STATUSES.has(record.status), `${record.name}: bad status ${record.status}`);
        assert.ok(VALID_ATTACK_TARGETS.has(record.target), `${record.name}: bad target ${record.target}`);
        assert.ok(Array.isArray(record.statChanges), `${record.name}: statChanges must be an array`);
        record.statChanges.forEach(change => {
            assert.ok(VALID_STAT_CHANGES.has(change), `${record.name}: bad statChange ${change}`);
        });
        assert.equal(typeof record.full_type_requirements, 'boolean', `${record.name}: bad full_type_requirements`);
    });
});

test('artificial attacks stay a small, TRAINER-targeted set', () => {
    const artificial = attacks.filter(record => record.type1 === 'ARTIFICIAL' || record.type2 === 'ARTIFICIAL');

    artificial.forEach(record => {
        assert.equal(record.target, 'TRAINER', `${record.name}: artificial attacks target TRAINER`);
        assert.ok(ARTIFICIAL_ATTACK_STATUSES.includes(record.status), `${record.name}: unhandled artificial status ${record.status}`);
    });
    // Intentional design constraint: this set stays small. Growing it should be
    // a deliberate decision, so bump the bound only when the owner adds one.
    assert.ok(artificial.length <= 6, `artificial attack count ${artificial.length} exceeds expected small set`);
});

test('items.json entries are well-formed', () => {
    assertUniqueNames(items, 'items.json');
    items.forEach(record => {
        assert.ok(VALID_ITEM_TARGETS.has(record.target), `${record.name}: bad target ${record.target}`);
        assert.ok(Array.isArray(record.status), `${record.name}: status must be an array`);
        record.status.forEach(status => {
            assert.ok(VALID_ITEM_STATUSES.has(status), `${record.name}: bad status ${status}`);
        });
        assert.ok(Array.isArray(record.statChanges), `${record.name}: statChanges must be an array`);
        // normalizeItem() treats non-stat statChanges entries as legacy
        // statuses and moves them into status, so both enums are legal here.
        record.statChanges.forEach(change => {
            assert.ok(
                VALID_STAT_CHANGES.has(change) || VALID_ITEM_STATUSES.has(change),
                `${record.name}: bad statChange ${change}`
            );
        });
    });
});

test('trainers.json entries are well-formed and cross-reference real data', () => {
    assertUniqueNames(trainers, 'trainers.json');
    const pokemonNames = new Set(pokemon.map(record => record.name));
    const attackNames = new Set(attacks.map(record => record.name));
    const itemNames = new Set(items.map(record => record.name));

    trainers.forEach(record => {
        assert.ok(VALID_RANKS.has(record.rank), `${record.name}: bad rank ${record.rank}`);
        assert.ok(Number.isFinite(record.cash) && record.cash >= 0, `${record.name}: bad cash`);
        if (record.typeSpecialization) {
            assert.ok(VALID_TYPES.has(record.typeSpecialization), `${record.name}: bad typeSpecialization`);
        }
        record.pokemon.forEach(name => {
            assert.ok(pokemonNames.has(name), `${record.name}: unknown pokemon ${name}`);
        });
        record.attacks.flat().forEach(name => {
            assert.ok(attackNames.has(name), `${record.name}: unknown attack ${name}`);
        });
        record.items.forEach(name => {
            assert.ok(itemNames.has(name), `${record.name}: unknown item ${name}`);
        });
    });
});

test('the roster has enough seeded Elite and Ace trainers with specializations', () => {
    const elites = trainers.filter(record => record.rank === Rank.ELITE);
    const aces = trainers.filter(record => record.rank === Rank.ACE);

    assert.ok(elites.length >= 4, `expected >=4 Elite trainers, found ${elites.length}`);
    assert.ok(aces.length >= 6, `expected >=6 Ace trainers, found ${aces.length}`);

    elites.concat(aces).forEach(record => {
        assert.ok(record.typeSpecialization, `${record.name}: seeded Elite/Ace needs a typeSpecialization`);
        assert.ok(VALID_TYPES.has(record.typeSpecialization), `${record.name}: bad typeSpecialization`);
    });
});

// The effect vocabulary the event engine dispatches on
// (map/event_effects.js applyEffect switch). Keep in sync when adding effects.
const VALID_EFFECT_TYPES = new Set([
    'gain-cash', 'lose-cash', 'gain-card', 'gain-random-card', 'gain-random-baby',
    'lose-random-cards', 'lose-random-pokemon', 'remove-selected-card',
    'duplicate-selected-card', 'duplicate-random-card', 'replace-selected-card',
    'replace-random-card', 'trade-selected-pokemon', 'trade-random-pokemon'
]);

const VALID_EVENT_TYPES = new Set(['gift', 'choice', 'trainer']);

function collectEventEffects(event) {
    const effects = [];

    if (Array.isArray(event.effects)) effects.push(...event.effects);
    if (Array.isArray(event.rewardEffects)) effects.push(...event.rewardEffects);
    if (event.payment && Array.isArray(event.payment.effects)) effects.push(...event.payment.effects);
    if (Array.isArray(event.choices)) {
        event.choices.forEach(choice => {
            if (choice && Array.isArray(choice.effects)) effects.push(...choice.effects);
        });
    }

    return effects;
}

function collectEventConditions(event) {
    const conditions = [];

    if (Array.isArray(event.conditions)) conditions.push(...event.conditions);
    if (event.payment && Array.isArray(event.payment.conditions)) conditions.push(...event.payment.conditions);
    if (Array.isArray(event.choices)) {
        event.choices.forEach(choice => {
            if (choice && Array.isArray(choice.conditions)) conditions.push(...choice.conditions);
        });
    }

    return conditions;
}

function collectEventRequirements(event) {
    const requirements = [];
    const push = owner => {
        if (!owner) return;
        const list = owner.requires || owner.requirements;
        if (Array.isArray(list)) requirements.push(...list);
    };

    push(event);
    push(event.payment);
    if (Array.isArray(event.choices)) event.choices.forEach(push);

    return requirements;
}

test('events.json entries are well-formed', () => {
    assert.ok(Array.isArray(events), 'events.json must be an array');

    const trainerNames = new Set(trainers.map(record => record.name));
    const conditionCardNames = {
        pokemon: new Set(pokemon.map(record => record.name)),
        attack: new Set(attacks.map(record => record.name)),
        item: new Set(items.map(record => record.name))
    };
    const achievementIds = new Set(achievements.map(record => record.id));
    const locationIds = new Set(locations.map(location => location.id));
    const terrainSet = new Set(locations.map(location => String(location.terrain || '').trim().toLowerCase()).filter(Boolean));
    const seenIds = new Set();
    let trainerEventCount = 0;

    events.forEach(event => {
        assert.ok(event && typeof event === 'object', 'events.json: entry must be an object');

        assert.ok(event.id && typeof event.id === 'string', 'events.json: entry missing id');
        assert.ok(!seenIds.has(event.id), `events.json: duplicate id ${event.id}`);
        seenIds.add(event.id);

        assert.ok(VALID_EVENT_TYPES.has(event.type), `${event.id}: bad type ${event.type}`);
        assert.ok(event.title && typeof event.title === 'string', `${event.id}: title must be a non-empty string`);
        assert.ok(event.body && typeof event.body === 'string', `${event.id}: body must be a non-empty string`);

        if (event.types !== undefined) {
            assert.ok(Array.isArray(event.types), `${event.id}: types must be an array`);
            event.types.forEach(type => {
                assert.ok(VALID_TYPES.has(type), `${event.id}: bad type ${type}`);
                assert.notEqual(type, 'NONE', `${event.id}: NONE is not an event type`);
                assert.notEqual(type, 'LEGENDARY', `${event.id}: LEGENDARY is not an event type`);
            });
        }

        if (event.locations !== undefined) {
            assert.ok(Array.isArray(event.locations), `${event.id}: locations must be an array`);
            event.locations.forEach(id => {
                assert.ok(locationIds.has(id), `${event.id}: unknown location id ${id}`);
            });
        }

        if (event.terrains !== undefined) {
            assert.ok(Array.isArray(event.terrains), `${event.id}: terrains must be an array`);
            event.terrains.forEach(label => {
                assert.ok(terrainSet.has(String(label).trim().toLowerCase()), `${event.id}: unknown terrain ${label}`);
            });
        }

        collectEventEffects(event).forEach(effect => {
            assert.ok(effect && typeof effect === 'object', `${event.id}: effect must be an object`);
            assert.ok(VALID_EFFECT_TYPES.has(effect.type), `${event.id}: unknown effect type ${effect.type}`);

            if (effect.types !== undefined) {
                assert.ok(Array.isArray(effect.types), `${event.id}: effect.types must be an array`);
                effect.types.forEach(type => {
                    assert.ok(VALID_TYPES.has(type), `${event.id}: bad effect type filter ${type}`);
                });
            }

            if (effect.replacement && effect.replacement.types !== undefined) {
                assert.ok(Array.isArray(effect.replacement.types), `${event.id}: effect.replacement.types must be an array`);
                effect.replacement.types.forEach(type => {
                    assert.ok(VALID_TYPES.has(type), `${event.id}: bad replacement type filter ${type}`);
                });
            }

            if (effect.locationTypes !== undefined) {
                assert.equal(typeof effect.locationTypes, 'boolean', `${event.id}: locationTypes must be a boolean`);
                assert.ok(effect.type === 'gain-random-card' || effect.type === 'gain-random-baby',
                    `${event.id}: locationTypes is not read by ${effect.type}`);
                assert.ok(!(effect.locationTypes === true && Array.isArray(effect.types) && effect.types.length > 0),
                    `${event.id}: locationTypes wins; the types list is ignored`);
            }

            if (effect.replacement && effect.replacement.locationTypes !== undefined) {
                assert.equal(typeof effect.replacement.locationTypes, 'boolean', `${event.id}: replacement.locationTypes must be a boolean`);
                assert.ok(!(effect.replacement.locationTypes === true && Array.isArray(effect.replacement.types) && effect.replacement.types.length > 0),
                    `${event.id}: replacement.locationTypes wins; the replacement types list is ignored`);
            }
        });

        collectEventConditions(event).forEach(condition => {
            assert.ok(condition && typeof condition === 'object', `${event.id}: condition must be an object`);
            assert.ok(condition.name && typeof condition.name === 'string', `${event.id}: condition needs a non-empty name`);
            assert.ok(condition.mode === 'has' || condition.mode === 'lacks',
                `${event.id}: condition mode must be has or lacks, got ${condition.mode}`);

            assert.ok(condition.subject === undefined || condition.subject === 'card' || condition.subject === 'achievement',
                `${event.id}: condition subject must be card or achievement, got ${condition.subject}`);

            if (condition.subject === 'achievement') {
                assert.ok(achievementIds.has(condition.name), `${event.id}: condition names unknown achievement ${condition.name}`);
            } else {
                const names = conditionCardNames[condition.cardKind];
                assert.ok(names, `${event.id}: condition cardKind must be pokemon, attack or item, got ${condition.cardKind}`);
                assert.ok(names.has(condition.name), `${event.id}: condition names unknown ${condition.cardKind} ${condition.name}`);
            }

            if (condition.text !== undefined) {
                assert.equal(typeof condition.text, 'string', `${event.id}: condition text must be a string`);
            }
        });

        collectEventRequirements(event).forEach(requirement => {
            assert.ok(requirement && typeof requirement === 'object', `${event.id}: requirement must be an object`);
            assert.ok(requirement.id && typeof requirement.id === 'string', `${event.id}: requirement needs an id`);

            const cardKind = requirement.cardKind || requirement.kind;
            const names = conditionCardNames[cardKind];
            assert.ok(names, `${event.id}: requirement cardKind must be pokemon, attack or item, got ${cardKind}`);

            // Optional name filter: narrows the picker to specific cards.
            const filter = Array.isArray(requirement.names)
                ? requirement.names
                : (requirement.name === undefined ? [] : [requirement.name]);

            filter.forEach(name => {
                assert.ok(name && typeof name === 'string', `${event.id}: requirement name must be a non-empty string`);
                assert.ok(names.has(name), `${event.id}: requirement names unknown ${cardKind} ${name}`);
            });
        });

        if (event.type === 'choice') {
            assert.ok(Array.isArray(event.choices) && event.choices.length >= 1, `${event.id}: choice event needs >=1 choice`);
        }

        if (event.type === 'trainer') {
            trainerEventCount += 1;
            assert.ok(trainerNames.has(event.trainerName), `${event.id}: unknown trainer ${event.trainerName}`);
        }
    });

    assert.ok(trainerEventCount >= 1, 'events.json needs at least one trainer event');
});

test('locations.json entries are well-formed', () => {
    assert.ok(Array.isArray(locations), 'locations.json must be an array');
    assert.ok(locations.length >= 8, `locations.json should have >=8 records, has ${locations.length}`);
    assertUniqueNames(locations, 'locations.json');

    const seenIds = new Set();
    locations.forEach(record => {
        assert.ok(record.id && typeof record.id === 'string', 'locations.json: entry missing id');
        assert.ok(!seenIds.has(record.id), `locations.json: duplicate id ${record.id}`);
        seenIds.add(record.id);

        assert.ok(Array.isArray(record.types), `${record.id}: types must be an array`);
        assert.ok(record.types.length >= 2 && record.types.length <= 4, `${record.id}: types must be 2-4, has ${record.types.length}`);
        assert.equal(new Set(record.types).size, record.types.length, `${record.id}: duplicate type`);
        record.types.forEach(type => {
            assert.ok(VALID_TYPES.has(type), `${record.id}: bad type ${type}`);
            assert.notEqual(type, 'NONE', `${record.id}: NONE is not a location type`);
            assert.notEqual(type, 'LEGENDARY', `${record.id}: LEGENDARY is not a location type`);
        });

        if (record.theme && typeof record.theme === 'object') {
            Object.entries(record.theme).forEach(([field, value]) => {
                assert.match(String(value), HEX_PATTERN, `${record.id}: theme.${field} must be 6-digit hex, got ${value}`);
            });
        }

        if (record.background) {
            assert.ok(record.background.startsWith('assets/backgrounds/'), `${record.id}: background must live under assets/backgrounds/`);
        }
    });
});

test('starter_decks.json entries are well-formed', () => {
    assert.ok(Array.isArray(starterDecks), 'starter_decks.json must be an array');
    assert.ok(starterDecks.length >= 1, 'starter_decks.json needs at least one deck');
    assertUniqueNames(starterDecks, 'starter_decks.json');

    const pokemonNames = new Set(pokemon.map(record => record.name));
    const attackNames = new Set(attacks.map(record => record.name));
    const itemNames = new Set(items.map(record => record.name));
    const seenIds = new Set();

    starterDecks.forEach(deck => {
        assert.ok(deck.id && typeof deck.id === 'string', 'starter_decks.json: entry missing id');
        assert.ok(!seenIds.has(deck.id), `starter_decks.json: duplicate id ${deck.id}`);
        seenIds.add(deck.id);

        assert.ok(VALID_TYPES.has(deck.type), `${deck.id}: bad type ${deck.type}`);
        assert.notEqual(deck.type, 'NONE', `${deck.id}: NONE is not a starter type`);

        assert.ok(Array.isArray(deck.pokemon) && deck.pokemon.length >= 1, `${deck.id}: needs at least one pokemon`);
        deck.pokemon.forEach(name => {
            assert.ok(pokemonNames.has(name), `${deck.id}: unknown pokemon ${name}`);
        });

        [['attacks', attackNames], ['items', itemNames]].forEach(([field, known]) => {
            assert.ok(Array.isArray(deck[field]), `${deck.id}: ${field} must be an array`);
            deck[field].forEach(entry => {
                assert.ok(known.has(entry.name), `${deck.id}: unknown ${field} entry ${entry.name}`);
                assert.ok(Number.isInteger(entry.count) && entry.count >= 1, `${deck.id}: ${entry.name} needs a count >= 1`);
            });
        });

        assert.ok(deck.attacks.length >= 1, `${deck.id}: needs at least one attack`);
    });

    assert.ok(
        starterDecks.some(deck => deck.enabled !== false),
        'starter_decks.json needs at least one enabled deck or no run can start'
    );
});

test('achievements.json entries are well-formed', () => {
    require('../map/profile.js');
    const { PokeProfile } = globalThis.window;

    assert.ok(Array.isArray(achievements), 'achievements.json must be an array');
    assert.ok(achievements.length >= 1, 'achievements.json needs at least one achievement');

    const seenIds = new Set();

    achievements.forEach(achievement => {
        assert.ok(
            achievement.id && typeof achievement.id === 'string',
            'achievements.json: entry missing id'
        );
        assert.ok(!seenIds.has(achievement.id), `achievements.json: duplicate id ${achievement.id}`);
        seenIds.add(achievement.id);

        assert.ok(
            Number.isInteger(achievement.atLeast) && achievement.atLeast >= 1,
            `${achievement.id}: atLeast must be an integer >= 1`
        );

        // An unknown counter can never be bumped, so the achievement would sit
        // unreachable forever.
        assert.ok(
            PokeProfile.isKnownStat(achievement.stat),
            `${achievement.id}: unknown stat ${achievement.stat}`
        );
    });
});

test('every starter type appears in an enabled location', () => {
    const enabled = locations.filter(record => record.enabled !== false);
    starterDecks.filter(deck => deck.enabled !== false).forEach(deck => {
        const covered = enabled.some(record => record.types.includes(deck.type));
        assert.ok(covered, `no enabled location contains starter type ${deck.type} (${deck.id})`);
    });
});

test('enabled locations form a connected shared-type graph', () => {
    const enabled = locations.filter(record => record.enabled !== false);
    assert.ok(enabled.length > 0, 'need at least one enabled location');

    const shareType = (a, b) => a.types.some(type => b.types.includes(type));
    const visited = new Set([enabled[0].id]);
    const queue = [enabled[0]];

    while (queue.length > 0) {
        const current = queue.shift();
        enabled.forEach(other => {
            if (!visited.has(other.id) && shareType(current, other)) {
                visited.add(other.id);
                queue.push(other);
            }
        });
    }

    assert.equal(visited.size, enabled.length, `overlap graph is disconnected: reached ${visited.size} of ${enabled.length}`);
});

test('default battle deck references resolve against real data', async () => {
    const { arena } = require('./helpers/arena_env');
    const data = await loadRealGameData();
    const pokemonNames = new Set(data.pokemon.map(record => record.name));
    const attackNames = new Set(data.attacks.map(record => record.name));
    const itemNames = new Set(data.items.map(record => record.name));

    const speciesByName = new Map(data.pokemon.map(record => [record.name, record]));
    const attacksByName = new Map(data.attacks.map(record => [record.name, record]));

    arena.Constants.DEFAULT_BATTLE_DECK.pokemon.forEach(entry => {
        assert.ok(pokemonNames.has(entry.name), `default deck: unknown pokemon ${entry.name}`);
        entry.attacks.forEach(attackName => {
            assert.ok(attackNames.has(attackName), `default deck: unknown attack ${attackName}`);

            // A pairing the species cannot use is silently dropped from the
            // deck (this happened when Feraligatr briefly lost DARK).
            const species = speciesByName.get(entry.name);
            const attack = attacksByName.get(attackName);
            const usable = attack.types.length === 0 || (attack.full_type_requirements
                ? attack.types.every(type => species.types.includes(type))
                : attack.types.some(type => species.types.includes(type)));
            assert.ok(usable, `default deck: ${entry.name} cannot use ${attackName}`);
        });
    });
    arena.Constants.DEFAULT_BATTLE_DECK.items.forEach(itemName => {
        assert.ok(itemNames.has(itemName), `default deck: unknown item ${itemName}`);
    });

    // loadGameData() must normalize every record without dropping any.
    assert.equal(data.pokemon.length, pokemon.length);
    assert.equal(data.attacks.length, attacks.length);
    assert.equal(data.items.length, items.length);
    assert.equal(data.trainers.length, trainers.length);
    assert.equal(data.starterDecks.length, starterDecks.length);
    assert.equal(data.achievements.length, achievements.length);
});

// A captured legendary is rewarded a dual-requirement legendary attack (one
// that pairs LEGENDARY with a real type the legendary also has). If a JSON
// edit ever strands a legendary with no eligible attack, its capture reward
// would silently fall back to a plain attack — catch that here.
test('every legendary pokemon has an eligible dual-req legendary attack', () => {
    const legendaries = pokemon.filter(record => (
        [record.type1, record.type2, record.type3].includes('LEGENDARY')
    ));

    assert.ok(legendaries.length > 0, 'no legendary pokemon found');

    legendaries.forEach(p => {
        const pokeTypes = [p.type1, p.type2, p.type3].filter(t => t && t !== 'NONE');
        const hasEligible = attacks.some(a => {
            const attackTypes = [a.type1, a.type2].filter(t => t && t !== 'NONE');
            return a.full_type_requirements
                && attackTypes.includes('LEGENDARY')
                && attackTypes.length > 1
                && attackTypes.every(t => pokeTypes.includes(t));
        });
        assert.ok(hasEligible, `legendary ${p.name} has no eligible dual-req legendary attack`);
    });
});
