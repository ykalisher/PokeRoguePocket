const fs = require('fs');
const readline = require('readline/promises');
const { stdin: input, stdout: output } = require('process');
const { PokeType, Rank } = require('./data_options');

const TRAINERS_FILE = 'trainers.json';
const POKEMON_FILE = 'pokemon.json';
const ATTACKS_FILE = 'attacks.json';
const ITEMS_FILE = 'items.json';

async function main() {
    const rl = readline.createInterface({ input, output });

    try {
        const trainers = readJsonArray(TRAINERS_FILE);
        const pokemonList = readJsonArray(POKEMON_FILE);
        const attackList = readJsonArray(ATTACKS_FILE);
        const itemList = readJsonArray(ITEMS_FILE);

        validateRequiredData(pokemonList, attackList, itemList);

        while (true) {
            console.log('\n--- Trainer Manager ---');
            console.log('1. Add Trainer');
            console.log('2. Exit');

            const choice = (await rl.question('Select an option: ')).trim();

            if (choice === '1') {
                const trainer = await handleAddTrainer(rl, pokemonList, attackList, itemList);
                trainers.push(trainer);
                fs.writeFileSync(TRAINERS_FILE, JSON.stringify(trainers, null, 2));
                console.log(`Successfully added ${trainer.name}!`);
            } else if (choice === '2') {
                break;
            } else {
                console.log('Invalid choice, please try again.');
            }
        }
    } catch (err) {
        console.error('An error occurred:', err);
    } finally {
        rl.close();
    }
}

