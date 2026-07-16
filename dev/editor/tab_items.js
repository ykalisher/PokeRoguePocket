/**
 * Items list tab: image thumb, name, target, statuses, stat changes.
 * See 25-data-editor-overview.md's "List views" table.
 */
(function (EditorApp, EditorPreview, EditorListView) {
    'use strict';

    function enumOptions(map) {
        return Object.values(map).sort().map((value) => ({ value, label: value }));
    }

    function columns() {
        return [
            {
                key: 'image',
                label: '',
                render: (record) => `<img class="editor-thumb" src="${EditorPreview.itemImagePathFor(record)}" alt="">`
            },
            {
                key: 'name',
                label: 'Name',
                render: (record) => EditorListView.escapeHtml(record.name),
                sortValue: (record) => record.name
            },
            {
                key: 'target',
                label: 'Target',
                render: (record) => EditorListView.escapeHtml(record.target),
                sortValue: (record) => record.target
            },
            {
                key: 'status',
                label: 'Statuses',
                render: (record) => EditorListView.escapeHtml(Array.isArray(record.status) ? record.status.join(', ') : '')
            },
            {
                key: 'statChanges',
                label: 'Stat changes',
                render: (record) => EditorListView.escapeHtml(Array.isArray(record.statChanges) ? record.statChanges.join(', ') : '')
            }
        ];
    }

    function render(root) {
        EditorListView.createListView({
            root,
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
            onSelect: () => {}
        });
    }

    EditorApp.registerTab('items', { label: 'Items', render });
})(window.EditorApp, window.EditorPreview, window.EditorListView);
