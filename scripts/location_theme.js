/**
 * Pokemon Rogue Pocket - type-derived location theme defaults (dev tooling).
 *
 * Canonical per-type colors extracted from the type icon SVGs
 * (assets/types-svgs/<TYPE>.svg): `bright` is the icon circle's fill, `mid`
 * its stroke. deriveLocationTheme(types) maps a location's 2-4 PokeTypes
 * onto the five theme slots consumed by map/locations.js's
 * applyLocationTheme. Dev-only: required by scripts/manage_locations.js and
 * loaded by dev/editor/index.html - never shipped to game pages, which read
 * the baked theme values from locations.json.
 */
(function () {
    'use strict';

    const TYPE_COLORS = {
        ARTIFICIAL: { bright: '#ededed', mid: '#20314d' },
        BABY: { bright: '#ffd79a', mid: '#b9915a' },
        BUG: { bright: '#fffe66', mid: '#737926' },
        DARK: { bright: '#a6a6a6', mid: '#2c2b2c' },
        DRAGON: { bright: '#b87333', mid: '#8a4513' },
        ELECTRIC: { bright: '#fdff4a', mid: '#b79a00' },
        FAIRY: { bright: '#ffafd1', mid: '#954e6f' },
        FIGHTING: { bright: '#f33218', mid: '#ad2220' },
        FIRE: { bright: '#ff9024', mid: '#ec5b00' },
        FLYING: { bright: '#b2e9ff', mid: '#82c8e5' },
        FOSSIL: { bright: '#d2d35b', mid: '#595926' },
        GHOST: { bright: '#876dad', mid: '#353247' },
        GOURMET: { bright: '#ff8473', mid: '#e55952' },
        GRASS: { bright: '#17b300', mid: '#008000' },
        GROUND: { bright: '#c6964a', mid: '#663711' },
        HUMAN: { bright: '#fdbb8b', mid: '#6b3b18' },
        ICE: { bright: '#c3e4ee', mid: '#498c92' },
        LEGENDARY: { bright: '#eed368', mid: '#634984' },
        MONSTER: { bright: '#00b464', mid: '#114530' },
        NORMAL: { bright: '#fffefe', mid: '#757575' },
        POISON: { bright: '#88d7a0', mid: '#5a7e5f' },
        PSYCHIC: { bright: '#b955d2', mid: '#7c3081' },
        ROCK: { bright: '#e7e5af', mid: '#7d7a69' },
        STEEL: { bright: '#dbdbdb', mid: '#808080' },
        WATER: { bright: '#2da2fd', mid: '#0048c9' }
    };

    // Matches NEUTRAL_LOCATION_THEME in arena/arena_data.js.
    const NEUTRAL_THEME = {
        accent: '#e0b84f',
        glow: '#4ab0a5',
        surface: '#232f3d',
        bgDeep: '#10161f',
        bgMid: '#1b2836'
    };

    // Near-black slate bases the type mids are mixed toward; the ratios are
    // calibrated so surface/bgMid/bgDeep stay as dark as the hand-tuned
    // themes this scheme replaced. Single tuning point for the whole look.
    const SURFACE_BASE = '#0b0e13';
    const DEEP_BASE = '#07090d';

    function hexToRgb(hex) {
        return {
            r: parseInt(hex.slice(1, 3), 16),
            g: parseInt(hex.slice(3, 5), 16),
            b: parseInt(hex.slice(5, 7), 16)
        };
    }

    function rgbToHex(r, g, b) {
        return '#' + [r, g, b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');
    }

    function mix(hexA, hexB, weightB) {
        const a = hexToRgb(hexA);
        const b = hexToRgb(hexB);
        const t = weightB;
        return rgbToHex(a.r * (1 - t) + b.r * t, a.g * (1 - t) + b.g * t, a.b * (1 - t) + b.b * t);
    }

    function deriveLocationTheme(types) {
        const list = (Array.isArray(types) ? types : [])
            .map((type) => String(type || '').trim().toUpperCase())
            .filter(Boolean);
        if (list.length === 0) return Object.assign({}, NEUTRAL_THEME);

        const t1 = list[0];
        const t2 = list[1] || t1;
        const t3 = list[2] || t1;
        const t4 = list[3] || t2;
        const colorFor = (type) => TYPE_COLORS[type] || { bright: NEUTRAL_THEME.accent, mid: NEUTRAL_THEME.surface };

        // Key order matters: locations.json themes round-trip through
        // format_json.js, which preserves object key order.
        return {
            accent: colorFor(t1).bright,
            glow: colorFor(t2).bright,
            surface: mix(SURFACE_BASE, colorFor(t3).mid, 0.30),
            bgDeep: mix(DEEP_BASE, colorFor(t4).mid, 0.12),
            bgMid: mix(SURFACE_BASE, colorFor(t4).mid, 0.22)
        };
    }

    const api = { TYPE_COLORS, NEUTRAL_THEME, deriveLocationTheme };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.LocationTheme = api;
}());
