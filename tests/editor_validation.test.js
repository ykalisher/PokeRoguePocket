'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, buildLiveEditorEnv } = require('./helpers/editor_env');
const { pick, pickIndex } = require('./helpers/pick');
const { validateAll, findReferences } = require('../dev/editor/validate.js');

const live = buildLiveEditorEnv();

function hasCode(issues, code) {
    return issues.some((issue) => issue.code === code);
}

// ------------------------------------------------- live-data fixture pickers
//
// These mutate a clone of the live data to provoke one validation error. Which
// record gets corrupted is irrelevant to what is being tested, so select it by
// the property the test actually depends on. Anchoring on an authored name
// ("Numel", "sitrus-berry-tree") breaks whenever the owner reworks content.

const typesOf = (record) => [record.type1, record.type2, record.type3].filter((type) => type && type !== 'NONE');

// Effects that read effect.locationTypes, per map/event_effects.js.
const LOCATION_TYPE_EFFECTS = ['gain-random-card', 'gain-random-baby'];

function pickBaby(pokemon) {
    return pick(pokemon, (record) => typesOf(record).includes('BABY') && record.evolvesInto, 'a BABY species with evolvesInto');
}

function pickNonMega(pokemon) {
    return pick(pokemon, (record) => parseInt(record.id, 10) <= 9000, 'a non-Mega species (id <= 9000)');
}

// An event whose first effect does NOT read locationTypes.
function pickPlainEffectEvent(events) {
    return pick(
        events,
        (event) => Array.isArray(event.effects) && event.effects[0] && !LOCATION_TYPE_EFFECTS.includes(event.effects[0].type),
        'an event whose first effect ignores locationTypes'
    );
}

// An event whose first effect DOES read locationTypes.
function pickLocationTypeEffectEvent(events) {
    return pick(
        events,
        (event) => Array.isArray(event.effects) && event.effects[0] && LOCATION_TYPE_EFFECTS.includes(event.effects[0].type),
        'an event whose first effect reads locationTypes'
    );
}

// withCondition/withRequirement graft onto whichever event pickPlainEffectEvent
// selects; the predicate is deterministic and structuredClone preserves order,
// so this id identifies the same record the mutators touched. Two real card
// names go with them — conditions must reference a pokemon that exists.
const HOST_EVENT_ID = pickPlainEffectEvent(live.data.events).id;
const [SAMPLE_POKEMON, OTHER_POKEMON] = live.data.pokemon.slice(0, 2).map((record) => record.name);

// The music vocabulary lives in arena/arena_data.js; validate.js keeps a mirror
// (DEFAULT_MUSIC_CATEGORIES) that it does not export. Read the engine's copy so
// the empty-category tests below count categories instead of hardcoding "3" and
// "4" — and so they fail loudly if the two copies ever drift apart.
function engineMusicCategories() {
    const src = fs.readFileSync(path.join(ROOT, 'arena', 'arena_data.js'), 'utf8');
    const match = src.match(/MUSIC_CATEGORIES\s*=\s*\[([^\]]*)\]/);
    assert.ok(match, 'MUSIC_CATEGORIES not found in arena/arena_data.js — update this helper');

    const categories = [...match[1].matchAll(/'([a-z]+)'/g)].map((entry) => entry[1]);
    assert.ok(categories.length > 0, 'parsed no music categories — update this helper');
    return categories;
}

// ------------------------------------------------------------- live parity

test('live data: zero error-severity issues', () => {
    const issues = validateAll(live.data, { enums: live.enums, assetIndex: live.assetIndex, engineRefs: live.engineRefs });
    const errors = issues.filter((issue) => issue.severity === 'error');

    assert.deepEqual(errors, [], `expected zero errors, got: ${JSON.stringify(errors)}`);
});

