const fs = require('fs');
const readline = require('readline/promises');
const { stdin: input, stdout: output } = require('process');
const { AttackTarget, PokeType, StatChange, Status } = require('./data_options');

const JSON_FILE = 'attacks.json';

async function main() {
    const rl = readline.createInterface({ input, output });

    try {
        let attackList = [];
        if (fs.existsSync(JSON_FILE)) {
            const data = fs.readFileSync(JSON_FILE, 'utf8');
            attackList = JSON.parse(data || '[]');
        }

        while (true) {
            console.log('\n--- Attack Manager ---');
            console.log('1. Add Attack');
            console.log('2. Remove Attack');
            console.log('3. Exit');
            
            const choice = (await rl.question('Select an option: ')).trim();

            if (choice === '1') {
                const newAttack = await handleAddAttack(rl);
                attackList.push(newAttack);
                fs.writeFileSync(JSON_FILE, JSON.stringify(attackList, null, 2));
                console.log(`Successfully added ${newAttack.name}!`);
            } else if (choice === '2') {
                if (attackList.length === 0) {
                    console.log('The list is currently empty.');
                    continue;
                }
                const index = await handleRemoveAttack(rl, attackList);
                if (index !== null) {
                    const removed = attackList.splice(index, 1);
                    fs.writeFileSync(JSON_FILE, JSON.stringify(attackList, null, 2));
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

async function handleAddAttack(rl) {
    const attack = {};

    attack.name = await askString(rl, 'Enter Attack Name: ');
    attack.type1 = await askEnum(rl, 'Select Type 1', PokeType);
    attack.type2 = await askEnum(rl, 'Select Type 2', PokeType);
    attack.basePower = await askInt(rl, 'Enter Base Power: ');
    attack.status = await askEnum(rl, 'Select Status Effect', Status);
    
    attack.statChanges = await askEnumArray(rl, 'Stat Changes', StatChange);
    
    attack.target = await askEnum(rl, 'Select Target', AttackTarget);
    attack.full_type_requirements = await askBoolean(rl, 'Does this attack have full type requirements? (y/n): ');

    return attack;
}

async function handleRemoveAttack(rl, list) {
    console.log('\n--- Current Attacks ---');
    list.forEach((a, i) => {
        console.log(`${i + 1}. ${a.name}`);
    });

    const input = (await rl.question('Enter the number of the Attack to remove (or "c" to cancel): ')).trim();
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
        if (!isNaN(val) && val >= 0) return val;
        console.log('Please enter a valid integer greater than or equal to 0.');
    }
}

async function askBoolean(rl, prompt) {
    while (true) {
        const input = (await rl.question(prompt)).trim().toLowerCase();
        if (input === 'y') return true;
        if (input === 'n') return false;
        console.log('Please enter "y" for yes or "n" for no.');
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

async function askEnumArray(rl, label, enumObj) {
    const selected = [];
    while (true) {
        const input = (await rl.question(`Do you want to add a ${label} effect? (y/n): `)).trim().toLowerCase();
        if (input !== 'y') break;

        const value = await askEnum(rl, `Select ${label}`, enumObj);
        selected.push(value);
    }
    return selected;
}

main();
