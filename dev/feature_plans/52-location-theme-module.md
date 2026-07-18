# Phase 52 — Location theme module + retroactive re-theme

**Recommended agent:** Sonnet · medium effort.
**Prereqs:** 50. **Read first:** `49-editor-polish-overview.md` (Locked spec → "Type-derived theme").
**Goal:** `scripts/location_theme.js` exists with unit tests, and every location in
`locations.json` carries a theme derived from its types. Suite green.

## Context you need

- The derivation spec, constants, and three worked examples are **locked in the batch
  overview** — the module below implements exactly that. The `TYPE_COLORS` table was
  extracted 2026-07-18 from each `assets/types-svgs/<TYPE>.svg` icon's `<circle>`
  (`fill` → `bright`, `stroke` → `mid`); trust the table, no need to re-extract. (If you
  do spot-check one: `grep -oE '(fill|stroke):\s*rgb\([0-9, ]+\)' assets/types-svgs/FIRE.svg`
  — note `BABY.svg` has a space after the colon, and ignore the outline colors
  `rgb(48,44,50)` / `rgb(38,38,42)`.)
- The module is **dev-only**: required by `scripts/manage_locations.js` and loaded by
  the editor GUI (both in phase 53) plus the retro-apply step here. Game pages never
  load it — themes stay baked into `locations.json`, and runtime
  (`map/locations.js applyLocationTheme`, `arena/arena_data.js normalizeLocation`) is
  untouched.
- UMD pattern to copy: the bottom of `dev/editor/validate.js` / `format_json.js`
  (`module.exports` if present, plus a `window` global).
- Write `locations.json` **only** via `formatDataFile('locations', data)` from
  `dev/editor/format_json.js` — `tests/editor_format.test.js` asserts the file is
  byte-exact against that formatter.
- `tests/run_all.js` discovers `tests/**/*.test.js` automatically and syntax-checks new
  JS files.

## Steps

- [ ] 1. **`scripts/location_theme.js`** (new file) — create with exactly this content:
  ```js
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
  ```
- [ ] 2. **Self-check the math** before touching data — all three worked examples in the
  overview must reproduce exactly, e.g.:
  ```bash
  node -e "console.log(JSON.stringify(require('./scripts/location_theme').deriveLocationTheme(['FIRE','ROCK'])))"
  # {"accent":"#ff9024","glow":"#e7e5af","surface":"#4f250d","bgDeep":"#151718","bgMid":"#242626"}
  ```
- [ ] 3. **`tests/location_theme.test.js`** (new file) — create with exactly this content:
  ```js
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
  ```
- [ ] 4. **`locations.json`** — retroactively re-theme **all** records (including the two
  hand-authored ones — owner's explicit choice, see overview):
  ```bash
  node -e "
  const fs = require('fs');
  const { deriveLocationTheme } = require('./scripts/location_theme.js');
  const { formatDataFile } = require('./dev/editor/format_json.js');
  const locations = JSON.parse(fs.readFileSync('locations.json', 'utf8'));
  locations.forEach((location) => { location.theme = deriveLocationTheme(location.types); });
  fs.writeFileSync('locations.json', formatDataFile('locations', locations));
  "
  ```

## Verification

- [ ] `node tests/run_all.js` green (includes the new test file and the byte-exact
  format test against the rewritten `locations.json`).
- [ ] `git diff locations.json` shows **only** `theme` lines changed, one per record
  (13 records), and nothing else.
- [ ] Eyeball the values: `node -e "JSON.parse(require('fs').readFileSync('locations.json','utf8')).forEach(l => console.log(l.id.padEnd(24), JSON.stringify(l.theme)))"`
  — accents/glows are bright type colors; surface/bgDeep/bgMid are dark (every
  bgDeep/bgMid channel pair reads well below `#40`).
- [ ] In-game spot check (`verify` skill): `python3 -m http.server 8931 --bind
  127.0.0.1`, start a run from `index.html`, confirm the area page background/panels
  pick up a location-specific palette (no longer the shared neutral gold/teal for most
  locations). `pkill -f "http.server 8931"` afterwards.

## Out of scope / do not touch

Do not wire the module into the editor GUI or CLI yet (phase 53). Do not modify
`map/`, `arena/`, `static/styles.css`, or any other data file. Do not hand-edit
individual theme values. Do not `git commit`.