test('live data: every asset warning is well-formed and names a real record', () => {
    // No count is asserted. How many locations are still waiting on artwork is
    // an authoring artifact that moves every time the owner draws one; what must
    // hold is that each warning is actionable — right severity, and a recordKey
    // the owner can actually go and open.
    const issues = validateAll(live.data, { enums: live.enums, assetIndex: live.assetIndex, engineRefs: live.engineRefs });
    const warnings = issues.filter((issue) => issue.severity === 'warning');
    const locationIds = new Set(live.data.locations.map((location) => location.id));

    warnings
        .filter((issue) => issue.code === 'assets.missing-background')
        .forEach((issue) => {
            assert.ok(issue.recordKey, 'missing-background warning must name a recordKey');
            assert.ok(
                locationIds.has(issue.recordKey),
                `missing-background warning names ${issue.recordKey}, which is not a location id`
            );
        });

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
function withStarterDecks(mutate) {
    const data = structuredClone(live.data);
    mutate(data.starter_decks);
    return data;
}
function withAchievements(mutate) {
    const data = structuredClone(live.data);
    mutate(data.achievements);
    return data;
}
// music.json ships empty, so music fixtures replace the array outright.
function musicTrack(overrides) {
    return Object.assign(
        { id: 'gym-leader-theme', title: 'Gym Leader Theme', category: 'boss', file: 'assets/music/gym-leader-theme.mp3', enabled: true },
        overrides || {}
    );
}
function withMusic(records) {
    const data = structuredClone(live.data);
    data.music = records;
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
        const baby = pickBaby(pokemon);
        delete baby.evolvesInto;
    });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'pokemon.baby-missing-mega'));
});

test('pokemon: BABY evolvesInto naming a non-Mega is a baby-missing-mega error', () => {
    const data = withPokemon((pokemon) => {
        const baby = pickBaby(pokemon);
        baby.evolvesInto = pickNonMega(pokemon).name;
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

test('items: bad vitaminStat', () => {
    const data = withItems((items) => { items[0].vitaminStat = 'luck'; });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'items.bad-vitamin-stat'));
});

test('items: non-positive vitaminAmount', () => {
    const data = withItems((items) => {
        items[0].vitaminStat = 'attack';
        items[0].vitaminAmount = 0;
    });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'items.bad-vitamin-amount'));
});

test('items: vitaminAmount without vitaminStat', () => {
    const data = withItems((items) => {
        delete items[0].vitaminStat;
        items[0].vitaminAmount = 5;
    });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'items.vitamin-amount-without-stat'));
});

test('events: boost-selected-pokemon naming a non-vitamin item', () => {
    const nonVitamin = pick(live.data.items, (item) => !item.vitaminStat, 'an ordinary battle item');
    const data = structuredClone(live.data);

    data.events.push({
        type: 'gift', id: 'vitamin-validation-fixture', title: 'Fixture', body: 'Fixture',
        enabled: true,
        requires: [{ id: 'target', cardKind: 'pokemon' }],
        effects: [{ type: 'boost-selected-pokemon', selectionId: 'target', item: nonVitamin.name }]
    });

    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'events.unknown-effect-vitamin'));
});

test('events: boost-selected-pokemon with no item', () => {
    const data = structuredClone(live.data);

    data.events.push({
        type: 'gift', id: 'vitamin-validation-fixture-2', title: 'Fixture', body: 'Fixture',
        enabled: true,
        requires: [{ id: 'target', cardKind: 'pokemon' }],
        effects: [{ type: 'boost-selected-pokemon', selectionId: 'target' }]
    });

    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'events.missing-effect-item'));
});

test('events: a vitamin handed out as a deck card', () => {
    const vitamin = pick(live.data.items, (item) => Boolean(item.vitaminStat), 'a vitamin item');
    const data = structuredClone(live.data);

    data.events.push({
        type: 'gift', id: 'vitamin-validation-fixture-3', title: 'Fixture', body: 'Fixture',
        enabled: true,
        effects: [{ type: 'gain-card', cardKind: 'item', count: 1, name: vitamin.name }]
    });

    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'events.vitamin-granted-as-card'));
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
        const giftEvent = pickPlainEffectEvent(events);
        giftEvent.effects[0].type = 'not-a-real-effect';
    });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'events.unknown-effect-type'));
});

