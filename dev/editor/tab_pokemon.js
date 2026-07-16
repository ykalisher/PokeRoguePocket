/**
 * Pokemon tab: list (portrait thumb, name, id, type icons, HP/ATK/DEF/SPD
 * inline-editable, computed BST) plus the full detail editor (live card
 * preview left, form right) via EditorApp.openEditor(). See
 * dev/feature_plans/25-data-editor-overview.md's "List views" table and
 * dev/feature_plans/29-editor-framework-and-pokemon.md for the locked spec.
 */
(function (EditorApp, EditorPreview, EditorListView) {
    'use strict';

    function isLegendary(record) {
        return [record.type1, record.type2, record.type3].includes('LEGENDARY');
    }

    function bst(record) {
        return (Number(record.baseHealth) || 0)
            + (Number(record.baseAttack) || 0)
            + (Number(record.baseDefense) || 0)
            + (Number(record.baseSpeed) || 0);
    }

    function typeValues() {
        return Object.values(EditorApp.store.enums.PokeType).slice().sort();
    }

    function typeOptions() {
        return typeValues()
            .filter((type) => type !== 'NONE')
            .map((type) => ({ value: type, label: type }));
    }

    function statValidate(value) {
        return Number.isFinite(value) && value > 0 ? true : 'must be a positive number';
    }

    function statColumn(key, label) {
        return {
            key,
            label,
            numeric: true,
            editable: { parse: Number, validate: statValidate },
            render: (record) => record[key],
            sortValue: (record) => Number(record[key]) || 0
        };
    }

    function columns() {
        return [
            {
                key: 'portrait',
                label: '',
                render: (record) => `<img class="editor-thumb" src="assets/portraits/${encodeURIComponent(record.name)}.png" alt="">`
            },
            {
                key: 'name',
                label: 'Name',
                render: (record) => EditorListView.escapeHtml(record.name),
                sortValue: (record) => record.name
            },
            {
                key: 'id',
                label: 'ID',
                render: (record) => EditorListView.escapeHtml(record.id),
                sortValue: (record) => record.id
            },
            {
                key: 'types',
                label: 'Type',
                render: (record) => EditorPreview.compactTypes([record.type1, record.type2, record.type3]).map(EditorPreview.typeIconHtml).join('')
            },
            statColumn('baseHealth', 'HP'),
            statColumn('baseAttack', 'ATK'),
            statColumn('baseDefense', 'DEF'),
            statColumn('baseSpeed', 'SPD'),
            {
                key: 'bst',
                label: 'BST',
                numeric: true,
                render: bst,
                sortValue: bst
            }
        ];
    }

    // Suggested id for "Add pokemon": max numeric id + 1, zero-padded to 4
    // digits; falls back to the smallest unused id past 9999.
    function suggestId() {
        const ids = EditorApp.store.data.pokemon
            .map((record) => parseInt(record.id, 10))
            .filter(Number.isFinite);
        const max = ids.length ? Math.max(...ids) : 0;
        let candidate = max + 1;
        if (candidate > 9999) {
            const used = new Set(ids);
            candidate = 1;
            while (used.has(candidate)) candidate += 1;
        }
        return String(candidate).padStart(4, '0');
    }

    function template() {
        return {
            name: '',
            type1: 'NORMAL',
            type2: 'NONE',
            type3: 'NONE',
            id: suggestId(),
            baseHealth: 1,
            baseAttack: 1,
            baseDefense: 1,
            baseSpeed: 1
        };
    }

    // ------------------------------------------------------------ preview

    function paintPreview(el, draft) {
        EditorPreview.renderCardInto(el.querySelector('.editor-preview-card'), 'pokemon', draft);

        const portraitFile = `${draft.name}.png`;
        const hasPortrait = EditorApp.store.assetIndex.portraits.has(portraitFile);
        const pathEl = el.querySelector('.editor-preview-portrait-path');
        const path = `assets/portraits/${EditorListView.escapeHtml(portraitFile)}`;
        pathEl.innerHTML = hasPortrait
            ? `<code>${path}</code>`
            : `<code>${path}</code><br><span class="editor-badge editor-badge--warning">portrait missing (uploads arrive in phase 34)</span>`;
    }

    function renderPreview(el, draft) {
        el.innerHTML = `
            <div class="editor-preview-card" style="--card-w: 140px"></div>
            <p class="editor-preview-portrait-path"></p>
        `;
        paintPreview(el, draft);
    }

    // --------------------------------------------------------------- form

    function typeSelectHtml(name, current, includeNone) {
        const options = typeValues()
            .filter((type) => includeNone || type !== 'NONE')
            .map((type) => `<option value="${type}"${type === current ? ' selected' : ''}>${type}</option>`)
            .join('');
        return `<select name="${name}">${options}</select>`;
    }

    function renderForm(el, draft, api) {
        el.innerHTML = `
            <div class="editor-form-row">
                <label>Name
                    <input type="text" name="name" value="${EditorListView.escapeAttr(draft.name)}">
                </label>
                <label>ID
                    <input type="text" name="id" value="${EditorListView.escapeAttr(draft.id)}" pattern="\\d{4}">
                </label>
            </div>
            <div class="editor-form-row">
                <label>Type 1${typeSelectHtml('type1', draft.type1, false)}</label>
                <label>Type 2${typeSelectHtml('type2', draft.type2, true)}</label>
                <label>Type 3${typeSelectHtml('type3', draft.type3, true)}</label>
            </div>
            <div class="editor-form-row">
                <label>HP<input type="number" name="baseHealth" min="1" value="${draft.baseHealth}"></label>
                <label>ATK<input type="number" name="baseAttack" min="1" value="${draft.baseAttack}"></label>
                <label>DEF<input type="number" name="baseDefense" min="1" value="${draft.baseDefense}"></label>
                <label>SPD<input type="number" name="baseSpeed" min="1" value="${draft.baseSpeed}"></label>
            </div>
            <p class="editor-form-bst">BST: <strong data-role="bst">${bst(draft)}</strong></p>
        `;

        const STAT_FIELDS = ['baseHealth', 'baseAttack', 'baseDefense', 'baseSpeed'];

        el.addEventListener('input', (event) => {
            const field = event.target.name;
            if (!field) return;

            draft[field] = STAT_FIELDS.includes(field) ? Number(event.target.value) : event.target.value;

            if (STAT_FIELDS.includes(field)) {
                el.querySelector('[data-role="bst"]').textContent = bst(draft);
            }

            api.markDirty();
            api.refreshPreview();
        });
    }

    // ------------------------------------------------------------- editor

    function openPokemonEditor(record) {
        EditorApp.openEditor({
            kind: 'pokemon',
            fileName: 'pokemon',
            record,
            template,
            renderPreview,
            renderForm
        });
    }

    function commitStatEdit(record, column, value) {
        return EditorApp.saveFieldEdit('pokemon', record, column.key, value);
    }

    function render(root) {
        root.innerHTML = `
            <div class="editor-tab-toolbar">
                <button type="button" class="editor-btn editor-btn--primary" data-action="add-pokemon">+ Add pokemon</button>
            </div>
            <div class="editor-list-slot"></div>
        `;

        root.querySelector('[data-action="add-pokemon"]').addEventListener('click', () => openPokemonEditor(null));

        return EditorListView.createListView({
            root: root.querySelector('.editor-list-slot'),
            columns: columns(),
            records: EditorApp.store.data.pokemon,
            getKey: (record) => record.id,
            searchFields: ['name'],
            filters: [
                {
                    key: 'type',
                    label: 'Types',
                    options: typeOptions(),
                    match: (record, value) => [record.type1, record.type2, record.type3].includes(value)
                },
                {
                    key: 'legendary',
                    label: 'Legendary',
                    options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
                    match: (record, value) => (value === 'yes') === isLegendary(record)
                }
            ],
            defaultSort: { key: 'id', direction: 'asc' },
            onSelect: openPokemonEditor,
            onCommitEdit: commitStatEdit
        });
    }

    EditorApp.registerTab('pokemon', { label: 'Pokemon', render });
})(window.EditorApp, window.EditorPreview, window.EditorListView);
