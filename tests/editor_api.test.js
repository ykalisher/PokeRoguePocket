'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { ROOT } = require('./helpers/arena_env');
const { createServer } = require('../dev/editor/server.js');
const { formatDataFile } = require('../dev/editor/format_json.js');

const FILE_NAMES = ['pokemon', 'attacks', 'items', 'trainers', 'events', 'locations', 'starter_decks'];

// Seeds a fixture data dir from the real, already-valid root JSON files
// (simpler than hand-rolling minimal fixtures, and it satisfies the
// roster/graph dataset rules for free — see 27-editor-server.md step 3).
function makeFixtureDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-api-'));
    FILE_NAMES.forEach((name) => {
        fs.copyFileSync(path.join(ROOT, `${name}.json`), path.join(dir, `${name}.json`));
    });
    return dir;
}

function bootServer(dataDir) {
    return new Promise((resolve) => {
        const server = createServer({ dataDir });
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

function closeServer(server) {
    return new Promise((resolve) => server.close(resolve));
}

function baseUrl(server) {
    return `http://127.0.0.1:${server.address().port}`;
}

// The server only checks the magic bytes, so the remainder is arbitrary.
const PNG_BYTES = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('fake-png-body-for-tests')
]);

// Sends a raw HTTP request with an unnormalized path. fetch() would resolve
// ".." segments client-side via the WHATWG URL parser before the request
// ever reaches the wire, so a real traversal attempt needs the raw client.
function rawGet(port, rawPath) {
    return new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, path: rawPath, method: 'GET' }, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
        });
        req.on('error', reject);
        req.end();
    });
}

// ---------------------------------------------------------- shared fixture
// Read-only-JSON tests (never PUT to a data file) share one server; tests
// that mutate a data file boot their own isolated fixture + server so they
// can't see each other's writes.

let sharedDir;
let sharedServer;
let sharedUrl;

before(async () => {
    sharedDir = makeFixtureDir();
    sharedServer = await bootServer(sharedDir);
    sharedUrl = baseUrl(sharedServer);
});

after(async () => {
    await closeServer(sharedServer);
});

// --------------------------------------------------------------- /api/data

test('GET /api/data returns the seven data arrays intact, including starter_decks', async () => {
    const res = await fetch(`${sharedUrl}/api/data`);
    assert.equal(res.status, 200);
    const body = await res.json();
    FILE_NAMES.forEach((name) => {
        const onDisk = JSON.parse(fs.readFileSync(path.join(sharedDir, `${name}.json`), 'utf8'));
        assert.deepEqual(body[name], onDisk);
    });
});

test('PUT /api/data/pokemon with a benign edit writes a byte-exact formatted file', async () => {
    const dataDir = makeFixtureDir();
    const server = await bootServer(dataDir);
    try {
        const url = baseUrl(server);
        const data = await (await fetch(`${url}/api/data`)).json();
        const pokemon = data.pokemon;
        pokemon[0] = { ...pokemon[0], baseHealth: pokemon[0].baseHealth + 1 };

        const putRes = await fetch(`${url}/api/data/pokemon`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(pokemon)
        });
        assert.equal(putRes.status, 200);
        assert.deepEqual(await putRes.json(), { ok: true, count: pokemon.length });

        const onDisk = fs.readFileSync(path.join(dataDir, 'pokemon.json'), 'utf8');
        assert.equal(onDisk, formatDataFile('pokemon', pokemon));
    } finally {
        await closeServer(server);
    }
});