test('events: locationTypes must be a boolean', () => {
    const data = withEvents((events) => {
        const eggEvent = pickLocationTypeEffectEvent(events);
        eggEvent.effects[0].locationTypes = 'yes';
    });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'events.effect-location-types-type'));
});

test('events: locationTypes conflicts with an authored types list', () => {
    const data = withEvents((events) => {
        const eggEvent = pickLocationTypeEffectEvent(events);
        eggEvent.effects[0].locationTypes = true;
        eggEvent.effects[0].types = ['FIRE'];
    });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'events.effect-location-types-conflict'));
});

test('events: locationTypes on an effect type that does not read it', () => {
    const data = withEvents((events) => {
        const giftEvent = pickPlainEffectEvent(events);
        giftEvent.effects[0].locationTypes = true;
    });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'events.effect-location-types-unused'));
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
        const event = pickPlainEffectEvent(events);
        if (placement === 'event') event.conditions = [condition];
        if (placement === 'payment') event.payment = { conditions: [condition] };
        if (placement === 'choice') event.choices = [{ label: 'Take it', conditions: [condition] }];
    });
}

test('events: well-formed conditions raise no condition issues', () => {
    ['event', 'payment', 'choice'].forEach((placement) => {
        const data = withCondition(placement, { mode: 'has', cardKind: 'pokemon', name: SAMPLE_POKEMON, text: `Needs ${SAMPLE_POKEMON}` });
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
    const data = withCondition('event', { mode: 'has', cardKind: 'pokemon', name: SAMPLE_POKEMON, text: 7 });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'events.bad-condition'));
});

test('events: choice condition with a bad mode', () => {
    const data = withCondition('choice', { mode: 'maybe', cardKind: 'pokemon', name: SAMPLE_POKEMON });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'events.bad-condition-mode'));
});

test('events: payment condition with a bad cardKind', () => {
    const data = withCondition('payment', { mode: 'has', cardKind: 'trainer', name: SAMPLE_POKEMON });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'events.bad-condition-kind'));
});

test('events: condition naming a card that does not exist', () => {
    const data = withCondition('choice', { mode: 'lacks', cardKind: 'pokemon', name: 'Definitely Not A Real Pokemon Name' });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'events.unknown-condition-card'));
});

// A requirement's optional name/names filter narrows its picker; these mirror
// the condition fixtures above.
const REQUIREMENT_CODES = [
    'events.bad-requirement', 'events.bad-requirement-kind', 'events.unknown-requirement-card'
];

function withRequirement(placement, requirement) {
    return withEvents((events) => {
        const event = pickPlainEffectEvent(events);
        if (placement === 'event') event.requires = [requirement];
        if (placement === 'payment') event.payment = { requires: [requirement] };
        if (placement === 'choice') event.choices = [{ label: 'Take it', requires: [requirement] }];
    });
}

test('events: well-formed requirements raise no requirement issues, filtered or not', () => {
    ['event', 'payment', 'choice'].forEach((placement) => {
        [
            { id: 'pick', cardKind: 'pokemon' },
            { id: 'pick', cardKind: 'pokemon', name: SAMPLE_POKEMON },
            { id: 'pick', cardKind: 'pokemon', names: [SAMPLE_POKEMON, OTHER_POKEMON] }
        ].forEach((requirement) => {
            const issues = validateAll(withRequirement(placement, requirement), { enums: live.enums });
            REQUIREMENT_CODES.forEach((code) => assert.ok(!hasCode(issues, code), `${placement}: unexpected ${code}`));
        });
    });
});

test('events: requirement without an id', () => {
    const data = withRequirement('event', { cardKind: 'pokemon' });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'events.bad-requirement'));
});

test('events: requirement with a bad cardKind', () => {
    const data = withRequirement('payment', { id: 'pick', cardKind: 'trainer' });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'events.bad-requirement-kind'));
});

