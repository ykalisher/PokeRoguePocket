/**
 * Attacks list tab: name, type icons, power, status, target, stat changes,
 * full-req flag. See 25-data-editor-overview.md's "List views" table.
 */
(function (EditorApp, EditorPreview, EditorListView) {
    'use strict';

    function typeOptions() {
        return Object.values(EditorApp.store.enums.PokeType)
            .filter((type) => type !== 'NONE')
            .sort()
            .map((type) => ({ value: type, label: type }));
    }

    function enumOptions(map) {
        return Object.values(map).sort().map((value) => ({ value, label: value }));
    }

    function columns() {
        return [
            {
                key: 'name',
                label: 'Name',
                render: (record) => EditorListView.escapeHtml(record.name),
                sortValue: (record) => record.name
            },
            {
                key: 'types',
                label: 'Type',
                render: (record) => EditorPreview.compactTypes([record.type1, record.type2]).map(EditorPreview.typeIconHtml).join('')
            },
            {
                key: 'basePower',
                label: 'Power',
                numeric: true,
                render: (record) => record.basePower,
                sortValue: (record) => Number(record.basePower) || 0
            },
            {
                key: 'status',
                label: 'Status',
                render: (record) => EditorListView.escapeHtml(record.status),
                sortValue: (record) => record.status
            },
            {
                key: 'target',
                label: 'Target',
                render: (record) => EditorListView.escapeHtml(record.target),
                sortValue: (record) => record.target
            },
            {
                key: 'statChanges',
                label: 'Stat changes',
                render: (record) => EditorListView.escapeHtml(Array.isArray(record.statChanges) ? record.statChanges.join(', ') : '')
            },
            {
                key: 'full_type_requirements',
                label: 'Full req',
                render: (record) => (record.full_type_requirements ? '✓' : '—')
            }
        ];
    }

    function render(root) {
        EditorListView.createListView({
            root,
            columns: columns(),
            records: EditorApp.store.data.attacks,
            getKey: (record) => record.name,
            searchFields: ['name'],
            filters: [
                {
                    key: 'type',
                    label: 'Types',
                    options: typeOptions(),
                    match: (record, value) => [record.type1, record.type2].includes(value)
                },
                {
                    key: 'target',
                    label: 'Targets',
                    options: enumOptions(EditorApp.store.enums.AttackTarget),
                    match: (record, value) => record.target === value
                },
                {
                    key: 'status',
                    label: 'Statuses',
                    options: enumOptions(EditorApp.store.enums.Status),
                    match: (record, value) => record.status === value
                }
            ],
            defaultSort: { key: 'name', direction: 'asc' },
            onSelect: () => {}
        });
    }

    EditorApp.registerTab('attacks', { label: 'Attacks', render });
})(window.EditorApp, window.EditorPreview, window.EditorListView);
