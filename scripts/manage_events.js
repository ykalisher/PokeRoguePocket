const fs = require('fs');
const readline = require('readline/promises');
const { stdin: input, stdout: output } = require('process');
const { PokeType } = require('./data_options');

// Location types gate where an event may appear (matched against a location's
// types). NONE/LEGENDARY are never valid location types.
const LOCATION_TYPES = Object.freeze(
    Object.values(PokeType).filter(value => value !== 'NONE' && value !== 'LEGENDARY')
);

const EVENTS_FILE = 'events.json';
const POKEMON_FILE = 'pokemon.json';
const ATTACKS_FILE = 'attacks.json';
const ITEMS_FILE = 'items.json';
const TRAINERS_FILE = 'trainers.json';

const EventType = Object.freeze({
    GIFT: 'gift',
    CHOICE: 'choice',
    TRAINER: 'trainer'
});

const CardKind = Object.freeze({
    POKEMON: 'pokemon',
    ATTACK: 'attack',
    ITEM: 'item',
    ACTION: 'action'
});

async function main() {
    const rl = readline.createInterface({ input, output });

    try {
        const data = {
            attacks: readJsonArray(ATTACKS_FILE),
            events: readJsonArray(EVENTS_FILE),
            items: readJsonArray(ITEMS_FILE),
            pokemon: readJsonArray(POKEMON_FILE),
            trainers: readJsonArray(TRAINERS_FILE)
        };

        while (true) {
            console.log('\n--- Event Manager ---');
            console.log('1. Add Event');
            console.log('2. List Events');
            console.log('3. Remove Event');
            console.log('4. Exit');

            const choice = (await rl.question('Select an option: ')).trim();

            if (choice === '1') {
                const event = await handleAddEvent(rl, data);
                data.events.push(event);
                writeEvents(data.events);
                console.log(`Successfully added ${event.title} (${event.id}).`);
            } else if (choice === '2') {
                listEvents(data.events);
            } else if (choice === '3') {
                const removed = await removeEvent(rl, data.events);
                if (removed) {
                    writeEvents(data.events);
                    console.log(`Removed ${removed.title} (${removed.id}).`);
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

async function handleAddEvent(rl, data) {
    const type = await askEnum(rl, 'Select Event Type', EventType);
    const event = await askCommonEventFields(rl, data.events, type);

    if (type === 'gift') {
        event.buttonText = await askOptionalString(rl, 'Claim button text (default "Take reward"): ');
        event.effects = await askEffects(rl, data, []);
    } else if (type === 'choice') {
        event.choices = await askChoices(rl, data);
    } else if (type === 'trainer') {
        await fillTrainerEvent(rl, data, event);
    }

    event.enabled = await askBoolean(rl, 'Enable this event now? (y/n): ');

    return event;
}

async function askCommonEventFields(rl, events, type) {
    const event = { type };

    event.title = await askString(rl, 'Event title: ');
    event.id = await askUniqueId(rl, events, event.title);
    event.kicker = await askOptionalString(rl, 'Kicker label (optional): ');
    event.subtitle = await askOptionalString(rl, 'Short status line (optional): ');
    event.body = await askMultiline(rl, 'Event explanatory text');
    event.resultTitle = await askOptionalString(rl, 'Result title (optional): ');

    const types = await askLocationTypes(rl);
    if (types.length > 0) event.types = types;

    return event;
}

async function askLocationTypes(rl) {
    const types = [];

    console.log('\nLocation types gate where this event can appear (leave empty to allow anywhere).');

    while (true) {
        const remaining = LOCATION_TYPES.filter(value => !types.includes(value));
        if (remaining.length === 0) break;

        const value = await askOptionalEnum(rl, 'Add a location type (blank to finish)', remaining);
        if (!value) break;

        types.push(value);
    }

    return types;
}

async function askChoices(rl, data) {
    const choices = [];

    while (true) {
        const choiceNumber = choices.length + 1;
        const choice = {};

        choice.title = await askString(rl, `Choice ${choiceNumber} title: `);
        choice.id = formatId(choice.title);
        choice.description = await askOptionalString(rl, `Choice ${choiceNumber} explanation (optional): `);
        choice.buttonText = await askOptionalString(rl, `Choice ${choiceNumber} button text (default "Choose"): `);
        choice.requires = await askRequirements(rl);
        choice.effects = await askEffects(rl, data, choice.requires);
        choices.push(choice);

        if (choices.length >= 2) {
            const addAnother = await askBoolean(rl, 'Add another choice? (y/n): ');
            if (!addAnother) break;
        }
    }

    return choices;
}

async function fillTrainerEvent(rl, data, event) {
    const trainer = await askRecordSelection(rl, {
        title: 'Special Trainers',
        prompt: 'Select trainer',
        records: data.trainers,
        describe: trainer => `${trainer.name} | ${trainer.rank || 'Standard'} | ${Number(trainer.cash) || 0} coins`
    });

    event.trainerName = trainer.name;
    event.battleTitle = await askOptionalString(rl, 'Battle choice title (default "Battle"): ');
    event.battleText = await askOptionalString(rl, 'Battle choice explanation (optional): ');
    event.battleButtonText = await askOptionalString(rl, 'Battle button text (default "Battle"): ');

    const rewardCash = await askOptionalInt(rl, `Battle coin reward (blank for trainer cash ${Number(trainer.cash) || 0}): `);
    if (rewardCash !== null) event.rewardCash = rewardCash;

    console.log('\nBattle prize effects:');
    event.rewardEffects = await askEffects(rl, data, []);

    const hasPayment = await askBoolean(rl, 'Can the player pay to avoid the battle? (y/n): ');

    if (!hasPayment) return;

    event.payment = {};
    event.payment.title = await askOptionalString(rl, 'Payment choice title (default "Pay and leave"): ');
    event.payment.description = await askOptionalString(rl, 'Payment explanation (optional): ');
    event.payment.buttonText = await askOptionalString(rl, 'Payment button text (default "Pay"): ');
    event.payment.requires = await askRequirements(rl);
    console.log('\nPayment effects:');
    event.payment.effects = await askEffects(rl, data, event.payment.requires);
}

async function askRequirements(rl) {
    const requirements = [];

    while (await askBoolean(rl, 'Does this action require selecting a card? (y/n): ')) {
        const label = await askString(rl, 'Selection label: ');
        const cardKind = await askEnum(rl, 'Selection card kind', CardKind);
        const id = await askUniqueRequirementId(rl, requirements, label);

        requirements.push({
            cardKind,
            emptyText: `No ${cardKind} cards are available.`,
            id,
            label
        });
    }

    return requirements;
}

async function askEffects(rl, data, requirements) {
    const effects = [];

    while (true) {
        console.log('\nAdd Effect:');
        console.log('1. Gain cash');
        console.log('2. Lose/pay cash');
        console.log('3. Gain specific card');
        console.log('4. Gain random card');
        console.log('5. Lose random cards');
        console.log('6. Remove selected card');
        console.log('7. Duplicate selected card');
        console.log('8. Duplicate random card');
        console.log('9. Replace selected card with random card');
        console.log('10. Replace random card with random card');
        console.log('11. Trade selected Pokemon for random Pokemon');
        console.log('12. Trade random Pokemon for random Pokemon');
        console.log('13. Done');

        const choice = (await rl.question('Select an effect: ')).trim();
        const effect = await buildEffect(choice, rl, data, requirements);

        if (choice === '13') break;
        if (!effect) continue;

        effects.push(effect);
        console.log(`Added ${effect.type}.`);
    }

    return effects;
}

async function buildEffect(choice, rl, data, requirements) {
    if (choice === '1') {
        return {
            amount: await askInt(rl, 'Coins to gain: '),
            type: 'gain-cash'
        };
    }

    if (choice === '2') {
        return {
            amount: await askInt(rl, 'Coins to lose/pay: '),
            type: 'lose-cash'
        };
    }

    if (choice === '3') {
        const cardKind = await askEnum(rl, 'Card kind', withoutAction(CardKind));
        const record = await askCardRecord(rl, data, cardKind);

        return {
            cardKind,
            count: await askInt(rl, 'Number of copies: '),
            name: record.name,
            type: 'gain-card'
        };
    }

    if (choice === '4') {
        return {
            cardKind: await askEnum(rl, 'Random card kind', withoutAction(CardKind)),
            count: await askInt(rl, 'Number of random cards: '),
            type: 'gain-random-card'
        };
    }

    if (choice === '5') {
        return {
            cardKind: await askEnum(rl, 'Cards to lose', CardKind),
            count: await askInt(rl, 'Number of random cards to lose: '),
            strict: await askBoolean(rl, 'Require the player to have this many cards? (y/n): '),
            type: 'lose-random-cards'
        };
    }

    if (choice === '6') {
        const requirement = await askRequirementReference(rl, requirements);
        if (!requirement) return null;

        return {
            selectionId: requirement.id,
            type: 'remove-selected-card'
        };
    }

    if (choice === '7') {
        const requirement = await askRequirementReference(rl, requirements);
        if (!requirement) return null;

        return {
            selectionId: requirement.id,
            type: 'duplicate-selected-card'
        };
    }

    if (choice === '8') {
        return {
            cardKind: await askEnum(rl, 'Card kind to duplicate', CardKind),
            count: await askInt(rl, 'Number of random cards to duplicate: '),
            type: 'duplicate-random-card'
        };
    }

    if (choice === '9') {
        const requirement = await askRequirementReference(rl, requirements);
        if (!requirement) return null;

        return {
            replacement: { source: 'random' },
            selectionId: requirement.id,
            type: 'replace-selected-card'
        };
    }

    if (choice === '10') {
        return {
            cardKind: await askEnum(rl, 'Card kind to replace', withoutAction(CardKind)),
            count: await askInt(rl, 'Number of random cards to replace: '),
            replacement: { source: 'random' },
            type: 'replace-random-card'
        };
    }

    if (choice === '11') {
        const pokemonRequirements = requirements.filter(requirement => requirement.cardKind === 'pokemon');
        const requirement = await askRequirementReference(rl, pokemonRequirements);
        if (!requirement) return null;

        return {
            replacement: { cardKind: 'pokemon', source: 'random' },
            selectionId: requirement.id,
            type: 'trade-selected-pokemon'
        };
    }

    if (choice === '12') {
        return {
            replacement: { cardKind: 'pokemon', source: 'random' },
            type: 'trade-random-pokemon'
        };
    }

    if (choice !== '13') {
        console.log('Invalid effect.');
    }

    return null;
}

async function askCardRecord(rl, data, cardKind) {
    const records = getCardRecords(data, cardKind);

    return askRecordSelection(rl, {
        title: `${cardKind} cards`,
        prompt: `Select ${cardKind}`,
        records,
        describe: record => record.name
    });
}

async function askRequirementReference(rl, requirements) {
    if (!requirements || requirements.length === 0) {
        console.log('Add a matching card selection requirement before using a selected-card effect.');
        return null;
    }

    return askRecordSelection(rl, {
        title: 'Selection Requirements',
        prompt: 'Select requirement',
        records: requirements,
        describe: requirement => `${requirement.label} (${requirement.cardKind})`
    });
}

async function askRecordSelection(rl, options) {
    if (!Array.isArray(options.records) || options.records.length === 0) {
        throw new Error(`${options.title} has no records.`);
    }

    while (true) {
        console.log(`\n${options.title}:`);
        options.records.forEach((record, index) => {
            console.log(`${index + 1}. ${options.describe(record)}`);
        });

        const input = (await rl.question(`${options.prompt} (1-${options.records.length}): `)).trim();
        const index = parseInt(input, 10) - 1;

        if (!isNaN(index) && index >= 0 && index < options.records.length) {
            return options.records[index];
        }

        console.log('Invalid selection. Please pick a number from the list.');
    }
}

async function removeEvent(rl, events) {
    if (events.length === 0) {
        console.log('There are no events.');
        return null;
    }

    listEvents(events);

    const input = (await rl.question('Enter event number to remove (or "c" to cancel): ')).trim();
    if (input.toLowerCase() === 'c') return null;

    const index = parseInt(input, 10) - 1;

    if (isNaN(index) || index < 0 || index >= events.length) {
        console.log('Invalid selection.');
        return null;
    }

    return events.splice(index, 1)[0];
}

function listEvents(events) {
    if (events.length === 0) {
        console.log('No events have been created.');
        return;
    }

    console.log('\n--- Current Events ---');
    events.forEach((event, index) => {
        const enabled = event.enabled === false ? 'disabled' : 'enabled';
        const types = Array.isArray(event.types) && event.types.length > 0 ? event.types.join('/') : 'any';
        console.log(`${index + 1}. ${event.title} | ${event.type} | ${event.id} | ${enabled} | ${types}`);
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

function writeEvents(events) {
    fs.writeFileSync(EVENTS_FILE, `${JSON.stringify(events, null, 2)}\n`);
}

async function askUniqueId(rl, events, title) {
    const defaultId = formatId(title);
    const existingIds = new Set(events.map(event => event.id));

    while (true) {
        const value = await askOptionalString(rl, `Event id (default "${defaultId}"): `);
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

async function askUniqueRequirementId(rl, requirements, label) {
    const defaultId = formatId(label);
    const existingIds = new Set(requirements.map(requirement => requirement.id));

    while (true) {
        const value = await askOptionalString(rl, `Selection id (default "${defaultId}"): `);
        const id = formatId(value || defaultId);

        if (!id) {
            console.log('Id cannot be empty.');
        } else if (existingIds.has(id)) {
            console.log('That id is already in use for this action.');
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

async function askMultiline(rl, label) {
    console.log(`${label}. Enter one or more lines, then submit a blank line to finish:`);

    const lines = [];

    while (true) {
        const line = await rl.question('> ');

        if (line.trim().length === 0) {
            if (lines.length > 0) break;
            console.log('Text cannot be empty.');
            continue;
        }

        lines.push(line);
    }

    return lines.join('\n');
}

async function askInt(rl, prompt) {
    while (true) {
        const value = (await rl.question(prompt)).trim();
        const number = parseInt(value, 10);

        if (!isNaN(number) && number >= 0) return number;
        console.log('Please enter a valid integer greater than or equal to 0.');
    }
}

async function askOptionalInt(rl, prompt) {
    while (true) {
        const value = (await rl.question(prompt)).trim();
        if (value.length === 0) return null;

        const number = parseInt(value, 10);
        if (!isNaN(number) && number >= 0) return number;

        console.log('Please enter a valid integer greater than or equal to 0, or leave blank.');
    }
}

async function askBoolean(rl, prompt) {
    while (true) {
        const value = (await rl.question(prompt)).trim().toLowerCase();
        if (value === 'y') return true;
        if (value === 'n') return false;
        console.log('Please enter "y" for yes or "n".');
    }
}

async function askEnum(rl, label, enumObj) {
    const entries = Object.entries(enumObj);

    while (true) {
        console.log(`\n${label}:`);
        entries.forEach(([, value], index) => {
            console.log(`${index + 1}. ${value}`);
        });

        const input = (await rl.question(`Pick a number (1-${entries.length}): `)).trim();
        const index = parseInt(input, 10) - 1;

        if (!isNaN(index) && index >= 0 && index < entries.length) {
            return entries[index][1];
        }

        console.log('Invalid selection. Please pick a number from the list.');
    }
}

async function askOptionalEnum(rl, label, values) {
    while (true) {
        console.log(`\n${label}:`);
        values.forEach((value, index) => {
            console.log(`${index + 1}. ${value}`);
        });

        const raw = (await rl.question(`Pick a number (1-${values.length}, blank to finish): `)).trim();
        if (raw.length === 0) return '';

        const index = parseInt(raw, 10) - 1;
        if (!isNaN(index) && index >= 0 && index < values.length) {
            return values[index];
        }

        console.log('Invalid selection. Please pick a number from the list.');
    }
}

function getCardRecords(data, cardKind) {
    if (cardKind === 'pokemon') return data.pokemon;
    if (cardKind === 'attack') return data.attacks;
    if (cardKind === 'item') return data.items;

    return data.attacks;
}

function withoutAction(enumObj) {
    return Object.fromEntries(
        Object.entries(enumObj).filter(([, value]) => value !== 'action')
    );
}

function formatId(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

main();
