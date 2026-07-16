'use strict';

/**
 * Builds the argument bundles validate.js needs (enums, assetIndex,
 * engineRefs) plus the six raw data arrays, for use by editor test files.
 * Mirrors the loading trick in arena_env.js (window = globalThis) and adds
 * trainer_sprites.js + locations.js on top, since validate.js's sprite and
 * starter-deck checks depend on both.
 */

const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./arena_env');

require(path.join(ROOT, 'arena', 'trainer_sprites.js'));
require(path.join(ROOT, 'map', 'locations.js'));

const enums = require('../../scripts/data_options');

function readData(fileName) {
    return JSON.parse(fs.readFileSync(path.join(ROOT, fileName), 'utf8'));
}

function loadRawData() {
    return {
        pokemon: readData('pokemon.json'),
        attacks: readData('attacks.json'),
        items: readData('items.json'),
        trainers: readData('trainers.json'),
        events: readData('events.json'),
        locations: readData('locations.json')
    };
}

function buildEngineRefs() {
    const defaultDeck = window.CardArena.Constants.DEFAULT_BATTLE_DECK;
    const starterDecks = window.PokeLocations.STARTER_DECKS;

    return {
        defaultDeck: {
            pokemon: defaultDeck.pokemon.map((entry) => entry.name),
            attacks: defaultDeck.pokemon.flatMap((entry) => entry.attacks),
            items: defaultDeck.items
        },
        starterDecks: Object.fromEntries(Object.entries(starterDecks).map(([key, deck]) => [key, {
            pokemon: deck.pokemon,
            attacks: deck.attacks.map((pair) => pair[0]),
            items: deck.items.map((pair) => pair[0])
        }])),
        starterTypes: Object.values(starterDecks).map((deck) => deck.type),
        resolveSpriteFile: (name, sprite) => window.PokeRogue.TrainerSprites.resolveSprite(name, sprite).file
    };
}

function buildAssetIndex() {
    const assetsDir = (name) => new Set(fs.readdirSync(path.join(ROOT, 'assets', name)));

    return {
        portraits: assetsDir('portraits'),
        sprites: assetsDir('sprites'),
        items: assetsDir('items'),
        backgrounds: assetsDir('backgrounds')
    };
}

// Full bundle over the live repo data, ready to pass straight into
// validateAll(data, { enums, assetIndex, engineRefs }).
function buildLiveEditorEnv() {
    return {
        data: loadRawData(),
        enums,
        assetIndex: buildAssetIndex(),
        engineRefs: buildEngineRefs()
    };
}

module.exports = { ROOT, enums, loadRawData, buildEngineRefs, buildAssetIndex, buildLiveEditorEnv };
