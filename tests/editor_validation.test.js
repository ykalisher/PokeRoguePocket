'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildLiveEditorEnv } = require('./helpers/editor_env');
const { validateAll, findReferences } = require('../dev/editor/validate.js');

const live = buildLiveEditorEnv();

function hasCode(issues, code) {
    return issues.some((issue) => issue.code === code);
}

// ------------------------------------------------------------- live parity

test('live data: zero error-severity issues', () => {
    const issues = validateAll(live.data, { enums: live.enums, assetIndex: live.assetIndex, engineRefs: live.engineRefs });
    const errors = issues.filter((issue) => issue.severity === 'error');

    assert.deepEqual(errors, [], `expected zero errors, got: ${JSON.stringify(errors)}`);
});

test('live data: asset warnings include missing backgrounds and the Linoone orphan portrait', () => {
    const issues = validateAll(live.data, { enums: live.enums, assetIndex: live.assetIndex, engineRefs: live.engineRefs });
    const warnings = issues.filter((issue) => issue.severity === 'warning');
    const missingBackgrounds = warnings.filter((issue) => issue.code === 'assets.missing-background');

    assert.ok(missingBackgrounds.length >= 8, `expected >=8 assets.missing-background warnings, got ${missingBackgrounds.length}`);
    assert.ok(
        warnings.some((issue) => issue.code === 'assets.orphan-portrait' && issue.recordKey === 'Linoone.png'),
        'expected an assets.orphan-portrait warning for Linoone.png'
    );
});

// -------------------------------------------------------- synthetic fixtures

function withPokemon(mutate) {
    const data = structuredClone(live.data);
    mutate(data.pokemon);
    return data;
}
function withAttacks(mutate) {
    const data = structuredClone(live.data);
    mutate(data.attacks);
    return data;
}
function withItems(mutate) {
    const data = structuredClone(live.data);
    mutate(data.items);
    return data;
}
function withTrainers(mutate) {
    const data = structuredClone(live.data);
    mutate(data.trainers);
    return data;
}
function withEvents(mutate) {
    const data = structuredClone(live.data);
    mutate(data.events);
    return data;
}
function withLocations(mutate) {
    const data = structuredClone(live.data);
    mutate(data.locations);
    return data;
}

test('pokemon: bad type', () => {
    const data = withPokemon((pokemon) => { pokemon[0].type1 = 'NOT_A_TYPE'; });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'pokemon.bad-type'));
});

test('pokemon: duplicate name', () => {
    const data = withPokemon((pokemon) => { pokemon.push({ ...pokemon[0] }); });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'pokemon.duplicate-name'));
});

test('pokemon: bad id', () => {
    const data = withPokemon((pokemon) => { pokemon[0].id = 'not-an-id'; });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'pokemon.bad-id'));
});

test('pokemon: negative stat', () => {
    const data = withPokemon((pokemon) => { pokemon[0].baseHealth = -5; });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'pokemon.bad-stat'));
});

test('attacks: unknown status', () => {
    const data = withAttacks((attacks) => { attacks[0].status = 'NOT_A_STATUS'; });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'attacks.bad-status'));
});

test('attacks: ARTIFICIAL attack targeting OPPONENT breaks the artificial rule', () => {
    const data = withAttacks((attacks) => {
        attacks.push({
            name: 'Test Artificial Attack',
            type1: 'ARTIFICIAL',
            type2: 'NONE',
            basePower: 0,
            status: 'EXTRA_ATTACK',
            statChanges: [],
            target: 'OPPONENT',
            full_type_requirements: false
        });
    });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'attacks.artificial-rule'));
});

test('items: bad target', () => {
    const data = withItems((items) => { items[0].target = 'NOT_A_TARGET'; });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'items.bad-target'));
});

test('trainers: unknown pokemon name', () => {
    const data = withTrainers((trainers) => { trainers[0].pokemon.push('Not A Real Pokemon'); });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'trainers.unknown-pokemon'));
});

test('trainers: bad rank', () => {
    const data = withTrainers((trainers) => { trainers[0].rank = 'NotARank'; });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'trainers.bad-rank'));
});

test('events: unknown effect type', () => {
    const data = withEvents((events) => {
        const giftEvent = events.find((event) => event.id === 'sitrus-berry-tree');
        giftEvent.effects[0].type = 'not-a-real-effect';
    });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'events.unknown-effect-type'));
});

test('events: trainer event naming a missing trainer', () => {
    const data = withEvents((events) => {
        const trainerEvent = events.find((event) => event.type === 'trainer');
        trainerEvent.trainerName = 'Not A Real Trainer';
    });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'events.unknown-trainer'));
});

test('locations: only 1 type', () => {
    const data = withLocations((locations) => { locations[0].types = ['WATER']; });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'locations.bad-types-count'));
});

test('locations: bad hex theme color', () => {
    const data = withLocations((locations) => { locations[0].theme.accent = 'not-a-hex'; });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'locations.bad-theme-color'));
});

test('locations: disconnected graph', () => {
    // lavender-town's types (GHOST/HUMAN/MONSTER) are all also covered by other
    // enabled locations and include no starter type, so isolating it doesn't
    // break starter coverage — only the connectivity rule.
    const data = withLocations((locations) => {
        const isolated = locations.find((location) => location.id === 'lavender-town');
        isolated.types = ['BABY', 'FOSSIL'];
    });
    const issues = validateAll(data, { enums: live.enums, engineRefs: live.engineRefs });
    assert.ok(hasCode(issues, 'locations.graph-disconnected'));
});

test('engine: deleting a defaultDeck pokemon strands the engine reference', () => {
    const data = withPokemon((pokemon) => {
        const index = pokemon.findIndex((record) => record.name === 'Blastoise');
        pokemon.splice(index, 1);
    });
    const issues = validateAll(data, { enums: live.enums, engineRefs: live.engineRefs });
    assert.ok(hasCode(issues, 'engine.unknown-default-deck-ref'));
});

// ------------------------------------------------------------- findReferences

test('findReferences(pokemon, Blastoise) includes the default deck and the water starter deck', () => {
    const refs = findReferences(live.data, 'pokemon', 'Blastoise', live.engineRefs);

    assert.ok(refs.some((ref) => ref.file === 'engine' && ref.recordKey === 'defaultDeck'));
    assert.ok(refs.some((ref) => ref.file === 'engine' && ref.recordKey === 'starterDecks.water'));
});

test('findReferences(trainer, Mecha Cop) includes events.json/rogue-mecha-cop', () => {
    const refs = findReferences(live.data, 'trainer', 'Mecha Cop', live.engineRefs);

    assert.ok(refs.some((ref) => ref.file === 'events.json' && ref.recordKey === 'rogue-mecha-cop'));
});

test('findReferences returns [] for a freshly invented name', () => {
    const refs = findReferences(live.data, 'pokemon', 'Definitely Not A Real Pokemon Name', live.engineRefs);
    assert.deepEqual(refs, []);
});
