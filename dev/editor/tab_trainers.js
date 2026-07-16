/**
 * Trainers list tab: sprite thumb, name, rank, spec type icon, cash, deck
 * sizes P/A/I. See 25-data-editor-overview.md's "List views" table.
 */
(function (EditorApp, EditorPreview, EditorListView) {
    'use strict';

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
                render: (record) => `<img class="editor-thumb" src="${EditorPreview.spritePathFor(record)}" alt="">`
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

    function render(root) {
        return EditorListView.createListView({
            root,
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
            onSelect: () => {}
        });
    }

    EditorApp.registerTab('trainers', { label: 'Trainers', render });
})(window.EditorApp, window.EditorPreview, window.EditorListView);
