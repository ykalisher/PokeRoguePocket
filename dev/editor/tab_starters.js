/**
 * Starters tab: list (portrait thumbs, name, id, type icon, card totals,
 * enabled dot) plus the full detail editor (starter-card preview left, form
 * + deck builder right) via EditorApp.openEditor(). See
 * dev/feature_plans/88-starter-decks-overview.md for the locked spec.
 *
 * `pokemon` is a flat name array (duplicates meaningful, same shape as a
 * trainer deck) while `attacks`/`items` are already grouped as
 * `{ name, count }` — no groupCounts() needed for those two.
 */
(function (EditorApp, EditorPreview, EditorListView) {
    'use strict';

    const escapeHtml = EditorListView.escapeHtml;
    const escapeAttr = EditorListView.escapeAttr;

    const DECK_KINDS = [
        { field: 'pokemon', kind: 'pokemon', label: 'Pokemon', storeKey: 'pokemon' },
        { field: 'attacks', kind: 'attack', label: 'Attacks', storeKey: 'attacks' },
        { field: 'items', kind: 'item', label: 'Items', storeKey: 'items' }
    ];

    function isEnabled(record) {
        return record.enabled !== false;
    }

    function typeValues() {
        return Object.values(EditorApp.store.enums.PokeType)
            .filter((type) => type !== 'NONE')
            .sort();
    }

    function typeOptions() {
        return typeValues().map((type) => ({ value: type, label: type }));
    }

    function portraitPath(name) {
        return `assets/portraits/${encodeURIComponent(name)}.png`;
    }

    function countEntries(entries) {
        return Array.isArray(entries) ? entries.reduce((sum, entry) => sum + (Number(entry && entry.count) || 0), 0) : 0;
    }

    function columns() {
        return [
            {
                key: 'portrait',
                label: '',
                render: (record) => (Array.isArray(record.pokemon) ? record.pokemon : [])
                    .map((name) => `<img class="editor-thumb" loading="lazy" decoding="async" src="${portraitPath(name)}" alt="" title="${escapeAttr(name)}">`)
                    .join('')
            },
            {
                key: 'name',
                label: 'Name',
                render: (record) => escapeHtml(record.name),
                sortValue: (record) => record.name
            },
            {
                key: 'id',
                label: 'ID',
                render: (record) => escapeHtml(record.id),
                sortValue: (record) => record.id
            },
            {
                key: 'type',
                label: 'Type',
                render: (record) => (record.type ? EditorPreview.typeIconHtml(record.type) : '')
            },
            {
                key: 'cardCounts',
                label: 'P / A / I',
                render: (record) => {
                    const pokemonCount = Array.isArray(record.pokemon) ? record.pokemon.length : 0;
                    return `${pokemonCount} / ${countEntries(record.attacks)} / ${countEntries(record.items)}`;
                }
            },
            {
                key: 'requiresAchievement',
                label: 'Unlocked by',
                render: (record) => (record.requiresAchievement
                    ? `${escapeHtml(achievementLabel(record.requiresAchievement))}${unknownAchievementBadge(record.requiresAchievement)}`
                    : '<span class="editor-muted">—</span>'),
                sortValue: (record) => (record.requiresAchievement ? achievementLabel(record.requiresAchievement) : '')
            },
            {
                key: 'enabled',
                label: 'Enabled',
                render: (record) => `<span class="editor-dot ${isEnabled(record) ? 'editor-dot--on' : 'editor-dot--off'}" title="${isEnabled(record) ? 'Enabled' : 'Disabled'}"></span>`
            }
        ];
    }

    // Canonical new-record key order (88-starter-decks-overview.md). A deck with
    // no achievement gate omits `requiresAchievement` entirely, so the field is
    // absent from the template and set/deleted by the form.
    function template() {
        return { id: '', name: '', type: '', pokemon: [], attacks: [], items: [], enabled: true };
    }

    // ------------------------------------------------------ achievement gate

    function achievements() {
        return (EditorApp.store.data.achievements || []).filter((record) => record && record.id);
    }

    function achievementLabel(id) {
        const record = achievements().find((entry) => entry.id === id);
        return record && record.name ? record.name : id;
    }

    function unknownAchievementBadge(id) {
        if (!id || achievements().some((record) => record.id === id)) return '';
        return ' <span class="editor-badge editor-badge--warning">unknown</span>';
    }

    function achievementSelectHtml(draft) {
        const current = draft.requiresAchievement || '';
        const options = achievements().map((record) =>
            `<option value="${escapeAttr(record.id)}"${record.id === current ? ' selected' : ''}>${escapeHtml(record.name || record.id)}</option>`
        ).join('');
        // An id that no longer exists in achievements.json still has to show up
        // as the selected value, or opening the deck would silently clear it.
        const orphan = current && !achievements().some((record) => record.id === current)
            ? `<option value="${escapeAttr(current)}" selected>${escapeHtml(current)} (unknown)</option>`
            : '';

        return `<select name="requiresAchievement">`
            + `<option value=""${current ? '' : ' selected'}>Always available</option>`
            + `${options}${orphan}</select>`;
    }

    // -------------------------------------------------------- entry helpers

    function entriesFor(draft, field) {
        if (!Array.isArray(draft[field])) draft[field] = [];
        return draft[field];
    }

    function addEntry(draft, field, name) {
        const entries = entriesFor(draft, field);
        const existing = entries.find((entry) => entry.name === name);
        if (existing) existing.count += 1;
        else entries.push({ name, count: 1 });
    }

    function bumpEntry(draft, field, name, delta) {
        const entries = entriesFor(draft, field);
        const index = entries.findIndex((entry) => entry.name === name);
        if (index === -1) return;
        entries[index].count += delta;
        if (entries[index].count < 1) entries.splice(index, 1);
    }

    function groupCounts(names) {
        const order = [];
        const counts = new Map();
        names.forEach((name) => {
            if (!counts.has(name)) {
                counts.set(name, 0);
                order.push(name);
            }
            counts.set(name, counts.get(name) + 1);
        });
        return order.map((name) => ({ name, count: counts.get(name) }));
    }

    function rowsForSpec(spec, draft) {
        return spec.field === 'pokemon' ? groupCounts(draft.pokemon || []) : entriesFor(draft, spec.field);
    }

    // ------------------------------------------------------------ preview

    function previewPokemonHtml(draft) {
        const names = Array.isArray(draft.pokemon) ? draft.pokemon : [];
        if (!names.length) return '<p class="editor-empty">No Pokemon.</p>';
        const tiles = names.map((name) => `
            <div class="editor-trainer-tile">
                <img class="editor-thumb" loading="lazy" decoding="async" src="${portraitPath(name)}" alt="">
                <span style="margin-left:6px">${escapeHtml(name)}</span>
            </div>
        `).join('');
        return `<div class="editor-trainer-deck-grid">${tiles}</div>`;
    }

    function previewCardsHtml(draft) {
        const entries = [
            ...(Array.isArray(draft.attacks) ? draft.attacks : []),
            ...(Array.isArray(draft.items) ? draft.items : [])
        ];
        if (!entries.length) return '<p class="editor-empty">No cards.</p>';
        const rows = entries.map((entry) =>
            `<li class="editor-deck-row"><span class="editor-deck-row-name">${Number(entry.count) || 0}&times; ${escapeHtml(entry.name)}</span></li>`
        ).join('');
        return `<ul class="editor-deck-rows">${rows}</ul>`;
    }

    function renderPreview(el, draft) {
        el.innerHTML = `
            <div class="editor-trainer-preview">
                <div class="editor-form-row">
                    ${draft.type ? EditorPreview.typeIconHtml(draft.type) : ''}
                    <span class="editor-badge">${escapeHtml(draft.type || 'no type')}</span>
                    ${draft.requiresAchievement
                        ? `<span class="editor-badge">Unlocked by ${escapeHtml(achievementLabel(draft.requiresAchievement))}</span>${unknownAchievementBadge(draft.requiresAchievement)}`
                        : ''}
                </div>
                <div class="editor-trainer-deck-sections">
                    <div class="editor-trainer-deck-section">
                        <h4 class="editor-trainer-deck-title">Pokemon &mdash; ${Array.isArray(draft.pokemon) ? draft.pokemon.length : 0}</h4>
                        ${previewPokemonHtml(draft)}
                    </div>
                    <div class="editor-trainer-deck-section">
                        <h4 class="editor-trainer-deck-title">Cards</h4>
                        ${previewCardsHtml(draft)}
                    </div>
                </div>
            </div>
        `;
    }

    // --------------------------------------------------------------- form

    function selectHtml(name, current, options, blankLabel) {
        const blank = blankLabel !== undefined
            ? `<option value=""${current ? '' : ' selected'}>${escapeHtml(blankLabel)}</option>`
            : '';
        const opts = options.map((value) =>
            `<option value="${escapeAttr(value)}"${value === current ? ' selected' : ''}>${escapeHtml(value)}</option>`
        ).join('');
        return `<select name="${name}">${blank}${opts}</select>`;
    }

    function deckRowsHtml(spec, draft) {
        const rows = rowsForSpec(spec, draft);
        if (!rows.length) return '<li class="editor-empty">No cards yet.</li>';

        return rows.map(({ name, count }) => `
            <li class="editor-deck-row">
                <span class="editor-deck-row-name" title="${escapeAttr(name)}">${escapeHtml(name)}</span>
                <span class="editor-stepper">
                    <button type="button" class="editor-stepper-btn" data-stepper="minus" data-kind="${spec.field}" data-name="${escapeAttr(name)}" aria-label="Remove one ${escapeAttr(name)}">−</button>
                    <span class="editor-stepper-count">${count}</span>
                    <button type="button" class="editor-stepper-btn" data-stepper="plus" data-kind="${spec.field}" data-name="${escapeAttr(name)}" aria-label="Add one ${escapeAttr(name)}">+</button>
                </span>
            </li>
        `).join('');
    }

    function deckBuilderSectionHtml(spec, draft) {
        return `
            <div class="editor-deck-builder-section" data-deck-kind="${spec.field}">
                <h4>${spec.label}</h4>
                <div class="editor-picker" data-picker="${spec.field}" data-store-key="${spec.storeKey}">
                    <input type="text" class="editor-picker-input" placeholder="Add ${spec.label.toLowerCase()}…" autocomplete="off">
                    <ul class="editor-picker-results" hidden></ul>
                </div>
                <ul class="editor-deck-rows" data-deck-rows="${spec.field}">${deckRowsHtml(spec, draft)}</ul>
            </div>
        `;
    }

    function formHtml(draft) {
        return `
            <div class="editor-form-row">
                <label>ID (slug)
                    <input type="text" name="id" value="${escapeAttr(draft.id)}">
                    <span class="editor-hint">Changing the id of a deck already in use breaks saved runs — they fall back to the first deck.</span>
                </label>
                <label>Name
                    <input type="text" name="name" value="${escapeAttr(draft.name)}">
                </label>
            </div>
            <div class="editor-form-row">
                <label>Type${selectHtml('type', draft.type, typeValues(), 'Select type…')}</label>
                <label class="editor-form-checkbox"><input type="checkbox" name="enabled" ${draft.enabled !== false ? 'checked' : ''}> Enabled</label>
            </div>
            <div class="editor-form-row">
                <label>Unlocked by achievement${achievementSelectHtml(draft)}
                    <span class="editor-hint">The deck shows as locked on the starter picker until this achievement is unlocked. "Always available" leaves it open from the start — at least one enabled deck must stay always available.</span>
                </label>
            </div>
            <div class="editor-deck-builder">
                ${DECK_KINDS.map((spec) => deckBuilderSectionHtml(spec, draft)).join('')}
            </div>
        `;
    }

    function renderForm(el, draft, api) {
        function paint() {
            el.innerHTML = formHtml(draft);
        }

        function refreshDeckRows(field) {
            const spec = DECK_KINDS.find((candidate) => candidate.field === field);
            const container = el.querySelector(`[data-deck-rows="${field}"]`);
            if (container) container.innerHTML = deckRowsHtml(spec, draft);
        }

        function addDeckName(field, name) {
            if (field === 'pokemon') {
                draft.pokemon = draft.pokemon || [];
                draft.pokemon.push(name);
            } else {
                addEntry(draft, field, name);
            }
            refreshDeckRows(field);
            api.markDirty();
            api.refreshPreview();
        }

        function hideResults(resultsEl) {
            resultsEl.hidden = true;
            resultsEl.innerHTML = '';
        }

        paint();

        el.addEventListener('input', (event) => {
            const target = event.target;

            if (target.classList.contains('editor-picker-input')) {
                const wrap = target.closest('.editor-picker');
                const query = target.value.trim().toLowerCase();
                const resultsEl = wrap.querySelector('.editor-picker-results');

                if (!query) {
                    hideResults(resultsEl);
                    return;
                }

                const matches = EditorApp.store.data[wrap.dataset.storeKey]
                    .map((record) => record.name)
                    .filter((name) => name.toLowerCase().includes(query))
                    .slice(0, 8);

                if (!matches.length) {
                    hideResults(resultsEl);
                    return;
                }

                resultsEl.innerHTML = matches.map((name) => `<li data-name="${escapeAttr(name)}">${escapeHtml(name)}</li>`).join('');
                resultsEl.hidden = false;
                return;
            }

            if (target.type === 'checkbox') {
                draft[target.name] = target.checked;
                api.markDirty();
                api.refreshPreview();
                return;
            }

            const field = target.name;
            if (!field) return;

            // "Always available" drops the key rather than storing "", keeping
            // ungated decks byte-identical to how they read today.
            if (field === 'requiresAchievement' && !target.value) delete draft.requiresAchievement;
            else draft[field] = target.value;

            api.markDirty();
            api.refreshPreview();
        });

        el.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' || !event.target.classList.contains('editor-picker-input')) return;
            event.preventDefault();

            const wrap = event.target.closest('.editor-picker');
            const resultsEl = wrap.querySelector('.editor-picker-results');
            const items = resultsEl.querySelectorAll('li');
            if (items.length !== 1) return;

            addDeckName(wrap.dataset.picker, items[0].dataset.name);
            event.target.value = '';
            hideResults(resultsEl);
        });

        el.addEventListener('mousedown', (event) => {
            const li = event.target.closest('.editor-picker-results li');
            if (!li) return;
            event.preventDefault();

            const wrap = li.closest('.editor-picker');
            addDeckName(wrap.dataset.picker, li.dataset.name);
            wrap.querySelector('.editor-picker-input').value = '';
            hideResults(wrap.querySelector('.editor-picker-results'));
        });

        el.addEventListener('focusout', (event) => {
            const wrap = event.target.closest('.editor-picker');
            if (!wrap) return;
            setTimeout(() => {
                if (!wrap.contains(document.activeElement)) hideResults(wrap.querySelector('.editor-picker-results'));
            }, 0);
        });

        el.addEventListener('click', (event) => {
            const btn = event.target.closest('[data-stepper]');
            if (!btn) return;

            const field = btn.dataset.kind;
            const name = btn.dataset.name;
            const delta = btn.dataset.stepper === 'plus' ? 1 : -1;

            if (field === 'pokemon') {
                const arr = draft.pokemon || [];
                if (delta === 1) {
                    arr.push(name);
                } else {
                    // Remove the LAST occurrence, same rationale as tab_trainers.js:
                    // rows are grouped by first occurrence, so dropping the first one
                    // would let a later name overtake this row mid-click.
                    const idx = arr.lastIndexOf(name);
                    if (idx !== -1) arr.splice(idx, 1);
                }
                draft.pokemon = arr;
            } else {
                bumpEntry(draft, field, name, delta);
            }

            refreshDeckRows(field);
            api.markDirty();
            api.refreshPreview();
        });
    }

    // ------------------------------------------------------------- editor

    function openStarterEditor(record) {
        EditorApp.openEditor({
            kind: 'starterDeck',
            fileName: 'starter_decks',
            record,
            template,
            renderPreview,
            renderForm
        });
    }

    function render(root) {
        root.innerHTML = `
            <div class="editor-tab-toolbar">
                <button type="button" class="editor-btn editor-btn--primary" data-action="add-starter">+ Add starter deck</button>
            </div>
            <div class="editor-list-slot"></div>
        `;

        root.querySelector('[data-action="add-starter"]').addEventListener('click', () => openStarterEditor(null));

        return EditorListView.createListView({
            root: root.querySelector('.editor-list-slot'),
            columns: columns(),
            records: EditorApp.store.data.starter_decks,
            getKey: (record) => record.id,
            searchFields: ['name', 'id'],
            filters: [
                {
                    key: 'type',
                    label: 'Types',
                    options: typeOptions(),
                    match: (record, value) => record.type === value
                },
                {
                    key: 'enabled',
                    label: 'Enabled',
                    options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
                    match: (record, value) => (value === 'yes') === isEnabled(record)
                }
            ],
            defaultSort: { key: 'name', direction: 'asc' },
            onSelect: openStarterEditor
        });
    }

    EditorApp.registerTab('starters', { label: 'Starters', render });
})(window.EditorApp, window.EditorPreview, window.EditorListView);
