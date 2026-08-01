'use strict';

const assert = require('node:assert');
const test = require('node:test');
const { arena } = require('./helpers/arena_env.js');

require('../arena/arena_render.js');

const SPECIES = {
    name: 'Testmon', id: '0001',
    type1: 'FIRE', type2: 'NONE', type3: 'NONE', types: ['FIRE'],
    baseHealth: 100, baseAttack: 100, baseDefense: 80, baseSpeed: 60
};

const FIGHTING_SPECIES = Object.assign({}, SPECIES, { type1: 'FIGHTING', types: ['FIGHTING'] });

function makeCard(overrides) {
    return Object.assign({
        id: 'p1', kind: 'pokemon', owner: 'player', pokemon: SPECIES,
        currentHealth: 42, currentStatus: [], faceUp: true,
        statStages: { attack: 0, defense: 0, speed: 0 }
    }, overrides || {});
}

// renderCardPreview is a pure string builder, so the stat grid is assertable
// without a DOM. Returns the one <span> for the requested stat letter.
function statCell(card, letter) {
    const html = arena.Render.renderCardPreview(card);
    const match = html.match(new RegExp(`<span class="stat-cell[^"]*"[^>]*>${letter} \\d+</span>`));

    assert.ok(match, `no ${letter} stat cell in rendered card`);
    return match[0];
}

function assertCell(cell, expectedClass, expectedTitle) {
    if (expectedClass) {
        assert.ok(cell.includes(`class="stat-cell ${expectedClass}"`), `expected class ${expectedClass} in ${cell}`);
    } else {
        assert.ok(cell.includes('class="stat-cell"'), `expected no modifier class in ${cell}`);
    }

    assert.ok(cell.includes(`title="${expectedTitle}"`), `expected title "${expectedTitle}" in ${cell}`);
}

test('clean card has no modifier class and a bare title', () => {
    const cell = statCell(makeCard(), 'A');

    assertCell(cell, null, 'Attack');
});

test('burn halves attack and colors it status-down', () => {
    const card = makeCard({ currentStatus: [{ status: 'BURN' }] });
    const cell = statCell(card, 'A');

    assertCell(cell, 'stat-cell--status-down', 'Attack 100 → 50 (Burn ×0.5)');
});

test('paralysis halves speed and colors it status-down', () => {
    const card = makeCard({ currentStatus: [{ status: 'PARALYSIS' }] });
    const cell = statCell(card, 'S');

    assertCell(cell, 'stat-cell--status-down', 'Speed 60 → 30 (Paralysis ×0.5)');
});

test('stat stages alone color up/down with stage-only titles', () => {
    const card = makeCard({ statStages: { attack: 2, defense: -1, speed: 0 } });

    assertCell(statCell(card, 'A'), 'stat-cell--up', 'Attack 100 → 200 (+2 stage)');
    assertCell(statCell(card, 'D'), 'stat-cell--down', 'Defense 80 → 64 (-1 stage)');
});

test('burn plus a positive attack stage still reads as status-down, not up', () => {
    const card = makeCard({
        currentStatus: [{ status: 'BURN' }],
        statStages: { attack: 2, defense: 0, speed: 0 }
    });
    const cell = statCell(card, 'A');

    assert.ok(!cell.includes('stat-cell--up'), `burned card with a positive stage must not read as --up: ${cell}`);
    assertCell(cell, 'stat-cell--status-down', 'Attack 100 → 100 (+2 stage, Burn ×0.5)');
});

test('a burned FIGHTING type reads as a status boost', () => {
    const card = makeCard({ pokemon: FIGHTING_SPECIES, currentStatus: [{ status: 'BURN' }] });
    const cell = statCell(card, 'A');

    assertCell(cell, 'stat-cell--status-up', 'Attack 100 → 150 (Burn ×1.5)');
});

test('fatigue lowers defense and colors it status-down', () => {
    const card = makeCard({ currentStatus: [{ status: 'FATIGUE' }] });
    const cell = statCell(card, 'D');

    assertCell(cell, 'stat-cell--status-down', 'Defense 80 → 60 (Fatigue ×0.75)');
});

test('poison has no stat multiplier and leaves attack uncolored', () => {
    const card = makeCard({ currentStatus: [{ status: 'POISON' }] });
    const cell = statCell(card, 'A');

    assertCell(cell, null, 'Attack');
});

test('this phase does not change the displayed stat number', () => {
    const clean = statCell(makeCard(), 'A');
    const burned = statCell(makeCard({ currentStatus: [{ status: 'BURN' }] }), 'A');

    assert.ok(clean.includes('>A 100<'), `clean card should read A 100: ${clean}`);
    assert.ok(burned.includes('>A 50<'), `burned card should read A 50: ${burned}`);
});
