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

test('attacks.json entries are well-formed', () => {
    assertUniqueNames(attacks, 'attacks.json');
    attacks.forEach(record => {
        ['type1', 'type2'].forEach(slot => {
            assert.ok(VALID_TYPES.has(record[slot]), `${record.name}: bad ${slot} ${record[slot]}`);
        });
        assert.notEqual(record.type1, 'NONE', `${record.name}: type1 must be a real type`);
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

test('events.json parses as an array', () => {
    assert.ok(Array.isArray(events), 'events.json must be an array');
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
});