test('events: requirement filtering on a card that does not exist', () => {
    const data = withRequirement('choice', { id: 'pick', cardKind: 'pokemon', name: 'Definitely Not A Real Pokemon Name' });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'events.unknown-requirement-card'));
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
    // Build the smallest disconnected graph out of whatever the data holds:
    // keep exactly two enabled locations that share no type, disable the rest.
    // Every record stays otherwise valid, so the only thing provoked is the
    // connectivity check.
    //
    // The previous fixture retyped one location to a hardcoded pair of types
    // "no location uses". That rots as soon as the owner adopts one for a real
    // location, and it did — twice (FOSSIL, 2026-07-18; ARTIFICIAL, 2026-08).
    // Only one PokeType is unused today, so a hardcoded pair cannot be picked
    // at all. Derive the fixture instead.
    const data = withLocations((locations) => {
        const enabled = locations.filter((location) => location.enabled !== false);
        assert.ok(enabled.length >= 2, 'need two enabled locations to disconnect');

        const first = enabled[0];
        const partner = enabled.find((location) => (
            location !== first && !location.types.some((type) => first.types.includes(type))
        ));
        assert.ok(partner, 'expected two enabled locations sharing no type');

        locations.forEach((location) => {
            if (location !== first && location !== partner) location.enabled = false;
        });
    });
    const issues = validateAll(data, { enums: live.enums, engineRefs: live.engineRefs });
    assert.ok(hasCode(issues, 'locations.graph-disconnected'));
});

test('starterDecks: missing id', () => {
    const data = withStarterDecks((decks) => { delete decks[0].id; });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'starterDecks.missing-id'));
});

test('starterDecks: duplicate id', () => {
    const data = withStarterDecks((decks) => { decks[1].id = decks[0].id; });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'starterDecks.duplicate-id'));
});

test('starterDecks: bad id', () => {
    const data = withStarterDecks((decks) => { decks[0].id = 'Not A Valid Id!'; });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'starterDecks.bad-id'));
});

test('starterDecks: bad type', () => {
    const data = withStarterDecks((decks) => { decks[0].type = 'NOT_A_TYPE'; });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'starterDecks.bad-type'));
});

test('starterDecks: no pokemon', () => {
    const data = withStarterDecks((decks) => { decks[0].pokemon = []; });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'starterDecks.no-pokemon'));
});

test('starterDecks: unknown pokemon', () => {
    const data = withStarterDecks((decks) => { decks[0].pokemon.push('Not A Real Pokemon'); });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'starterDecks.unknown-pokemon'));
});

test('starterDecks: unknown attack', () => {
    const data = withStarterDecks((decks) => { decks[0].attacks.push({ name: 'Not A Real Attack', count: 1 }); });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'starterDecks.unknown-attack'));
});

test('starterDecks: unknown item', () => {
    const data = withStarterDecks((decks) => { decks[0].items.push({ name: 'Not A Real Item', count: 1 }); });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'starterDecks.unknown-item'));
});

test('starterDecks: bad count', () => {
    const data = withStarterDecks((decks) => { decks[0].attacks[0].count = 0; });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'starterDecks.bad-count'));
});

test('starterDecks: none enabled', () => {
    const data = withStarterDecks((decks) => { decks.forEach((deck) => { deck.enabled = false; }); });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'starterDecks.none-enabled'));
});

test('starterDecks: gating a deck on a known achievement is clean', () => {
    const data = withStarterDecks((decks) => { decks[1].requiresAchievement = 'champion'; });
    const issues = validateAll(data, { enums: live.enums });
    assert.equal(hasCode(issues, 'starterDecks.unknown-achievement'), false);
    assert.equal(hasCode(issues, 'starterDecks.none-unlocked'), false);
});

test('starterDecks: unknown achievement', () => {
    const data = withStarterDecks((decks) => { decks[0].requiresAchievement = 'not-a-real-achievement'; });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'starterDecks.unknown-achievement'));
});

