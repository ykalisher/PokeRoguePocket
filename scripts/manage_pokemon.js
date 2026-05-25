const fs = require('fs');
const readline = require('readline/promises');
const { stdin: input, stdout: output } = require('process');
const { PokeType } = require('./data_options');

const JSON_FILE = 'pokemon.json';

async function main() {
    const rl = readline.createInterface({ input, output });

    try {
        let pokemonList = [];
        if (fs.existsSync(JSON_FILE)) {
            const data = fs.readFileSync(JSON_FILE, 'utf8');
            pokemonList = JSON.parse(data || '[]');
        }

        while (true) {
            console.log('\n--- Pokemon Manager ---');
            console.log('1. Add Pokemon');
            console.log('2. Remove Pokemon');
            console.log('3. Exit');
            
            const choice = (await rl.question('Select an option: ')).trim();

            if (choice === '1') {
                const newPokemon = await handleAddPokemon(rl);
                pokemonList.push(newPokemon);
                fs.writeFileSync(JSON_FILE, JSON.stringify(pokemonList, null, 2));
                console.log(`Successfully added ${newPokemon.name}!`);
            } else if (choice === '2') {
                if (pokemonList.length === 0) {
                    console.log('The list is currently empty.');
                    continue;
                }
                const index = await handleRemovePokemon(rl, pokemonList);
                if (index !== null) {
                    const removed = pokemonList.splice(index, 1);
                    fs.writeFileSync(JSON_FILE, JSON.stringify(pokemonList, null, 2));
                    console.log(`Successfully removed ${removed[0].name}!`);
                }
            } else if (choice === '3') {
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

async function handleAddPokemon(rl) {
    const pokemon = {};

    pokemon.name = await askString(rl, 'Enter Pokemon Name: ');
    pokemon.type1 = await askEnum(rl, 'Select Type 1', PokeType);
    pokemon.type2 = await askEnum(rl, 'Select Type 2', PokeType);
    pokemon.type3 = await askEnum(rl, 'Select Type 3', PokeType);
    pokemon.id = await askString(rl, 'Enter Pokemon ID: ');
    pokemon.baseHealth = await askInt(rl, 'Enter Base Health: ');
    pokemon.baseAttack = await askInt(rl, 'Enter Base Attack: ');
    pokemon.baseDefense = await askInt(rl, 'Enter Base Defense: ');
    pokemon.baseSpeed = await askInt(rl, 'Enter Base Speed: ');

    return pokemon;
}

async function handleRemovePokemon(rl, list) {
    console.log('\n--- Current Pokemon ---');
    list.forEach((p, i) => {
        console.log(`${i + 1}. ${p.name}`);
    });

    const input = (await rl.question('Enter the number of the Pokemon to remove (or "c" to cancel): ')).trim();
    if (input.toLowerCase() === 'c') return null;

    const index = parseInt(input, 10) - 1;
    if (isNaN(index) || index < 0 || index >= list.length) {
        console.log('Invalid selection.');
        return null;
    }
    return index;
}

async function askString(rl, prompt) {
    while (true) {
        const input = (await rl.question(prompt)).trim();
        if (input.length > 0) return input;
        console.log('Input cannot be empty.');
    }
}

async function askInt(rl, prompt) {
    while (true) {
        const input = (await rl.question(prompt)).trim();
        const val = parseInt(input, 10);
        if (!isNaN(val) && val > 0) return val;
        console.log('Please enter a valid integer greater than 0.');
    }
}

async function askEnum(rl, label, enumObj) {
    const keys = Object.keys(enumObj);
    while (true) {
        console.log(`\n${label}:`);
        keys.forEach((key, i) => {
            console.log(`${i + 1}. ${key}`);
        });

        const input = (await rl.question(`Pick a number (1-${keys.length}): `)).trim();
        const index = parseInt(input, 10) - 1;

        if (!isNaN(index) && index >= 0 && index < keys.length) {
            return enumObj[keys[index]];
        }
        console.log('Invalid selection. Please pick a number from the list.');
    }
}

main();
