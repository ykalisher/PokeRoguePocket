/**
 * Data editor local server: static repo serving + JSON API + write guard +
 * PNG uploads. Node built-ins only (http, fs, path). See
 * dev/feature_plans/25-data-editor-overview.md ("Server + HTTP API") for the
 * full contract this file implements.
 *
 * Usage: node dev/editor/server.js [--port N] [--data-dir <path>]
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

// ------------------------------------------------------------ engine load
// Loaded once, at require time, the same window-shim trick used by
// tests/helpers/arena_env.js. Order matters: trainer_sprites.js has no
// dependencies; arena_data.js's normalizeTrainer() looks up
// window.PokeRogue.TrainerSprites lazily (call time, not load time) but we
// still load it first per the batch spec; locations.js has no dependencies
// on either.
globalThis.window = globalThis;
require('../../arena/trainer_sprites.js');
require('../../arena/arena_data.js');
require('../../map/locations.js');

const dataOptions = require('../../scripts/data_options');
const { formatDataFile } = require('./format_json.js');
const { validateAll } = require('./validate.js');

const resolveSpriteFile = (name, explicitSprite) =>
    window.PokeRogue.TrainerSprites.resolveSprite(name, explicitSprite).file;

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
        resolveSpriteFile
    };
}

const ENGINE_REFS = buildEngineRefs();

const EFFECT_TYPES = [
    'gain-cash', 'lose-cash', 'gain-card', 'gain-random-card', 'gain-random-baby',
    'lose-random-cards', 'lose-random-pokemon', 'remove-selected-card',
    'duplicate-selected-card', 'duplicate-random-card', 'replace-selected-card',
    'replace-random-card', 'trade-selected-pokemon', 'trade-random-pokemon'
];
const EVENT_TYPES = ['gift', 'choice', 'trainer'];
const EXTENSIONS = {
    attackTargets: ['TRAINER'],
    attackStatuses: ['EXTRA_ATTACK', 'EXTRA_ITEM', 'INCREASE_CAPACITY', 'REFRESH_DECK'],
    artificialAttackCap: 6
};

// Rank is a class with static fields (Object.values() yields nothing), so
// its five statics are serialized explicitly.
const ENUMS_PAYLOAD = {
    PokeType: dataOptions.PokeType,
    Status: dataOptions.Status,
    StatChange: dataOptions.StatChange,
    AttackTarget: dataOptions.AttackTarget,
    ItemTarget: dataOptions.ItemTarget,
    Rank: [dataOptions.Rank.STANDARD, dataOptions.Rank.ACE, dataOptions.Rank.SPECIAL, dataOptions.Rank.BOSS, dataOptions.Rank.ELITE],
    extensions: EXTENSIONS,
    effectTypes: EFFECT_TYPES,
    eventTypes: EVENT_TYPES,
    engineRefs: ENGINE_REFS
};

// -------------------------------------------------------------- constants

const FILE_NAMES = ['pokemon', 'attacks', 'items', 'trainers', 'events', 'locations'];
const UPLOAD_DIR_NAMES = ['portraits', 'sprites', 'items', 'backgrounds'];
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

// Reimplements formatAssetName() in arena/arena_data.js so this file never
// requires game code beyond the engine-load section above.
function formatAssetName(name) {
    return String(name || 'item')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

const UPLOAD_ROUTES = {
    portraits: {
        lookup: (data, key) => data.pokemon.find((record) => record.name === key),
        deriveFileName: (record) => `${record.name}.png`
    },
    sprites: {
        lookup: (data, key) => data.trainers.find((record) => record.name === key),
        deriveFileName: (record) => resolveSpriteFile(record.name, record.sprite)
    },
    items: {
        lookup: (data, key) => data.items.find((record) => record.name === key),
        deriveFileName: (record) => `${formatAssetName(record.name)}.png`
    },
    backgrounds: {
        lookup: (data, key) => data.locations.find((record) => record.id === key),
        deriveFileName: (record) => `${record.id}.png`
    }
};

// -------------------------------------------------------------- data I/O

function dataFilePath(dataDir, name) {
    return path.join(dataDir, `${name}.json`);
}

function readAllData(dataDir) {
    const data = {};
    FILE_NAMES.forEach((name) => {
        data[name] = JSON.parse(fs.readFileSync(dataFilePath(dataDir, name), 'utf8'));
    });
    return data;
}

function readDirSafe(dir) {
    try {
        return new Set(fs.readdirSync(dir));
    } catch (err) {
        return new Set();
    }
}

function buildAssetIndex(config) {
    return {
        portraits: readDirSafe(path.join(config.dataDir, 'assets', 'portraits')),
        sprites: readDirSafe(path.join(config.dataDir, 'assets', 'sprites')),
        items: readDirSafe(path.join(config.dataDir, 'assets', 'items')),
        backgrounds: readDirSafe(path.join(config.dataDir, 'assets', 'backgrounds'))
    };
}

function issueKey(issue) {
    return `${issue.code} ${issue.recordKey}`;
}

function dedupeIssues(issues) {
    const seen = new Set();
    return issues.filter((issue) => {
        const key = JSON.stringify(issue);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// ------------------------------------------------------------- HTTP helpers

function sendJson(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(body);
}

function parseRequestUrl(req) {
    const queryIndex = req.url.indexOf('?');
    const rawPath = queryIndex === -1 ? req.url : req.url.slice(0, queryIndex);
    const search = queryIndex === -1 ? '' : req.url.slice(queryIndex);
    return { rawPath, searchParams: new URLSearchParams(search) };
}

// Reads the full request body into a Buffer. Bytes beyond MAX_BODY_BYTES are
// dropped (not buffered) so memory stays capped, but the stream is drained
// to completion so the connection stays healthy; once drained, a 413 error
// is thrown for the caller to report.
function readRawBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        let tooLarge = false;

        req.on('data', (chunk) => {
            total += chunk.length;
            if (total > MAX_BODY_BYTES) {
                tooLarge = true;
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (tooLarge) {
                const err = new Error('request body exceeds 5 MB');
                err.status = 413;
                reject(err);
                return;
            }
            resolve(Buffer.concat(chunks));
        });
        req.on('error', reject);
    });
}

async function readJsonBody(req) {
    const buffer = await readRawBody(req);
    try {
        return JSON.parse(buffer.toString('utf8'));
    } catch (err) {
        const parseErr = new Error('malformed JSON body');
        parseErr.status = 400;
        throw parseErr;
    }
}

// --------------------------------------------------------------- static

function serveStatic(req, res, config, rawPath) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendJson(res, 405, { error: 'method not allowed' });
    }

    let pathname;
    try {
        pathname = decodeURIComponent(rawPath);
    } catch (err) {
        return sendJson(res, 400, { error: 'bad path' });
    }

    if (pathname === '/') {
        const indexPath = path.join(config.root, 'dev', 'editor', 'index.html');
        if (fs.existsSync(indexPath)) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            return res.end(req.method === 'HEAD' ? undefined : fs.readFileSync(indexPath));
        }
        res.writeHead(501, { 'Content-Type': 'text/plain' });
        return res.end(req.method === 'HEAD' ? undefined : 'editor UI arrives in phase 28');
    }

    const resolved = path.resolve(config.root, '.' + pathname);
    if (resolved !== config.root && !resolved.startsWith(config.root + path.sep)) {
        return sendJson(res, 404, { error: 'not found' });
    }

    let stat;
    try {
        stat = fs.statSync(resolved);
    } catch (err) {
        return sendJson(res, 404, { error: 'not found' });
    }
    if (!stat.isFile()) return sendJson(res, 404, { error: 'not found' });

    // no-cache + ETag: the browser may reuse its cached copy (thumbnails,
    // sprites, scripts) but must revalidate, so overwritten uploads and
    // edited files show up immediately — revalidations are empty 304s.
    const etag = `"${stat.size}-${Math.floor(stat.mtimeMs)}"`;
    const cacheHeaders = {
        'Cache-Control': 'no-cache',
        'ETag': etag,
        'Last-Modified': stat.mtime.toUTCString()
    };

    if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, cacheHeaders);
        return res.end();
    }

    const mime = MIME_TYPES[path.extname(resolved).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, Object.assign({ 'Content-Type': mime, 'Content-Length': stat.size }, cacheHeaders));
    return res.end(req.method === 'HEAD' ? undefined : fs.readFileSync(resolved));
}

// ----------------------------------------------------------------- /api/data

function handleGetData(res, config) {
    return sendJson(res, 200, readAllData(config.dataDir));
}

async function handlePutData(req, res, fileName, searchParams, config) {
    if (!FILE_NAMES.includes(fileName)) {
        return sendJson(res, 404, { error: `unknown file name "${fileName}"` });
    }

    const body = await readJsonBody(req);
    if (!Array.isArray(body)) {
        return sendJson(res, 400, { error: 'body must be a JSON array' });
    }

    const force = searchParams.get('force') === '1';

    if (!force) {
        const before = readAllData(config.dataDir);
        const after = { ...before, [fileName]: body };
        const assetIndex = buildAssetIndex(config);
        const validateOptions = { enums: ENUMS_PAYLOAD, assetIndex, engineRefs: ENGINE_REFS };

        const beforeErrors = validateAll(before, validateOptions).filter((issue) => issue.severity === 'error');
        const afterErrors = validateAll(after, validateOptions).filter((issue) => issue.severity === 'error');
        const beforeKeys = new Set(beforeErrors.map(issueKey));

        const targetFile = `${fileName}.json`;
        const inWrittenFile = afterErrors.filter((issue) => issue.file === targetFile);
        const newAnywhere = afterErrors.filter((issue) => !beforeKeys.has(issueKey(issue)));
        const blocking = dedupeIssues([...inWrittenFile, ...newAnywhere]);

        if (blocking.length > 0) {
            return sendJson(res, 409, { error: 'write blocked by validation errors', blocked: true, issues: blocking });
        }
    }

    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(dataFilePath(config.dataDir, fileName), formatDataFile(fileName, body));
    return sendJson(res, 200, { ok: true, count: body.length });
}

// ---------------------------------------------------------------- /api/assets

function handleGetAssets(res, config) {
    return sendJson(res, 200, {
        portraits: [...readDirSafe(path.join(config.dataDir, 'assets', 'portraits'))],
        sprites: [...readDirSafe(path.join(config.dataDir, 'assets', 'sprites'))],
        items: [...readDirSafe(path.join(config.dataDir, 'assets', 'items'))],
        backgrounds: [...readDirSafe(path.join(config.dataDir, 'assets', 'backgrounds'))],
        typesSvgs: [...readDirSafe(path.join(config.root, 'assets', 'types-svgs'))],
        statusIcons: [...readDirSafe(path.join(config.root, 'assets', 'status-icons'))]
    });
}

// ---------------------------------------------------------------- /api/issues

function handleGetIssues(res, config) {
    const data = readAllData(config.dataDir);
    const assetIndex = buildAssetIndex(config);
    const issues = validateAll(data, { enums: ENUMS_PAYLOAD, assetIndex, engineRefs: ENGINE_REFS });
    const counts = {
        error: issues.filter((issue) => issue.severity === 'error').length,
        warning: issues.filter((issue) => issue.severity === 'warning').length
    };
    return sendJson(res, 200, { issues, counts });
}

// ----------------------------------------------------------------- uploads

async function handleUpload(req, res, dir, rawKey, config) {
    // Drain the body (and enforce the 5 MB cap) before any other validation,
    // so the cap applies uniformly to every upload request.
    const buffer = await readRawBody(req);

    const route = UPLOAD_ROUTES[dir];
    if (!route) return sendJson(res, 400, { error: `unknown upload dir "${dir}"` });

    let key;
    try {
        key = decodeURIComponent(rawKey);
    } catch (err) {
        return sendJson(res, 400, { error: 'bad key' });
    }

    const data = readAllData(config.dataDir);
    const record = route.lookup(data, key);
    if (!record) return sendJson(res, 404, { error: `no ${dir} record for "${key}"` });

    if (buffer.length < 4 || !buffer.subarray(0, 4).equals(PNG_MAGIC)) {
        return sendJson(res, 400, { error: 'body is not a PNG (missing magic bytes)' });
    }

    const fileName = route.deriveFileName(record);
    const targetDir = path.join(config.dataDir, 'assets', dir);
    const targetPath = path.resolve(targetDir, fileName);
    if (targetPath !== targetDir && !targetPath.startsWith(targetDir + path.sep)) {
        return sendJson(res, 400, { error: 'invalid derived file name' });
    }

    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(targetPath, buffer);
    return sendJson(res, 201, { ok: true, path: `assets/${dir}/${fileName}` });
}

// ------------------------------------------------------------------- router

async function handleApi(req, res, rawPath, searchParams, config) {
    if (rawPath === '/api/data') {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
        return handleGetData(res, config);
    }

    const dataFileMatch = rawPath.match(/^\/api\/data\/([^/]+)$/);
    if (dataFileMatch) {
        if (req.method !== 'PUT') return sendJson(res, 405, { error: 'method not allowed' });
        return handlePutData(req, res, dataFileMatch[1], searchParams, config);
    }

    if (rawPath === '/api/enums') {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
        return sendJson(res, 200, ENUMS_PAYLOAD);
    }

    if (rawPath === '/api/assets') {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
        return handleGetAssets(res, config);
    }

    if (rawPath === '/api/issues') {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
        return handleGetIssues(res, config);
    }

    const uploadMatch = rawPath.match(/^\/api\/assets\/([^/]+)\/([^/]+)$/);
    if (uploadMatch) {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
        return handleUpload(req, res, uploadMatch[1], uploadMatch[2], config);
    }

    return sendJson(res, 404, { error: 'not found' });
}

async function handleRequest(req, res, config) {
    const { rawPath, searchParams } = parseRequestUrl(req);
    if (rawPath.startsWith('/api/')) return handleApi(req, res, rawPath, searchParams, config);
    return serveStatic(req, res, config, rawPath);
}

// --------------------------------------------------------------- entry points

function resolveConfig(options) {
    const root = options.root || REPO_ROOT;
    return {
        root,
        dataDir: options.dataDir || root,
        host: options.host || '127.0.0.1',
        port: options.port || 8932
    };
}

function createServer(options = {}) {
    const config = resolveConfig(options);

    const server = http.createServer((req, res) => {
        handleRequest(req, res, config).catch((err) => {
            if (res.headersSent) {
                res.end();
                return;
            }
            sendJson(res, err && err.status ? err.status : 500, { error: String((err && err.message) || err) });
        });
    });
    server.editorConfig = config;
    return server;
}

function parseArgs(argv) {
    const args = argv.slice(2);
    const parsed = {};
    for (let i = 0; i < args.length; i += 1) {
        if (args[i] === '--port') parsed.port = Number(args[i + 1]);
        else if (args[i] === '--data-dir') parsed.dataDir = args[i + 1];
    }
    return parsed;
}

function start(argv) {
    const { port, dataDir } = parseArgs(argv);
    const server = createServer({ port, dataDir });
    const { host, port: resolvedPort } = server.editorConfig;
    server.listen(resolvedPort, host, () => {
        console.log(`Data editor server running at http://${host}:${resolvedPort}/`);
    });
    return server;
}

if (require.main === module) start(process.argv);

module.exports = { createServer, start };
