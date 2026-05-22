const fs = require('fs');
const readline = require('readline/promises');
const { stdin: input, stdout: output } = require('process');

const JSON_FILE = 'items.json';

const Status = Object.freeze({
    BURN: 'BURN',
    CONFUSION: 'CONFUSION',
    FATIGUE: 'FATIGUE',
    FLINCH: 'FLINCH',
    HEAL: 'HEAL',
    HEAL_BURN: 'HEAL_BURN',
    HEAL_STATUS: 'HEAL_STATUS',
    MULTI_ATTACK: 'MULTI_ATTACK',
    PARALYSIS: 'PARALYSIS',
    POISON: 'POISON',
    PROTECT: 'PROTECT',
    SLEEP: 'SLEEP',
    SWITCH: 'SWITCH',
    NONE: 'NONE'
});

const StatChange = Object.freeze({
    ATTACK_UP: 'ATTACK_UP',
    DEFENSE_UP: 'DEFENSE_UP',
    SPEED_UP: 'SPEED_UP',
    ATTACK_DOWN: 'ATTACK_DOWN',
    DEFENSE_DOWN: 'DEFENSE_DOWN',
    SPEED_DOWN: 'SPEED_DOWN'
});

const Target = Object.freeze({
    SELF: 'SELF',
    ALLY: 'ALLY',
    ALL_ALLIES: 'ALL_ALLIES',
    OPPONENT: 'OPPONENT',
    ALL_OPPONENTS: 'ALL_OPPONENTS'
});

async function main() {
    const rl = readline.createInterface({ input, output });

    try {
        let itemList = [];
        if (fs.existsSync(JSON_FILE)) {
            const data = fs.readFileSync(JSON_FILE, 'utf8');
            itemList = JSON.parse(data || '[]');
        }

        while (true) {
            console.log('\n--- Item Manager ---');
            console.log('1. Add Item');
            console.log('2. Remove Item');
            console.log('3. Exit');
            
            const choice = (await rl.question('Select an option: ')).trim();

            if (choice === '1') {
                const newItem = await handleAddItem(rl);
                itemList.push(newItem);
                fs.writeFileSync(JSON_FILE, JSON.stringify(itemList, null, 2));
                console.log(`Successfully added ${newItem.name}!`);
            } else if (choice === '2') {
                if (itemList.length === 0) {
                    console.log('The list is currently empty.');
                    continue;
                }
                const index = await handleRemoveItem(rl, itemList);
                if (index !== null) {
                    const removed = itemList.splice(index, 1);
                    fs.writeFileSync(JSON_FILE, JSON.stringify(itemList, null, 2));
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

async function handleAddItem(rl) {
    const item = {};

    item.name = await askString(rl, 'Enter Item Name: ');
    item.target = await askEnum(rl, 'Select Target', Target);
    item.status = await askEnumArray(rl, 'Status Effects', Status);
    item.statChanges = await askEnumArray(rl, 'Stat Changes', StatChange);

    return item;
}

async function handleRemoveItem(rl, list) {
    console.log('\n--- Current Items ---');
    list.forEach((item, i) => {
        console.log(`${i + 1}. ${item.name}`);
    });

    const input = (await rl.question('Enter the number of the Item to remove (or "c" to cancel): ')).trim();
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
