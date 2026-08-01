'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// arena_env aliases window to globalThis, so these IIFEs attach to the
// globalThis namespaces below.
const { loadRealGameData, arena } = require('./helpers/arena_env');
require('../map/locations');

const P = globalThis.PokeLocations;

function makeAttack(name, types, extra) {
    return Object.assign({
        name,
        type1: types[0] || 'NONE',
        type2: types[1] || 'NONE',
        basePower: 40,
        status: 'NONE',
        statChanges: [],
        target: 'OPPONENT',
        full_type_requirements: false
    }, extra || {});
}

// One on-type, one off-type, one legendary, one artificial - enough to
// exercise every pool-eligibility branch.
function fixtureGameData() {
    const onType = makeAttack('Fixture Ember', ['FIRE']);
    const offType = makeAttack('Fixture Tackle', ['NORMAL']);
    const legendary = makeAttack('Fixture Roar of Time', ['DRAGON', 'LEGENDARY']);
    const artificial = makeAttack('Fixture Hyper Beam Cannon', ['ARTIFICIAL']);
    return { attacks: [onType, offType, legendary, artificial] };
}

test('getAttackCardPool excludes legendary and artificial attacks, includes on-type', () => {
    const gameData = fixtureGameData();
    const pool = P.getAttackCardPool(gameData, ['FIRE']);

    assert.deepEqual(pool.map(record => record.name), ['Fixture Ember']);
});

test('getAttackCardPool falls back to the full offerable pool when nothing matches the location types', () => {
    const gameData = fixtureGameData();
    const pool = P.getAttackCardPool(gameData, ['ICE']);

    assert.deepEqual(pool.map(record => record.name).sort(), ['Fixture Ember', 'Fixture Tackle']);
});

test('getAttackCardPool is unique by name', () => {
    const gameData = { attacks: [makeAttack('Fixture Ember', ['FIRE']), makeAttack('Fixture Ember', ['FIRE'])] };
    const pool = P.getAttackCardPool(gameData, ['FIRE']);

    assert.equal(pool.length, 1);
});

test('chooseAttackCardOptions returns 1-3 distinct records drawn from the pool', () => {
    const gameData = fixtureGameData();
    const pool = P.getAttackCardPool(gameData, ['ICE']).map(record => record.name);

    for (let i = 0; i < 200; i += 1) {
        const options = P.chooseAttackCardOptions(gameData, ['ICE']);

        assert.ok(options.length >= 1 && options.length <= 3, `expected 1-3 options, got ${options.length}`);
        const names = options.map(record => record.name);
        assert.equal(new Set(names).size, names.length, 'options must be distinct');
        names.forEach(name => assert.ok(pool.includes(name), `${name} is not in the pool`));
    }
});

test('getAttackCardPool against real data is non-empty and legendary/artificial-free for every location', async () => {
    await loadRealGameData();
    const gameData = arena.GameData;
    const locations = gameData.locations;

    assert.ok(Array.isArray(locations) && locations.length > 0, 'expected real locations to load');

    locations.forEach(location => {
        const pool = P.getAttackCardPool(gameData, location.types);

        assert.ok(pool.length > 0, `${location.id} produced an empty attack pool`);
        pool.forEach(record => {
            assert.ok(record.type1 !== 'LEGENDARY' && record.type2 !== 'LEGENDARY', `${record.name} is legendary`);
            assert.ok(record.type1 !== 'ARTIFICIAL' && record.type2 !== 'ARTIFICIAL', `${record.name} is artificial`);
        });
    });
});
