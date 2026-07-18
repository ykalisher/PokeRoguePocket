'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { TYPE_COLORS, deriveLocationTheme } = require('../scripts/location_theme');

// Deliberately no exact-hex assertions against locations.json: the owner may
// hand-tune individual themes after they are derived.
const HEX_PATTERN = /^#[0-9a-f]{6}$/;
const THEME_KEYS = ['accent', 'glow', 'surface', 'bgDeep', 'bgMid'];

test('every live location derives a full valid theme', () => {
    const locations = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'locations.json'), 'utf8'));
    locations.forEach((location) => {
        const theme = deriveLocationTheme(location.types);
        assert.deepEqual(Object.keys(theme), THEME_KEYS, `${location.id}: theme key order`);
        THEME_KEYS.forEach((key) => {
            assert.ok(HEX_PATTERN.test(theme[key]), `${location.id}: ${key} = ${theme[key]} is not lowercase hex`);
        });
    });
});

test('TYPE_COLORS entries are lowercase hex pairs', () => {
    Object.entries(TYPE_COLORS).forEach(([type, pair]) => {
        assert.ok(HEX_PATTERN.test(pair.bright), `${type}.bright = ${pair.bright}`);
        assert.ok(HEX_PATTERN.test(pair.mid), `${type}.mid = ${pair.mid}`);
    });
});

test('missing third/fourth types fall back to t1/t2', () => {
    assert.deepEqual(
        deriveLocationTheme(['FIRE', 'ROCK']),
        deriveLocationTheme(['FIRE', 'ROCK', 'FIRE', 'ROCK'])
    );
});

test('empty input returns a fresh neutral palette', () => {
    const a = deriveLocationTheme([]);
    const b = deriveLocationTheme();
    assert.deepEqual(a, b);
    a.accent = '#000000';
    assert.notEqual(deriveLocationTheme([]).accent, '#000000');
});

test('unknown types fall back to neutral colors without throwing', () => {
    const theme = deriveLocationTheme(['NOT_A_TYPE', 'ALSO_FAKE']);
    THEME_KEYS.forEach((key) => assert.ok(HEX_PATTERN.test(theme[key]), `${key} = ${theme[key]}`));
});
