/**
 * Pure validation library for the data editor. Ports every rule from
 * tests/data_validation.test.js rule-for-rule (that test file remains the
 * source of truth for game-data invariants; this module additionally
 * surfaces them as structured issues instead of throwing).
 *
 * No `require`s, no `fetch`, no `fs` — every input arrives as an argument so
 * this file works identically in the browser and in Node.
 */
(function () {
    'use strict';

    const HEX_PATTERN = /^#[0-9a-f]{6}$/i;

    // Mirrors the ARTIFICIAL_ATTACK_* consts in tests/data_validation.test.js.
    // `enums.extensions` (the /api/enums payload) can override these; when
    // absent (e.g. a bare scripts/data_options.js enums bundle) these are the
    // fallback.
    const DEFAULT_ARTIFICIAL_ATTACK_TARGETS = ['TRAINER'];
    const DEFAULT_ARTIFICIAL_ATTACK_STATUSES = ['EXTRA_ATTACK', 'EXTRA_ITEM', 'INCREASE_CAPACITY', 'REFRESH_DECK'];
    const DEFAULT_ARTIFICIAL_ATTACK_CAP = 6;

    // Mirrors VALID_EFFECT_TYPES / VALID_EVENT_TYPES in the same test file.
    const DEFAULT_EFFECT_TYPES = [
        'gain-cash', 'lose-cash', 'gain-card', 'gain-random-card', 'gain-random-baby',
        'lose-random-cards', 'lose-random-pokemon', 'remove-selected-card',
        'duplicate-selected-card', 'duplicate-random-card', 'replace-selected-card',
        'replace-random-card', 'trade-selected-pokemon', 'trade-random-pokemon'
    ];
    const DEFAULT_EVENT_TYPES = ['gift', 'choice', 'trainer'];

    // Mirrors MUSIC_CATEGORIES in arena/arena_data.js (the vocabulary the
    // engine actually accepts when normalizing music.json).
    const DEFAULT_MUSIC_CATEGORIES = ['trainer', 'boss', 'elite', 'legendary'];

    // Mirrors STAT_KEYS / STAT_PREFIXES in map/profile.js (the counter
    // namespace the game actually tracks), kept here as a fallback for when
    // enums.statKeys / enums.statPrefixes are absent from the /api/enums
    // payload.
    const DEFAULT_STAT_KEYS = [
        'runs.started', 'runs.completed', 'battles.won', 'battles.lost',
        'events.seen', 'captures.completed', 'attacks.claimed', 'marts.visited'
    ];
    const DEFAULT_STAT_PREFIXES = [
        'runs.completed.starter.', 'runs.completed.mono.', 'battles.won.rank.', 'events.seen.'
    ];

    function issue(severity, file, recordKey, code, message, field) {
        const out = { severity, file, recordKey, code, message };
        if (field !== undefined) out.field = field;
        return out;
    }
    const err = (file, recordKey, code, message, field) => issue('error', file, recordKey, code, message, field);
    const warn = (file, recordKey, code, message, field) => issue('warning', file, recordKey, code, message, field);

    // Rank is a class with static string fields in scripts/data_options.js
    // (Object.values(Rank) works, but callers may instead pass the
    // already-serialized 5-string array the HTTP /api/enums endpoint sends);
    // accept either shape.
    function rankValues(Rank) {
        if (Array.isArray(Rank)) return Rank;
        if (!Rank) return [];
        return [Rank.STANDARD, Rank.ACE, Rank.SPECIAL, Rank.BOSS, Rank.ELITE].filter(Boolean);
    }

    function collectEventEffects(event) {
        const effects = [];

        if (Array.isArray(event.effects)) effects.push(...event.effects);
        if (Array.isArray(event.rewardEffects)) effects.push(...event.rewardEffects);
        if (event.payment && Array.isArray(event.payment.effects)) effects.push(...event.payment.effects);
        if (Array.isArray(event.choices)) {
            event.choices.forEach((choice) => {
                if (choice && Array.isArray(choice.effects)) effects.push(...choice.effects);
            });
        }

        return effects;
    }

    function collectEventConditions(event) {
        const conditions = [];

        if (Array.isArray(event.conditions)) conditions.push(...event.conditions);
        if (event.payment && Array.isArray(event.payment.conditions)) conditions.push(...event.payment.conditions);
        if (Array.isArray(event.choices)) {
            event.choices.forEach((choice) => {
                if (choice && Array.isArray(choice.conditions)) conditions.push(...choice.conditions);
            });
        }

        return conditions;
    }

    function collectEventRequirements(event) {
        const requirements = [];
        const push = (owner) => {
            if (!owner) return;
            const list = owner.requires || owner.requirements;
            if (Array.isArray(list)) requirements.push(...list);
        };

        push(event);
        push(event.payment);
        if (Array.isArray(event.choices)) event.choices.forEach(push);

        return requirements;
    }

    // Mirrors formatAssetName() in arena/arena_data.js (kept local so this
    // module stays require-free).
    function formatAssetName(name) {
        return String(name || 'item')
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
    }

    function basename(filePath) {
        const parts = String(filePath || '').split('/');
        return parts[parts.length - 1];
    }

    // ---------------------------------------------------------------- pokemon

    function validatePokemon(pokemon, enums, eventGrantedPokemon) {
        const issues = [];
        const validTypes = new Set(Object.values((enums && enums.PokeType) || {}));
        const seen = new Set();
        const namesAndIds = new Set();
        const byNameOrId = new Map();
        pokemon.forEach((record) => {
            if (record.name) namesAndIds.add(record.name);
            if (record.id) namesAndIds.add(record.id);
            if (record.name) byNameOrId.set(record.name, record);
            if (record.id) byNameOrId.set(record.id, record);
        });
        // Mega convention: id > 9000 (mirrors map/locations.js isMegaByConvention).
        const isMega = (record) => {
            const idNum = parseInt(record && record.id, 10);
            return Number.isFinite(idNum) && idNum > 9000;
        };

        pokemon.forEach((record) => {
            const key = record.name || '(unnamed pokemon)';

            if (record.name && seen.has(record.name)) {
                issues.push(err('pokemon.json', key, 'pokemon.duplicate-name', `duplicate pokemon name ${record.name}`, 'name'));
            }
            if (record.name) seen.add(record.name);

            ['type1', 'type2', 'type3'].forEach((slot) => {
                if (!validTypes.has(record[slot])) {
                    issues.push(err('pokemon.json', key, 'pokemon.bad-type', `${key}: bad ${slot} ${record[slot]}`, slot));
                }
            });
            if (record.type1 === 'NONE') {
                issues.push(err('pokemon.json', key, 'pokemon.none-primary-type', `${key}: type1 must be a real type`, 'type1'));
            }
            ['baseHealth', 'baseAttack', 'baseDefense', 'baseSpeed'].forEach((stat) => {
                if (!(Number.isFinite(record[stat]) && record[stat] > 0)) {
                    issues.push(err('pokemon.json', key, 'pokemon.bad-stat', `${key}: bad ${stat}`, stat));
                }
            });
            if (!/^\d{4}$/.test(String(record.id))) {
                issues.push(err('pokemon.json', key, 'pokemon.bad-id', `${key}: bad id ${record.id}`, 'id'));
            }

            const types = [record.type1, record.type2, record.type3].filter((type) => type && type !== 'NONE');
            if (types.includes('BABY') && !types.some((type) => type !== 'BABY')) {
                issues.push(err('pokemon.json', key, 'pokemon.baby-needs-other-type', `${key}: BABY pokemon needs >=1 non-BABY type`, 'type1'));
            }
            if (record.evolvesInto !== undefined && !namesAndIds.has(record.evolvesInto)) {
                issues.push(err('pokemon.json', key, 'pokemon.bad-evolves-into', `${key}: evolvesInto "${record.evolvesInto}" does not resolve to a real pokemon`, 'evolvesInto'));
            }
            if ([record.type1, record.type2, record.type3].includes('BABY')) {
                if (record.evolvesInto === undefined || record.evolvesInto === '') {
                    issues.push(err('pokemon.json', key, 'pokemon.baby-missing-mega',
                        `${key}: BABY pokemon must set evolvesInto to its Mega`, 'evolvesInto'));
                } else {
                    const target = byNameOrId.get(record.evolvesInto);
                    // target that doesn't resolve at all is already reported by pokemon.bad-evolves-into
                    if (target && !isMega(target)) {
                        issues.push(err('pokemon.json', key, 'pokemon.baby-missing-mega',
                            `${key}: evolvesInto "${record.evolvesInto}" is not a Mega (id must be > 9000)`, 'evolvesInto'));
                    }
                }
            }
            if (record.eventOnly === true && !(eventGrantedPokemon && eventGrantedPokemon.has(record.name))) {
                issues.push(warn('pokemon.json', key, 'pokemon.event-only-unreachable',
                    `${key}: event-only pokemon is granted by no event (gain-card) — it is unobtainable`, 'eventOnly'));
            }
        });

        return issues;
    }

    // ---------------------------------------------------------------- attacks

    function validateAttacks(attacks, enums) {
        const issues = [];
        const extensions = (enums && enums.extensions) || {};
        const validTypes = new Set(Object.values((enums && enums.PokeType) || {}));
        const artificialStatuses = new Set(extensions.attackStatuses || DEFAULT_ARTIFICIAL_ATTACK_STATUSES);
        const artificialTargets = new Set(extensions.attackTargets || DEFAULT_ARTIFICIAL_ATTACK_TARGETS);
        const validStatuses = new Set([...Object.values((enums && enums.Status) || {}), ...artificialStatuses]);
        const validTargets = new Set([...Object.values((enums && enums.AttackTarget) || {}), ...artificialTargets]);
        const validStatChanges = new Set(Object.values((enums && enums.StatChange) || {}));
        const artificialCap = extensions.artificialAttackCap || DEFAULT_ARTIFICIAL_ATTACK_CAP;

        const seen = new Set();
        let artificialCount = 0;

        attacks.forEach((record) => {
            const key = record.name || '(unnamed attack)';

            if (record.name && seen.has(record.name)) {
                issues.push(err('attacks.json', key, 'attacks.duplicate-name', `duplicate attack name ${record.name}`, 'name'));
            }
            if (record.name) seen.add(record.name);

            ['type1', 'type2'].forEach((slot) => {
                if (!validTypes.has(record[slot])) {
                    issues.push(err('attacks.json', key, 'attacks.bad-type', `${key}: bad ${slot} ${record[slot]}`, slot));
                }
            });
            if (record.type1 === 'NONE') {
                issues.push(err('attacks.json', key, 'attacks.none-primary-type', `${key}: type1 must be a real type`, 'type1'));
            }
            if (record.type1 === 'BABY' || record.type2 === 'BABY') {
                issues.push(err('attacks.json', key, 'attacks.baby-type-forbidden', `${key}: BABY is not a valid attack type`, record.type1 === 'BABY' ? 'type1' : 'type2'));
            }
            if (!(Number.isFinite(record.basePower) && record.basePower >= 0)) {
                issues.push(err('attacks.json', key, 'attacks.bad-power', `${key}: bad basePower`, 'basePower'));
            }
            if (!validStatuses.has(record.status)) {
                issues.push(err('attacks.json', key, 'attacks.bad-status', `${key}: bad status ${record.status}`, 'status'));
            }
            if (!validTargets.has(record.target)) {
                issues.push(err('attacks.json', key, 'attacks.bad-target', `${key}: bad target ${record.target}`, 'target'));
            }
            (Array.isArray(record.statChanges) ? record.statChanges : []).forEach((change) => {
                if (!validStatChanges.has(change)) {
                    issues.push(err('attacks.json', key, 'attacks.bad-stat-change', `${key}: bad statChange ${change}`, 'statChanges'));
                }
            });
            if (typeof record.full_type_requirements !== 'boolean') {
                issues.push(err('attacks.json', key, 'attacks.bad-full-req-flag', `${key}: bad full_type_requirements`, 'full_type_requirements'));
            }

            const isArtificial = record.type1 === 'ARTIFICIAL' || record.type2 === 'ARTIFICIAL';
            if (isArtificial) {
                artificialCount += 1;
                if (record.target !== 'TRAINER') {
                    issues.push(err('attacks.json', key, 'attacks.artificial-rule', `${key}: artificial attacks target TRAINER`, 'target'));
                }
                if (!artificialStatuses.has(record.status)) {
                    issues.push(err('attacks.json', key, 'attacks.artificial-rule', `${key}: unhandled artificial status ${record.status}`, 'status'));
                }
            }
        });

        if (artificialCount > artificialCap) {
            issues.push(err('attacks.json', '(dataset)', 'attacks.artificial-cap', `artificial attack count ${artificialCount} exceeds expected small set`));
        }

        return issues;
    }

    // ------------------------------------------------------------------ items

    function validateItems(items, enums) {
        const issues = [];
        const validTargets = new Set(Object.values((enums && enums.ItemTarget) || {}));
        const validStatuses = new Set(Object.values((enums && enums.Status) || {}));
        const validStatChanges = new Set(Object.values((enums && enums.StatChange) || {}));

        const seen = new Set();

        items.forEach((record) => {
            const key = record.name || '(unnamed item)';

            if (record.name && seen.has(record.name)) {
                issues.push(err('items.json', key, 'items.duplicate-name', `duplicate item name ${record.name}`, 'name'));
            }
            if (record.name) seen.add(record.name);

            if (!validTargets.has(record.target)) {
                issues.push(err('items.json', key, 'items.bad-target', `${key}: bad target ${record.target}`, 'target'));
            }
            (Array.isArray(record.status) ? record.status : []).forEach((status) => {
                if (!validStatuses.has(status)) {
                    issues.push(err('items.json', key, 'items.bad-status', `${key}: bad status ${status}`, 'status'));
                }
            });
            // normalizeItem() treats non-stat statChanges entries as legacy
            // statuses and moves them into status, so both enums are legal here.
            (Array.isArray(record.statChanges) ? record.statChanges : []).forEach((change) => {
                if (!validStatChanges.has(change) && !validStatuses.has(change)) {
                    issues.push(err('items.json', key, 'items.bad-stat-change', `${key}: bad statChange ${change}`, 'statChanges'));
                }
            });
        });

        return issues;
    }

    // --------------------------------------------------------------- trainers

    function validateTrainers(trainers, pokemonNames, attackNames, itemNames, enums) {
        const issues = [];
        const validRanks = new Set(rankValues(enums && enums.Rank));
        const validTypes = new Set(Object.values((enums && enums.PokeType) || {}));

        const seen = new Set();

        trainers.forEach((record) => {
            const key = record.name || '(unnamed trainer)';

            if (record.name && seen.has(record.name)) {
                issues.push(err('trainers.json', key, 'trainers.duplicate-name', `duplicate trainer name ${record.name}`, 'name'));
            }
            if (record.name) seen.add(record.name);

            if (!validRanks.has(record.rank)) {
                issues.push(err('trainers.json', key, 'trainers.bad-rank', `${key}: bad rank ${record.rank}`, 'rank'));
            }
            if (!(Number.isFinite(record.cash) && record.cash >= 0)) {
                issues.push(err('trainers.json', key, 'trainers.bad-cash', `${key}: bad cash`, 'cash'));
            }
            if (record.typeSpecialization && !validTypes.has(record.typeSpecialization)) {
                issues.push(err('trainers.json', key, 'trainers.bad-specialization', `${key}: bad typeSpecialization`, 'typeSpecialization'));
            }
            (Array.isArray(record.pokemon) ? record.pokemon : []).forEach((name) => {
                if (!pokemonNames.has(name)) {
                    issues.push(err('trainers.json', key, 'trainers.unknown-pokemon', `${key}: unknown pokemon ${name}`, 'pokemon'));
                }
            });
            (Array.isArray(record.attacks) ? record.attacks.flat() : []).forEach((name) => {
                if (!attackNames.has(name)) {
                    issues.push(err('trainers.json', key, 'trainers.unknown-attack', `${key}: unknown attack ${name}`, 'attacks'));
                }
            });
            (Array.isArray(record.items) ? record.items : []).forEach((name) => {
                if (!itemNames.has(name)) {
                    issues.push(err('trainers.json', key, 'trainers.unknown-item', `${key}: unknown item ${name}`, 'items'));
                }
            });
        });

        const elites = trainers.filter((record) => record.rank === 'Elite');
        const aces = trainers.filter((record) => record.rank === 'Ace');

        if (elites.length < 4) {
            issues.push(err('trainers.json', '(dataset)', 'trainers.roster-minimums', `expected >=4 Elite trainers, found ${elites.length}`));
        }
        if (aces.length < 6) {
            issues.push(err('trainers.json', '(dataset)', 'trainers.roster-minimums', `expected >=6 Ace trainers, found ${aces.length}`));
        }
        elites.concat(aces).forEach((record) => {
            if (!record.typeSpecialization || !validTypes.has(record.typeSpecialization)) {
                issues.push(err('trainers.json', '(dataset)', 'trainers.roster-minimums', `${record.name}: seeded Elite/Ace needs a valid typeSpecialization`));
            }
        });

        return issues;
    }

    // ----------------------------------------------------------------- events

    function validateEvents(events, trainerNames, enums, locations, cardNames, achievementIds) {
        const issues = [];
        const validTypes = new Set(Object.values((enums && enums.PokeType) || {}));
        const validEffectTypes = new Set((enums && enums.effectTypes) || DEFAULT_EFFECT_TYPES);
        const validEventTypes = new Set((enums && enums.eventTypes) || DEFAULT_EVENT_TYPES);
        const locationIds = new Set((locations || []).map((record) => record && record.id).filter(Boolean));
        const terrainSet = new Set((locations || [])
            .map((record) => String((record && record.terrain) || '').trim().toLowerCase())
            .filter(Boolean));

        const seenIds = new Set();
        let trainerEventCount = 0;

        events.forEach((event) => {
            const key = (event && (event.id || event.title)) || '(unnamed event)';

            if (!event || typeof event !== 'object') {
                issues.push(err('events.json', key, 'events.missing-id', 'events.json: entry must be an object'));
                return;
            }

            if (!event.id || typeof event.id !== 'string') {
                issues.push(err('events.json', key, 'events.missing-id', `${key}: entry missing id`, 'id'));
            } else {
                if (seenIds.has(event.id)) {
                    issues.push(err('events.json', event.id, 'events.duplicate-id', `duplicate event id ${event.id}`, 'id'));
                }
                seenIds.add(event.id);
            }

            if (!validEventTypes.has(event.type)) {
                issues.push(err('events.json', key, 'events.bad-type', `${key}: bad type ${event.type}`, 'type'));
            }
            if (!event.title || typeof event.title !== 'string') {
                issues.push(err('events.json', key, 'events.missing-title', `${key}: title must be a non-empty string`, 'title'));
            }
            if (!event.body || typeof event.body !== 'string') {
                issues.push(err('events.json', key, 'events.missing-body', `${key}: body must be a non-empty string`, 'body'));
            }

            if (event.types !== undefined) {
                (Array.isArray(event.types) ? event.types : []).forEach((type) => {
                    if (!validTypes.has(type) || type === 'NONE' || type === 'LEGENDARY') {
                        issues.push(err('events.json', key, 'events.bad-gate-type', `${key}: bad type ${type}`, 'types'));
                    }
                });
            }
            if (event.locations !== undefined) {
                if (!Array.isArray(event.locations)) {
                    issues.push(err('events.json', key, 'events.bad-locations', `${key}: locations must be an array`, 'locations'));
                } else {
                    event.locations.forEach((id) => {
                        if (!locationIds.has(id)) {
                            issues.push(err('events.json', key, 'events.unknown-location', `${key}: unknown location id ${id}`, 'locations'));
                        }
                    });
                }
            }
            if (event.terrains !== undefined) {
                if (!Array.isArray(event.terrains)) {
                    issues.push(err('events.json', key, 'events.bad-terrains', `${key}: terrains must be an array`, 'terrains'));
                } else {
                    event.terrains.forEach((label) => {
                        const norm = String(label || '').trim().toLowerCase();
                        if (!norm || !terrainSet.has(norm)) {
                            issues.push(err('events.json', key, 'events.unknown-terrain', `${key}: unknown terrain ${label}`, 'terrains'));
                        }
                    });
                }
            }

            collectEventEffects(event).forEach((effect) => {
                if (!effect || typeof effect !== 'object') {
                    issues.push(err('events.json', key, 'events.unknown-effect-type', `${key}: effect must be an object`, 'effects'));
                    return;
                }
                if (!validEffectTypes.has(effect.type)) {
                    issues.push(err('events.json', key, 'events.unknown-effect-type', `${key}: unknown effect type ${effect.type}`, 'effects'));
                }
                if (effect.types !== undefined) {
                    (Array.isArray(effect.types) ? effect.types : []).forEach((type) => {
                        if (!validTypes.has(type)) {
                            issues.push(err('events.json', key, 'events.bad-effect-types', `${key}: bad effect type filter ${type}`, 'effects'));
                        }
                    });
                }
                if (effect.replacement && effect.replacement.types !== undefined) {
                    (Array.isArray(effect.replacement.types) ? effect.replacement.types : []).forEach((type) => {
                        if (!validTypes.has(type)) {
                            issues.push(err('events.json', key, 'events.bad-effect-types', `${key}: bad replacement type filter ${type}`, 'effects'));
                        }
                    });
                }
                if (effect.locationTypes !== undefined && typeof effect.locationTypes !== 'boolean') {
                    issues.push(err('events.json', key, 'events.effect-location-types-type', `${key}: locationTypes must be a boolean`, 'effects'));
                }
                if (effect.replacement && effect.replacement.locationTypes !== undefined && typeof effect.replacement.locationTypes !== 'boolean') {
                    issues.push(err('events.json', key, 'events.effect-location-types-type', `${key}: replacement.locationTypes must be a boolean`, 'effects'));
                }
                if (effect.locationTypes === true && Array.isArray(effect.types) && effect.types.length > 0) {
                    issues.push(warn('events.json', key, 'events.effect-location-types-conflict', `${key}: locationTypes wins; the types list is ignored`, 'effects'));
                }
                if (effect.replacement && effect.replacement.locationTypes === true &&
                    Array.isArray(effect.replacement.types) && effect.replacement.types.length > 0) {
                    issues.push(warn('events.json', key, 'events.effect-location-types-conflict', `${key}: replacement.locationTypes wins; the replacement types list is ignored`, 'effects'));
                }
                if (effect.locationTypes !== undefined && effect.type !== 'gain-random-card' && effect.type !== 'gain-random-baby') {
                    issues.push(warn('events.json', key, 'events.effect-location-types-unused', `${key}: locationTypes is not read by ${effect.type}`, 'effects'));
                }
            });

            collectEventConditions(event).forEach((condition) => {
                if (!condition || typeof condition !== 'object') {
                    issues.push(err('events.json', key, 'events.bad-condition',
                        `${key}: condition must be an object`, 'conditions'));
                    return;
                }
                if (!condition.name || typeof condition.name !== 'string') {
                    issues.push(err('events.json', key, 'events.bad-condition',
                        `${key}: condition needs a non-empty name`, 'conditions'));
                    return;
                }
                if (condition.mode !== 'has' && condition.mode !== 'lacks') {
                    issues.push(err('events.json', key, 'events.bad-condition-mode',
                        `${key}: condition mode must be has or lacks, got ${condition.mode}`, 'conditions'));
                }
                if (condition.subject !== undefined && condition.subject !== 'card' && condition.subject !== 'achievement') {
                    issues.push(err('events.json', key, 'events.bad-condition-subject',
                        `${key}: condition subject must be card or achievement, got ${condition.subject}`, 'conditions'));
                } else if (condition.subject === 'achievement') {
                    if (!achievementIds || !achievementIds.has(condition.name)) {
                        issues.push(err('events.json', key, 'events.unknown-condition-achievement',
                            `${key}: condition names unknown achievement ${condition.name}`, 'conditions'));
                    }
                } else {
                    const names = cardNames && cardNames[condition.cardKind];
                    if (!names) {
                        issues.push(err('events.json', key, 'events.bad-condition-kind',
                            `${key}: condition cardKind must be pokemon, attack or item, got ${condition.cardKind}`, 'conditions'));
                    } else if (!names.has(condition.name)) {
                        issues.push(err('events.json', key, 'events.unknown-condition-card',
                            `${key}: condition names unknown ${condition.cardKind} ${condition.name}`, 'conditions'));
                    }
                }
                if (condition.text !== undefined && typeof condition.text !== 'string') {
                    issues.push(err('events.json', key, 'events.bad-condition',
                        `${key}: condition text must be a string`, 'conditions'));
                }
            });

            collectEventRequirements(event).forEach((requirement) => {
                if (!requirement || typeof requirement !== 'object') {
                    issues.push(err('events.json', key, 'events.bad-requirement',
                        `${key}: requirement must be an object`, 'requires'));
                    return;
                }
                if (!requirement.id || typeof requirement.id !== 'string') {
                    issues.push(err('events.json', key, 'events.bad-requirement',
                        `${key}: requirement needs an id`, 'requires'));
                    return;
                }

                const requirementKind = requirement.cardKind || requirement.kind;
                const names = cardNames && cardNames[requirementKind];
                if (!names) {
                    issues.push(err('events.json', key, 'events.bad-requirement-kind',
                        `${key}: requirement cardKind must be pokemon, attack or item, got ${requirementKind}`, 'requires'));
                    return;
                }

                // Optional name filter: narrows the picker to specific cards.
                const filter = Array.isArray(requirement.names)
                    ? requirement.names
                    : (requirement.name === undefined ? [] : [requirement.name]);

                filter.forEach((name) => {
                    if (!name || typeof name !== 'string') {
                        issues.push(err('events.json', key, 'events.bad-requirement',
                            `${key}: requirement name must be a non-empty string`, 'requires'));
                    } else if (!names.has(name)) {
                        issues.push(err('events.json', key, 'events.unknown-requirement-card',
                            `${key}: requirement names unknown ${requirementKind} ${name}`, 'requires'));
                    }
                });
            });

            if (event.type === 'choice' && !(Array.isArray(event.choices) && event.choices.length >= 1)) {
                issues.push(err('events.json', key, 'events.no-choices', `${key}: choice event needs >=1 choice`, 'choices'));
            }

            if (event.type === 'trainer') {
                trainerEventCount += 1;
                if (!trainerNames.has(event.trainerName)) {
                    issues.push(err('events.json', key, 'events.unknown-trainer', `${key}: unknown trainer ${event.trainerName}`, 'trainerName'));
                }
            }
        });

        if (trainerEventCount < 1) {
            issues.push(err('events.json', '(dataset)', 'events.no-trainer-event', 'events.json needs at least one trainer event'));
        }

        return issues;
    }

    // -------------------------------------------------------- starter decks

    const ID_PATTERN = /^[a-z0-9-]+$/;

    // Mirrors speciesCanUseAttack() in arena/arena_model.js / pokemonCanUseAttack()
    // in map/run_state.js, kept local so this module stays require-free.
    function cardTypes(record) {
        if (record && Array.isArray(record.types)) return record.types;
        if (!record) return [];
        return [record.type1, record.type2, record.type3].filter((type) => type && type !== 'NONE');
    }

    function speciesCanUseAttack(pokemonRecord, attackRecord) {
        const pokemonTypes = cardTypes(pokemonRecord);
        const requiredTypes = cardTypes(attackRecord);

        if (requiredTypes.length === 0) return true;
        if (attackRecord.full_type_requirements) {
            return requiredTypes.every((type) => pokemonTypes.includes(type));
        }
        return requiredTypes.some((type) => pokemonTypes.includes(type));
    }

    function validateStarterDecks(starterDecks, pokemon, attacks, items, pokemonNames, attackNames, itemNames, enums, achievementIds) {
        const issues = [];
        const validTypes = new Set(Object.values((enums && enums.PokeType) || {}));
        const pokemonByName = new Map(pokemon.map((record) => [record.name, record]));
        const attacksByName = new Map(attacks.map((record) => [record.name, record]));

        const seenIds = new Set();

        starterDecks.forEach((deck) => {
            const key = (deck && deck.id) || '(unnamed deck)';

            if (!deck || !deck.id || typeof deck.id !== 'string') {
                issues.push(err('starter_decks.json', key, 'starterDecks.missing-id', `${key}: entry missing id`, 'id'));
            } else {
                if (seenIds.has(deck.id)) {
                    issues.push(err('starter_decks.json', deck.id, 'starterDecks.duplicate-id', `duplicate starter deck id ${deck.id}`, 'id'));
                }
                seenIds.add(deck.id);
                if (!ID_PATTERN.test(deck.id)) {
                    issues.push(err('starter_decks.json', deck.id, 'starterDecks.bad-id', `${key}: id must match ${ID_PATTERN}`, 'id'));
                }
            }

            if (!deck) return;

            if (!deck.type || !validTypes.has(deck.type)) {
                issues.push(err('starter_decks.json', key, 'starterDecks.bad-type', `${key}: bad type ${deck.type}`, 'type'));
            }

            if (deck.requiresAchievement !== undefined) {
                if (typeof deck.requiresAchievement !== 'string' || deck.requiresAchievement.trim() === '') {
                    issues.push(err('starter_decks.json', key, 'starterDecks.bad-achievement',
                        `${key}: requiresAchievement must be a non-empty achievement id (omit it for an always-available deck)`, 'requiresAchievement'));
                } else if (!achievementIds || !achievementIds.has(deck.requiresAchievement)) {
                    issues.push(err('starter_decks.json', key, 'starterDecks.unknown-achievement',
                        `${key}: requiresAchievement names unknown achievement ${deck.requiresAchievement}`, 'requiresAchievement'));
                }
            }

            const deckPokemon = Array.isArray(deck.pokemon) ? deck.pokemon : [];
            if (deckPokemon.length === 0) {
                issues.push(err('starter_decks.json', key, 'starterDecks.no-pokemon', `${key}: needs at least one pokemon`, 'pokemon'));
            }
            deckPokemon.forEach((name) => {
                if (!pokemonNames.has(name)) {
                    issues.push(err('starter_decks.json', key, 'starterDecks.unknown-pokemon', `${key}: unknown pokemon ${name}`, 'pokemon'));
                }
            });

            (Array.isArray(deck.attacks) ? deck.attacks : []).forEach((entry) => {
                if (!entry || !attackNames.has(entry.name)) {
                    issues.push(err('starter_decks.json', key, 'starterDecks.unknown-attack', `${key}: unknown attack ${entry && entry.name}`, 'attacks'));
                }
                if (!entry || !(Number.isInteger(entry.count) && entry.count >= 1)) {
                    issues.push(err('starter_decks.json', key, 'starterDecks.bad-count', `${key}: attack ${entry && entry.name} needs an integer count >= 1`, 'attacks'));
                }
            });

            (Array.isArray(deck.items) ? deck.items : []).forEach((entry) => {
                if (!entry || !itemNames.has(entry.name)) {
                    issues.push(err('starter_decks.json', key, 'starterDecks.unknown-item', `${key}: unknown item ${entry && entry.name}`, 'items'));
                }
                if (!entry || !(Number.isInteger(entry.count) && entry.count >= 1)) {
                    issues.push(err('starter_decks.json', key, 'starterDecks.bad-count', `${key}: item ${entry && entry.name} needs an integer count >= 1`, 'items'));
                }
            });

            const deckPokemonRecords = deckPokemon.map((name) => pokemonByName.get(name)).filter(Boolean);
            (Array.isArray(deck.attacks) ? deck.attacks : []).forEach((entry) => {
                const attackRecord = entry && attacksByName.get(entry.name);
                if (!attackRecord) return;
                const usable = deckPokemonRecords.some((pokemonRecord) => speciesCanUseAttack(pokemonRecord, attackRecord));
                if (!usable) {
                    issues.push(warn('starter_decks.json', key, 'starterDecks.unusable-attack', `${key}: no pokemon in this deck can legally use ${entry.name}`, 'attacks'));
                }
            });
        });

        if (!starterDecks.some((deck) => deck && deck.enabled !== false)) {
            issues.push(err('starter_decks.json', '(dataset)', 'starterDecks.none-enabled', 'starter_decks.json needs at least one enabled deck'));
        } else if (!starterDecks.some((deck) => deck && deck.enabled !== false && !deck.requiresAchievement)) {
            // Otherwise a brand-new profile opens the starter picker with every
            // deck locked and no way to earn the achievement that unlocks one.
            issues.push(err('starter_decks.json', '(dataset)', 'starterDecks.none-unlocked',
                'starter_decks.json needs at least one enabled deck with no requiresAchievement'));
        }

        return issues;
    }

    // ------------------------------------------------------------- locations

    function validateLocations(locations, enums, starterDecks) {
        const issues = [];
        const validTypes = new Set(Object.values((enums && enums.PokeType) || {}));

        if (locations.length < 8) {
            issues.push(err('locations.json', '(dataset)', 'locations.min-count', `locations.json should have >=8 records, has ${locations.length}`));
        }

        const seenIds = new Set();
        const seenNames = new Set();

        locations.forEach((record) => {
            const key = record.id || record.name || '(unnamed location)';

            if (!record.id || typeof record.id !== 'string') {
                issues.push(err('locations.json', key, 'locations.missing-id', `${key}: entry missing id`, 'id'));
            } else {
                if (seenIds.has(record.id)) {
                    issues.push(err('locations.json', record.id, 'locations.duplicate-id', `duplicate location id ${record.id}`, 'id'));
                }
                seenIds.add(record.id);
            }

            if (record.name) {
                if (seenNames.has(record.name)) {
                    issues.push(err('locations.json', key, 'locations.duplicate-name', `duplicate location name ${record.name}`, 'name'));
                }
                seenNames.add(record.name);
            }

            const types = Array.isArray(record.types) ? record.types : [];
            if (!(types.length >= 2 && types.length <= 4)) {
                issues.push(err('locations.json', key, 'locations.bad-types-count', `${key}: types must be 2-4, has ${types.length}`, 'types'));
            }
            if (new Set(types).size !== types.length) {
                issues.push(err('locations.json', key, 'locations.duplicate-type', `${key}: duplicate type`, 'types'));
            }
            types.forEach((type) => {
                if (!validTypes.has(type) || type === 'NONE' || type === 'LEGENDARY') {
                    issues.push(err('locations.json', key, 'locations.bad-type', `${key}: bad type ${type}`, 'types'));
                }
            });

            if (record.theme && typeof record.theme === 'object') {
                Object.entries(record.theme).forEach(([field, value]) => {
                    if (!HEX_PATTERN.test(String(value))) {
                        issues.push(err('locations.json', key, 'locations.bad-theme-color', `${key}: theme.${field} must be 6-digit hex, got ${value}`, `theme.${field}`));
                    }
                });
            }

            if (record.background && !String(record.background).startsWith('assets/backgrounds/')) {
                issues.push(err('locations.json', key, 'locations.bad-background-path', `${key}: background must live under assets/backgrounds/`, 'background'));
            }
        });

        const enabled = locations.filter((record) => record.enabled !== false);

        const starterTypes = [...new Set((starterDecks || [])
            .filter((deck) => deck && deck.enabled !== false && deck.type)
            .map((deck) => deck.type))];

        starterTypes.forEach((type) => {
            const covered = enabled.some((record) => Array.isArray(record.types) && record.types.includes(type));
            if (!covered) {
                issues.push(err('locations.json', '(dataset)', 'locations.starter-coverage',
                    `no enabled location contains starter type ${type} — enable a location with that type, or disable that starter deck`));
            }
        });

        if (enabled.length > 0) {
            const shareType = (a, b) => (a.types || []).some((type) => (b.types || []).includes(type));
            const visited = new Set([enabled[0].id]);
            const queue = [enabled[0]];

            while (queue.length > 0) {
                const current = queue.shift();
                enabled.forEach((other) => {
                    if (!visited.has(other.id) && shareType(current, other)) {
                        visited.add(other.id);
                        queue.push(other);
                    }
                });
            }

            if (visited.size !== enabled.length) {
                issues.push(err('locations.json', '(dataset)', 'locations.graph-disconnected', `overlap graph is disconnected: reached ${visited.size} of ${enabled.length}`));
            }
        }

        return issues;
    }

    // ----------------------------------------------------------- achievements

    function isKnownStat(stat, statKeys, statPrefixes) {
        const value = String(stat || '');
        if (statKeys.includes(value)) return true;
        return statPrefixes.some((prefix) => value.startsWith(prefix) && value.length > prefix.length);
    }

    function validateAchievements(achievements, enums, events, starterDecks) {
        const issues = [];
        const statKeys = (enums && enums.statKeys) || DEFAULT_STAT_KEYS;
        const statPrefixes = (enums && enums.statPrefixes) || DEFAULT_STAT_PREFIXES;
        const eventIds = new Set((events || []).map((event) => event && event.id).filter(Boolean));
        const starterIds = new Set((starterDecks || []).map((deck) => deck && deck.id).filter(Boolean));

        const seenIds = new Set();

        (achievements || []).forEach((record) => {
            const key = (record && record.id) || '(unnamed achievement)';

            if (!record || !record.id || typeof record.id !== 'string') {
                issues.push(err('achievements.json', key, 'achievements.missing-id', `${key}: entry missing id`, 'id'));
            } else {
                if (seenIds.has(record.id)) {
                    issues.push(err('achievements.json', record.id, 'achievements.duplicate-id', `duplicate achievement id ${record.id}`, 'id'));
                }
                seenIds.add(record.id);
                if (!ID_PATTERN.test(record.id)) {
                    issues.push(err('achievements.json', record.id, 'achievements.bad-id', `${key}: id must match ${ID_PATTERN}`, 'id'));
                }
            }

            if (!record) return;

            if (!record.name || typeof record.name !== 'string') {
                issues.push(err('achievements.json', key, 'achievements.missing-name', `${key}: name must be a non-empty string`, 'name'));
            }

            if (!isKnownStat(record.stat, statKeys, statPrefixes)) {
                issues.push(err('achievements.json', key, 'achievements.bad-stat', `${key}: unknown stat ${record.stat}`, 'stat'));
            } else if (typeof record.stat === 'string' && record.stat.startsWith('events.seen.')) {
                const eventId = record.stat.slice('events.seen.'.length);
                if (!eventIds.has(eventId)) {
                    issues.push(warn('achievements.json', key, 'achievements.unreachable-event', `${key}: stat names unknown event ${eventId}`, 'stat'));
                }
            } else if (typeof record.stat === 'string' && record.stat.startsWith('runs.completed.starter.')) {
                const starterId = record.stat.slice('runs.completed.starter.'.length);
                if (!starterIds.has(starterId)) {
                    issues.push(warn('achievements.json', key, 'achievements.unreachable-starter', `${key}: stat names unknown starter deck ${starterId}`, 'stat'));
                }
            }

            if (!(Number.isInteger(record.atLeast) && record.atLeast >= 1)) {
                issues.push(err('achievements.json', key, 'achievements.bad-threshold', `${key}: atLeast must be an integer >= 1, got ${record.atLeast}`, 'atLeast'));
            }

            if (!record.description) {
                issues.push(warn('achievements.json', key, 'achievements.missing-description', `${key}: description is empty`, 'description'));
            }
        });

        return issues;
    }

    // --------------------------------------------------------------- music

    // `music.missing-file` is deliberately a warning, not an error: the upload
    // route matches an MP3 to an already-saved record (handleUpload looks the
    // id up in music.json), so a new track must be saved *before* its file can
    // exist. An error would make the write guard block that first save and
    // leave the owner with no way to register a song at all.
    function validateMusic(music, enums, assetIndex) {
        const issues = [];
        const categories = (enums && enums.musicCategories) || DEFAULT_MUSIC_CATEGORIES;
        const seenIds = new Set();
        const enabledCategories = new Set();

        (music || []).forEach((record) => {
            const key = (record && record.id) || '(unnamed track)';

            if (!record || !record.id || typeof record.id !== 'string') {
                issues.push(err('music.json', key, 'music.missing-id', `${key}: entry missing id`, 'id'));
            } else {
                if (seenIds.has(record.id)) {
                    issues.push(err('music.json', record.id, 'music.duplicate-id', `duplicate music id ${record.id}`, 'id'));
                }
                seenIds.add(record.id);
                if (!ID_PATTERN.test(record.id)) {
                    issues.push(err('music.json', record.id, 'music.bad-id', `${key}: id must match ${ID_PATTERN} (it becomes the file name)`, 'id'));
                }
            }

            if (!record) return;

            if (!categories.includes(record.category)) {
                issues.push(err('music.json', key, 'music.bad-category', `${key}: category must be one of ${categories.join(', ')}, got ${record.category}`, 'category'));
            } else if (record.enabled !== false) {
                enabledCategories.add(record.category);
            }

            if (record.id && ID_PATTERN.test(record.id)) {
                const canonical = `assets/music/${record.id}.mp3`;
                if (record.file !== canonical) {
                    issues.push(err('music.json', key, 'music.bad-file-path', `${key}: file must be ${canonical}, got ${record.file}`, 'file'));
                }
                if (assetIndex && assetIndex.music && !assetIndex.music.has(`${record.id}.mp3`)) {
                    issues.push(warn('music.json', key, 'music.missing-file', `${key}: no uploaded file at ${canonical}`, 'file'));
                }
            }
        });

        categories.forEach((category) => {
            if (!enabledCategories.has(category)) {
                issues.push(warn('music.json', '(dataset)', 'music.empty-category', `no enabled track for category ${category} — those battles play in silence`));
            }
        });

        return issues;
    }

    // ------------------------------------------------------------- engine refs

    function validateEngineRefs(pokemonNames, attackNames, itemNames, engineRefs) {
        const issues = [];
        if (!engineRefs) return issues;

        function checkDeck(deck, code) {
            if (!deck) return;
            (deck.pokemon || []).forEach((name) => {
                if (!pokemonNames.has(name)) issues.push(err('engine', name, code, `unknown pokemon ${name}`, 'pokemon'));
            });
            (deck.attacks || []).forEach((name) => {
                if (!attackNames.has(name)) issues.push(err('engine', name, code, `unknown attack ${name}`, 'attacks'));
            });
            (deck.items || []).forEach((name) => {
                if (!itemNames.has(name)) issues.push(err('engine', name, code, `unknown item ${name}`, 'items'));
            });
        }

        checkDeck(engineRefs.defaultDeck, 'engine.unknown-default-deck-ref');

        return issues;
    }

    // ------------------------------------------------------------------ assets

    function validateAssets(data, assetIndex, engineRefs) {
        const issues = [];
        if (!assetIndex) return issues;

        const portraitNames = new Set();
        (data.pokemon || []).forEach((record) => {
            const fileName = `${record.name}.png`;
            portraitNames.add(fileName);
            if (!assetIndex.portraits || !assetIndex.portraits.has(fileName)) {
                issues.push(warn('assets', record.name, 'assets.missing-portrait', `missing portrait ${fileName}`, 'portrait'));
            }
        });
        if (assetIndex.portraits) {
            assetIndex.portraits.forEach((fileName) => {
                if (!portraitNames.has(fileName)) {
                    issues.push(warn('assets', fileName, 'assets.orphan-portrait', `orphan portrait file ${fileName}`));
                }
            });
        }

        if (engineRefs && typeof engineRefs.resolveSpriteFile === 'function') {
            (data.trainers || []).forEach((record) => {
                const fileName = engineRefs.resolveSpriteFile(record.name, record.sprite);
                if (!assetIndex.sprites || !assetIndex.sprites.has(fileName)) {
                    issues.push(warn('assets', record.name, 'assets.missing-sprite', `missing sprite ${fileName}`, 'sprite'));
                }
            });
        }
        // Deliberately no orphan-sprite warnings: assets/sprites/ is a
        // 423-file library shared by 95 trainers, so most files are unused
        // by design.

        const itemFileNames = new Set();
        (data.items || []).forEach((record) => {
            const fileName = record.imagePath ? basename(record.imagePath) : `${formatAssetName(record.name)}.png`;
            itemFileNames.add(fileName);
            if (!assetIndex.items || !assetIndex.items.has(fileName)) {
                issues.push(warn('assets', record.name, 'assets.missing-item-image', `missing item image ${fileName}`, 'imagePath'));
            }
        });
        if (assetIndex.items) {
            assetIndex.items.forEach((fileName) => {
                if (!itemFileNames.has(fileName)) {
                    issues.push(warn('assets', fileName, 'assets.orphan-item-image', `orphan item image ${fileName}`));
                }
            });
        }

        const backgroundNames = new Set();
        (data.locations || []).filter((record) => record.enabled !== false).forEach((record) => {
            const fileName = `${record.id}.png`;
            backgroundNames.add(fileName);
            if (!assetIndex.backgrounds || !assetIndex.backgrounds.has(fileName)) {
                issues.push(warn('assets', record.id, 'assets.missing-background', `missing background ${fileName}`, 'background'));
            }
        });
        if (assetIndex.backgrounds) {
            assetIndex.backgrounds.forEach((fileName) => {
                if (!backgroundNames.has(fileName)) {
                    issues.push(warn('assets', fileName, 'assets.orphan-background', `orphan background file ${fileName}`));
                }
            });
        }

        // Only .mp3 files are considered: assets/music/ also holds a README.
        if (assetIndex.music) {
            const musicFileNames = new Set((data.music || []).map((record) => `${record && record.id}.mp3`));
            assetIndex.music.forEach((fileName) => {
                if (fileName.endsWith('.mp3') && !musicFileNames.has(fileName)) {
                    issues.push(warn('assets', fileName, 'music.orphan-file', `orphan music file ${fileName}`));
                }
            });
        }

        return issues;
    }

    // ---------------------------------------------------- name character safety

    // The battle renderer (arena/arena_render.js) interpolates these strings
    // into double-quoted HTML attributes without escaping, so a quote or angle
    // bracket in a name would silently corrupt the DOM. Apostrophes are legal.
    const UNSAFE_NAME_PATTERN = /["<>]/;

    function validateNameCharacters(data) {
        const issues = [];
        const check = (file, recordKey, value, field) => {
            if (typeof value === 'string' && UNSAFE_NAME_PATTERN.test(value)) {
                issues.push(err(file, recordKey, 'data.unsafe-name-chars',
                    `${recordKey}: ${field} must not contain " < or > (breaks battle markup), got ${value}`, field));
            }
        };

        (data.pokemon || []).forEach((record) => check('pokemon.json', record.name, record.name, 'name'));
        (data.attacks || []).forEach((record) => check('attacks.json', record.name, record.name, 'name'));
        (data.items || []).forEach((record) => check('items.json', record.name, record.name, 'name'));
        (data.trainers || []).forEach((record) => check('trainers.json', record.name, record.name, 'name'));
        (data.locations || []).forEach((record) => {
            check('locations.json', record.id, record.name, 'name');
            check('locations.json', record.id, record.terrain, 'terrain');
        });

        return issues;
    }

    // -------------------------------------------------------------- validateAll

    function validateAll(data, options) {
        const opts = options || {};
        const enums = opts.enums || {};
        const assetIndex = opts.assetIndex || null;
        const engineRefs = opts.engineRefs || null;

        const pokemon = data.pokemon || [];
        const attacks = data.attacks || [];
        const items = data.items || [];
        const trainers = data.trainers || [];
        const events = data.events || [];
        const locations = data.locations || [];
        const starterDecks = data.starter_decks || [];
        const achievements = data.achievements || [];
        const music = data.music || [];

        const pokemonNames = new Set(pokemon.map((record) => record.name));
        const attackNames = new Set(attacks.map((record) => record.name));
        const itemNames = new Set(items.map((record) => record.name));
        const trainerNames = new Set(trainers.map((record) => record.name));
        const achievementIds = new Set((data.achievements || []).map((record) => record && record.id).filter(Boolean));
        const eventGrantedPokemon = new Set(
            collectAllEffectRefs(events)
                .map((ref) => ref.effect)
                .filter((effect) => effect && effect.type === 'gain-card' && effect.cardKind === 'pokemon' && effect.name)
                .map((effect) => effect.name)
        );

        return [
            ...validatePokemon(pokemon, enums, eventGrantedPokemon),
            ...validateAttacks(attacks, enums),
            ...validateItems(items, enums),
            ...validateTrainers(trainers, pokemonNames, attackNames, itemNames, enums),
            ...validateEvents(events, trainerNames, enums, locations, { attack: attackNames, item: itemNames, pokemon: pokemonNames }, achievementIds),
            ...validateStarterDecks(starterDecks, pokemon, attacks, items, pokemonNames, attackNames, itemNames, enums, achievementIds),
            ...validateLocations(locations, enums, starterDecks),
            ...validateAchievements(achievements, enums, events, starterDecks),
            ...validateMusic(music, enums, assetIndex),
            ...validateNameCharacters(data),
            ...validateEngineRefs(pokemonNames, attackNames, itemNames, engineRefs),
            ...validateAssets(data, assetIndex, engineRefs)
        ];
    }

    // ------------------------------------------------------------ findReferences

    function collectAllEffectRefs(events) {
        const refs = [];
        (events || []).forEach((event) => {
            collectEventEffects(event).forEach((effect) => refs.push({ event, effect }));
        });
        return refs;
    }

    function collectAllConditionRefs(events) {
        const refs = [];
        (events || []).forEach((event) => {
            collectEventConditions(event).forEach((condition) => {
                if (condition && typeof condition === 'object') refs.push({ event, condition });
            });
        });
        return refs;
    }

    // A requirement's optional name/names filter is matched by name too, so a
    // rename would silently empty its picker.
    function addRequirementRefs(results, events, cardKind, name) {
        (events || []).forEach((event) => {
            collectEventRequirements(event).forEach((requirement) => {
                if (!requirement || typeof requirement !== 'object') return;
                if ((requirement.cardKind || requirement.kind) !== cardKind) return;

                const filter = Array.isArray(requirement.names)
                    ? requirement.names
                    : (requirement.name === undefined ? [] : [requirement.name]);

                if (filter.includes(name)) {
                    results.push({ file: 'events.json', recordKey: event.id, field: 'requires' });
                }
            });
        });
    }

    function addEngineDeckRefs(results, engineRefs, listKey, name) {
        if (!engineRefs) return;
        if (engineRefs.defaultDeck && Array.isArray(engineRefs.defaultDeck[listKey]) && engineRefs.defaultDeck[listKey].includes(name)) {
            results.push({ file: 'engine', recordKey: 'defaultDeck', field: listKey });
        }
    }

    function addStarterDeckRefs(results, data, listKey, name) {
        (data.starter_decks || []).forEach((deck) => {
            const names = listKey === 'pokemon'
                ? (deck.pokemon || [])
                : (deck[listKey] || []).map((entry) => entry && entry.name);
            if (names.includes(name)) {
                results.push({ file: 'starter_decks.json', recordKey: deck.id, field: listKey });
            }
        });
    }

    function findReferences(data, kind, name, engineRefs) {
        const results = [];
        const trainers = data.trainers || [];
        const events = data.events || [];

        if (kind === 'pokemon') {
            trainers.forEach((t) => {
                if (Array.isArray(t.pokemon) && t.pokemon.includes(name)) {
                    results.push({ file: 'trainers.json', recordKey: t.name, field: 'pokemon' });
                }
            });
            collectAllEffectRefs(events).forEach(({ event, effect }) => {
                if (effect.cardKind === 'pokemon' && (effect.name === name || (effect.replacement && effect.replacement.name === name))) {
                    results.push({ file: 'events.json', recordKey: event.id, field: 'effects' });
                }
            });
            collectAllConditionRefs(events).forEach(({ event, condition }) => {
                if (condition.cardKind === 'pokemon' && condition.name === name) {
                    results.push({ file: 'events.json', recordKey: event.id, field: 'conditions' });
                }
            });
            addRequirementRefs(results, events, 'pokemon', name);
            addEngineDeckRefs(results, engineRefs, 'pokemon', name);
            addStarterDeckRefs(results, data, 'pokemon', name);
        } else if (kind === 'attack') {
            trainers.forEach((t) => {
                const flat = Array.isArray(t.attacks) ? t.attacks.flat() : [];
                if (flat.includes(name)) results.push({ file: 'trainers.json', recordKey: t.name, field: 'attacks' });
            });
            collectAllEffectRefs(events).forEach(({ event, effect }) => {
                if (effect.cardKind === 'attack' && (effect.name === name || (effect.replacement && effect.replacement.name === name))) {
                    results.push({ file: 'events.json', recordKey: event.id, field: 'effects' });
                }
            });
            collectAllConditionRefs(events).forEach(({ event, condition }) => {
                if (condition.cardKind === 'attack' && condition.name === name) {
                    results.push({ file: 'events.json', recordKey: event.id, field: 'conditions' });
                }
            });
            addRequirementRefs(results, events, 'attack', name);
            addEngineDeckRefs(results, engineRefs, 'attacks', name);
            addStarterDeckRefs(results, data, 'attacks', name);
        } else if (kind === 'item') {
            trainers.forEach((t) => {
                if (Array.isArray(t.items) && t.items.includes(name)) {
                    results.push({ file: 'trainers.json', recordKey: t.name, field: 'items' });
                }
            });
            collectAllEffectRefs(events).forEach(({ event, effect }) => {
                if (effect.cardKind === 'item' && (effect.name === name || (effect.replacement && effect.replacement.name === name))) {
                    results.push({ file: 'events.json', recordKey: event.id, field: 'effects' });
                }
            });
            collectAllConditionRefs(events).forEach(({ event, condition }) => {
                if (condition.cardKind === 'item' && condition.name === name) {
                    results.push({ file: 'events.json', recordKey: event.id, field: 'conditions' });
                }
            });
            addRequirementRefs(results, events, 'item', name);
            addEngineDeckRefs(results, engineRefs, 'items', name);
            addStarterDeckRefs(results, data, 'items', name);
        } else if (kind === 'trainer') {
            events.forEach((e) => {
                if (e.trainerName === name) results.push({ file: 'events.json', recordKey: e.id, field: 'trainerName' });
            });
        } else if (kind === 'achievement') {
            collectAllConditionRefs(events).forEach(({ event, condition }) => {
                if (condition.subject === 'achievement' && condition.name === name) {
                    results.push({ file: 'events.json', recordKey: event.id, field: 'conditions' });
                }
            });
            (data.starter_decks || []).forEach((deck) => {
                if (deck && deck.requiresAchievement === name) {
                    results.push({ file: 'starter_decks.json', recordKey: deck.id, field: 'requiresAchievement' });
                }
            });
        }
        // locations are never referenced elsewhere.

        return results;
    }

    const api = { validateAll, findReferences };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.EditorValidation = api;
}());
