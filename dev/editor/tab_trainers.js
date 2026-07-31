/**
 * Trainers tab: list (sprite thumb, name, rank, spec type icon, cash, deck
 * sizes P/A/I) plus the full detail editor (sprite + deck-of-mini-cards
 * preview left, scalar form + deck builder right) via EditorApp.openEditor().
 * See dev/feature_plans/25-data-editor-overview.md's "List views" table and
 * dev/feature_plans/31-editor-trainers.md for the locked spec.
 *
 * Deck arrays (`pokemon`, `attacks`, `items`) are exact battle decks —
 * duplicates are meaningful (e.g. Gamer runs Mind Break x2). `attacks` is
 * read tolerant of nested arrays (flattened once on open) but always saved
 * flat; the picker appends new names at the end, the "-" stepper removes the
 * last occurrence so deck rows (grouped by first occurrence) keep their order
 * as the count drops.
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

    function rankIndex(record) {
        const ranks = EditorApp.store.enums.Rank;
        const idx = ranks.indexOf(record.rank);
        return idx === -1 ? ranks.length : idx;
    }

    function typeOptions() {
        return Object.values(EditorApp.store.enums.PokeType)
            .filter((type) => type !== 'NONE')
            .sort()
            .map((type) => ({ value: type, label: type }));
    }

    function columns() {
        return [
            {
                key: 'sprite',
                label: '',
                render: (record) => `<img class="editor-thumb" loading="lazy" decoding="async" src="${EditorPreview.spritePathFor(record)}" alt="">`
            },
            {
                key: 'name',
                label: 'Name',
                render: (record) => EditorListView.escapeHtml(record.name),
                sortValue: (record) => record.name
            },
            {
                key: 'rank',
                label: 'Rank',
                render: (record) => EditorListView.escapeHtml(record.rank),
                // Single sort key doubles as "rank, then name": rank-group index first,
                // then alphabetical within the group.
                sortValue: (record) => `${String(rankIndex(record)).padStart(2, '0')}-${record.name}`
            },
            {
                key: 'typeSpecialization',
                label: 'Type',
                render: (record) => (record.typeSpecialization ? EditorPreview.typeIconHtml(record.typeSpecialization) : '—')
            },
            {
                key: 'cash',
                label: 'Cash',
                numeric: true,
                render: (record) => record.cash,
                sortValue: (record) => Number(record.cash) || 0
            },
            {
                key: 'deckSizes',
                label: 'P / A / I',
                render: (record) => {
                    const pokemonCount = Array.isArray(record.pokemon) ? record.pokemon.length : 0;
                    const attackCount = Array.isArray(record.attacks) ? record.attacks.flat().length : 0;
                    const itemCount = Array.isArray(record.items) ? record.items.length : 0;
                    return `${pokemonCount} / ${attackCount} / ${itemCount}`;
                }
            }
        ];
    }

    function template() {
        return {
            name: '',
            sprite: '',
            cash: 200,
            rank: 'Standard',
            typeSpecialization: '',
            pokemon: [],
            attacks: [],
            items: []
        };
    }

    // Legacy-tolerant read: some hypothetical inputs could nest `attacks` per
    // pokemon; flatten once so every subsequent read/mutation deals with a
    // plain array of names, and Save always writes it flat.
    function normalizeDraftAttacks(draft) {
        if (Array.isArray(draft.attacks) && draft.attacks.some(Array.isArray)) {
            draft.attacks = draft.attacks.flat();
        }
    }

    function namesFor(draft, field) {
        const values = draft[field] || [];
        return field === 'attacks' ? values.flat() : values;
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

    function findCardRecord(storeKey, name) {
        return EditorApp.store.data[storeKey].find((record) => record.name === name);
    }

    // ------------------------------------------------------------ preview

    function spriteHintHtml(draft) {
        const resolved = window.PokeRogue.TrainerSprites.resolveSprite(draft.name, draft.sprite || null);
        const missing = !EditorApp.store.assetIndex.sprites.has(resolved.file);
        return `Resolves to <code>${escapeHtml(resolved.file)}</code>` +
            (missing ? ' <span class="editor-badge editor-badge--warning">missing</span>' : '');
    }

    function paintSprite(el, draft) {
        const resolved = window.PokeRogue.TrainerSprites.resolveSprite(draft.name, draft.sprite || null);
        const missing = !EditorApp.store.assetIndex.sprites.has(resolved.file);

        const img = el.querySelector('[data-role="sprite-img"]');
        img.src = resolved.path;
        img.alt = draft.name || '';

        const pathEl = el.querySelector('[data-role="sprite-path"]');
        const escapedPath = `<code>${escapeHtml(resolved.path)}</code>`;
        pathEl.innerHTML = missing
            ? `${escapedPath}<br><span class="editor-badge editor-badge--warning">sprite file missing</span> ` +
              '<button type="button" class="editor-btn editor-btn--small" data-role="upload-sprite-btn">Upload…</button>' +
              '<input type="file" accept="image/png" data-role="upload-sprite-input" hidden>'
            : escapedPath;

        // Fresh elements every paint (innerHTML above), so no listener buildup.
        if (missing) {
            const input = pathEl.querySelector('[data-role="upload-sprite-input"]');
            pathEl.querySelector('[data-role="upload-sprite-btn"]').addEventListener('click', () => input.click());
            input.addEventListener('change', () => {
                if (!input.files[0]) return;
                EditorApp.uploadAsset('sprites', draft.name, input.files[0]).then(() => paintSprite(el, draft)).catch(() => {});
            });
        }
    }

    function previewDeckSectionHtml(spec, draft) {
        const names = namesFor(draft, spec.field);
        const grouped = groupCounts(names);

        const tiles = grouped.length
            ? grouped.map(({ name, count }) => {
                const record = findCardRecord(spec.storeKey, name);
                const badge = count > 1 ? `<span class="editor-count-badge">&times;${count}</span>` : '';
                if (!record) {
                    return `
                        <div class="editor-trainer-tile editor-trainer-tile--unknown" title="${escapeAttr(name)} — not found in ${spec.storeKey}.json">
                            <div class="editor-trainer-unknown-card">${escapeHtml(name)}</div>${badge}
                        </div>
                    `;
                }
                return `
                    <div class="editor-trainer-tile" data-card-slot data-kind="${spec.kind}" data-name="${escapeAttr(name)}">
                        <div class="editor-preview-card"></div>${badge}
                    </div>
                `;
            }).join('')
            : '<p class="editor-empty">No cards.</p>';

        let advisory = '';
        if (spec.field === 'attacks') {
            const pokemonCount = namesFor(draft, 'pokemon').length;
            const expected = 4 * pokemonCount;
            if (names.length !== expected) {
                advisory = `<p class="editor-warning-banner editor-trainer-advisory">Advisory: ${names.length} attacks &ne; 4 &times; ${pokemonCount} pokemon (expected ${expected}).</p>`;
            }
        }

        return `
            <div class="editor-trainer-deck-section">
                <h4 class="editor-trainer-deck-title">${spec.label} — ${names.length}</h4>
                <div class="editor-trainer-deck-grid" style="--card-w: 48px">${tiles}</div>
                ${advisory}
            </div>
        `;
    }

    function renderPreview(el, draft) {
        normalizeDraftAttacks(draft);

        el.innerHTML = `
            <div class="editor-trainer-preview">
                <div class="editor-trainer-sprite-wrap">
                    <img class="editor-trainer-sprite" data-role="sprite-img" alt="">
                </div>
                <p class="editor-trainer-sprite-path" data-role="sprite-path"></p>
                <div class="editor-trainer-deck-sections">
                    ${DECK_KINDS.map((spec) => previewDeckSectionHtml(spec, draft)).join('')}
                </div>
            </div>
        `;

        paintSprite(el, draft);

        el.querySelectorAll('[data-card-slot]').forEach((slot) => {
            const record = findCardRecord(
                DECK_KINDS.find((spec) => spec.kind === slot.dataset.kind).storeKey,
                slot.dataset.name
            );
            if (record) EditorPreview.renderCardInto(slot.querySelector('.editor-preview-card'), slot.dataset.kind, record);
        });
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

    function spriteManifestNames() {
        const seen = new Set();
        const names = [];
        window.PokeRogue.TrainerSprites.sprites.forEach((entry) => {
            if (!seen.has(entry.name)) {
                seen.add(entry.name);
                names.push(entry.name);
            }
        });
        return names.sort();
    }

    function deckRowsHtml(spec, draft) {
        const grouped = groupCounts(namesFor(draft, spec.field));
        if (!grouped.length) return '<li class="editor-empty">No cards yet.</li>';

        return grouped.map(({ name, count }) => `
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
                <label>Name
                    <input type="text" name="name" value="${escapeAttr(draft.name)}">
                </label>
                <label>Sprite
                    <input type="text" name="sprite" list="editor-trainer-sprite-datalist" value="${escapeAttr(draft.sprite || '')}">
                    <span class="editor-hint" data-role="sprite-hint">${spriteHintHtml(draft)}</span>
                </label>
            </div>
            <datalist id="editor-trainer-sprite-datalist">
                ${spriteManifestNames().map((name) => `<option value="${escapeAttr(name)}">`).join('')}
            </datalist>
            <div class="editor-form-row">
                <label>Cash<input type="number" name="cash" min="0" value="${draft.cash}"></label>
                <label>Rank${selectHtml('rank', draft.rank, EditorApp.store.enums.Rank)}</label>
                <label>Type specialization${selectHtml('typeSpecialization', draft.typeSpecialization || '', typeOptions().map((opt) => opt.value), 'None')}</label>
            </div>
            <div class="editor-deck-builder">
                ${DECK_KINDS.map((spec) => deckBuilderSectionHtml(spec, draft)).join('')}
            </div>
        `;
    }

    function renderForm(el, draft, api) {
        normalizeDraftAttacks(draft);

        function paint() {
            el.innerHTML = formHtml(draft);
        }

        function refreshDeckRows(field) {
            const spec = DECK_KINDS.find((candidate) => candidate.field === field);
            const container = el.querySelector(`[data-deck-rows="${field}"]`);
            if (container) container.innerHTML = deckRowsHtml(spec, draft);
        }

        function addDeckName(field, name) {
            draft[field] = draft[field] || [];
            draft[field].push(name);
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

            const field = target.name;
            if (!field) return;

            draft[field] = field === 'cash' ? Number(target.value) : target.value;

            if (field === 'name' || field === 'sprite') {
                const hint = el.querySelector('[data-role="sprite-hint"]');
                if (hint) hint.innerHTML = spriteHintHtml(draft);
            }

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
            const arr = draft[field] || [];

            if (btn.dataset.stepper === 'plus') {
                arr.push(name);
            } else {
                // Remove the LAST occurrence: rows are grouped by first occurrence, so
                // dropping the first one would let a later name overtake this row and make
                // it hop down the list between clicks (decks are shuffled at battle start,
                // so which duplicate goes is gameplay-irrelevant).
                const idx = arr.lastIndexOf(name);
                if (idx !== -1) arr.splice(idx, 1);
            }
            draft[field] = arr;

            refreshDeckRows(field);
            api.markDirty();
            api.refreshPreview();
        });
    }

    // ------------------------------------------------------------- editor

    function openTrainerEditor(record) {
        EditorApp.openEditor({
            kind: 'trainer',
            fileName: 'trainers',
            record,
            template,
            renderPreview,
            renderForm
        });
    }

    function render(root) {
        root.innerHTML = `
            <div class="editor-tab-toolbar">
                <button type="button" class="editor-btn editor-btn--primary" data-action="add-trainer">+ Add trainer</button>
            </div>
            <div class="editor-list-slot"></div>
        `;

        root.querySelector('[data-action="add-trainer"]').addEventListener('click', () => openTrainerEditor(null));

        return EditorListView.createListView({
            root: root.querySelector('.editor-list-slot'),
            columns: columns(),
            records: EditorApp.store.data.trainers,
            getKey: (record) => record.name,
            searchFields: ['name'],
            filters: [
                {
                    key: 'rank',
                    label: 'Ranks',
                    options: EditorApp.store.enums.Rank.map((rank) => ({ value: rank, label: rank })),
                    match: (record, value) => record.rank === value
                },
                {
                    key: 'typeSpecialization',
                    label: 'Specializations',
                    options: typeOptions(),
                    match: (record, value) => record.typeSpecialization === value
                }
            ],
            defaultSort: { key: 'rank', direction: 'asc' },
            onSelect: openTrainerEditor
        });
    }

    EditorApp.registerTab('trainers', { label: 'Trainers', render });
})(window.EditorApp, window.EditorPreview, window.EditorListView);