test('starterDecks: a non-string or blank requiresAchievement is rejected', () => {
    const blank = withStarterDecks((decks) => { decks[0].requiresAchievement = ''; });
    assert.ok(hasCode(validateAll(blank, { enums: live.enums }), 'starterDecks.bad-achievement'));

    const wrongType = withStarterDecks((decks) => { decks[0].requiresAchievement = 7; });
    assert.ok(hasCode(validateAll(wrongType, { enums: live.enums }), 'starterDecks.bad-achievement'));
});

test('starterDecks: gating every enabled deck leaves a new profile with nothing to pick', () => {
    const data = withStarterDecks((decks) => {
        decks.forEach((deck) => { deck.requiresAchievement = 'champion'; });
    });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'starterDecks.none-unlocked'));
});

test('findReferences(achievement, champion) includes a starter deck gated on it', () => {
    const data = withStarterDecks((decks) => { decks[1].requiresAchievement = 'champion'; });
    const refs = findReferences(data, 'achievement', 'champion', live.engineRefs);

    assert.ok(refs.some((ref) => ref.file === 'starter_decks.json'
        && ref.recordKey === data.starter_decks[1].id
        && ref.field === 'requiresAchievement'));
});

test('starterDecks: an attack no deck pokemon can use warns unusable-attack', () => {
    const data = withStarterDecks((decks) => {
        decks[0].attacks.push({ name: 'Sleep Powder', count: 1 });
    });
    const issues = validateAll(data, { enums: live.enums });
    const warning = issues.find((issue) => issue.code === 'starterDecks.unusable-attack');
    assert.ok(warning, 'expected a starterDecks.unusable-attack warning');
    assert.equal(warning.severity, 'warning');
});

test('locations.starter-coverage fires when an enabled starter deck type has no covering enabled location', () => {
    const data = structuredClone(live.data);
    data.starter_decks[0].type = 'BABY';
    data.locations.forEach((location) => { location.types = (location.types || []).filter((type) => type !== 'BABY'); });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'locations.starter-coverage'));
});

test('achievements: missing id', () => {
    const data = withAchievements((achievements) => { delete achievements[0].id; });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'achievements.missing-id'));
});

test('achievements: duplicate id', () => {
    // Appends rather than writing achievements[1]: achievements.json is still
    // short enough that a second record is not guaranteed to exist.
    const data = withAchievements((achievements) => { achievements.push(structuredClone(achievements[0])); });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'achievements.duplicate-id'));
});

test('achievements: bad id', () => {
    const data = withAchievements((achievements) => { achievements[0].id = 'Not A Valid Id!'; });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'achievements.bad-id'));
});

test('achievements: missing name', () => {
    const data = withAchievements((achievements) => { achievements[0].name = ''; });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'achievements.missing-name'));
});

test('achievements: bad stat (unknown key)', () => {
    const data = withAchievements((achievements) => { achievements[0].stat = 'nonsense.key'; });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'achievements.bad-stat'));
});

test('achievements: bad stat (prefix with no suffix)', () => {
    const data = withAchievements((achievements) => { achievements[0].stat = 'events.seen.'; });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'achievements.bad-stat'));
});

test('achievements: bad threshold', () => {
    const data = withAchievements((achievements) => { achievements[0].atLeast = 0; });
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'achievements.bad-threshold'));
});

test('achievements: missing description warns', () => {
    const data = withAchievements((achievements) => { achievements[0].description = ''; });
    const issues = validateAll(data, { enums: live.enums });
    const warning = issues.find((issue) => issue.code === 'achievements.missing-description');
    assert.ok(warning, 'expected an achievements.missing-description warning');
    assert.equal(warning.severity, 'warning');
});

test('achievements: unreachable event warns', () => {
    const data = withAchievements((achievements) => { achievements[0].stat = 'events.seen.not-a-real-event'; });
    const issues = validateAll(data, { enums: live.enums });
    const warning = issues.find((issue) => issue.code === 'achievements.unreachable-event');
    assert.ok(warning, 'expected an achievements.unreachable-event warning');
    assert.equal(warning.severity, 'warning');
});

