'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./helpers/arena_env');
const { formatDataFile } = require('../dev/editor/format_json.js');

function readRaw(fileName) {
    return fs.readFileSync(path.join(ROOT, fileName), 'utf8');
}

// Normalizes a raw file's trailing whitespace to exactly one newline, for
// comparing against the plain JSON.stringify(...) + '\n' output of files
// that (today) may or may not already end in a trailing newline.
function withSingleTrailingNewline(text) {
    return text.replace(/\n*$/, '') + '\n';
}

test('events.json formats byte-exact against the live file', () => {
    const raw = readRaw('events.json');
    const data = JSON.parse(raw);
    assert.equal(formatDataFile('events.json', data), raw);
    assert.equal(formatDataFile('events', data), raw);
});

test('locations.json formats byte-exact against the live file', () => {
    const raw = readRaw('locations.json');
    const data = JSON.parse(raw);
    assert.equal(formatDataFile('locations.json', data), raw);
    assert.equal(formatDataFile('locations', data), raw);
});

['pokemon.json', 'attacks.json', 'items.json', 'trainers.json'].forEach((fileName) => {
    test(`${fileName} formats as plain JSON.stringify(..., null, 2)`, () => {
        const raw = readRaw(fileName);
        const data = JSON.parse(raw);
        const expected = JSON.stringify(data, null, 2) + '\n';
        const out = formatDataFile(fileName, data);

        assert.equal(out, expected);
        assert.equal(out, withSingleTrailingNewline(raw));
    });
});

test('unknown file name throws', () => {
    assert.throws(() => formatDataFile('nonsense.json', []), /unknown file name/);
});

test('a >110-char primitive array wraps one-per-line', () => {
    const longNames = Array.from({ length: 15 }, (_, i) => `SOME_LONG_VALUE_${i}`);
    const data = [{ id: 'x', name: 'x', terrain: 'x', types: longNames, theme: {}, background: null, enabled: true }];
    const out = formatDataFile('locations', data);

    const flatLine = '  "types": [' + longNames.map((v) => JSON.stringify(v)).join(', ') + ']';
    assert.ok(flatLine.length > 110, 'fixture must actually exceed the width to exercise wrapping');
    assert.ok(!out.includes(flatLine), 'long array must not stay inline');
    longNames.forEach((name) => {
        assert.ok(out.includes(`      ${JSON.stringify(name)}`), `expected ${name} on its own line`);
    });
});

test('a short array containing an object still wraps (never inlines objects in arrays)', () => {
    const data = [{
        id: 'x', title: 'x', type: 'gift', body: 'x',
        effects: [{ type: 'gain-cash', amount: 1 }]
    }];
    const out = formatDataFile('events', data);

    assert.ok(!out.includes('"effects": [{'), 'array containing an object must not inline the array');
    assert.ok(out.includes('"effects": [\n'));
    assert.ok(out.includes('{ "type": "gain-cash", "amount": 1 }'), 'the object itself may still inline');
});

test('empty arrays and objects stay inline', () => {
    const data = [{ id: 'x', title: 'x', requires: [], payment: {} }];
    const out = formatDataFile('events', data);

    assert.ok(out.includes('"requires": []'));
    assert.ok(out.includes('"payment": {}'));
});

test('a record-level object with two keys expands even though it would fit inline', () => {
    const data = [{ id: 'x', name: 'y' }];
    const out = formatDataFile('locations', data);

    // The record itself (depth 1) is a `{ "id": "x", "name": "y" }`-sized
    // object that would easily fit under WIDTH, but record-level objects
    // always expand.
    assert.ok(!out.includes('[{ "id": "x", "name": "y" }]'));
    assert.equal(out, '[\n  {\n    "id": "x",\n    "name": "y"\n  }\n]\n');
});

test('key order is preserved', () => {
    const data = [{ zeta: 1, alpha: 2, mid: 3 }];
    const out = formatDataFile('events', data);
    const keys = [...out.matchAll(/"(\w+)":/g)].map((m) => m[1]);

    assert.deepEqual(keys, ['zeta', 'alpha', 'mid']);
});
