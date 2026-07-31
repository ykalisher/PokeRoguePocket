/**
 * Events tab: list (type badge, id, title, gate type icons, enabled dot) plus
 * the full structured detail editor (event preview LEFT, three-zone form RIGHT)
 * via EditorApp.openEditor(). See dev/feature_plans/25-data-editor-overview.md's
 * "List views" + "Event vocabulary" sections and 32-editor-events.md for the
 * locked spec.
 *
 * Round-trip fidelity is the hard requirement: the editor mutates the
 * structuredClone draft IN PLACE — it sets fields the form edits, deletes a
 * field only when the user clears an optional one, never rebuilds an existing
 * record / effect / choice / requirement, and reorders choices by swapping the
 * existing objects. Saving an unedited event therefore produces an empty diff.
 */
(function (EditorApp, EditorPreview, EditorListView) {
    'use strict';

    const escapeHtml = EditorListView.escapeHtml;
    const escapeAttr = EditorListView.escapeAttr;
    const typeIconHtml = EditorPreview.typeIconHtml;

    const CARD_KINDS_UI = ['pokemon', 'attack', 'item'];
    // Card-condition modes: labels are the UI wording, values are the JSON.
    const CONDITION_MODES = [
        { value: 'has', label: 'Must have' },
        { value: 'lacks', label: 'Must not have' }
    ];
    const STORE_FOR_KIND = { pokemon: 'pokemon', attack: 'attacks', item: 'items' };
    const DATALIST_ID = {
        pokemon: 'editor-events-pokemon-datalist',
        attacks: 'editor-events-attacks-datalist',
        items: 'editor-events-items-datalist',
        trainers: 'editor-events-trainers-datalist'
    };

    const SELECTION_EFFECT_TYPES = [
        'remove-selected-card', 'duplicate-selected-card',
        'replace-selected-card', 'trade-selected-pokemon'
    ];

    // Which fields each effect type shows. 'replacement' = full replacement
    // editor (kind override + name + type filter); 'replacementPokemon' = the
    // pokemon-locked variant (name + type filter only).
    const EFFECT_FIELDS = {
        'gain-cash': ['amount'],
        'lose-cash': ['amount'],
        'gain-card': ['cardKind', 'name', 'count'],
        'gain-random-card': ['cardKind', 'count', 'types', 'excludeName'],
        'gain-random-baby': [],
        'lose-random-cards': ['cardKind', 'count', 'strict'],
        'lose-random-pokemon': ['count', 'strict'],
        'remove-selected-card': ['selectionId'],
        'duplicate-selected-card': ['selectionId'],
        'duplicate-random-card': ['cardKind', 'count', 'strict'],
        'replace-selected-card': ['selectionId', 'replacement'],
        'replace-random-card': ['cardKind', 'count', 'replacement'],
        'trade-selected-pokemon': ['selectionId', 'replacementPokemon'],
        'trade-random-pokemon': ['replacementPokemon']
    };

    // ------------------------------------------------------------- enums

    function eventTypes() {
        return EditorApp.store.enums.eventTypes || ['gift', 'choice', 'trainer'];
    }

    function effectTypes() {
        return EditorApp.store.enums.effectTypes || Object.keys(EFFECT_FIELDS);
    }

    // Location gates never use NONE (empty slot) or LEGENDARY.
    function gateTypeValues() {
        return Object.values(EditorApp.store.enums.PokeType)
            .filter((type) => type !== 'NONE' && type !== 'LEGENDARY')
            .sort();
    }

    // Effect / replacement type filters accept any real PokeType (validation
    // only rejects values outside the enum); NONE is the empty-slot sentinel.
    function effectFilterTypeValues() {
        return Object.values(EditorApp.store.enums.PokeType)
            .filter((type) => type !== 'NONE')
            .sort();
    }

    // ---------------------------------------------------------- lookups

    function isEnabled(record) {
        return record.enabled !== false;
    }

    function findCardRecord(store, name) {
        return (EditorApp.store.data[store] || []).find((record) => record.name === name);
    }

    function isKnownTrainer(name) {
        return (EditorApp.store.data.trainers || []).some((trainer) => trainer.name === name);
    }

    function spritePathForName(name) {
        return window.PokeRogue.TrainerSprites.resolveSprite(name || '', null).path;
    }

    function datalistForStore(store) {
        return DATALIST_ID[store] || DATALIST_ID.pokemon;
    }

    function datalistForKind(kind) {
        return datalistForStore(STORE_FOR_KIND[kind] || 'attacks');
    }

    function getAmount(effect) {
        if (effect.amount != null) return effect.amount;
        if (effect.count != null) return effect.count;
        return 1;
    }

    function getCount(effect) {
        if (effect.count != null) return effect.count;
        if (effect.amount != null) return effect.amount;
        return 1;
    }

    // --------------------------------------------------------- list view

    function columns() {
        return [
            {
                key: 'type',
                label: 'Type',
                render: (record) => `<span class="editor-badge">${escapeHtml(record.type)}</span>`,
                sortValue: (record) => record.type
            },
            {
                key: 'id',
                label: 'ID',
                render: (record) => escapeHtml(record.id),
                sortValue: (record) => record.id
            },
            {
                key: 'title',
                label: 'Title',
                render: (record) => escapeHtml(record.title),
                sortValue: (record) => record.title
            },
            {
                key: 'types',
                label: 'Gate',
                render: (record) => {
                    const locs = Array.isArray(record.locations) ? record.locations : [];
                    const terrs = Array.isArray(record.terrains) ? record.terrains : [];
                    if (locs.length || terrs.length) {
                        return locs.concat(terrs).map((value) => `<span class="editor-badge">${escapeHtml(value)}</span>`).join(' ');
                    }
                    return Array.isArray(record.types) && record.types.length
                        ? record.types.map(typeIconHtml).join('')
                        : '<span class="editor-muted">Any</span>';
                }
            },
            {
                key: 'enabled',
                label: 'Enabled',
                render: (record) => `<span class="editor-dot ${isEnabled(record) ? 'editor-dot--on' : 'editor-dot--off'}" title="${isEnabled(record) ? 'Enabled' : 'Disabled'}"></span>`
            }
        ];
    }

    // ---------------------------------------------------------- templates

    function slugify(text) {
        return String(text || '')
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    function uniqueEventId(base) {
        const existing = new Set((EditorApp.store.data.events || []).map((event) => event.id));
        const root = slugify(base) || 'event';
        if (!existing.has(root)) return root;
        let n = 2;
        while (existing.has(`${root}-${n}`)) n += 1;
        return `${root}-${n}`;
    }

    function uniqueScopedId(prefix, siblings) {
        const used = new Set(siblings.map((entry) => entry.id));
        let n = siblings.length + 1;
        while (used.has(`${prefix}-${n}`)) n += 1;
        return `${prefix}-${n}`;
    }

    function newChoice(existingChoices) {
        return {
            title: '',
            id: uniqueScopedId('choice', existingChoices),
            description: '',
            buttonText: 'Choose',
            requires: [],
            effects: []
        };
    }

    function newRequirement(existingRequires) {
        return { id: uniqueScopedId('req', existingRequires), cardKind: 'pokemon' };
    }

    // cardKind is always explicit: the engine defaults a missing kind to 'attack'.
    function newCondition() {
        return { mode: 'has', cardKind: 'pokemon', name: '' };
    }

    function newPayment() {
        return { title: '', description: '', buttonText: 'Pay', requires: [], effects: [] };
    }

    function newEffect(type) {
        switch (type) {
            case 'gain-cash':
            case 'lose-cash':
                return { type, amount: 1 };
            case 'gain-card':
            case 'gain-random-card':
                return { type, cardKind: 'pokemon', count: 1 };
            case 'lose-random-cards':
            case 'duplicate-random-card':
                return { type, cardKind: 'pokemon', count: 1, strict: false };
            case 'lose-random-pokemon':
                return { type, count: 1, strict: false };
            case 'replace-random-card':
                return { type, cardKind: 'pokemon', count: 1 };
            default:
                // selection / replacement-only effects: fields fill in as edited.
                return { type };
        }
    }

    // Backfill the fields a newly-selected effect type requires so cardKind is
    // always explicit (normalizeCardKind silently defaults to 'attack'). Only
    // runs on an active type switch; shared fields already present are kept.
    function backfillEffectDefaults(effect) {
        const fields = EFFECT_FIELDS[effect.type] || [];
        if (fields.includes('cardKind') && effect.cardKind == null) effect.cardKind = 'pokemon';
        if (fields.includes('count') && effect.count == null) effect.count = 1;
        if (fields.includes('strict') && effect.strict == null) effect.strict = false;
        if (fields.includes('amount') && effect.amount == null) effect.amount = getAmount(effect);
    }

    function giftTemplate() {
        return {
            type: 'gift',
            title: '',
            id: uniqueEventId('new-event'),
            body: '',
            buttonText: 'Take reward',
            effects: [],
            enabled: true
        };
    }

    function choiceTemplate() {
        return {
            type: 'choice',
            title: '',
            id: uniqueEventId('new-event'),
            body: '',
            choices: [newChoice([])],
            enabled: true
        };
    }

    function trainerTemplate() {
        return {
            type: 'trainer',
            title: '',
            id: uniqueEventId('new-event'),
            body: '',
            trainerName: '',
            rewardCash: 0,
            rewardEffects: [],
            enabled: true
        };
    }

    // ------------------------------------------------------ action model

    // An "action" is a container of effects (+ optionally requirements): the
    // gift event, each choice, the trainer battle reward, and the trainer
    // payment. resolveAction maps an owner key back to the live draft object.
    // The pseudo-action 'event' owns nothing but the event-level card
    // conditions, so the same row renderer / handlers serve them too. The gift
    // claim and the battle reward inherit the event-level list instead of
    // carrying one (conditionsField: null).
    function resolveAction(draft, key) {
        if (key === 'event') return { key, obj: draft, effectsField: null, requiresField: null, conditionsField: 'conditions' };
        if (key === 'gift') return { key, obj: draft, effectsField: 'effects', requiresField: 'requires', conditionsField: null };
        if (key === 'reward') return { key, obj: draft, effectsField: 'rewardEffects', requiresField: null, conditionsField: null };
        if (key === 'payment') return { key, obj: draft.payment, effectsField: 'effects', requiresField: 'requires', conditionsField: 'conditions' };
        if (key.indexOf('choice:') === 0) {
            const index = Number(key.slice('choice:'.length));
            return { key, obj: draft.choices[index], effectsField: 'effects', requiresField: 'requires', conditionsField: 'conditions' };
        }
        return null;
    }

    function actionEffects(action) {
        return action.obj[action.effectsField] || [];
    }

    function actionRequires(action) {
        return action.requiresField ? (action.obj[action.requiresField] || []) : [];
    }

    function actionConditions(action) {
        return action.conditionsField ? (action.obj[action.conditionsField] || []) : [];
    }

    function ensureEffects(action) {
        if (!action.obj[action.effectsField]) action.obj[action.effectsField] = [];
        return action.obj[action.effectsField];
    }

    function ensureRequires(action) {
        if (!action.requiresField) return [];
        if (!action.obj[action.requiresField]) action.obj[action.requiresField] = [];
        return action.obj[action.requiresField];
    }

    function ensureConditions(action) {
        if (!action.conditionsField) return [];
        if (!action.obj[action.conditionsField]) action.obj[action.conditionsField] = [];
        return action.obj[action.conditionsField];
    }

    function cleanupReplacement(effect) {
        if (effect.replacement && Object.keys(effect.replacement).length === 0) {
            delete effect.replacement;
        }
    }

    // =================================================================
    // Preview (LEFT pane)
    // =================================================================

    function effectSummaryText(effect) {
        const kind = effect.cardKind || 'attack';
        const repl = effect.replacement || {};
        const replName = repl.name || 'a random card';
        switch (effect.type) {
            case 'gain-cash': return `Gain ${getAmount(effect)} coins`;
            case 'lose-cash': return `Lose ${getAmount(effect)} coins`;
            case 'gain-card': return `Gain ${getCount(effect)}× ${effect.name || '(no card)'} [${kind}]`;
            case 'gain-random-card': {
                const filter = Array.isArray(effect.types) && effect.types.length ? ` (${effect.types.join('/')})` : '';
                const excl = effect.excludeName ? ` excl. ${effect.excludeName}` : '';
                return `Gain ${getCount(effect)} random ${kind}${filter}${excl}`;
            }
            case 'lose-random-cards': return `Lose ${getCount(effect)} random ${kind}${effect.strict ? ' (strict)' : ''}`;
            case 'lose-random-pokemon': return `Lose ${getCount(effect)} random Pokemon${effect.strict ? ' (strict)' : ''}`;
            case 'remove-selected-card': return `Remove selected card${effect.selectionId ? ` (${effect.selectionId})` : ''}`;
            case 'duplicate-selected-card': return `Duplicate selected card${effect.selectionId ? ` (${effect.selectionId})` : ''}`;
            case 'duplicate-random-card': return `Duplicate ${getCount(effect)} random ${kind}${effect.strict ? ' (strict)' : ''}`;
            case 'replace-selected-card': return `Replace selected card → ${replName}`;
            case 'replace-random-card': return `Replace ${getCount(effect)} random ${kind} → ${replName}`;
            case 'trade-selected-pokemon': return `Trade selected Pokemon → ${replName}`;
            case 'trade-random-pokemon': return `Trade a random Pokemon → ${replName}`;
            case 'gain-random-baby': return 'Gain a random baby Pokemon';
            default: return effect.type || '(unknown effect)';
        }
    }

    // Which mini card (if any) a resolved effect should preview.
    function effectMiniCard(effect) {
        const repl = effect.replacement || {};
        if (effect.type === 'gain-card' && effect.name) {
            return { kind: effect.cardKind || 'attack', name: effect.name };
        }
        if ((effect.type === 'replace-selected-card' || effect.type === 'replace-random-card') && repl.name) {
            const kind = repl.cardKind || (effect.type === 'replace-random-card' ? effect.cardKind : null);
            return kind ? { kind, name: repl.name } : null;
        }
        if ((effect.type === 'trade-selected-pokemon' || effect.type === 'trade-random-pokemon') && repl.name) {
            return { kind: 'pokemon', name: repl.name };
        }
        return null;
    }

    function effectPreviewLineHtml(effect) {
        const card = effectMiniCard(effect);
        let cardHtml = '';
        if (card) {
            const store = STORE_FOR_KIND[card.kind];
            const record = store && findCardRecord(store, card.name);
            cardHtml = record
                ? `<span class="editor-events-preview-cardslot" data-card-slot data-store="${store}" data-kind="${escapeAttr(card.kind)}" data-name="${escapeAttr(card.name)}"><span class="editor-preview-card"></span></span>`
                : `<span class="editor-trainer-unknown-card">${escapeHtml(card.name)}</span>`;
        }
        return `<li class="editor-events-preview-effect"><span>${escapeHtml(effectSummaryText(effect))}</span>${cardHtml}</li>`;
    }

    function conditionsPreviewHtml(conditions) {
        const list = (Array.isArray(conditions) ? conditions : []).filter((cond) => cond && cond.name);
        if (!list.length) return '';
        const parts = list.map((cond) =>
            `${cond.mode === 'lacks' ? 'Only without' : 'Requires'} ${cond.name}`);
        return `<p class="editor-events-preview-desc">${escapeHtml(parts.join(' · '))}</p>`;
    }

    function previewActionHtml(title, description, effects, conditions) {
        const effectsHtml = (effects && effects.length)
            ? `<ul class="editor-events-preview-effects">${effects.map(effectPreviewLineHtml).join('')}</ul>`
            : '<p class="editor-muted">No effects.</p>';
        return `
            <div class="editor-events-preview-action">
                <h4>${escapeHtml(title || '')}</h4>
                ${description ? `<p class="editor-events-preview-desc">${escapeHtml(description)}</p>` : ''}
                ${conditionsPreviewHtml(conditions)}
                ${effectsHtml}
            </div>
        `;
    }

    function previewTrainerHeaderHtml(draft) {
        const known = draft.trainerName && isKnownTrainer(draft.trainerName);
        const spriteHtml = known
            ? `<img class="editor-events-preview-sprite" src="${escapeAttr(spritePathForName(draft.trainerName))}" alt="${escapeAttr(draft.trainerName)}">`
            : `<span class="editor-events-preview-sprite editor-events-preview-sprite--missing">${escapeHtml(draft.trainerName || 'No trainer')}</span>`;
        return `
            <div class="editor-events-preview-trainer">
                ${spriteHtml}
                <div class="editor-events-preview-trainer-meta">
                    <strong>${escapeHtml(draft.trainerName || '(no trainer)')}</strong>
                    <span class="editor-events-preview-cash">Reward: ${Number(draft.rewardCash) || 0} coins</span>
                </div>
            </div>
        `;
    }

    function eventPreviewHtml(draft) {
        const locs = Array.isArray(draft.locations) ? draft.locations : [];
        const terrs = Array.isArray(draft.terrains) ? draft.terrains : [];
        let gates;
        if (locs.length || terrs.length) {
            gates = locs.concat(terrs).map((value) => `<span class="editor-badge">${escapeHtml(value)}</span>`).join(' ');
        } else if (Array.isArray(draft.types) && draft.types.length) {
            gates = draft.types.map(typeIconHtml).join('');
        } else {
            gates = '<span class="editor-muted">Any location</span>';
        }

        let actionsHtml = '';
        if (draft.type === 'gift') {
            // The gift claim inherits the event-level conditions.
            actionsHtml = previewActionHtml(draft.actionTitle || 'Claim', draft.rewardText || '', draft.effects || [], draft.conditions);
        } else if (draft.type === 'choice') {
            actionsHtml = (draft.choices || []).map((choice, index) =>
                previewActionHtml(choice.title || `Choice ${index + 1}`, choice.description || choice.text || '', choice.effects || [], choice.conditions)
            ).join('') || '<p class="editor-muted">No choices.</p>';
        } else if (draft.type === 'trainer') {
            actionsHtml = previewTrainerHeaderHtml(draft)
                + previewActionHtml('Battle reward', '', draft.rewardEffects || []);
            if (draft.payment) {
                actionsHtml += previewActionHtml(draft.payment.title || 'Pay and leave', draft.payment.description || '', draft.payment.effects || [], draft.payment.conditions);
            }
        }

        return `
            <div class="editor-events-preview">
                <div class="editor-events-preview-head">
                    <span class="editor-badge">${escapeHtml(draft.type || '')}</span>
                    <span class="editor-events-preview-gates">${gates}</span>
                    ${isEnabled(draft) ? '' : '<span class="editor-badge editor-badge--warning">disabled</span>'}
                </div>
                <div class="editor-events-preview-text">
                    ${draft.kicker ? `<p class="editor-events-preview-kicker">${escapeHtml(draft.kicker)}</p>` : ''}
                    <h3 class="editor-events-preview-title">${escapeHtml(draft.title || '(untitled)')}</h3>
                    ${draft.subtitle ? `<p class="editor-events-preview-subtitle">${escapeHtml(draft.subtitle)}</p>` : ''}
                    ${conditionsPreviewHtml(draft.conditions)}
                    ${draft.body ? `<p class="editor-events-preview-body">${escapeHtml(draft.body)}</p>` : ''}
                </div>
                <div class="editor-events-preview-actions">${actionsHtml}</div>
            </div>
        `;
    }

    function renderPreview(el, draft) {
        el.innerHTML = eventPreviewHtml(draft);
        el.querySelectorAll('[data-card-slot]').forEach((slot) => {
            const record = findCardRecord(slot.dataset.store, slot.dataset.name);
            if (record) EditorPreview.renderCardInto(slot.querySelector('.editor-preview-card'), slot.dataset.kind, record);
        });
    }

    // =================================================================
    // Form (RIGHT pane)
    // =================================================================

    function optionTags(values, current) {
        return values.map((value) =>
            `<option value="${escapeAttr(value)}"${value === current ? ' selected' : ''}>${escapeHtml(value)}</option>`
        ).join('');
    }

    function conditionModeOptions(current) {
        return CONDITION_MODES.map(({ value, label }) =>
            `<option value="${escapeAttr(value)}"${value === current ? ' selected' : ''}>${escapeHtml(label)}</option>`
        ).join('');
    }

    function textField(label, scopeAttrs, value) {
        return `<label>${escapeHtml(label)}<input type="text" ${scopeAttrs} value="${escapeAttr(value || '')}"></label>`;
    }

    function textArea(label, scopeAttrs, value) {
        return `<label>${escapeHtml(label)}<textarea ${scopeAttrs} rows="3">${escapeHtml(value || '')}</textarea></label>`;
    }

    function unknownBadge(store, name) {
        if (!name || findCardRecord(store, name)) return '';
        return '<span class="editor-badge editor-badge--warning">unknown</span>';
    }

    // ---- chip pickers (gate types, effect/replacement type filters) ----

    function chipListHtml(values, addScopeAttrs, removeAttrsFor, available) {
        const chips = values.map((value, index) =>
            `<span class="editor-chip">${typeIconHtml(value)}${escapeHtml(value)}` +
            `<button type="button" class="editor-chip-remove" ${removeAttrsFor(index)} aria-label="Remove ${escapeAttr(value)}">×</button></span>`
        ).join('');
        const remaining = available.filter((value) => !values.includes(value));
        return `<div class="editor-chip-list">${chips}` +
            `<select class="editor-chip-add" ${addScopeAttrs}><option value="">+ type…</option>${optionTags(remaining, '')}</select></div>`;
    }

    function gateChipsHtml(draft) {
        const values = draft.types || [];
        return chipListHtml(
            values,
            'data-scope="gate-add"',
            (index) => `data-action="chip-remove" data-chip="gate" data-chip-index="${index}"`,
            gateTypeValues()
        );
    }

    function plainChipListHtml(values, addScopeAttrs, removeAttrsFor, available, placeholder) {
        const chips = values.map((value, index) =>
            `<span class="editor-chip">${escapeHtml(value)}` +
            `<button type="button" class="editor-chip-remove" ${removeAttrsFor(index)} aria-label="Remove ${escapeAttr(value)}">×</button></span>`
        ).join('');
        const remaining = available.filter((value) => !values.includes(value));
        return `<div class="editor-chip-list">${chips}` +
            `<select class="editor-chip-add" ${addScopeAttrs}><option value="">${placeholder}</option>${optionTags(remaining, '')}</select></div>`;
    }

    function locationIdValues() {
        return (EditorApp.store.data.locations || []).map((record) => record.id).sort();
    }

    function terrainValues() {
        // Distinct terrain labels, deduped case-insensitively, first-seen casing kept.
        const seen = new Map();
        (EditorApp.store.data.locations || []).forEach((record) => {
            const label = String(record.terrain || '').trim();
            if (label && !seen.has(label.toLowerCase())) seen.set(label.toLowerCase(), label);
        });
        return Array.from(seen.values()).sort();
    }

    function locationChipsHtml(draft) {
        return plainChipListHtml(
            draft.locations || [],
            'data-scope="event-locations-add"',
            (index) => `data-action="chip-remove" data-chip="event-locations" data-chip-index="${index}"`,
            locationIdValues(),
            '+ location…'
        );
    }

    function terrainChipsHtml(draft) {
        return plainChipListHtml(
            draft.terrains || [],
            'data-scope="event-terrains-add"',
            (index) => `data-action="chip-remove" data-chip="event-terrains" data-chip-index="${index}"`,
            terrainValues(),
            '+ terrain…'
        );
    }

    function effectTypesChipsHtml(effect, index, owner) {
        const values = effect.types || [];
        return chipListHtml(
            values,
            `data-scope="eff-types-add" data-owner="${escapeAttr(owner)}" data-index="${index}"`,
            (chipIndex) => `data-action="chip-remove" data-chip="eff-types" data-owner="${escapeAttr(owner)}" data-index="${index}" data-chip-index="${chipIndex}"`,
            effectFilterTypeValues()
        );
    }

    function replacementTypesChipsHtml(effect, index, owner) {
        const values = (effect.replacement && effect.replacement.types) || [];
        return chipListHtml(
            values,
            `data-scope="eff-repl-types-add" data-owner="${escapeAttr(owner)}" data-index="${index}"`,
            (chipIndex) => `data-action="chip-remove" data-chip="eff-repl-types" data-owner="${escapeAttr(owner)}" data-index="${index}" data-chip-index="${chipIndex}"`,
            effectFilterTypeValues()
        );
    }

    // ---- selection-id select ----

    function selectionSelectHtml(effect, index, action) {
        if (!action.requiresField) {
            return '<label>Selection<span class="editor-events-flag">Reward effects cannot reference a selection.</span></label>';
        }
        const requires = actionRequires(action);
        const current = effect.selectionId || '';
        const base = `data-scope="eff-selection" data-owner="${escapeAttr(action.key)}" data-index="${index}"`;
        let opts = '<option value="">— choose requirement —</option>';
        opts += requires.map((req) =>
            `<option value="${escapeAttr(req.id)}"${req.id === current ? ' selected' : ''}>${escapeHtml(req.id)}</option>`
        ).join('');
        if (current && !requires.some((req) => req.id === current)) {
            opts += `<option value="${escapeAttr(current)}" selected>${escapeHtml(current)} (missing)</option>`;
        }
        const warn = requires.length === 0
            ? '<span class="editor-events-flag">Add a requirement above for this effect to select from.</span>'
            : '';
        return `<label>Selection<select ${base}>${opts}</select>${warn}</label>`;
    }

    // ---- replacement sub-editor ----

    function replacementEditorHtml(effect, index, action, pokemonLocked) {
        const owner = action.key;
        const repl = effect.replacement || {};
        const base = `data-owner="${escapeAttr(owner)}" data-index="${index}"`;
        const nameKind = pokemonLocked
            ? 'pokemon'
            : (repl.cardKind || (effect.type === 'replace-random-card' ? effect.cardKind : 'attack'));
        const nameStore = STORE_FOR_KIND[nameKind] || 'attacks';

        const kindLabel = effect.type === 'replace-random-card' ? 'pool' : 'selected';
        const kindSelect = pokemonLocked
            ? ''
            : `<label>Replacement kind<select data-scope="eff-repl-cardkind" ${base}>` +
              `<option value="">(same as ${kindLabel})</option>${optionTags(CARD_KINDS_UI, repl.cardKind || '')}</select></label>`;

        return `
            <div class="editor-events-replacement">
                <span class="editor-events-replacement-title">Replacement</span>
                <div class="editor-form-row">
                    ${kindSelect}
                    <label>Replacement card
                        <input type="text" list="${datalistForStore(nameStore)}" data-scope="eff-repl" ${base} data-field="name" value="${escapeAttr(repl.name || '')}">
                        ${unknownBadge(nameStore, repl.name)}
                    </label>
                </div>
                <label>Type filter${replacementTypesChipsHtml(effect, index, owner)}</label>
            </div>
        `;
    }

    // ---- one effect field ----

    function effectFieldHtml(field, effect, index, action) {
        const owner = action.key;
        const base = `data-owner="${escapeAttr(owner)}" data-index="${index}"`;
        switch (field) {
            case 'amount':
                return `<label>Amount<input type="number" min="1" data-scope="eff" ${base} data-field="amount" value="${getAmount(effect)}"></label>`;
            case 'count':
                return `<label>Count<input type="number" min="1" data-scope="eff" ${base} data-field="count" value="${getCount(effect)}"></label>`;
            case 'cardKind':
                return `<label>Card kind<select data-scope="eff-cardkind" ${base}>${optionTags(CARD_KINDS_UI, effect.cardKind || 'pokemon')}</select></label>`;
            case 'name': {
                const store = STORE_FOR_KIND[effect.cardKind] || 'attacks';
                return `<label>Card<input type="text" list="${datalistForStore(store)}" data-scope="eff" ${base} data-field="name" value="${escapeAttr(effect.name || '')}">${unknownBadge(store, effect.name)}</label>`;
            }
            case 'excludeName': {
                const store = STORE_FOR_KIND[effect.cardKind] || 'attacks';
                return `<label>Exclude card<input type="text" list="${datalistForStore(store)}" data-scope="eff" ${base} data-field="excludeName" value="${escapeAttr(effect.excludeName || '')}">${unknownBadge(store, effect.excludeName)}</label>`;
            }
            case 'strict':
                return `<label class="editor-form-checkbox"><input type="checkbox" data-scope="eff-strict" ${base}${effect.strict ? ' checked' : ''}> Strict (block if too few)</label>`;
            case 'types':
                return `<label>Type filter${effectTypesChipsHtml(effect, index, owner)}</label>`;
            case 'selectionId':
                return selectionSelectHtml(effect, index, action);
            case 'replacement':
                return replacementEditorHtml(effect, index, action, false);
            case 'replacementPokemon':
                return replacementEditorHtml(effect, index, action, true);
            default:
                return '';
        }
    }

    function effectRowHtml(effect, index, action) {
        const owner = action.key;
        const base = `data-owner="${escapeAttr(owner)}" data-index="${index}"`;
        const requires = actionRequires(action);
        const dangling = SELECTION_EFFECT_TYPES.indexOf(effect.type) !== -1
            && effect.selectionId
            && !requires.some((req) => req.id === effect.selectionId);
        const fields = EFFECT_FIELDS[effect.type] || [];
        const fieldsHtml = fields.map((field) => effectFieldHtml(field, effect, index, action)).join('');

        return `
            <li class="editor-events-eff-row${dangling ? ' editor-events-eff-row--flagged' : ''}">
                <div class="editor-events-eff-head">
                    <select data-scope="eff-type" ${base}>${optionTags(effectTypes(), effect.type)}</select>
                    <button type="button" class="editor-btn editor-btn--danger editor-events-row-remove" data-action="remove-effect" ${base}>Remove</button>
                </div>
                <div class="editor-form-row editor-events-eff-fields">${fieldsHtml || '<span class="editor-muted">No fields.</span>'}</div>
                ${dangling ? `<p class="editor-events-flag">selectionId “${escapeHtml(effect.selectionId)}” no longer matches a requirement.</p>` : ''}
            </li>
        `;
    }

    function effectsEditorHtml(action, title) {
        const effects = actionEffects(action);
        const rows = effects.length
            ? effects.map((effect, index) => effectRowHtml(effect, index, action)).join('')
            : '<li class="editor-empty">No effects.</li>';
        return `
            <div class="editor-events-subsection">
                <h4>${escapeHtml(title || 'Effects')}</h4>
                <ul class="editor-events-rows">${rows}</ul>
                <button type="button" class="editor-btn" data-action="add-effect" data-owner="${escapeAttr(action.key)}">+ Add effect</button>
            </div>
        `;
    }

    // ---- requirements editor ----

    function requirementRowHtml(req, index, owner) {
        const base = `data-owner="${escapeAttr(owner)}" data-index="${index}"`;
        return `
            <li class="editor-events-req-row">
                <div class="editor-form-row">
                    ${textField('ID', `data-scope="req" ${base} data-field="id"`, req.id)}
                    <label>Card kind<select data-scope="req-cardkind" ${base}>${optionTags(CARD_KINDS_UI, req.cardKind || 'pokemon')}</select></label>
                    <button type="button" class="editor-btn editor-btn--danger editor-events-row-remove" data-action="remove-req" ${base}>Remove</button>
                </div>
                <div class="editor-form-row">
                    ${textField('Prompt', `data-scope="req" ${base} data-field="prompt"`, req.prompt)}
                    ${textField('Label', `data-scope="req" ${base} data-field="label"`, req.label)}
                    ${textField('Empty text', `data-scope="req" ${base} data-field="emptyText"`, req.emptyText)}
                </div>
            </li>
        `;
    }

    function requirementsEditorHtml(action) {
        const requires = actionRequires(action);
        const rows = requires.length
            ? requires.map((req, index) => requirementRowHtml(req, index, action.key)).join('')
            : '<li class="editor-empty">No requirements.</li>';
        return `
            <div class="editor-events-subsection">
                <h4>Requirements</h4>
                <ul class="editor-events-rows">${rows}</ul>
                <button type="button" class="editor-btn" data-action="add-req" data-owner="${escapeAttr(action.key)}">+ Add requirement</button>
            </div>
        `;
    }

    // ---- card conditions editor ----

    function conditionRowHtml(cond, index, owner) {
        const base = `data-owner="${escapeAttr(owner)}" data-index="${index}"`;
        const kind = cond.cardKind || 'pokemon';
        const store = STORE_FOR_KIND[kind] || 'pokemon';
        return `
            <li class="editor-events-req-row">
                <div class="editor-form-row">
                    <label>Rule<select data-scope="cond-mode" ${base}>${conditionModeOptions(cond.mode || 'has')}</select></label>
                    <label>Card kind<select data-scope="cond-cardkind" ${base}>${optionTags(CARD_KINDS_UI, kind)}</select></label>
                    <label>Card<input type="text" list="${datalistForStore(store)}" data-scope="cond" ${base} data-field="name" value="${escapeAttr(cond.name || '')}">${unknownBadge(store, cond.name)}</label>
                    <button type="button" class="editor-btn editor-btn--danger editor-events-row-remove" data-action="remove-cond" ${base}>Remove</button>
                </div>
                <div class="editor-form-row">
                    ${textField('Locked text', `data-scope="cond" ${base} data-field="text"`, cond.text)}
                </div>
            </li>
        `;
    }

    function conditionsEditorHtml(action, title, hint) {
        const conditions = actionConditions(action);
        const rows = conditions.length
            ? conditions.map((cond, index) => conditionRowHtml(cond, index, action.key)).join('')
            : '<li class="editor-empty">No conditions.</li>';
        return `
            <div class="editor-events-subsection">
                <h4>${escapeHtml(title)}</h4>
                <span class="editor-hint">${escapeHtml(hint)}</span>
                <ul class="editor-events-rows">${rows}</ul>
                <button type="button" class="editor-btn" data-action="add-cond" data-owner="${escapeAttr(action.key)}">+ Add condition</button>
            </div>
        `;
    }

    // ---- form zones ----

    function commonZoneHtml(draft) {
        return `
            <div class="editor-events-zone">
                <h3 class="editor-events-zone-title">Event</h3>
                <div class="editor-form-row">
                    ${textField('ID', 'data-scope="common" data-field="id"', draft.id)}
                    <label>Type<select data-scope="event-type">${optionTags(eventTypes(), draft.type)}</select></label>
                </div>
                <div class="editor-form-row">
                    ${textField('Title', 'data-scope="common" data-field="title"', draft.title)}
                    ${textField('Kicker', 'data-scope="common" data-field="kicker"', draft.kicker)}
                </div>
                <div class="editor-form-row">
                    ${textField('Subtitle', 'data-scope="common" data-field="subtitle"', draft.subtitle)}
                    ${textField('Result title', 'data-scope="common" data-field="resultTitle"', draft.resultTitle)}
                </div>
                <div class="editor-form-row">
                    ${textArea('Body', 'data-scope="common" data-field="body"', draft.body)}
                </div>
                <div class="editor-form-row">
                    <label class="editor-form-checkbox"><input type="checkbox" data-scope="common" data-field="enabled"${isEnabled(draft) ? ' checked' : ''}> Enabled</label>
                </div>
                <label>Location gate types${gateChipsHtml(draft)}</label>
                <label>Only at locations${locationChipsHtml(draft)}</label>
                <label>Only at terrains${terrainChipsHtml(draft)}</label>
                <span class="editor-hint">If either override list is set, it replaces the type gate: the event appears only at those location ids / terrains.</span>
                ${conditionsEditorHtml(resolveAction(draft, 'event'), 'Event card conditions',
                    'Checked when the game picks an event: the whole event is skipped unless the run satisfies every condition. Nothing is selected or taken away. A gift event\'s claim button inherits these too.')}
            </div>
        `;
    }

    function giftZoneHtml(draft) {
        const action = resolveAction(draft, 'gift');
        return `
            <div class="editor-events-zone">
                <h3 class="editor-events-zone-title">Gift reward</h3>
                <div class="editor-form-row">
                    ${textField('Action title', 'data-scope="common" data-field="actionTitle"', draft.actionTitle)}
                    ${textField('Button text', 'data-scope="common" data-field="buttonText"', draft.buttonText)}
                </div>
                <div class="editor-form-row">
                    ${textField('Reward text', 'data-scope="common" data-field="rewardText"', draft.rewardText)}
                </div>
                ${requirementsEditorHtml(action)}
                ${effectsEditorHtml(action)}
            </div>
        `;
    }

    function choiceBlockHtml(choice, index, total) {
        const choiceAction = { key: `choice:${index}`, obj: choice, effectsField: 'effects', requiresField: 'requires', conditionsField: 'conditions' };
        const base = `data-choice="${index}"`;
        return `
            <div class="editor-events-choice">
                <div class="editor-events-choice-head">
                    <span class="editor-events-choice-label">Choice ${index + 1}</span>
                    <span class="editor-events-choice-controls">
                        <button type="button" class="editor-btn editor-btn--ghost" data-action="move-choice" data-dir="up" data-index="${index}"${index === 0 ? ' disabled' : ''} aria-label="Move up">↑</button>
                        <button type="button" class="editor-btn editor-btn--ghost" data-action="move-choice" data-dir="down" data-index="${index}"${index === total - 1 ? ' disabled' : ''} aria-label="Move down">↓</button>
                        <button type="button" class="editor-btn editor-btn--danger" data-action="remove-choice" data-index="${index}">Remove</button>
                    </span>
                </div>
                <div class="editor-form-row">
                    ${textField('ID', `data-scope="choice" ${base} data-field="id"`, choice.id)}
                    ${textField('Title', `data-scope="choice" ${base} data-field="title"`, choice.title)}
                    ${textField('Button text', `data-scope="choice" ${base} data-field="buttonText"`, choice.buttonText)}
                </div>
                <div class="editor-form-row">
                    ${textArea('Description', `data-scope="choice" ${base} data-field="description"`, choice.description || choice.text)}
                </div>
                ${conditionsEditorHtml(choiceAction, 'Choice card conditions',
                    'Grays out this choice unless the run satisfies every condition. Unlike a requirement, the player picks nothing and loses nothing.')}
                ${requirementsEditorHtml(choiceAction)}
                ${effectsEditorHtml(choiceAction)}
            </div>
        `;
    }

    function choiceZoneHtml(draft) {
        const choices = draft.choices || [];
        const blocks = choices.length
            ? choices.map((choice, index) => choiceBlockHtml(choice, index, choices.length)).join('')
            : '<p class="editor-empty">No choices yet.</p>';
        return `
            <div class="editor-events-zone">
                <h3 class="editor-events-zone-title">Choices</h3>
                ${blocks}
                <button type="button" class="editor-btn editor-btn--primary" data-action="add-choice">+ Add choice</button>
            </div>
        `;
    }

    function paymentZoneHtml(draft) {
        if (!draft.payment) {
            return `
                <div class="editor-events-subzone">
                    <button type="button" class="editor-btn" data-action="add-payment">+ Add payment option</button>
                </div>
            `;
        }
        const action = resolveAction(draft, 'payment');
        return `
            <div class="editor-events-subzone">
                <div class="editor-events-choice-head">
                    <span class="editor-events-choice-label">Payment option</span>
                    <button type="button" class="editor-btn editor-btn--danger" data-action="remove-payment">Remove payment</button>
                </div>
                <div class="editor-form-row">
                    ${textField('Title', 'data-scope="payment" data-field="title"', draft.payment.title)}
                    ${textField('Button text', 'data-scope="payment" data-field="buttonText"', draft.payment.buttonText)}
                </div>
                <div class="editor-form-row">
                    ${textArea('Description', 'data-scope="payment" data-field="description"', draft.payment.description)}
                </div>
                ${conditionsEditorHtml(action, 'Payment card conditions',
                    'Grays out this payment option unless the run satisfies every condition. Unlike a requirement, the player picks nothing and loses nothing.')}
                ${requirementsEditorHtml(action)}
                ${effectsEditorHtml(action)}
            </div>
        `;
    }

    function trainerZoneHtml(draft) {
        const rewardAction = resolveAction(draft, 'reward');
        const known = draft.trainerName && isKnownTrainer(draft.trainerName);
        const flagHtml = draft.trainerName
            ? (known ? '' : '<span class="editor-badge editor-badge--warning">unknown trainer</span>')
            : '<span class="editor-hint">No trainer selected.</span>';
        return `
            <div class="editor-events-zone">
                <h3 class="editor-events-zone-title">Trainer battle</h3>
                <div class="editor-form-row">
                    <label>Trainer
                        <div class="editor-events-trainer-pick">
                            <img class="editor-thumb" data-role="trainer-thumb" src="${escapeAttr(spritePathForName(draft.trainerName))}" alt="">
                            <input type="text" list="${DATALIST_ID.trainers}" data-scope="trainer-name" value="${escapeAttr(draft.trainerName || '')}">
                        </div>
                        <span class="editor-hint" data-role="trainer-name-flag">${flagHtml}</span>
                    </label>
                    <label>Reward cash<input type="number" min="0" data-scope="rewardcash" value="${Number(draft.rewardCash) || 0}"></label>
                </div>
                <div class="editor-form-row">
                    ${textField('Battle title', 'data-scope="common" data-field="battleTitle"', draft.battleTitle)}
                    ${textField('Battle button text', 'data-scope="common" data-field="battleButtonText"', draft.battleButtonText)}
                </div>
                <div class="editor-form-row">
                    ${textArea('Battle text', 'data-scope="common" data-field="battleText"', draft.battleText)}
                </div>
                ${effectsEditorHtml(rewardAction, 'Battle reward effects')}
                ${paymentZoneHtml(draft)}
            </div>
        `;
    }

    function conditionalZoneHtml(draft) {
        if (draft.type === 'gift') return giftZoneHtml(draft);
        if (draft.type === 'choice') return choiceZoneHtml(draft);
        if (draft.type === 'trainer') return trainerZoneHtml(draft);
        return '';
    }

    function datalistHtml(id, names) {
        return `<datalist id="${id}">${names.map((name) => `<option value="${escapeAttr(name)}">`).join('')}</datalist>`;
    }

    function datalistsHtml() {
        const data = EditorApp.store.data;
        return datalistHtml(DATALIST_ID.pokemon, (data.pokemon || []).map((r) => r.name))
            + datalistHtml(DATALIST_ID.attacks, (data.attacks || []).map((r) => r.name))
            + datalistHtml(DATALIST_ID.items, (data.items || []).map((r) => r.name))
            + datalistHtml(DATALIST_ID.trainers, (data.trainers || []).map((r) => r.name));
    }

    function formHtml(draft) {
        return commonZoneHtml(draft) + conditionalZoneHtml(draft) + datalistsHtml();
    }

    // =================================================================
    // Form wiring
    // =================================================================

    function setOrDelete(obj, key, value) {
        if (value === '' || value == null) delete obj[key];
        else obj[key] = value;
    }

    function renderForm(el, draft, api) {
        // A fresh inner root per call means listeners always close over the
        // current draft (revert swaps in a new draft object) and never stack up.
        el.innerHTML = '';
        const root = document.createElement('div');
        root.className = 'editor-events-form';
        el.appendChild(root);

        function paint() {
            root.innerHTML = formHtml(draft);
        }

        function commit(repaint) {
            api.markDirty();
            if (repaint) paint();
            api.refreshPreview();
        }

        function effectAt(owner, index) {
            return actionEffects(resolveAction(draft, owner))[index];
        }

        function requireAt(owner, index) {
            return actionRequires(resolveAction(draft, owner))[index];
        }

        function conditionAt(owner, index) {
            return actionConditions(resolveAction(draft, owner))[index];
        }

        function applyCommonField(field, value) {
            if (field === 'id' || field === 'title' || field === 'body') draft[field] = value;
            else setOrDelete(draft, field, value);
        }

        function applyTrainerName(value) {
            setOrDelete(draft, 'trainerName', value);
            const thumb = root.querySelector('[data-role="trainer-thumb"]');
            if (thumb) thumb.src = spritePathForName(draft.trainerName);
            const flag = root.querySelector('[data-role="trainer-name-flag"]');
            if (flag) {
                if (!draft.trainerName) flag.innerHTML = '<span class="editor-hint">No trainer selected.</span>';
                else if (isKnownTrainer(draft.trainerName)) flag.innerHTML = '';
                else flag.innerHTML = '<span class="editor-badge editor-badge--warning">unknown trainer</span>';
            }
        }

        // -------- text / number / textarea input (no repaint) --------
        root.addEventListener('input', (event) => {
            const target = event.target;
            if (target.tagName === 'SELECT' || target.type === 'checkbox') return;
            const scope = target.dataset.scope;
            if (!scope) return;
            const value = target.value;
            const owner = target.dataset.owner;
            const index = Number(target.dataset.index);
            const field = target.dataset.field;

            if (scope === 'common') applyCommonField(field, value);
            else if (scope === 'rewardcash') draft.rewardCash = Number(value) || 0;
            else if (scope === 'trainer-name') applyTrainerName(value);
            else if (scope === 'payment') { if (draft.payment) setOrDelete(draft.payment, field, value); }
            else if (scope === 'choice') {
                const choice = draft.choices[Number(target.dataset.choice)];
                if (field === 'id') choice.id = value;
                else setOrDelete(choice, field, value);
            } else if (scope === 'req') {
                const req = requireAt(owner, index);
                if (field === 'id') req.id = value;
                else setOrDelete(req, field, value);
            } else if (scope === 'cond') {
                const cond = conditionAt(owner, index);
                // name is always set (never deleted) so a cleared box round-trips
                // as "" instead of vanishing mid-edit — same as req.id / choice.id.
                if (field === 'name') cond.name = value;
                else setOrDelete(cond, field, value);
            } else if (scope === 'eff') {
                const effect = effectAt(owner, index);
                if (field === 'amount' || field === 'count') effect[field] = Number(value) || 1;
                else setOrDelete(effect, field, value);
            } else if (scope === 'eff-repl') {
                const effect = effectAt(owner, index);
                if (value === '') {
                    if (effect.replacement) { delete effect.replacement.name; cleanupReplacement(effect); }
                } else {
                    effect.replacement = effect.replacement || {};
                    effect.replacement.name = value;
                }
            } else {
                return;
            }
            commit(false);
        });

        // -------- select / checkbox changes (structural repaint) --------
        root.addEventListener('change', (event) => {
            const target = event.target;
            const scope = target.dataset.scope;
            if (!scope) return;
            const value = target.value;
            const owner = target.dataset.owner;
            const index = Number(target.dataset.index);
            let repaint = true;

            switch (scope) {
                case 'common': // enabled checkbox
                    if (target.dataset.field === 'enabled') draft.enabled = target.checked;
                    repaint = false;
                    break;
                case 'event-type':
                    draft.type = value;
                    break;
                case 'gate-add':
                    if (value) { draft.types = draft.types || []; draft.types.push(value); }
                    break;
                case 'event-locations-add':
                    if (value) { draft.locations = draft.locations || []; draft.locations.push(value); }
                    break;
                case 'event-terrains-add':
                    if (value) { draft.terrains = draft.terrains || []; draft.terrains.push(value); }
                    break;
                case 'req-cardkind':
                    requireAt(owner, index).cardKind = value;
                    break;
                case 'cond-mode':
                    conditionAt(owner, index).mode = value;
                    break;
                case 'cond-cardkind':
                    // Repaints: the datalist and the unknown badge follow the kind.
                    conditionAt(owner, index).cardKind = value;
                    break;
                case 'eff-type': {
                    const effect = effectAt(owner, index);
                    effect.type = value;
                    backfillEffectDefaults(effect);
                    break;
                }
                case 'eff-cardkind':
                    effectAt(owner, index).cardKind = value;
                    break;
                case 'eff-selection':
                    setOrDelete(effectAt(owner, index), 'selectionId', value);
                    break;
                case 'eff-strict':
                    effectAt(owner, index).strict = target.checked;
                    repaint = false;
                    break;
                case 'eff-repl-cardkind': {
                    const effect = effectAt(owner, index);
                    if (value) { effect.replacement = effect.replacement || {}; effect.replacement.cardKind = value; }
                    else if (effect.replacement) { delete effect.replacement.cardKind; cleanupReplacement(effect); }
                    break;
                }
                case 'eff-types-add': {
                    const effect = effectAt(owner, index);
                    if (value) { effect.types = effect.types || []; effect.types.push(value); }
                    break;
                }
                case 'eff-repl-types-add': {
                    const effect = effectAt(owner, index);
                    if (value) {
                        effect.replacement = effect.replacement || {};
                        effect.replacement.types = effect.replacement.types || [];
                        effect.replacement.types.push(value);
                    }
                    break;
                }
                default:
                    return;
            }
            commit(repaint);
        });

        // -------- buttons (add / remove / reorder / chip remove) --------
        root.addEventListener('click', (event) => {
            const btn = event.target.closest('[data-action]');
            if (!btn) return;
            const action = btn.dataset.action;
            const owner = btn.dataset.owner;
            const index = Number(btn.dataset.index);

            if (action === 'add-effect') {
                ensureEffects(resolveAction(draft, owner)).push(newEffect('gain-cash'));
            } else if (action === 'remove-effect') {
                actionEffects(resolveAction(draft, owner)).splice(index, 1);
            } else if (action === 'add-req') {
                const reqs = ensureRequires(resolveAction(draft, owner));
                reqs.push(newRequirement(reqs));
            } else if (action === 'remove-req') {
                actionRequires(resolveAction(draft, owner)).splice(index, 1);
            } else if (action === 'add-cond') {
                ensureConditions(resolveAction(draft, owner)).push(newCondition());
            } else if (action === 'remove-cond') {
                const target = resolveAction(draft, owner);
                actionConditions(target).splice(index, 1);
                // Drop the key entirely so untouched events stay diff-clean.
                if (target.conditionsField && target.obj[target.conditionsField].length === 0) {
                    delete target.obj[target.conditionsField];
                }
            } else if (action === 'add-choice') {
                draft.choices = draft.choices || [];
                draft.choices.push(newChoice(draft.choices));
            } else if (action === 'remove-choice') {
                draft.choices.splice(index, 1);
            } else if (action === 'move-choice') {
                const arr = draft.choices;
                const target = btn.dataset.dir === 'up' ? index - 1 : index + 1;
                if (target < 0 || target >= arr.length) return;
                const tmp = arr[index];
                arr[index] = arr[target];
                arr[target] = tmp;
            } else if (action === 'add-payment') {
                draft.payment = newPayment();
            } else if (action === 'remove-payment') {
                delete draft.payment;
            } else if (action === 'chip-remove') {
                const chipIndex = Number(btn.dataset.chipIndex);
                const chip = btn.dataset.chip;
                if (chip === 'gate') {
                    draft.types.splice(chipIndex, 1);
                    if (!draft.types.length) delete draft.types;
                } else if (chip === 'eff-types') {
                    const effect = effectAt(owner, index);
                    effect.types.splice(chipIndex, 1);
                    if (!effect.types.length) delete effect.types;
                } else if (chip === 'eff-repl-types') {
                    const effect = effectAt(owner, index);
                    effect.replacement.types.splice(chipIndex, 1);
                    if (!effect.replacement.types.length) { delete effect.replacement.types; cleanupReplacement(effect); }
                } else if (chip === 'event-locations') {
                    draft.locations.splice(chipIndex, 1);
                    if (!draft.locations.length) delete draft.locations;
                } else if (chip === 'event-terrains') {
                    draft.terrains.splice(chipIndex, 1);
                    if (!draft.terrains.length) delete draft.terrains;
                }
            } else {
                return;
            }
            commit(true);
        });

        paint();
    }

    // =================================================================
    // Editor + list registration
    // =================================================================

    function openEventEditor(record) {
        EditorApp.openEditor({
            kind: 'event',
            fileName: 'events',
            record,
            template: giftTemplate, // overridden below for add-new by-type
            renderPreview,
            renderForm
        });
    }

    function openNewEvent(template) {
        EditorApp.openEditor({
            kind: 'event',
            fileName: 'events',
            record: null,
            template,
            renderPreview,
            renderForm
        });
    }

    function render(root) {
        root.innerHTML = `
            <div class="editor-tab-toolbar">
                <button type="button" class="editor-btn editor-btn--primary" data-action="add-gift">+ Gift event</button>
                <button type="button" class="editor-btn editor-btn--primary" data-action="add-choice">+ Choice event</button>
                <button type="button" class="editor-btn editor-btn--primary" data-action="add-trainer">+ Trainer event</button>
            </div>
            <div class="editor-list-slot"></div>
        `;

        root.querySelector('[data-action="add-gift"]').addEventListener('click', () => openNewEvent(giftTemplate));
        root.querySelector('[data-action="add-choice"]').addEventListener('click', () => openNewEvent(choiceTemplate));
        root.querySelector('[data-action="add-trainer"]').addEventListener('click', () => openNewEvent(trainerTemplate));

        return EditorListView.createListView({
            root: root.querySelector('.editor-list-slot'),
            columns: columns(),
            records: EditorApp.store.data.events,
            getKey: (record) => record.id,
            searchFields: ['title', 'id'],
            filters: [
                {
                    key: 'type',
                    label: 'Event types',
                    options: eventTypes().map((type) => ({ value: type, label: type })),
                    match: (record, value) => record.type === value
                },
                {
                    key: 'gate',
                    label: 'Gate types',
                    options: gateTypeValues().map((type) => ({ value: type, label: type })),
                    match: (record, value) => Array.isArray(record.types) && record.types.includes(value)
                },
                {
                    key: 'enabled',
                    label: 'Enabled',
                    options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
                    match: (record, value) => (value === 'yes') === isEnabled(record)
                }
            ],
            defaultSort: { key: 'id', direction: 'asc' },
            onSelect: openEventEditor
        });
    }

    EditorApp.registerTab('events', { label: 'Events', render });
})(window.EditorApp, window.EditorPreview, window.EditorListView);
