/**
 * Canonical per-file JSON write formatter for the data editor.
 *
 * pokemon/attacks/items/trainers use plain JSON.stringify(data, null, 2).
 * events/locations use a smart formatter (see `format` below) that keeps
 * primitive-only arrays inline and expands record-level objects, verified
 * byte-exact against the live events.json / locations.json files.
 */
(function () {
    'use strict';

    const WIDTH = 110;

    const isPrimitive = (v) => v === null || typeof v !== 'object';

    // Returns the flat `{ "k": v, … }` / `[v, …]` rendering of value, or null
    // when it cannot be inlined (an array containing a non-primitive, or an
    // object with a non-inlineable child).
    function inline(value) {
        if (Array.isArray(value)) {
            if (value.length === 0) return '[]';
            if (!value.every(isPrimitive)) return null;
            return '[' + value.map((v) => JSON.stringify(v)).join(', ') + ']';
        }
        if (value && typeof value === 'object') {
            const keys = Object.keys(value);
            if (keys.length === 0) return '{}';
            const parts = keys.map((k) => {
                const v = inline(value[k]);
                return v === null ? null : JSON.stringify(k) + ': ' + v;
            });
            return parts.includes(null) ? null : '{ ' + parts.join(', ') + ' }';
        }
        return JSON.stringify(value);
    }

    // depth 0 = root array, depth 1 = record objects (always expanded).
    function format(value, indent, depth) {
        const pad = ' '.repeat(indent + 2);
        if (Array.isArray(value)) {
            if (value.length === 0) return '[]';
            const flat = inline(value);
            if (flat !== null && indent + flat.length <= WIDTH) return flat;
            return '[\n' + value.map((v) => pad + format(v, indent + 2, depth + 1)).join(',\n') +
                '\n' + ' '.repeat(indent) + ']';
        }
        if (value && typeof value === 'object') {
            const keys = Object.keys(value);
            if (keys.length === 0) return '{}';
            if (depth > 1) {
                const flat = inline(value);
                if (flat !== null && indent + flat.length <= WIDTH) return flat;
            }
            return '{\n' + keys.map((k) => pad + JSON.stringify(k) + ': ' +
                format(value[k], indent + 2, depth + 1)).join(',\n') +
                '\n' + ' '.repeat(indent) + '}';
        }
        return JSON.stringify(value);
    }

    const PLAIN_FILES = new Set(['pokemon', 'attacks', 'items', 'trainers']);
    const SMART_FILES = new Set(['events', 'locations']);

    function baseName(fileName) {
        return String(fileName || '').replace(/\.json$/, '');
    }

    function formatDataFile(fileName, data) {
        const name = baseName(fileName);

        if (PLAIN_FILES.has(name)) return JSON.stringify(data, null, 2) + '\n';
        if (SMART_FILES.has(name)) return format(data, 0, 0) + '\n';

        throw new Error(`formatDataFile: unknown file name "${fileName}"`);
    }

    const api = { formatDataFile };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.EditorFormat = api;
}());