test('PUT /api/data/pokemon removing a trainer-referenced pokemon is blocked; ?force=1 allows it', async () => {
    const dataDir = makeFixtureDir();
    const server = await bootServer(dataDir);
    try {
        const url = baseUrl(server);
        const data = await (await fetch(`${url}/api/data`)).json();
        const referencedName = data.trainers.flatMap((trainer) => trainer.pokemon)[0];
        assert.ok(referencedName, 'fixture must have at least one trainer with a pokemon');
        const withoutIt = data.pokemon.filter((record) => record.name !== referencedName);

        const blockedRes = await fetch(`${url}/api/data/pokemon`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(withoutIt)
        });
        assert.equal(blockedRes.status, 409);
        const blockedBody = await blockedRes.json();
        assert.equal(blockedBody.blocked, true);
        assert.ok(blockedBody.issues.some((issue) => issue.code === 'trainers.unknown-pokemon'));

        const untouched = JSON.parse(fs.readFileSync(path.join(dataDir, 'pokemon.json'), 'utf8'));
        assert.equal(untouched.length, data.pokemon.length, 'a blocked write must not touch disk');

        const forcedRes = await fetch(`${url}/api/data/pokemon?force=1`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(withoutIt)
        });
        assert.equal(forcedRes.status, 200);
        const forced = JSON.parse(fs.readFileSync(path.join(dataDir, 'pokemon.json'), 'utf8'));
        assert.equal(forced.length, withoutIt.length);
    } finally {
        await closeServer(server);
    }
});

test('PUT /api/data/starter_decks with a valid array writes the file', async () => {
    const dataDir = makeFixtureDir();
    const server = await bootServer(dataDir);
    try {
        const url = baseUrl(server);
        const data = await (await fetch(`${url}/api/data`)).json();
        const decks = data.starter_decks;
        decks[0] = { ...decks[0], name: `${decks[0].name} Deluxe` };

        const putRes = await fetch(`${url}/api/data/starter_decks`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(decks)
        });
        assert.equal(putRes.status, 200);
        assert.deepEqual(await putRes.json(), { ok: true, count: decks.length });

        const onDisk = fs.readFileSync(path.join(dataDir, 'starter_decks.json'), 'utf8');
        assert.equal(onDisk, formatDataFile('starter_decks', decks));
    } finally {
        await closeServer(server);
    }
});

test('PUT /api/data/starter_decks introducing an unknown pokemon name is blocked with a 409', async () => {
    const dataDir = makeFixtureDir();
    const server = await bootServer(dataDir);
    try {
        const url = baseUrl(server);
        const data = await (await fetch(`${url}/api/data`)).json();
        const decks = data.starter_decks;
        decks[0] = { ...decks[0], pokemon: [...decks[0].pokemon, 'Not A Real Pokemon'] };

        const res = await fetch(`${url}/api/data/starter_decks`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(decks)
        });
        assert.equal(res.status, 409);
        const body = await res.json();
        assert.equal(body.blocked, true);
        assert.ok(body.issues.some((issue) => issue.code === 'starterDecks.unknown-pokemon'));

        const untouched = JSON.parse(fs.readFileSync(path.join(dataDir, 'starter_decks.json'), 'utf8'));
        assert.equal(untouched.length, data.starter_decks.length);
    } finally {
        await closeServer(server);
    }
});

test('PUT with a malformed JSON body returns 400', async () => {
    const res = await fetch(`${sharedUrl}/api/data/pokemon`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: '{not valid json'
    });
    assert.equal(res.status, 400);
});

test('PUT to an unknown file name returns 404', async () => {
    const res = await fetch(`${sharedUrl}/api/data/nonsense`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: '[]'
    });
    assert.equal(res.status, 404);
});

test('POST /api/data/x returns 405', async () => {
    const res = await fetch(`${sharedUrl}/api/data/x`, { method: 'POST', body: '[]' });
    assert.equal(res.status, 405);
});

// -------------------------------------------------------------- /api/enums

test('GET /api/enums returns the five ranks, 14 effect types, and non-empty engine refs', async () => {
    const res = await fetch(`${sharedUrl}/api/enums`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.Rank, ['Standard', 'Ace', 'Special', 'Boss', 'Elite']);
    assert.equal(body.effectTypes.length, 14);
    assert.ok(body.engineRefs.defaultDeck.pokemon.length > 0);
});

// ------------------------------------------------------------- /api/issues

