/**
 * Locations tab: list (5-color theme swatch strip, name, id, terrain, type
 * icons, enabled dot) plus the full detail editor (themed preview panel
 * left, form right) via EditorApp.openEditor(). See
 * dev/feature_plans/25-data-editor-overview.md's "List views" table and
 * dev/feature_plans/33-editor-locations.md for the locked spec.
 *
 * The two dataset-level graph rules (`locations.starter-coverage`,
 * `locations.graph-disconnected`) are `error`-severity issues in
 * validate.js, so they already surface through the generic
 * EditorApp form-issues box (app.js's computePredictedIssues() treats any
 * error in the file being edited as in-scope) every time a field marks the
 * draft dirty — no bespoke duplicate check is needed here.
 */
(function (EditorApp, EditorPreview, EditorListView) {
    'use strict';

    const escapeHtml = EditorListView.escapeHtml;
    const escapeAttr = EditorListView.escapeAttr;

    const THEME_KEYS = ['accent', 'glow', 'surface', 'bgDeep', 'bgMid'];
    const THEME_LABELS = { accent: 'Accent', glow: 'Glow', surface: 'Surface', bgDeep: 'BG deep', bgMid: 'BG mid' };

    // Copied literally from NEUTRAL_LOCATION_THEME in arena/arena_data.js.
    const NEUTRAL_LOCATION_THEME = {
        accent: '#e0b84f',
        glow: '#4ab0a5',
        surface: '#232f3d',
        bgDeep: '#10161f',
        bgMid: '#1b2836'
    };

    function isEnabled(record) {
        return record.enabled !== false;
    }

    function typeValues() {
        // Location types never use NONE or LEGENDARY (see validate.js).
        return Object.values(EditorApp.store.enums.PokeType)
            .filter((type) => type !== 'NONE' && type !== 'LEGENDARY')
            .sort();
    }

    function typeOptions() {
        return typeValues().map((type) => ({ value: type, label: type }));
    }

    function swatchStrip(record) {
        const theme = record.theme || {};
        const swatches = THEME_KEYS.map((key) =>
            `<span class="editor-swatch" style="background-color:${escapeAttr(theme[key] || '#000000')}" title="${key}"></span>`
        ).join('');
        return `<span class="editor-swatch-strip">${swatches}</span>`;
    }

    function columns() {
        return [
            { key: 'theme', label: 'Theme', render: swatchStrip },
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
                key: 'terrain',
                label: 'Terrain',
                render: (record) => escapeHtml(record.terrain),
                sortValue: (record) => record.terrain
            },
            {
                key: 'types',
                label: 'Type',
                render: (record) => (Array.isArray(record.types) ? record.types.map(EditorPreview.typeIconHtml).join('') : '')
            },
            {
                key: 'enabled',
                label: 'Enabled',
                render: (record) => `<span class="editor-dot ${isEnabled(record) ? 'editor-dot--on' : 'editor-dot--off'}" title="${isEnabled(record) ? 'Enabled' : 'Disabled'}"></span>`
            }
        ];
    }

    // Canonical new-record key order (25-data-editor-overview.md).
    function template() {
        return {
            id: '',
            name: '',
            terrain: '',
            types: [],
            theme: Object.assign({}, NEUTRAL_LOCATION_THEME),
            background: '',
            enabled: true
        };
    }

    // ------------------------------------------------------------ preview

    function backgroundFileName(draft) {
        const path = draft.background || '';
        return path.split('/').pop();
    }

    function backgroundBlockHtml(draft) {
        const path = draft.background || '';
        const hasFile = path && EditorApp.store.assetIndex.backgrounds.has(backgroundFileName(draft));

        if (!path) {
            return `<div class="editor-location-bg-placeholder">no background path set</div>`;
        }
        if (hasFile) {
            return `<img src="${escapeAttr(path)}" alt="">`;
        }
        return `
            <div class="editor-location-bg-placeholder">
                <code>${escapeHtml(path)}</code><br>
                <span class="editor-badge editor-badge--warning">missing file (uploads arrive in phase 34)</span>
            </div>
        `;
    }

    function swatchLabelsHtml(theme) {
        return THEME_KEYS.map((key) => `
            <span class="editor-location-swatch">
                <span class="editor-location-swatch-chip" style="background-color:${escapeAttr(theme[key] || '#000000')}"></span>
                ${THEME_LABELS[key]}
            </span>
        `).join('');
    }

    function paintPreview(el, draft) {
        const theme = draft.theme || {};
        const panel = el.querySelector('.editor-location-panel');
        THEME_KEYS.forEach((key) => panel.style.setProperty(`--loc-${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`, theme[key] || NEUTRAL_LOCATION_THEME[key]));

        panel.querySelector('.editor-location-name').textContent = draft.name || '(unnamed)';
        panel.querySelector('.editor-location-terrain').textContent = draft.terrain || '';
        panel.querySelector('.editor-location-types').innerHTML = (draft.types || []).map(EditorPreview.typeIconHtml).join('');
        panel.querySelector('.editor-location-bg').innerHTML = backgroundBlockHtml(draft);
        panel.querySelector('.editor-location-swatches').innerHTML = swatchLabelsHtml(theme);
    }

    function renderPreview(el, draft) {
        el.innerHTML = `
            <div class="editor-location-panel">
                <div class="editor-location-header">
                    <h3 class="editor-location-name"></h3>
                    <p class="editor-location-terrain"></p>
                </div>
                <div class="editor-location-types"></div>
                <div class="editor-location-bg"></div>
                <div class="editor-location-swatches"></div>
            </div>
        `;
        paintPreview(el, draft);
    }

    // --------------------------------------------------------------- form

    function typesHintHtml(types) {
        const count = types.length;
        if (count >= 2 && count <= 4) return '';
        return `<span class="editor-badge editor-badge--warning">types must be 2-4 (currently ${count})</span>`;
    }

    function typeChipListHtml(values) {
        const chips = values.map((value, index) =>
            `<span class="editor-chip">${EditorPreview.typeIconHtml(value)}${escapeHtml(value)}` +
            `<button type="button" class="editor-chip-remove" data-chip-remove="types" data-chip-index="${index}" aria-label="Remove ${escapeAttr(value)}">×</button></span>`
        ).join('');
        const remaining = typeValues().filter((value) => !values.includes(value));
        const options = remaining.map((value) => `<option value="${escapeAttr(value)}">${escapeHtml(value)}</option>`).join('');
        return `
            <div class="editor-chip-list">${chips}<select class="editor-chip-add" data-chip-add="types"><option value="">+ add…</option>${options}</select></div>
            ${typesHintHtml(values)}
        `;
    }

    function colorFieldHtml(theme, key) {
        const value = theme[key] || NEUTRAL_LOCATION_THEME[key];
        return `<label>${THEME_LABELS[key]}<input type="color" data-theme-key="${key}" value="${escapeAttr(value)}"></label>`;
    }

    function backgroundRowHtml(draft) {
        const canonical = draft.id ? `assets/backgrounds/${draft.id}.png` : '';
        const isCanonical = Boolean(draft.background) && draft.background === canonical;
        return `
            <div class="editor-form-row">
                <span class="editor-hint">
                    ${draft.background ? `Current: <code>${escapeHtml(draft.background)}</code>` : 'No background path set.'}
                    ${draft.id ? ` (canonical: <code>${escapeHtml(canonical)}</code>)` : ' (enter an id to compute the canonical path)'}
                </span>
            </div>
            <div class="editor-form-row">
                <button type="button" class="editor-btn" data-action="set-canonical-background" ${draft.id ? '' : 'disabled'}>
                    ${isCanonical ? 'Canonical path set' : 'Set canonical path'}
                </button>
            </div>
        `;
    }

    function formHtml(draft) {
        const theme = draft.theme || {};
        return `
            <div class="editor-form-row">
                <label>ID (slug)
                    <input type="text" name="id" value="${escapeAttr(draft.id)}">
                    <span class="editor-hint">Renaming does not move the background file — use "Set canonical path" below afterward.</span>
                </label>
                <label>Name
                    <input type="text" name="name" value="${escapeAttr(draft.name)}">
                </label>
                <label>Terrain
                    <input type="text" name="terrain" value="${escapeAttr(draft.terrain)}">
                </label>
            </div>
            <div class="editor-form-row">
                <label class="editor-form-checkbox"><input type="checkbox" name="enabled" ${draft.enabled !== false ? 'checked' : ''}> Enabled</label>
            </div>
            <div class="editor-form-row">
                <label>Types${typeChipListHtml(draft.types || [])}</label>
            </div>
            <div class="editor-form-row">
                ${THEME_KEYS.map((key) => colorFieldHtml(theme, key)).join('')}
            </div>
            ${backgroundRowHtml(draft)}
        `;
    }

    function renderForm(el, draft, api) {
        function paint() {
            el.innerHTML = formHtml(draft);
        }

        paint();

        el.addEventListener('input', (event) => {
            const target = event.target;

            if (target.dataset.themeKey) {
                draft.theme = draft.theme || {};
                draft.theme[target.dataset.themeKey] = target.value;
                api.markDirty();
                api.refreshPreview();
                return;
            }

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

            if (target.type === 'checkbox') {
                draft[target.name] = target.checked;
                api.markDirty();
                api.refreshPreview();
                return;
            }

            const field = target.name;
            if (!field) return;

            draft[field] = target.value;
            if (field === 'id') paint();

            api.markDirty();
            api.refreshPreview();
        });

        el.addEventListener('click', (event) => {
            const removeBtn = event.target.closest('[data-chip-remove]');
            if (removeBtn) {
                const field = removeBtn.dataset.chipRemove;
                const index = Number(removeBtn.dataset.chipIndex);
                draft[field].splice(index, 1);
                paint();
                api.markDirty();
                api.refreshPreview();
                return;
            }

            const canonicalBtn = event.target.closest('[data-action="set-canonical-background"]');
            if (canonicalBtn && draft.id) {
                draft.background = `assets/backgrounds/${draft.id}.png`;
                paint();
                api.markDirty();
                api.refreshPreview();
            }
        });
    }

    // ------------------------------------------------------------- editor

    function openLocationEditor(record) {
        EditorApp.openEditor({
            kind: 'location',
            fileName: 'locations',
            record,
            template,
            renderPreview,
            renderForm
        });
    }

    function render(root) {
        root.innerHTML = `
            <div class="editor-tab-toolbar">
                <button type="button" class="editor-btn editor-btn--primary" data-action="add-location">+ Add location</button>
            </div>
            <div class="editor-list-slot"></div>
        `;

        root.querySelector('[data-action="add-location"]').addEventListener('click', () => openLocationEditor(null));

        return EditorListView.createListView({
            root: root.querySelector('.editor-list-slot'),
            columns: columns(),
            records: EditorApp.store.data.locations,
            getKey: (record) => record.id,
            searchFields: ['name', 'id'],
            filters: [
                {
                    key: 'type',
                    label: 'Types',
                    options: typeOptions(),
                    match: (record, value) => Array.isArray(record.types) && record.types.includes(value)
                },
                {
                    key: 'enabled',
                    label: 'Enabled',
                    options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
                    match: (record, value) => (value === 'yes') === isEnabled(record)
                }
            ],
            defaultSort: { key: 'name', direction: 'asc' },
            onSelect: openLocationEditor
        });
    }

    EditorApp.registerTab('locations', { label: 'Locations', render });
})(window.EditorApp, window.EditorPreview, window.EditorListView);
