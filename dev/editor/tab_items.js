/**
 * Items tab: list (image thumb, name, target, statuses, stat changes) plus
 * the full detail editor (live item-card preview left, form right) via
 * EditorApp.openEditor(). See dev/feature_plans/25-data-editor-overview.md's
 * "List views" table and dev/feature_plans/30-editor-attacks-items.md for
 * the locked spec, incl. legacy statChange handling.
 *
 * `statChanges` legacy note: normalizeItem() at runtime moves any Status
 * value living in an item's statChanges array into its status list (e.g.
 * Lum Berry's HEAL_STATUS). Those entries must survive save untouched — the
 * "add" control for statChanges only offers StatChange values, but existing
 * legacy entries render as a distinct chip style and remain removable.
 */
(function (EditorApp, EditorPreview, EditorListView) {
    'use strict';

    const escapeHtml = EditorListView.escapeHtml;
    const escapeAttr = EditorListView.escapeAttr;

    // Mirrors STAT_LABELS in arena/arena_model.js and VITAMIN_STATS in
    // dev/editor/validate.js — the stats a vitamin item may permanently raise.
    const VITAMIN_STATS = ['attack', 'defense', 'speed'];
    const DEFAULT_VITAMIN_AMOUNT = 5;

    function enumOptions(map) {
        return Object.values(map).sort().map((value) => ({ value, label: value }));
    }

    function statusValues() {
        return Object.values(EditorApp.store.enums.Status).sort();
    }

    function statChangeValues() {
        return Object.values(EditorApp.store.enums.StatChange).sort();
    }

    function columns() {
        return [
            {
                key: 'image',
                label: '',
                render: (record) => `<img class="editor-thumb" loading="lazy" decoding="async" src="${EditorPreview.itemImagePathFor(record)}" alt="">`
            },
            {
                key: 'name',
                label: 'Name',
                render: (record) => escapeHtml(record.name),
                sortValue: (record) => record.name
            },
            {
                key: 'target',
                label: 'Target',
                render: (record) => escapeHtml(record.target),
                sortValue: (record) => record.target
            },
            {
                key: 'status',
                label: 'Statuses',
                render: (record) => escapeHtml(Array.isArray(record.status) ? record.status.join(', ') : '')
            },
            {
                key: 'statChanges',
                label: 'Stat changes',
                render: (record) => escapeHtml(Array.isArray(record.statChanges) ? record.statChanges.join(', ') : '')
            },
            {
                key: 'vitamin',
                label: 'Vitamin',
                render: (record) => (VITAMIN_STATS.includes(record.vitaminStat)
                    ? escapeHtml(`+${record.vitaminAmount == null ? DEFAULT_VITAMIN_AMOUNT : record.vitaminAmount} ${record.vitaminStat}`)
                    : ''),
                sortValue: (record) => record.vitaminStat || ''
            }
        ];
    }

    function template() {
        return {
            name: '',
            target: 'SELF',
            status: [],
            statChanges: []
        };
    }

    // ------------------------------------------------------------ preview

    function paintPreview(el, draft) {
        EditorPreview.renderCardInto(el.querySelector('.editor-preview-card'), 'item', draft);

        const path = EditorPreview.itemImagePathFor(draft);
        const fileName = path.split('/').pop();
        const hasImage = EditorApp.store.assetIndex.items.has(fileName);
        const pathEl = el.querySelector('.editor-preview-image-path');
        const escapedPath = `<code>${escapeHtml(path)}</code>`;
        pathEl.innerHTML = hasImage
            ? escapedPath
            : `${escapedPath}<br><span class="editor-badge editor-badge--warning">image missing</span> ` +
              '<button type="button" class="editor-btn editor-btn--small" data-role="upload-image-btn">Upload…</button>' +
              '<input type="file" accept="image/png" data-role="upload-image-input" hidden>';

        // Fresh elements every paint (innerHTML above), so no listener buildup.
        if (!hasImage) {
            const input = pathEl.querySelector('[data-role="upload-image-input"]');
            pathEl.querySelector('[data-role="upload-image-btn"]').addEventListener('click', () => input.click());
            input.addEventListener('change', () => {
                if (!input.files[0]) return;
                EditorApp.uploadAsset('items', draft.name, input.files[0]).then(() => paintPreview(el, draft)).catch(() => {});
            });
        }
    }

    function renderPreview(el, draft) {
        el.innerHTML = `
            <div class="editor-preview-card" style="--card-w: 140px"></div>
            <p class="editor-preview-image-path"></p>
        `;
        paintPreview(el, draft);
    }

    // --------------------------------------------------------------- form

    function selectHtml(name, current, options) {
        const opts = options.map((value) =>
            `<option value="${escapeAttr(value)}"${value === current ? ' selected' : ''}>${escapeHtml(value)}</option>`
        ).join('');
        return `<select name="${name}">${opts}</select>`;
    }

    function chipListHtml(field, values, addOptions, legacySet) {
        const chips = values.map((value, index) => {
            const legacy = legacySet && legacySet.has(value);
            return `<span class="editor-chip${legacy ? ' editor-chip--legacy' : ''}"${legacy ? ' title="legacy: a Status value stored in statChanges"' : ''}>${escapeHtml(value)}${legacy ? ' <em>(legacy)</em>' : ''}` +
                `<button type="button" class="editor-chip-remove" data-chip-remove="${field}" data-chip-index="${index}" aria-label="Remove ${escapeAttr(value)}">×</button></span>`;
        }).join('');
        const options = addOptions.map((value) => `<option value="${escapeAttr(value)}">${escapeHtml(value)}</option>`).join('');
        return `<div class="editor-chip-list">${chips}<select class="editor-chip-add" data-chip-add="${field}"><option value="">+ add…</option>${options}</select></div>`;
    }

    function formHtml(draft) {
        const statusSet = new Set(statusValues());
        const statChanges = draft.statChanges || [];

        return `
            <div class="editor-form-row">
                <label>Name
                    <input type="text" name="name" value="${escapeAttr(draft.name)}">
                </label>
                <label>Target${selectHtml('target', draft.target, Object.values(EditorApp.store.enums.ItemTarget).sort())}</label>
            </div>
            <div class="editor-form-row">
                <label>Status
                    ${chipListHtml('status', draft.status || [], statusValues(), null)}
                </label>
            </div>
            <div class="editor-form-row">
                <label>Stat changes
                    ${chipListHtml('statChanges', statChanges, statChangeValues(), statusSet)}
                </label>
            </div>
            <div class="editor-form-row">
                <label>Vitamin stat${selectHtml('vitaminStat', draft.vitaminStat || '', ['', ...VITAMIN_STATS])}</label>
                ${draft.vitaminStat ? `
                    <label>Vitamin dose
                        <input type="number" name="vitaminAmount" min="1" step="1" value="${escapeAttr(String(draft.vitaminAmount == null ? DEFAULT_VITAMIN_AMOUNT : draft.vitaminAmount))}">
                    </label>
                ` : '<p class="editor-muted">Set a vitamin stat to turn this into a Protein-style item: consumed on receipt, permanently raising one stat of one Pokemon. Ordinary battle items leave it blank.</p>'}
            </div>
        `;
    }

    function renderForm(el, draft, api) {
        function paint() {
            el.innerHTML = formHtml(draft);
        }

        paint();

        el.addEventListener('input', (event) => {
            const target = event.target;

            if (target.dataset.chipAdd) {
                const field = target.dataset.chipAdd;
                if (target.value) {
                    draft[field] = (draft[field] || []).concat(target.value);
                    paint();
                    api.markDirty();
                    api.refreshPreview();
                }
                return;
            }

            const field = target.name;
            if (!field) return;

            // Clearing the vitamin stat drops both keys rather than leaving an
            // empty string behind: their absence is what marks an ordinary
            // battle item, and validate.js errors on a dose without a stat.
            if (field === 'vitaminStat') {
                if (target.value) {
                    draft.vitaminStat = target.value;
                    if (draft.vitaminAmount == null) draft.vitaminAmount = DEFAULT_VITAMIN_AMOUNT;
                } else {
                    delete draft.vitaminStat;
                    delete draft.vitaminAmount;
                }
                paint();
                api.markDirty();
                api.refreshPreview();
                return;
            }

            if (field === 'vitaminAmount') {
                const amount = Number(target.value);

                draft.vitaminAmount = Number.isFinite(amount) ? amount : DEFAULT_VITAMIN_AMOUNT;
                api.markDirty();
                api.refreshPreview();
                return;
            }

            draft[field] = target.value;
            if (field === 'target') paint();

            api.markDirty();
            api.refreshPreview();
        });

        el.addEventListener('click', (event) => {
            const btn = event.target.closest('[data-chip-remove]');
            if (!btn) return;
            const field = btn.dataset.chipRemove;
            const index = Number(btn.dataset.chipIndex);
            draft[field].splice(index, 1);
            paint();
            api.markDirty();
            api.refreshPreview();
        });
    }

    // ------------------------------------------------------------- editor

    function openItemEditor(record) {
        EditorApp.openEditor({
            kind: 'item',
            fileName: 'items',
            record,
            template,
            renderPreview,
            renderForm
        });
    }

    function render(root) {
        root.innerHTML = `
            <div class="editor-tab-toolbar">
                <button type="button" class="editor-btn editor-btn--primary" data-action="add-item">+ Add item</button>
            </div>
            <div class="editor-list-slot"></div>
        `;

        root.querySelector('[data-action="add-item"]').addEventListener('click', () => openItemEditor(null));

        return EditorListView.createListView({
            root: root.querySelector('.editor-list-slot'),
            columns: columns(),
            records: EditorApp.store.data.items,
            getKey: (record) => record.name,
            searchFields: ['name'],
            filters: [
                {
                    key: 'target',
                    label: 'Targets',
                    options: enumOptions(EditorApp.store.enums.ItemTarget),
                    match: (record, value) => record.target === value
                }
            ],
            defaultSort: { key: 'name', direction: 'asc' },
            onSelect: openItemEditor
        });
    }

    EditorApp.registerTab('items', { label: 'Items', render });
})(window.EditorApp, window.EditorPreview, window.EditorListView);
