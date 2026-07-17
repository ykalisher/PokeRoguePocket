/**
 * Pokemon Rogue Pocket - shared event helpers
 */

(function attachPokeEvents(global) {
    'use strict';

    const EVENT_TYPES = ['gift', 'choice', 'trainer'];
    const CARD_KINDS = ['pokemon', 'attack', 'item', 'action'];

    function getAvailableEvents(gameData, locationTypes) {
        const events = gameData && Array.isArray(gameData.events) ? gameData.events : [];
        // A non-empty locationTypes array gates typed events to the current
        // location; undefined leaves the pool ungated (so getEventById and any
        // saved-encounter restore path always resolve).
        const gated = Array.isArray(locationTypes) && locationTypes.length > 0;

        return events.filter(event => (
            event &&
            event.enabled !== false &&
            event.id &&
            EVENT_TYPES.includes(event.type) &&
            (!gated || matchesLocationTypes(event, locationTypes))
        ));
    }

    function matchesLocationTypes(event, locationTypes) {
        return !event.types || event.types.length === 0 || event.types.some(type => locationTypes.includes(type));
    }

    function chooseEvent(gameData, run) {
        const locationTypes = run && run.location ? run.location.types : undefined;
        const events = getAvailableEvents(gameData, locationTypes);

        if (events.length === 0) return null;

        return events[randomInt(0, events.length - 1)];
    }

    function getEventById(gameData, eventId) {
        if (!eventId) return null;

        return getAvailableEvents(gameData).find(event => event.id === eventId) || null;
    }

    function getEventActions(eventRecord) {
        if (!eventRecord) return [];

        if (eventRecord.type === 'gift') {
            return [{
                buttonText: eventRecord.buttonText || 'Take reward',
                description: eventRecord.rewardText || '',
                effects: normalizeEffects(eventRecord.effects || eventRecord.rewards),
                id: 'claim',
                requires: normalizeRequirements(eventRecord.requires),
                title: eventRecord.actionTitle || 'Claim'
            }];
        }

        if (eventRecord.type === 'choice') {
            return Array.isArray(eventRecord.choices)
                ? eventRecord.choices.map((choice, index) => ({
                    buttonText: choice.buttonText || 'Choose',
                    description: choice.description || choice.text || '',
                    effects: normalizeEffects(choice.effects),
                    id: choice.id || `choice-${index + 1}`,
                    requires: normalizeRequirements(choice.requires || choice.requirements),
                    title: choice.title || `Choice ${index + 1}`
                }))
                : [];
        }

        return [];
    }

    function getTrainerBattleRewardEffects(eventRecord) {
        if (!eventRecord || eventRecord.type !== 'trainer') return [];

        return normalizeEffects(eventRecord.rewardEffects || eventRecord.battleRewardEffects);
    }

    function getTrainerPaymentAction(eventRecord) {
        if (!eventRecord || eventRecord.type !== 'trainer' || !eventRecord.payment) return null;

        return {
            buttonText: eventRecord.payment.buttonText || 'Pay',
            description: eventRecord.payment.description || '',
            effects: normalizeEffects(eventRecord.payment.effects),
            id: 'pay',
            requires: normalizeRequirements(eventRecord.payment.requires || eventRecord.payment.requirements),
            title: eventRecord.payment.title || 'Pay and leave'
        };
    }

    function getActionRequirements(action) {
        return normalizeRequirements(action && (action.requires || action.requirements));
    }

    function getRequirementById(action, requirementId) {
        return getActionRequirements(action).find(requirement => requirement.id === requirementId) || null;
    }

    function actionNeedsSelection(action) {
        return getActionRequirements(action).length > 0;
    }

    function getSelectableCards(run, requirement) {
        if (!requirement) return [];

        const cardKind = normalizeCardKind(requirement.cardKind || requirement.kind);

        return getCardsByKind(run, cardKind).map(entry => entry.card);
    }

    function getBlockedReason(run, action, selections, context = {}) {
        const requirements = getActionRequirements(action);

        for (const requirement of requirements) {
            const selectedCardId = selections && selections[requirement.id];
            const selectableCards = getSelectableCards(run, requirement);

            if (selectableCards.length === 0) {
                return requirement.emptyText || `No ${getCardKindLabel(requirement.cardKind || requirement.kind)} cards are available.`;
            }

            if (!selectedCardId) {
                return requirement.prompt || requirement.label || 'Choose a card first.';
            }

            if (!selectableCards.some(card => card.id === selectedCardId)) {
                return 'Choose an available card.';
            }
        }

        for (const effect of normalizeEffects(action && action.effects)) {
            const blockedReason = getEffectBlockedReason(run, effect, selections, context);

            if (blockedReason) return blockedReason;
        }

        return '';
    }

    function applyAction(run, action, selections, context = {}) {
        const blockedReason = getBlockedReason(run, action, selections, context);

        if (blockedReason) {
            return {
                ok: false,
                summary: [],
                message: blockedReason
            };
        }

        const summary = applyEffects(run, action.effects, selections, context);
        const runStore = context.runStore || global.PokeRun;

        if (runStore && typeof runStore.balancePokemonCollections === 'function') {
            runStore.balancePokemonCollections(run);
        }

        if (runStore && typeof runStore.rebuildActionDeckForActivePokemon === 'function') {
            runStore.rebuildActionDeckForActivePokemon(run);
        }

        return {
            ok: true,
            summary,
            message: summary.length > 0 ? summary.join(' ') : 'Done.'
        };
    }

    function applyEffects(run, effects, selections, context = {}) {
        return normalizeEffects(effects).reduce((summary, effect) => {
            const entries = applyEffect(run, effect, selections || {}, context);

            return summary.concat(entries);
        }, []);
    }

    function getEffectBlockedReason(run, effect, selections, context = {}) {
        const amount = getEffectAmount(effect);
        const cardKind = normalizeCardKind(effect.cardKind || effect.kind);

        if (effect.type === 'lose-cash' && getCash(run) < amount) {
            return `You need ${amount} coins.`;
        }

        if (effect.type === 'remove-selected-card' ||
            effect.type === 'duplicate-selected-card' ||
            effect.type === 'replace-selected-card' ||
            effect.type === 'trade-selected-pokemon') {
            const selectedCard = getSelectedCard(run, effect.selectionId, selections);

            if (!selectedCard) return 'Choose a card first.';

            if (
                effect.type === 'remove-selected-card' &&
                getCardKind(selectedCard) === 'pokemon' &&
                getCardsByKind(run, 'pokemon').length <= 1
            ) {
                return 'Keep at least one Pokemon.';
            }
        }

        if (effect.strict && (effect.type === 'lose-random-cards' || effect.type === 'duplicate-random-card')) {
            const cards = getCardsByKind(run, cardKind);

            if (cards.length < amount) {
                return `You need ${amount} ${getCardKindLabel(cardKind)} card${amount === 1 ? '' : 's'}.`;
            }
        }

        if (effect.strict && effect.type === 'lose-random-pokemon') {
            const pokemonCount = getCardsByKind(run, 'pokemon').length;

            if (pokemonCount <= amount) {
                return `You need more Pokemon.`;
            }
        }

        if ((effect.type === 'gain-card' || effect.type === 'replace-selected-card') && effect.name) {
            const record = findRecord(context.gameData, cardKind, effect.name);

            if (!record) return `${effect.name} is not available.`;
        }

        return '';
    }

    function applyEffect(run, effect, selections, context) {
        const runStore = context.runStore || global.PokeRun;
        const gameData = context.gameData || {};
        const amount = getEffectAmount(effect);
        const cardKind = normalizeCardKind(effect.cardKind || effect.kind);

        switch (effect.type) {
            case 'gain-cash':
                run.cash = getCash(run) + amount;
                return [`Gained ${amount} coins.`];
            case 'lose-cash': {
                const paid = Math.min(getCash(run), amount);
                run.cash = getCash(run) - paid;
                return paid > 0 ? [`Paid ${paid} coins.`] : [];
            }
            case 'gain-card':
                return gainNamedCards(run, runStore, gameData, cardKind, effect.name, amount);
            case 'gain-random-card':
                return gainRandomCards(run, runStore, gameData, cardKind, amount, effect);
            case 'lose-random-cards':
                return loseRandomCards(run, cardKind, amount, { keepOnePokemon: cardKind === 'pokemon' });
            case 'lose-random-pokemon':
                return loseRandomCards(run, 'pokemon', amount, { keepOnePokemon: true });
            case 'remove-selected-card':
                return removeSelectedCard(run, effect.selectionId, selections);
            case 'duplicate-selected-card':
                return duplicateSelectedCard(run, runStore, effect.selectionId, selections);
            case 'duplicate-random-card':
                return duplicateRandomCards(run, runStore, cardKind, amount);
            case 'replace-selected-card':
                return replaceSelectedCard(run, runStore, gameData, effect.selectionId, selections, effect.replacement || {});
            case 'replace-random-card':
                return replaceRandomCards(run, runStore, gameData, cardKind, amount, effect.replacement || {});
            case 'trade-selected-pokemon':
                return tradeSelectedPokemon(run, runStore, gameData, effect.selectionId, selections, effect.replacement || {});
            case 'trade-random-pokemon':
                return tradeRandomPokemon(run, runStore, gameData, effect.replacement || {});
            default:
                return [];
        }
    }

    function gainNamedCards(run, runStore, gameData, cardKind, name, count) {
        if (!name) return [];

        const record = findRecord(gameData, cardKind, name);

        if (!record) return [`${name} is not available.`];

        const cards = createCardsFromRecord(run, runStore, cardKind, record, count);
        const results = cards.map(card => addCardToRun(run, runStore, card));
        const zoneSuffix = results.some(result => result.zone === 'bench') ? ' Some went to the bench.' : '';

        return [`Gained ${formatCardCount(name, cards.length)}.${zoneSuffix}`];
    }

    function gainRandomCards(run, runStore, gameData, cardKind, count, effect) {
        const types = getEffectTypes(effect);
        const gainedNames = [];

        for (let index = 0; index < count; index += 1) {
            const record = chooseRandomRecord(gameData, cardKind, effect.excludeName, types);

            if (!record) {
                if (types) {
                    return summarizeNames('Gained', gainedNames)
                        .concat([`No ${types.join('/')} ${getCardKindLabel(cardKind)} available.`]);
                }

                continue;
            }

            const card = createCardsFromRecord(run, runStore, cardKind, record, 1)[0];

            if (!card) continue;

            addCardToRun(run, runStore, card);
            gainedNames.push(getRecordName(record));
        }

        return summarizeNames('Gained', gainedNames);
    }

    function getEffectTypes(source) {
        const types = Array.isArray(source && source.types) ? source.types : null;

        return types && types.length > 0 ? types.map(type => String(type).toUpperCase()) : null;
    }

    function loseRandomCards(run, cardKind, count, options = {}) {
        const keepOnePokemon = Boolean(options.keepOnePokemon) && cardKind === 'pokemon';
        const entries = getCardsByKind(run, cardKind);
        const removableCount = keepOnePokemon ? Math.max(0, entries.length - 1) : entries.length;
        const selectedEntries = shuffleRecords(entries).slice(0, Math.min(count, removableCount));
        const removedNames = selectedEntries.map(entry => removeCardAtLocation(run, entry));

        return summarizeNames('Lost', removedNames.filter(Boolean));
    }

    function removeSelectedCard(run, selectionId, selections) {
        const entry = getSelectedCardEntry(run, selectionId, selections);

        if (!entry) return [];

        const removedName = removeCardAtLocation(run, entry);

        return removedName ? [`Lost ${removedName}.`] : [];
    }

    function duplicateSelectedCard(run, runStore, selectionId, selections) {
        const selectedCard = getSelectedCard(run, selectionId, selections);

        if (!selectedCard) return [];

        const duplicatedCard = createCardFromSource(run, runStore, selectedCard);

        if (!duplicatedCard) return [];

        addCardToRun(run, runStore, duplicatedCard);
        return [`Duplicated ${getCardName(selectedCard)}.`];
    }

    function duplicateRandomCards(run, runStore, cardKind, count) {
        const cards = shuffleRecords(getCardsByKind(run, cardKind)).slice(0, count);
        const duplicatedNames = [];

        cards.forEach(entry => {
            const duplicatedCard = createCardFromSource(run, runStore, entry.card);

            if (!duplicatedCard) return;

            addCardToRun(run, runStore, duplicatedCard);
            duplicatedNames.push(getCardName(entry.card));
        });

        return summarizeNames('Duplicated', duplicatedNames);
    }

    function replaceSelectedCard(run, runStore, gameData, selectionId, selections, replacement) {
        const entry = getSelectedCardEntry(run, selectionId, selections);

        if (!entry) return [];

        const sourceKind = getCardKind(entry.card);
        const replacementCard = createReplacementCard(run, runStore, gameData, sourceKind, entry.card, replacement);

        if (!replacementCard) return [];

        const removedName = removeCardAtLocation(run, entry);

        addCardToRun(run, runStore, replacementCard);

        return [`Replaced ${removedName} with ${getCardName(replacementCard)}.`];
    }

    function replaceRandomCards(run, runStore, gameData, cardKind, count, replacement) {
        const entries = shuffleRecords(getCardsByKind(run, cardKind)).slice(0, count);
        const summary = [];

        entries.forEach(entry => {
            const replacementCard = createReplacementCard(run, runStore, gameData, cardKind, entry.card, replacement);

            if (!replacementCard) return;

            const removedName = removeCardAtLocation(run, entry);

            addCardToRun(run, runStore, replacementCard);
            summary.push(`Replaced ${removedName} with ${getCardName(replacementCard)}.`);
        });

        return summary;
    }

    function tradeSelectedPokemon(run, runStore, gameData, selectionId, selections, replacement) {
        return replaceSelectedCard(run, runStore, gameData, selectionId, selections, {
            ...replacement,
            cardKind: 'pokemon'
        });
    }

    function tradeRandomPokemon(run, runStore, gameData, replacement) {
        return replaceRandomCards(run, runStore, gameData, 'pokemon', 1, {
            ...replacement,
            cardKind: 'pokemon'
        });
    }

    function createReplacementCard(run, runStore, gameData, sourceKind, sourceCard, replacement) {
        const cardKind = normalizeCardKind(replacement.cardKind || replacement.kind || sourceKind);
        const record = replacement.name
            ? findRecord(gameData, cardKind, replacement.name)
            : chooseRandomRecord(gameData, cardKind, getCardName(sourceCard), getEffectTypes(replacement));

        return record ? createCardsFromRecord(run, runStore, cardKind, record, 1)[0] : null;
    }

    function createCardsFromRecord(run, runStore, cardKind, record, count) {
        const cards = [];

        if (!runStore || !record) return cards;

        for (let index = 0; index < count; index += 1) {
            const name = getRecordName(record);

            if (cardKind === 'pokemon' && typeof runStore.createPokemonCard === 'function') {
                cards.push(runStore.createPokemonCard(record, 'player', runStore.allocateCardId(run, 'pokemon', name)));
            } else if (cardKind === 'attack' && typeof runStore.createAttackCard === 'function') {
                cards.push(runStore.createAttackCard(record, 'player', runStore.allocateCardId(run, 'attack', name)));
            } else if (cardKind === 'item' && typeof runStore.createItemCard === 'function') {
                cards.push(runStore.createItemCard(record, 'player', runStore.allocateCardId(run, 'item', name)));
            }
        }

        return cards;
    }

    function createCardFromSource(run, runStore, sourceCard) {
        if (!sourceCard || !runStore) return null;

        if (sourceCard.kind === 'pokemon' || sourceCard.pokemon) {
            return runStore.createPokemonCard(
                sourceCard.pokemon,
                'player',
                runStore.allocateCardId(run, 'pokemon', getCardName(sourceCard))
            );
        }

        if (sourceCard.kind === 'attack' || sourceCard.attack) {
            return runStore.createAttackCard(
                sourceCard.attack,
                'player',
                runStore.allocateCardId(run, 'attack', getCardName(sourceCard))
            );
        }

        if (sourceCard.kind === 'item' || sourceCard.item) {
            return runStore.createItemCard(
                sourceCard.item,
                'player',
                runStore.allocateCardId(run, 'item', getCardName(sourceCard))
            );
        }

        return null;
    }

    function addCardToRun(run, runStore, card) {
        if (!card) return { zone: null };

        if (card.kind === 'pokemon' || card.pokemon) {
            return runStore.addPokemonCard(run, card);
        }

        return runStore.addActionCard(run, card);
    }

    function getSelectedCard(run, selectionId, selections) {
        const entry = getSelectedCardEntry(run, selectionId, selections);

        return entry ? entry.card : null;
    }

    function getSelectedCardEntry(run, selectionId, selections) {
        const selectedCardId = selections && selections[selectionId];

        if (!selectedCardId) return null;

        return findCardEntryById(run, selectedCardId);
    }

    function findCardEntryById(run, cardId) {
        return [
            ...getCardsByKind(run, 'pokemon'),
            ...getCardsByKind(run, 'attack'),
            ...getCardsByKind(run, 'item')
        ].find(entry => entry.card.id === cardId) || null;
    }

    function getCardsByKind(run, cardKind) {
        if (!run || !run.collections) return [];

        const collections = run.collections;
        const bench = collections.bench || {};
        const activeActions = Array.isArray(collections.actions) ? collections.actions : [];
        const benchActions = Array.isArray(bench.actions) ? bench.actions : [];

        if (cardKind === 'pokemon') {
            return [
                ...toEntries(collections.pokemon, 'pokemon', 'active'),
                ...toEntries(bench.pokemon, 'pokemon', 'bench')
            ];
        }

        if (cardKind === 'attack') {
            return [
                ...toEntries(activeActions, 'actions', 'active').filter(entry => getCardKind(entry.card) === 'attack'),
                ...toEntries(benchActions, 'benchActions', 'bench').filter(entry => getCardKind(entry.card) === 'attack')
            ];
        }

        if (cardKind === 'item') {
            return toEntries(activeActions, 'actions', 'active').filter(entry => getCardKind(entry.card) === 'item');
        }

        if (cardKind === 'action') {
            return [
                ...toEntries(activeActions, 'actions', 'active'),
                ...toEntries(benchActions, 'benchActions', 'bench')
            ];
        }

        return [];
    }

    function toEntries(cards, collectionKey, zone) {
        return (Array.isArray(cards) ? cards : []).map((card, index) => ({
            card,
            collectionKey,
            index,
            zone
        }));
    }

    function removeCardAtLocation(run, entry) {
        if (!entry || !entry.card || !run || !run.collections) return null;

        const name = getCardName(entry.card);
        const collections = run.collections;
        const bench = collections.bench || {};
        let cards = null;

        if (entry.collectionKey === 'pokemon') cards = collections.pokemon;
        if (entry.collectionKey === 'actions') cards = collections.actions;
        if (entry.collectionKey === 'benchActions') cards = bench.actions;

        if (entry.collectionKey === 'pokemon' && entry.zone === 'bench') cards = bench.pokemon;

        if (!Array.isArray(cards)) return null;

        const index = cards.findIndex(card => card.id === entry.card.id);

        if (index === -1) return null;

        cards.splice(index, 1);
        return name;
    }

    function findRecord(gameData, cardKind, name) {
        const collectionKey = getRecordCollectionKey(cardKind);
        const records = gameData && Array.isArray(gameData[collectionKey])
            ? gameData[collectionKey]
            : [];

        return records.find(record => getRecordName(record) === name) || null;
    }

    function chooseRandomRecord(gameData, cardKind, excludeName = null, types = null) {
        const collectionKey = getRecordCollectionKey(cardKind);
        const records = getUniqueRecords(gameData && gameData[collectionKey]);
        // Pokemon picks never include babies, megas, or legendaries. Guarded
        // because this module has no hard dependency on map/locations.js.
        const obtainableRecords = cardKind === 'pokemon' && global.PokeLocations && typeof global.PokeLocations.isObtainablePokemon === 'function'
            ? records.filter(record => global.PokeLocations.isObtainablePokemon(record, gameData))
            : records;
        const filteredRecords = excludeName
            ? obtainableRecords.filter(record => getRecordName(record) !== excludeName)
            : obtainableRecords;

        if (Array.isArray(types) && types.length > 0) {
            const typeSet = new Set(types);
            const typedRecords = filteredRecords.filter(record => recordMatchesTypes(record, typeSet));

            return typedRecords.length > 0 ? typedRecords[randomInt(0, typedRecords.length - 1)] : null;
        }

        const choices = filteredRecords.length > 0 ? filteredRecords : obtainableRecords;

        if (choices.length === 0) return null;

        return choices[randomInt(0, choices.length - 1)];
    }

    function recordMatchesTypes(record, typeSet) {
        return ['type1', 'type2', 'type3']
            .map(key => record && record[key])
            .some(type => type && type !== 'NONE' && typeSet.has(type));
    }

    function getUniqueRecords(records) {
        const seenNames = new Set();

        return (Array.isArray(records) ? records : []).filter(record => {
            const name = getRecordName(record);

            if (!name || seenNames.has(name)) return false;

            seenNames.add(name);
            return true;
        });
    }

    function getRecordCollectionKey(cardKind) {
        if (cardKind === 'pokemon') return 'pokemon';
        if (cardKind === 'attack') return 'attacks';
        if (cardKind === 'item') return 'items';

        return 'attacks';
    }

    function getCardKind(card) {
        if (!card) return '';
        if (card.kind === 'pokemon' || card.pokemon) return 'pokemon';
        if (card.kind === 'attack' || card.attack) return 'attack';
        if (card.kind === 'item' || card.item) return 'item';

        return '';
    }

    function getCardName(card) {
        if (!card) return 'Card';
        if (card.pokemon && card.pokemon.name) return card.pokemon.name;
        if (card.attack && card.attack.name) return card.attack.name;
        if (card.item && card.item.name) return card.item.name;

        return 'Card';
    }

    function getRecordName(record) {
        return record && record.name ? record.name : '';
    }

    function getCardKindLabel(cardKind) {
        const normalizedKind = normalizeCardKind(cardKind);

        if (normalizedKind === 'pokemon') return 'Pokemon';
        if (normalizedKind === 'attack') return 'attack';
        if (normalizedKind === 'item') return 'item';

        return 'action';
    }

    function normalizeCardKind(cardKind) {
        const normalizedKind = String(cardKind || '').trim().toLowerCase();

        return CARD_KINDS.includes(normalizedKind) ? normalizedKind : 'attack';
    }

    function normalizeEffects(effects) {
        return Array.isArray(effects) ? effects.filter(effect => effect && effect.type) : [];
    }

    function normalizeRequirements(requirements) {
        return (Array.isArray(requirements) ? requirements : []).filter(requirement => (
            requirement &&
            requirement.id &&
            normalizeCardKind(requirement.cardKind || requirement.kind)
        ));
    }

    function getEffectAmount(effect) {
        return Math.max(0, Number(effect && (effect.amount || effect.count)) || 0);
    }

    function getCash(run) {
        return Number.isFinite(run && run.cash) ? run.cash : 0;
    }

    function summarizeNames(verb, names) {
        if (names.length === 0) return [];

        const counts = names.reduce((map, name) => {
            map.set(name, (map.get(name) || 0) + 1);
            return map;
        }, new Map());

        return Array.from(counts.entries()).map(([name, count]) => (
            `${verb} ${formatCardCount(name, count)}.`
        ));
    }

    function formatCardCount(name, count) {
        return count > 1 ? `${name} x${count}` : name;
    }

    function shuffleRecords(records) {
        const shuffled = records.slice();

        for (let index = shuffled.length - 1; index > 0; index -= 1) {
            const swapIndex = randomInt(0, index);

            [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
        }

        return shuffled;
    }

    function randomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    global.PokeEvents = {
        actionNeedsSelection,
        applyAction,
        applyEffects,
        chooseEvent,
        getActionRequirements,
        getAvailableEvents,
        getBlockedReason,
        getEventActions,
        getEventById,
        getRequirementById,
        getSelectableCards,
        getTrainerBattleRewardEffects,
        getTrainerPaymentAction
    };
})(window);