test('achievements: unreachable starter deck warns', () => {
    const data = withAchievements((achievements) => { achievements[0].stat = 'runs.completed.starter.not-a-real-deck'; });
    const issues = validateAll(data, { enums: live.enums });
    const warning = issues.find((issue) => issue.code === 'achievements.unreachable-starter');
    assert.ok(warning, 'expected an achievements.unreachable-starter warning');
    assert.equal(warning.severity, 'warning');
});

test('findReferences(achievement, champion) includes an event conditioned on it', () => {
    const data = withCondition('choice', { mode: 'has', subject: 'achievement', name: 'champion' });
    const refs = findReferences(data, 'achievement', 'champion', live.engineRefs);

    assert.ok(refs.some((ref) => ref.file === 'events.json' && ref.recordKey === HOST_EVENT_ID && ref.field === 'conditions'));
});

// ---------------------------------------------------------------- music

test('music: a well-formed track with its file present is clean', () => {
    const data = withMusic([musicTrack()]);
    const assetIndex = Object.assign({}, live.assetIndex, { music: new Set(['gym-leader-theme.mp3']) });
    const issues = validateAll(data, { enums: live.enums, assetIndex, engineRefs: live.engineRefs })
        .filter((issue) => issue.file === 'music.json' && issue.recordKey === 'gym-leader-theme');

    assert.deepEqual(issues, [], `expected no issues on the track, got: ${JSON.stringify(issues)}`);
});

test('music: missing id', () => {
    const data = withMusic([musicTrack({ id: '' })]);
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'music.missing-id'));
});

test('music: duplicate id', () => {
    const data = withMusic([musicTrack(), musicTrack({ title: 'Second' })]);
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'music.duplicate-id'));
});

test('music: bad id (it becomes a file name)', () => {
    const data = withMusic([musicTrack({ id: 'Gym Leader', file: 'assets/music/Gym Leader.mp3' })]);
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'music.bad-id'));
});

test('music: bad category', () => {
    const data = withMusic([musicTrack({ category: 'mystery' })]);
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'music.bad-category'));
});

test('music: bad file path', () => {
    const data = withMusic([musicTrack({ file: 'assets/music/other.mp3' })]);
    const issues = validateAll(data, { enums: live.enums });
    assert.ok(hasCode(issues, 'music.bad-file-path'));
});

test('music: missing file warns (so a new track can be saved before its upload)', () => {
    const data = withMusic([musicTrack()]);
    const assetIndex = Object.assign({}, live.assetIndex, { music: new Set() });
    const issues = validateAll(data, { enums: live.enums, assetIndex, engineRefs: live.engineRefs });
    const warning = issues.find((issue) => issue.code === 'music.missing-file');

    assert.ok(warning, 'expected a music.missing-file warning');
    assert.equal(warning.severity, 'warning');
    assert.ok(!issues.some((issue) => issue.file === 'music.json' && issue.severity === 'error'));
});

test('music: every category without an enabled track warns', () => {
    // musicTrack() is category 'boss', so every OTHER category is uncovered.
    const categories = engineMusicCategories();
    const data = withMusic([musicTrack()]);
    const issues = validateAll(data, { enums: live.enums });
    const empty = issues.filter((issue) => issue.code === 'music.empty-category');

    assert.equal(empty.length, categories.length - 1, 'boss is covered, every other category is not');
    empty.forEach((issue) => {
        assert.equal(issue.severity, 'warning');
        assert.equal(issue.recordKey, '(dataset)');
    });
    assert.ok(!empty.some((issue) => issue.message.includes('boss')));
});

test('music: a disabled track does not cover its category', () => {
    const categories = engineMusicCategories();
    const data = withMusic([musicTrack({ enabled: false })]);
    const issues = validateAll(data, { enums: live.enums });

    assert.equal(issues.filter((issue) => issue.code === 'music.empty-category').length, categories.length);
});

