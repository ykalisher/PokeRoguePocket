/**
 * Events list tab: type badge, id, title, gate type icons, enabled dot.
 * See 25-data-editor-overview.md's "List views" table.
 */
(function (EditorApp, EditorPreview, EditorListView) {
    'use strict';

    function gateTypeOptions() {
        // Event location gates never use NONE (empty slot) or LEGENDARY (see
        // the overview's Event vocabulary section).
        return Object.values(EditorApp.store.enums.PokeType)
            .filter((type) => type !== 'NONE' && type !== 'LEGENDARY')
            .sort()
            .map((type) => ({ value: type, label: type }));
    }

    function isEnabled(record) {
        return record.enabled !== false;
    }

    function columns() {
        return [
            {
                key: 'type',
                label: 'Type',
                render: (record) => `<span class="editor-badge">${EditorListView.escapeHtml(record.type)}</span>`,
                sortValue: (record) => record.type
            },
            {
                key: 'id',
                label: 'ID',
                render: (record) => EditorListView.escapeHtml(record.id),
                sortValue: (record) => record.id
            },
            {
                key: 'title',
                label: 'Title',
                render: (record) => EditorListView.escapeHtml(record.title),
                sortValue: (record) => record.title
            },
            {
                key: 'types',
                label: 'Gate',
                render: (record) => (Array.isArray(record.types) && record.types.length
                    ? record.types.map(EditorPreview.typeIconHtml).join('')
                    : '<span class="editor-muted">Any</span>')
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
            records: EditorApp.store.data.events,
            getKey: (record) => record.id,
            searchFields: ['title', 'id'],
            filters: [
                {
                    key: 'type',
                    label: 'Event types',
                    options: EditorApp.store.enums.eventTypes.map((type) => ({ value: type, label: type })),
                    match: (record, value) => record.type === value
                },
                {
                    key: 'gate',
                    label: 'Gate types',
                    options: gateTypeOptions(),
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
            onSelect: () => {}
        });
    }

    EditorApp.registerTab('events', { label: 'Events', render });
})(window.EditorApp, window.EditorPreview, window.EditorListView);
