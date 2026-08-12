'use strict';

/**
 * The data editor draws its live card previews with the real renderer, but it
 * normalizes records through its OWN copies of the engine's normalizers
 * (dev/editor/preview.js). Those copies are field whitelists, so whenever the
 * engine's normalizer gains a field and the editor's does not, the preview
 * silently stops showing it — which is exactly how a vitamin item lost its
 * permanent-boost badge in the editor while looking fine in the game.
 *
 * Parity is asserted against the records the engine actually loads, so this
 * needs no new engine exports and cannot drift from what the game really sees.
 * Per the "Test conventions" section of CLAUDE.md, duplicated vocabularies get
 * a parity assertion against the real source rather than a hand-listed count.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { arena, loadRealGameData } = require('./helpers/arena_env');
require('../dev/editor/preview.js');

const { pick } = require('./helpers/pick');

const preview = globalThis.EditorPreview;
const rawItems = require('../items.json');

function keysOf(object) {
    return Object.keys(object).sort();
}

// The engine's normalized record for `name`, i.e. exactly what the game reads.
function loadedByName(collection, name) {
    return pick(collection, record => record.name === name, `the loaded record for ${name}`);
}

test('the editor item preview normalizes to the same fields as the engine', async () => {
    const gameData = await loadRealGameData();

    // A vitamin exercises the optional fields; without one the two whitelists
    // could agree merely because nothing optional is set anywhere.
    const rawVitamin = pick(rawItems, item => Boolean(item.vitaminStat), 'a vitamin item');
    const loaded = loadedByName(gameData.items, rawVitamin.name);

    assert.deepEqual(
        keysOf(preview.normalizeItemPreview(rawVitamin)),
        keysOf(loaded),
        'dev/editor/preview.js normalizeItemPreview has drifted from arena/arena_data.js normalizeItem'
    );
});

test('the editor item preview keeps a vitamin readable as a vitamin', async () => {
    await loadRealGameData();

    const rawVitamin = pick(rawItems, item => Boolean(item.vitaminStat), 'a vitamin item');
    const previewed = preview.normalizeItemPreview(rawVitamin);

    assert.ok(arena.Model.isVitaminItem(previewed),
        'the editor preview must still read as a vitamin, or its card badge vanishes');
    assert.equal(arena.Model.getVitaminAmount(previewed), arena.Model.getVitaminAmount(rawVitamin));
});

/**
 * The weaker invariant for the other two previews: they may lag the engine on
 * fields nothing draws (normalizePokemonPreview omits eventOnly/evolvesInto
 * today, which is harmless), but they must never invent a field the engine does
 * not produce — that would be a preview showing something the game never sees.
 */
test('the editor attack and pokemon previews invent no fields the engine lacks', async () => {
    const gameData = await loadRealGameData();

    const rawAttack = pick(require('../attacks.json'),
        record => Number(record.basePower) > 0, 'an attack with base power');
    const rawSpecies = pick(require('../pokemon.json'),
        record => Number(record.baseAttack) > 0, 'a Pokemon with base attack');

    const cases = [
        ['attack', preview.normalizeAttackPreview(rawAttack), loadedByName(gameData.attacks, rawAttack.name)],
        ['pokemon', preview.normalizePokemonPreview(rawSpecies), loadedByName(gameData.pokemon, rawSpecies.name)]
    ];

    cases.forEach(([label, previewed, loaded]) => {
        const engineKeys = new Set(keysOf(loaded));
        const invented = keysOf(previewed).filter(key => !engineKeys.has(key));

        assert.deepEqual(invented, [], `the ${label} preview produces fields the engine never does: ${invented}`);
    });
});
