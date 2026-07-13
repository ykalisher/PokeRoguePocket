const fs = require('fs');
const readline = require('readline/promises');
const { stdin: input, stdout: output } = require('process');
const { PokeType } = require('./data_options');

const LOCATIONS_FILE = 'locations.json';

const HEX_PATTERN = /^#[0-9a-f]{6}$/i;

// Neutral palette used as defaults; keep in sync with NEUTRAL_LOCATION_THEME
// in arena/arena_data.js and the CLI defaults there.
const NEUTRAL_THEME = Object.freeze({
    accent: '#e0b84f',
    glow: '#4ab0a5',
    surface: '#232f3d',
    bgDeep: '#10161f',
    bgMid: '#1b2836'
});

const THEME_FIELDS = [
    ['accent', 'Accent hex'],
    ['glow', 'Glow hex'],
    ['surface', 'Surface hex'],
    ['bgDeep', 'Deep background hex'],
    ['bgMid', 'Mid background hex']
];

// Real, selectable pokemon types (NONE and LEGENDARY are not location types).
const SELECTABLE_TYPES = Object.values(PokeType).filter(type => type !== 'NONE' && type !== 'LEGENDARY');

async function main() {
    const rl = readline.createInterface({ input, output });

    try {
        const locations = readJsonArray(LOCATIONS_FILE);

        while (true) {
            console.log('\n--- Location Manager ---');
            console.log('1. Add Location');
            console.log('2. List Locations');
            console.log('3. Remove Location');
            console.log('4. Exit');

            const choice = (await rl.question('Select an option: ')).trim();

            if (choice === '1') {
                const location = await handleAddLocation(rl, locations);
                locations.push(location);
                writeLocations(locations);
                console.log(`Successfully added ${location.name} (${location.id}).`);
            } else if (choice === '2') {
                listLocations(locations);
            } else if (choice === '3') {
                const removed = await removeLocation(rl, locations);
                if (removed) {
                    writeLocations(locations);
                    console.log(`Removed ${removed.name} (${removed.id}).`);
                }
            } else if (choice === '4') {
                break;
            } else {
                console.log('Invalid choice, please try again.');
            }
        }
    } catch (error) {
        console.error('An error occurred:', error);
    } finally {
        rl.close();
    }
}

async function handleAddLocation(rl, locations) {
    const name = await askString(rl, 'Location name: ');
    const id = await askUniqueId(rl, locations, name);
    const terrain = await askString(rl, 'Terrain display label: ');
    const types = await askTypes(rl);
    const theme = await askTheme(rl);
    const background = await askBackground(rl, id);
    const enabled = await askBoolean(rl, 'Enable this location now? (y/n): ');

    return { id, name, terrain, types, theme, background, enabled };
}

async function askTypes(rl) {
    const types = [];

    while (true) {
        const remaining = SELECTABLE_TYPES.filter(type => !types.includes(type));
        console.log(`\nType ${types.length + 1} (chosen: ${types.join(', ') || 'none'}):`);
        remaining.forEach((type, index) => {
            console.log(`${index + 1}. ${type}`);
        });

        const prompt = types.length >= 2
            ? `Pick a number (1-${remaining.length}), or blank to finish: `
            : `Pick a number (1-${remaining.length}): `;
        const value = (await rl.question(prompt)).trim();

        if (value.length === 0) {
            if (types.length >= 2) return types;
            console.log('Select at least 2 types.');
            continue;
        }

        const index = parseInt(value, 10) - 1;
        if (isNaN(index) || index < 0 || index >= remaining.length) {
            console.log('Invalid selection. Please pick a number from the list.');
            continue;
        }

        types.push(remaining[index]);
        if (types.length >= 4) return types;
    }
}

async function askTheme(rl) {
    const theme = {};

    for (const [field, label] of THEME_FIELDS) {
        theme[field] = await askHex(rl, `${label} (default "${NEUTRAL_THEME[field]}"): `, NEUTRAL_THEME[field]);
    }

    return theme;
}

async function askHex(rl, prompt, fallback) {
    while (true) {
        const value = (await rl.question(prompt)).trim();
        if (value.length === 0) return fallback;
        if (HEX_PATTERN.test(value)) return value.toLowerCase();
        console.log('Please enter a 6-digit hex color like "#1a2b3c", or leave blank.');
    }
}

async function askBackground(rl, id) {
    const fallback = `assets/backgrounds/${id}.png`;
    const value = (await rl.question(`Background path (default "${fallback}"): `)).trim();
    return value.length > 0 ? value : fallback;
}

async function removeLocation(rl, locations) {
    if (locations.length === 0) {
        console.log('There are no locations.');
        return null;
    }

    listLocations(locations);

    const value = (await rl.question('Enter location number to remove (or "c" to cancel): ')).trim();
    if (value.toLowerCase() === 'c') return null;

    const index = parseInt(value, 10) - 1;
    if (isNaN(index) || index < 0 || index >= locations.length) {
        console.log('Invalid selection.');
        return null;
    }

    return locations.splice(index, 1)[0];
}

function listLocations(locations) {
    if (locations.length === 0) {
        console.log('No locations have been created.');
        return;
    }

    console.log('\n--- Current Locations ---');
    locations.forEach((location, index) => {
        const enabled = location.enabled === false ? 'disabled' : 'enabled';
        const types = Array.isArray(location.types) ? location.types.join('/') : '';
        console.log(`${index + 1}. ${location.name} | ${location.id} | ${types} | ${enabled}`);
    });
}

function readJsonArray(filePath) {
    if (!fs.existsSync(filePath)) return [];

    const data = fs.readFileSync(filePath, 'utf8').trim();
    if (data.length === 0) return [];

    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) {
        throw new Error(`${filePath} must contain a JSON array.`);
    }

    return parsed;
}

function writeLocations(locations) {
    fs.writeFileSync(LOCATIONS_FILE, `${JSON.stringify(locations, null, 2)}\n`);
}

async function askUniqueId(rl, locations, name) {
    const defaultId = formatId(name);
    const existingIds = new Set(locations.map(location => location.id));

    while (true) {
        const value = await askOptionalString(rl, `Location id (default "${defaultId}"): `);
        const id = formatId(value || defaultId);

        if (!id) {
            console.log('Id cannot be empty.');
        } else if (existingIds.has(id)) {
            console.log('That id is already in use.');
        } else {
            return id;
        }
    }
}

async function askString(rl, prompt) {
    while (true) {
        const value = (await rl.question(prompt)).trim();
        if (value.length > 0) return value;
        console.log('Input cannot be empty.');
    }
}

async function askOptionalString(rl, prompt) {
    return (await rl.question(prompt)).trim();
}

async function askBoolean(rl, prompt) {
    while (true) {
        const value = (await rl.question(prompt)).trim().toLowerCase();
        if (value === 'y') return true;
        if (value === 'n') return false;
        console.log('Please enter "y" for yes or "n".');
    }
}

function formatId(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

main();