test('music: an mp3 no record names is an orphan warning; a README is not', () => {
    const data = withMusic([musicTrack()]);
    const assetIndex = Object.assign({}, live.assetIndex, {
        music: new Set(['gym-leader-theme.mp3', 'leftover.mp3', 'README.md'])
    });
    const issues = validateAll(data, { enums: live.enums, assetIndex, engineRefs: live.engineRefs });
    const orphans = issues.filter((issue) => issue.code === 'music.orphan-file');

    assert.equal(orphans.length, 1);
    assert.equal(orphans[0].recordKey, 'leftover.mp3');
    assert.equal(orphans[0].severity, 'warning');
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
        const index = pickIndex(
            pokemon,
            (record) => live.engineRefs.defaultDeck.pokemon.includes(record.name),
            'a species the engine default deck references'
        );
        pokemon.splice(index, 1);
    });
    const issues = validateAll(data, { enums: live.enums, engineRefs: live.engineRefs });
    assert.ok(hasCode(issues, 'engine.unknown-default-deck-ref'));
});

// ------------------------------------------------------------- findReferences

test('findReferences(pokemon) finds both the engine default deck and the starter deck naming it', () => {
    // Any species that is in the default deck AND in some starter deck exercises
    // both reference sources at once.
    const deck = pick(
        live.data.starter_decks,
        (record) => (record.pokemon || []).some((name) => live.engineRefs.defaultDeck.pokemon.includes(name)),
        'a starter deck sharing a pokemon with the engine default deck'
    );
    const name = deck.pokemon.find((entry) => live.engineRefs.defaultDeck.pokemon.includes(entry));

    const refs = findReferences(live.data, 'pokemon', name, live.engineRefs);

    assert.ok(refs.some((ref) => ref.file === 'engine' && ref.recordKey === 'defaultDeck'), `${name}: no engine ref`);
    assert.ok(
        refs.some((ref) => ref.file === 'starter_decks.json' && ref.recordKey === deck.id),
        `${name}: no starter_decks.json/${deck.id} ref`
    );
});

test('findReferences(trainer) finds the trainer event that summons them', () => {
    const event = pick(
        live.data.events,
        (record) => record.type === 'trainer' && record.trainerName,
        'a trainer-type event naming a trainer'
    );

    const refs = findReferences(live.data, 'trainer', event.trainerName, live.engineRefs);

    assert.ok(refs.some((ref) => ref.file === 'events.json' && ref.recordKey === event.id));
});

test('findReferences(pokemon) includes an event that gates on it', () => {
    const data = withCondition('choice', { mode: 'has', cardKind: 'pokemon', name: SAMPLE_POKEMON });
    const refs = findReferences(data, 'pokemon', SAMPLE_POKEMON, live.engineRefs);

    assert.ok(refs.some((ref) => ref.file === 'events.json' && ref.recordKey === HOST_EVENT_ID && ref.field === 'conditions'));
});

test('findReferences(pokemon) includes an event whose requirement filters on it', () => {
    const data = withRequirement('choice', { id: 'pick', cardKind: 'pokemon', name: SAMPLE_POKEMON });
    const refs = findReferences(data, 'pokemon', SAMPLE_POKEMON, live.engineRefs);

    assert.ok(refs.some((ref) => ref.file === 'events.json' && ref.recordKey === HOST_EVENT_ID && ref.field === 'requires'));
});

test('findReferences(pokemon, Rotom) includes the live rotom-appliances requirement filters', () => {
    const refs = findReferences(live.data, 'pokemon', 'Rotom', live.engineRefs);

    assert.ok(refs.some((ref) => ref.file === 'events.json' && ref.recordKey === 'rotom-appliances' && ref.field === 'requires'));
});

test('findReferences returns [] for a freshly invented name', () => {
    const refs = findReferences(live.data, 'pokemon', 'Definitely Not A Real Pokemon Name', live.engineRefs);
    assert.deepEqual(refs, []);
});
