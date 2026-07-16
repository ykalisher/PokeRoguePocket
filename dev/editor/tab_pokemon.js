/**
 * Pokemon list tab: portrait thumb, name, id, type icons, HP/ATK/DEF/SPD,
 * computed BST. See dev/feature_plans/25-data-editor-overview.md's
 * "List views" table for the locked column/search/filter/sort spec.
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

    function typeOptions() {
        return Object.values(EditorApp.store.enums.PokeType)
            .filter((type) => type !== 'NONE')
            .sort()
            .map((type) => ({ value: type, label: type }));
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
            {
                key: 'baseHealth',
                label: 'HP',
                numeric: true,
                editable: true,
                render: (record) => record.baseHealth,
                sortValue: (record) => Number(record.baseHealth) || 0
            },
            {
                key: 'baseAttack',
                label: 'ATK',
                numeric: true,
                editable: true,
                render: (record) => record.baseAttack,
                sortValue: (record) => Number(record.baseAttack) || 0
            },
            {
                key: 'baseDefense',
                label: 'DEF',
                numeric: true,
                editable: true,
                render: (record) => record.baseDefense,
                sortValue: (record) => Number(record.baseDefense) || 0
            },
            {
                key: 'baseSpeed',
                label: 'SPD',
                numeric: true,
                editable: true,
                render: (record) => record.baseSpeed,
                sortValue: (record) => Number(record.baseSpeed) || 0
            },
            {
                key: 'bst',
                label: 'BST',
                numeric: true,
                render: bst,
                sortValue: bst
            }
        ];
    }

    function render(root) {
        EditorListView.createListView({
            root,
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
            onSelect: () => {}
        });
    }

    EditorApp.registerTab('pokemon', { label: 'Pokemon', render });
})(window.EditorApp, window.EditorPreview, window.EditorListView);
