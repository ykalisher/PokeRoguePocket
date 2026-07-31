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

    function validateEvents(events, trainerNames, enums, locations, cardNames) {
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
                const names = cardNames && cardNames[condition.cardKind];
                if (!names) {
                    issues.push(err('events.json', key, 'events.bad-condition-kind',
                        `${key}: condition cardKind must be pokemon, attack or item, got ${condition.cardKind}`, 'conditions'));
                } else if (!names.has(condition.name)) {
                    issues.push(err('events.json', key, 'events.unknown-condition-card',
                        `${key}: condition names unknown ${condition.cardKind} ${condition.name}`, 'conditions'));
                }
                if (condition.text !== undefined && typeof condition.text !== 'string') {
                    issues.push(err('events.json', key, 'events.bad-condition',
                        `${key}: condition text must be a string`, 'conditions'));
                }
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

    // ------------------------------------------------------------- locations

    function validateLocations(locations, enums, engineRefs) {
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

        if (engineRefs && Array.isArray(engineRefs.starterTypes)) {
            engineRefs.starterTypes.forEach((type) => {
                const covered = enabled.some((record) => Array.isArray(record.types) && record.types.includes(type));
                if (!covered) {
                    issues.push(err('locations.json', '(dataset)', 'locations.starter-coverage', `no enabled location contains starter type ${type}`));
                }
            });
        }

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
        if (engineRefs.starterDecks) {
            Object.values(engineRefs.starterDecks).forEach((deck) => checkDeck(deck, 'engine.unknown-starter-deck-ref'));
        }

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

        const pokemonNames = new Set(pokemon.map((record) => record.name));
        const attackNames = new Set(attacks.map((record) => record.name));
        const itemNames = new Set(items.map((record) => record.name));
        const trainerNames = new Set(trainers.map((record) => record.name));
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
            ...validateEvents(events, trainerNames, enums, locations, { attack: attackNames, item: itemNames, pokemon: pokemonNames }),
            ...validateLocations(locations, enums, engineRefs),
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

    function addEngineDeckRefs(results, engineRefs, listKey, name) {
        if (!engineRefs) return;
        if (engineRefs.defaultDeck && Array.isArray(engineRefs.defaultDeck[listKey]) && engineRefs.defaultDeck[listKey].includes(name)) {
            results.push({ file: 'engine', recordKey: 'defaultDeck', field: listKey });
        }
        if (engineRefs.starterDecks) {
            Object.entries(engineRefs.starterDecks).forEach(([key, deck]) => {
                if (deck && Array.isArray(deck[listKey]) && deck[listKey].includes(name)) {
                    results.push({ file: 'engine', recordKey: `starterDecks.${key}`, field: listKey });
                }
            });
        }
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
            addEngineDeckRefs(results, engineRefs, 'pokemon', name);
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
            addEngineDeckRefs(results, engineRefs, 'attacks', name);
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
            addEngineDeckRefs(results, engineRefs, 'items', name);
        } else if (kind === 'trainer') {
            events.forEach((e) => {
                if (e.trainerName === name) results.push({ file: 'events.json', recordKey: e.id, field: 'trainerName' });
            });
        }
        // events and locations are never referenced elsewhere.

        return results;
    }

    const api = { validateAll, findReferences };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.EditorValidation = api;
}());
