'use strict';

/**
 * Loads the browser arena engine into Node for headless tests.
 *
 * The arena files are window-namespace IIFEs, so aliasing window to
 * globalThis is enough to require them. arena_data.js must load before
 * arena_model.js because the model destructures arena.Constants at load
 * time. The model touches no browser APIs beyond localStorage (guarded)
 * and setTimeout.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

globalThis.window = globalThis;

// In-memory localStorage so save/restore round-trips are testable and
// Node's experimental built-in localStorage stays out of the way.
const storageMap = new Map();
Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
        get length() { return storageMap.size; },
        clear: () => storageMap.clear(),
        getItem: key => (storageMap.has(key) ? storageMap.get(key) : null),
        key: index => [...storageMap.keys()][index] ?? null,
        removeItem: key => storageMap.delete(key),
        setItem: (key, value) => storageMap.set(String(key), String(value))
    }
});

require(path.join(ROOT, 'arena', 'arena_data.js'));
require(path.join(ROOT, 'arena', 'arena_model.js'));

const arena = window.CardArena;

/**
 * Replaces fetch with a disk reader for the root JSON files, then runs the
 * game's own loadGameData() so arena.GameData holds real normalized data.
 */
async function loadRealGameData() {
    globalThis.fetch = async requestPath => ({
        ok: true,
        json: async () => JSON.parse(fs.readFileSync(path.join(ROOT, String(requestPath)), 'utf8'))
    });

    return arena.Data.loadGameData();
}

module.exports = { ROOT, arena, loadRealGameData, storageMap };