async function handleAddTrainer(rl, pokemonList, attackList, itemList) {
    const trainer = {};

    trainer.name = await askString(rl, 'Enter Trainer Name: ');
    trainer.sprite = await askString(rl, 'Enter Sprite Icon Name: ');
    trainer.cash = await askInt(rl, 'Enter Cash Amount: ');
    trainer.rank = await askEnum(rl, 'Select Rank', Rank);
    trainer.typeSpecialization = await askEnum(rl, 'Select Type Specialization', withoutNone(PokeType));

    const selectedPokemon = await askPokemonTeam(rl, pokemonList);
    trainer.pokemon = selectedPokemon.map(pokemon => pokemon.name);
    trainer.attacks = [];

    for (const pokemon of selectedPokemon) {
        const attacks = await askAttacksForPokemon(rl, pokemon, attackList);
        trainer.attacks.push(...attacks.map(attack => attack.name));
    }

    const selectedItems = await askFixedSelections(rl, {
        title: 'Items',
        prompt: 'Select Item',
        records: itemList,
        count: getItemCountForRank(trainer.rank),
        describe: describeItem,
        allowRepeats: true
    });
    trainer.items = selectedItems.map(item => item.name);

    return trainer;
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

function validateRequiredData(pokemonList, attackList, itemList) {
    if (pokemonList.length < 1) {
        throw new Error(`${POKEMON_FILE} must contain at least 1 Pokemon.`);
    }
    if (attackList.length < 1) {
        throw new Error(`${ATTACKS_FILE} must contain at least 1 attack.`);
    }
    if (itemList.length < 1) {
        throw new Error(`${ITEMS_FILE} must contain at least 1 item.`);
    }
}

async function askPokemonTeam(rl, pokemonList) {
    const selected = [];

    for (let i = 0; i < 3; i++) {
        const pokemon = await askRecordSelection(rl, {
            title: 'Pokemon',
            prompt: `Select Pokemon ${i + 1}`,
            records: pokemonList,
            describe: describePokemon,
            useIdForSelection: true
        });
        selected.push(pokemon);
    }

    while (selected.length < 6) {
        const shouldAdd = await askBoolean(rl, 'Do you want to add another Pokemon? (y/n): ');
        if (!shouldAdd) break;

        const pokemon = await askRecordSelection(rl, {
            title: 'Pokemon',
            prompt: `Select Pokemon ${selected.length + 1}`,
            records: pokemonList,
            describe: describePokemon,
            useIdForSelection: true
        });
        selected.push(pokemon);
    }

    return selected;
}

async function askAttacksForPokemon(rl, pokemon, attackList) {
    const learnableAttacks = attackList.filter(attack => pokemonCanLearnAttack(pokemon, attack));

    if (learnableAttacks.length === 0) {
        throw new Error(`${pokemon.name} cannot learn any attacks from ${ATTACKS_FILE}.`);
    }

    return askFixedSelections(rl, {
        title: `Attacks for ${pokemon.name}`,
        prompt: `Select Attack for ${pokemon.name}`,
        records: learnableAttacks,
        count: 4,
        describe: describeAttack,
        allowRepeats: true
    });
}

async function askFixedSelections(rl, options) {
    const selected = [];

    for (let i = 0; i < options.count; i++) {
        const record = await askRecordSelection(rl, {
            title: options.title,
            prompt: `${options.prompt} ${i + 1}`,
            records: options.records,
            describe: options.describe,
            unavailableNames: options.allowRepeats ? [] : selected.map(entry => entry.name)
        });
        selected.push(record);
    }

    return selected;
}

async function askRecordSelection(rl, options) {
    const unavailableNames = new Set(options.unavailableNames || []);
    let displayRecords = options.records;
    let idToRecord = null;

    if (options.useIdForSelection) {
        displayRecords = [...options.records].sort((a, b) => a.id.localeCompare(b.id));
        idToRecord = new Map();
        for (const record of displayRecords) {
            idToRecord.set(record.id, record);
            idToRecord.set(record.name, record);
        }
    }

    while (true) {
        console.log(`\n${options.title}:`);
        displayRecords.forEach((record, i) => {
            const disabled = unavailableNames.has(record.name) ? ' (already selected)' : '';
            if (options.useIdForSelection) {
                console.log(`${record.id}. ${options.describe(record)}${disabled}`);
            } else {
                console.log(`${i + 1}. ${options.describe(record)}${disabled}`);
            }
        });

        let prompt = options.prompt;
        if (options.useIdForSelection) {
            const ids = displayRecords.map(r => r.id);
            prompt = `${options.prompt} (enter ID or name, e.g., ${ids[0]}-${ids[ids.length-1]})`;
        } else {
            prompt = `${options.prompt} (1-${displayRecords.length})`;
        }

        const input = (await rl.question(`${prompt}: `)).trim();
        
        if (options.useIdForSelection) {
            const record = idToRecord.get(input);
            if (record) {
                if (unavailableNames.has(record.name)) {
                    console.log('That option has already been selected.');
                    continue;
                }
                return record;
            }
        } else {
            const index = parseInt(input, 10) - 1;
            if (!isNaN(index) && index >= 0 && index < displayRecords.length) {
                const record = displayRecords[index];
                if (unavailableNames.has(record.name)) {
                    console.log('That option has already been selected.');
                    continue;
                }
                return record;
            }
        }

        console.log('Invalid selection. Please pick a valid option from the list.');
    }
}

async function askString(rl, prompt) {
    while (true) {
        const value = (await rl.question(prompt)).trim();
        if (value.length > 0) return value;
        console.log('Input cannot be empty.');
    }
}

async function askInt(rl, prompt) {
    while (true) {
        const value = (await rl.question(prompt)).trim();
        const number = parseInt(value, 10);

        if (!isNaN(number) && number >= 0) return number;
        console.log('Please enter a valid integer greater than or equal to 0.');
    }
}

async function askBoolean(rl, prompt) {
    while (true) {
        const value = (await rl.question(prompt)).trim().toLowerCase();
        if (value === 'y') return true;
        if (value === 'n') return false;
        console.log('Please enter "y" for yes or "n" for no.');
    }
}

async function askEnum(rl, label, enumObj) {
    const keys = Object.keys(enumObj);

    while (true) {
        console.log(`\n${label}:`);
        keys.forEach((key, i) => {
            console.log(`${i + 1}. ${enumObj[key]}`);
        });

        const input = (await rl.question(`Pick a number (1-${keys.length}): `)).trim();
        const index = parseInt(input, 10) - 1;

        if (!isNaN(index) && index >= 0 && index < keys.length) {
            return enumObj[keys[index]];
        }

        console.log('Invalid selection. Please pick a number from the list.');
    }
}

function getItemCountForRank(rank) {
    if (rank === Rank.STANDARD) return 3;
    if (rank === Rank.ACE || rank === Rank.SPECIAL) return 4;
    if (rank === Rank.BOSS || rank === Rank.ELITE) return 5;
    throw new Error(`Unknown trainer rank: ${rank}`);
}

function withoutNone(enumObj) {
    return Object.fromEntries(
        Object.entries(enumObj).filter(([key]) => key !== 'NONE')
    );
}

function describePokemon(pokemon) {
    const types = [pokemon.type1, pokemon.type2, pokemon.type3]
        .filter(type => type && type !== 'NONE')
        .join('/');
    const stats = [
        pokemon.baseHealth,
        pokemon.baseAttack,
        pokemon.baseDefense,
        pokemon.baseSpeed
    ].map(value => Number(value) || 0).join('/');

    return `${pokemon.name} | ${types || 'NONE'} | ${stats}`;
}

function describeAttack(attack) {
    const types = getRecordTypes(attack, ['type1', 'type2']).join('/');
    const statChangeCount = Array.isArray(attack.statChanges) ? attack.statChanges.length : 0;
    return `${attack.name} | ${types || 'NONE'} | Power ${Number(attack.basePower) || 0} | Status ${attack.status || 'NONE'} | Stat Changes ${statChangeCount}`;
}

function describeItem(item) {
    return item.name;
}

function pokemonCanLearnAttack(pokemon, attack) {
    const pokemonTypes = getRecordTypes(pokemon, ['type1', 'type2', 'type3']);
    const requiredTypes = getRecordTypes(attack, ['type1', 'type2']);

    if (requiredTypes.length === 0) return true;

    if (attack.full_type_requirements) {
        return requiredTypes.every(type => pokemonTypes.includes(type));
    }

    return requiredTypes.some(type => pokemonTypes.includes(type));
}

function getRecordTypes(record, typeKeys) {
    const types = Array.isArray(record.types)
        ? record.types
        : typeKeys.map(key => record[key]);

    return types.filter(type => type && type !== 'NONE');
}

if (require.main === module) {
    main();
}
