/**
 * Locations list tab: 5-color theme swatch strip, name, id, terrain, type
 * icons, enabled dot. See 25-data-editor-overview.md's "List views" table.
 */
(function (EditorApp, EditorPreview, EditorListView) {
    'use strict';

    const THEME_KEYS = ['accent', 'glow', 'surface', 'bgDeep', 'bgMid'];

    function isEnabled(record) {
        return record.enabled !== false;
    }

    function typeOptions() {
        // Location types never use NONE or LEGENDARY (see validate.js).
        return Object.values(EditorApp.store.enums.PokeType)
            .filter((type) => type !== 'NONE' && type !== 'LEGENDARY')
            .sort()
            .map((type) => ({ value: type, label: type }));
    }

    function swatchStrip(record) {
        const theme = record.theme || {};
        const swatches = THEME_KEYS.map((key) =>
            `<span class="editor-swatch" style="background-color:${EditorListView.escapeAttr(theme[key] || '#000000')}" title="${key}"></span>`
        ).join('');
        return `<span class="editor-swatch-strip">${swatches}</span>`;
    }

    function columns() {
        return [
            { key: 'theme', label: 'Theme', render: swatchStrip },
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
                key: 'terrain',
                label: 'Terrain',
                render: (record) => EditorListView.escapeHtml(record.terrain),
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

    function render(root) {
        return EditorListView.createListView({
            root,
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
            onSelect: () => {}
        });
    }

    EditorApp.registerTab('locations', { label: 'Locations', render });
})(window.EditorApp, window.EditorPreview, window.EditorListView);