test('GET /api/issues reports zero errors for the live-seeded fixture', async () => {
    const res = await fetch(`${sharedUrl}/api/issues`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.counts);
    assert.equal(body.counts.error, 0);
});

// ------------------------------------------------------------------ static

test('GET /arena/arena_render.js serves the static file with a JS-ish content type', async () => {
    const res = await fetch(`${sharedUrl}/arena/arena_render.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /javascript/);
    assert.ok((await res.text()).length > 0);
});

test('static responses carry revalidation headers and honor If-None-Match with a 304', async () => {
    const res = await fetch(`${sharedUrl}/arena/arena_render.js`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-cache');
    assert.ok(res.headers.get('last-modified'));
    const etag = res.headers.get('etag');
    assert.match(etag, /^".+"$/);
    assert.equal(Number(res.headers.get('content-length')), Buffer.byteLength(await res.text()));

    const revalidated = await fetch(`${sharedUrl}/arena/arena_render.js`, {
        headers: { 'If-None-Match': etag }
    });
    assert.equal(revalidated.status, 304);
    assert.equal(await revalidated.text(), '');
    assert.equal(revalidated.headers.get('etag'), etag);

    const missed = await fetch(`${sharedUrl}/arena/arena_render.js`, {
        headers: { 'If-None-Match': '"stale-etag"' }
    });
    assert.equal(missed.status, 200);
    assert.ok((await missed.text()).length > 0);
});

test('an encoded ../ traversal path is rejected without leaking file contents', async () => {
    const res = await fetch(`${sharedUrl}/..%2f..%2fetc%2fpasswd`);
    assert.ok([400, 404].includes(res.status));
    assert.ok(!(await res.text()).includes('root:'));
});

test('a literal ../ traversal path is rejected without leaking file contents', async () => {
    const { status, body } = await rawGet(sharedServer.address().port, '/../../../../../../etc/passwd');
    assert.ok([400, 404].includes(status));
    assert.ok(!body.includes('root:'));
});

// ----------------------------------------------------------------- uploads

test('uploading a valid PNG to backgrounds/<location id> succeeds', async () => {
    const data = await (await fetch(`${sharedUrl}/api/data`)).json();
    const locationId = data.locations[0].id;

    const res = await fetch(`${sharedUrl}/api/assets/backgrounds/${encodeURIComponent(locationId)}`, {
        method: 'POST',
        body: PNG_BYTES
    });
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), { ok: true, path: `assets/backgrounds/${locationId}.png` });
    assert.ok(fs.existsSync(path.join(sharedDir, 'assets', 'backgrounds', `${locationId}.png`)));
});

test('uploading to an unknown location returns 404', async () => {
    const res = await fetch(`${sharedUrl}/api/assets/backgrounds/not-a-real-location`, {
        method: 'POST',
        body: PNG_BYTES
    });
    assert.equal(res.status, 404);
});

test('uploading to a disallowed dir (types-svgs) returns 400', async () => {
    const res = await fetch(`${sharedUrl}/api/assets/types-svgs/FIRE`, { method: 'POST', body: PNG_BYTES });
    assert.equal(res.status, 400);
});

test('uploading a body without PNG magic bytes returns 400', async () => {
    const data = await (await fetch(`${sharedUrl}/api/data`)).json();
    const pokemonName = data.pokemon[0].name;

    const res = await fetch(`${sharedUrl}/api/assets/portraits/${encodeURIComponent(pokemonName)}`, {
        method: 'POST',
        body: Buffer.from('not a png')
    });
    assert.equal(res.status, 400);
});

test('uploading a body over 5 MB returns 413', async () => {
    const data = await (await fetch(`${sharedUrl}/api/data`)).json();
    const pokemonName = data.pokemon[1].name;

    const oversized = Buffer.concat([PNG_BYTES, Buffer.alloc(5 * 1024 * 1024)]);
    const res = await fetch(`${sharedUrl}/api/assets/portraits/${encodeURIComponent(pokemonName)}`, {
        method: 'POST',
        body: oversized
    });
    assert.equal(res.status, 413);
});
