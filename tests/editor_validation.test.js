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

test('live data: asset warnings include the missing backgrounds', () => {
    const issues = validateAll(live.data, { enums: live.enums, assetIndex: live.assetIndex, engineRefs: live.engineRefs });
    const warnings = issues.filter((issue) => issue.severity === 'warning');
    const missingBackgrounds = warnings.filter((issue) => issue.code === 'assets.missing-background');

    assert.ok(missingBackgrounds.length >= 8, `expected >=8 assets.missing-background warnings, got ${missingBackgrounds.length}`);
    // No specific orphan portrait is asserted: the live assets currently have
    // none (the former Linoone.png orphan was cleaned up). Any orphan-portrait
    // warnings that do surface must still be well-formed.
    warnings
        .filter((issue) => issue.code === 'assets.orphan-portrait')
        .forEach((issue) => assert.ok(issue.recordKey, 'orphan-portrait warning must name a recordKey'));
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

test('pokemon: eventOnly with no granting event warns unreachable', () => {
    const data = withPokemon((pokemon) => { pokemon[0].eventOnly = true; });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'pokemon.event-only-unreachable'));
});

test('pokemon: eventOnly granted by a gain-card event has no unreachable warning', () => {
    const data = structuredClone(live.data);
    data.pokemon[0].eventOnly = true;
    data.events[0] = {
        ...data.events[0],
        rewardEffects: [
            ...(data.events[0].rewardEffects || []),
            { type: 'gain-card', cardKind: 'pokemon', name: data.pokemon[0].name, count: 1 }
        ]
    };
    const issues = validateAll(data, { enums: live.enums });
    const grantedName = data.pokemon[0].name;

    assert.ok(
        !issues.some((issue) => issue.code === 'pokemon.event-only-unreachable' && issue.recordKey === grantedName),
        `${grantedName} is granted by an event, so it must not be reported unreachable`
    );
});

test('pokemon: BABY with no evolvesInto is a baby-missing-mega error', () => {
    const data = withPokemon((pokemon) => {
        const baby = pokemon.find((record) => record.name === 'Numel');
        delete baby.evolvesInto;
    });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'pokemon.baby-missing-mega'));
});

test('pokemon: BABY evolvesInto naming a non-Mega is a baby-missing-mega error', () => {
    const data = withPokemon((pokemon) => {
        const baby = pokemon.find((record) => record.name === 'Numel');
        baby.evolvesInto = 'Blastoise';
    });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'pokemon.baby-missing-mega'));
});

test('pokemon: BABY evolvesInto naming a 9xxx Mega has no baby-missing-mega error', () => {
    const issues = validateAll(live.data, { enums: live.enums });
    assert.ok(!hasCode(issues, 'pokemon.baby-missing-mega'));
});

test('live data: zero baby-missing-mega issues', () => {
    const issues = validateAll(live.data, { enums: live.enums, assetIndex: live.assetIndex, engineRefs: live.engineRefs });
    assert.ok(!hasCode(issues, 'pokemon.baby-missing-mega'), 'expected zero pokemon.baby-missing-mega issues in live data');
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

test('events: unknown location id in locations override', () => {
    const data = withEvents((events) => { events[0].locations = ['not-a-real-place']; });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'events.unknown-location'));
});

test('events: unknown terrain in terrains override', () => {
    const data = withEvents((events) => { events[0].terrains = ['NotATerrain']; });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'events.unknown-terrain'));
});

// Live events.json has no conditions yet, so every condition fixture starts
// from a well-formed one and breaks exactly one field.
const CONDITION_CODES = [
    'events.bad-condition', 'events.bad-condition-mode',
    'events.bad-condition-kind', 'events.unknown-condition-card'
];

function withCondition(placement, condition) {
    return withEvents((events) => {
        const event = events.find((record) => record.id === 'sitrus-berry-tree');
        if (placement === 'event') event.conditions = [condition];
        if (placement === 'payment') event.payment = { conditions: [condition] };
        if (placement === 'choice') event.choices = [{ label: 'Take it', conditions: [condition] }];
    });
}

test('events: well-formed conditions raise no condition issues', () => {
    ['event', 'payment', 'choice'].forEach((placement) => {
        const data = withCondition(placement, { mode: 'has', cardKind: 'pokemon', name: 'Blastoise', text: 'Needs Blastoise' });
        const issues = validateAll(data, { enums: live.enums });
        CONDITION_CODES.forEach((code) => assert.ok(!hasCode(issues, code), `${placement}: unexpected ${code}`));
    });
});

test('events: condition without a name', () => {
    const data = withCondition('event', { mode: 'has', cardKind: 'pokemon' });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'events.bad-condition'));
});

test('events: condition text must be a string', () => {
    const data = withCondition('event', { mode: 'has', cardKind: 'pokemon', name: 'Blastoise', text: 7 });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'events.bad-condition'));
});

test('events: choice condition with a bad mode', () => {
    const data = withCondition('choice', { mode: 'maybe', cardKind: 'pokemon', name: 'Blastoise' });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'events.bad-condition-mode'));
});

test('events: payment condition with a bad cardKind', () => {
    const data = withCondition('payment', { mode: 'has', cardKind: 'trainer', name: 'Blastoise' });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'events.bad-condition-kind'));
});

test('events: condition naming a card that does not exist', () => {
    const data = withCondition('choice', { mode: 'lacks', cardKind: 'pokemon', name: 'Definitely Not A Real Pokemon Name' });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'events.unknown-condition-card'));
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
    // Isolation types must be types NO enabled location uses. FOSSIL became a
    // real location type in the 2026-07-18 location expansion, so BABY +
    // ARTIFICIAL (card-only types) are used instead. lavender-town's real
    // types (GHOST/HUMAN/MONSTER) are all covered by other enabled locations
    // and include no starter type, so isolating it breaks only connectivity.
    const data = withLocations((locations) => {
        const isolated = locations.find((location) => location.id === 'lavender-town');
        isolated.types = ['BABY', 'ARTIFICIAL'];
    });
    const issues = validateAll(data, { enums: live.enums, engineRefs: live.engineRefs });
    assert.ok(hasCode(issues, 'locations.graph-disconnected'));
});

test('names: double quote in an attack name is an error', () => {
    const data = withAttacks((attacks) => { attacks[0].name = 'Slash "Deluxe"'; });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'data.unsafe-name-chars'));
});

test('names: angle bracket in a location terrain is an error', () => {
    const data = withLocations((locations) => { locations[0].terrain = '<Volcanic>'; });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'data.unsafe-name-chars'));
});

test('names: apostrophes stay legal', () => {
    // Live data already contains "Nature's Blessing" etc.; the zero-errors
    // live-parity test above is the real guard — this pins the intent.
    const issues = validateAll(live.data, { enums: live.enums, assetIndex: live.assetIndex, engineRefs: live.engineRefs });
    assert.ok(!hasCode(issues, 'data.unsafe-name-chars'));
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

test('findReferences(pokemon, Blastoise) includes an event that gates on it', () => {
    const data = withCondition('choice', { mode: 'has', cardKind: 'pokemon', name: 'Blastoise' });
    const refs = findReferences(data, 'pokemon', 'Blastoise', live.engineRefs);

    assert.ok(refs.some((ref) => ref.file === 'events.json' && ref.recordKey === 'sitrus-berry-tree' && ref.field === 'conditions'));
});

test('findReferences returns [] for a freshly invented name', () => {
    const refs = findReferences(live.data, 'pokemon', 'Definitely Not A Real Pokemon Name', live.engineRefs);
    assert.deepEqual(refs, []);
});
