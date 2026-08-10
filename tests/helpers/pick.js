'use strict';

/**
 * Selects a record out of live data by predicate rather than by hardcoded name.
 *
 * A test that anchors a fixture on a specific authored record ("Numel",
 * "sitrus-berry-tree") breaks the moment the owner renames or retires it — and a
 * bare find() returning undefined throws an unreadable TypeError two lines later,
 * so the failure never says what actually went stale. The label fixes that.
 *
 * See the "Test conventions" section of CLAUDE.md.
 */

const assert = require('node:assert/strict');

function pick(records, predicate, label) {
    const list = Array.isArray(records) ? records : [];
    const record = list.find(predicate);

    assert.ok(record, `expected the live data to contain ${label}`);
    return record;
}

// Same contract, for the callers that need to splice the record back out.
function pickIndex(records, predicate, label) {
    const list = Array.isArray(records) ? records : [];
    const index = list.findIndex(predicate);

    assert.ok(index !== -1, `expected the live data to contain ${label}`);
    return index;
}

module.exports = { pick, pickIndex };
