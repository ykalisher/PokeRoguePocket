/**
 * Attacks tab: list (name, type icons, power, status, target, stat changes,
 * full-req flag) plus the full detail editor (live action-card preview left,
 * form right) via EditorApp.openEditor(). See
 * dev/feature_plans/25-data-editor-overview.md's "List views" table and
 * dev/feature_plans/30-editor-attacks-items.md for the locked spec, incl.
 * the ARTIFICIAL guardrails.
 */
(function (EditorApp, EditorPreview, EditorListView) {
    'use strict';

    const escapeHtml = EditorListView.escapeHtml;
    const escapeAttr = EditorListView.escapeAttr;

    function typeOptions() {
        return Object.values(EditorApp.store.enums.PokeType)
            .filter((type) => type !== 'NONE')
            .sort()
            .map((type) => ({ value: type, label: type }));
    }

    function typeValuesInclNone() {
        return Object.values(EditorApp.store.enums.PokeType).slice().sort();
    }

    function enumOptions(map) {
        return Object.values(map).sort().map((value) => ({ value, label: value }));
    }

    function artificialStatuses() {
        return (EditorApp.store.enums.extensions && EditorApp.store.enums.extensions.attackStatuses) || [];
    }

    function artificialTargets() {
        return (EditorApp.store.enums.extensions && EditorApp.store.enums.extensions.attackTargets) || [];
    }

    function statusOptions() {
        const base = enumOptions(EditorApp.store.enums.Status);
        const trainerEffect = artificialStatuses().slice().sort().map((value) => ({ value, label: `${value} (trainer-effect)` }));
        return [...base, ...trainerEffect];
    }

    function targetOptions() {
        const base = enumOptions(EditorApp.store.enums.AttackTarget);
        const trainerEffect = artificialTargets().slice().sort().map((value) => ({ value, label: value }));
        return [...base, ...trainerEffect];
    }

    function isArtificial(draft) {
        return draft.type1 === 'ARTIFICIAL' || draft.type2 === 'ARTIFICIAL';
    }

    function columns() {
        return [
            {
                key: 'name',
                label: 'Name',
                render: (record) => escapeHtml(record.name),
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
                render: (record) => escapeHtml(record.status),
                sortValue: (record) => record.status
            },
            {
                key: 'target',
                label: 'Target',
                render: (record) => escapeHtml(record.target),
                sortValue: (record) => record.target
            },
            {
                key: 'statChanges',
                label: 'Stat changes',
                render: (record) => escapeHtml(Array.isArray(record.statChanges) ? record.statChanges.join(', ') : '')
            },
            {
                key: 'full_type_requirements',
                label: 'Full req',
                render: (record) => (record.full_type_requirements ? '✓' : '—')
            }
        ];
    }

    function template() {
        return {
            name: '',
            type1: 'NORMAL',
            type2: 'NONE',
            basePower: 0,
            status: 'NONE',
            statChanges: [],
            target: 'OPPONENT',
            full_type_requirements: false
        };
    }

    // ------------------------------------------------------------ preview

    function renderPreview(el, draft) {
        el.innerHTML = '<div class="editor-preview-card" style="--card-w: 140px"></div>';
        EditorPreview.renderCardInto(el.querySelector('.editor-preview-card'), 'attack', draft);
    }

    // --------------------------------------------------------------- form

    function selectHtml(name, current, options) {
        const opts = options.map((opt) => {
            const value = typeof opt === 'string' ? opt : opt.value;
            const label = typeof opt === 'string' ? opt : opt.label;
            return `<option value="${escapeAttr(value)}"${value === current ? ' selected' : ''}>${escapeHtml(label)}</option>`;
        }).join('');
        return `<select name="${name}">${opts}</select>`;
    }

    function chipListHtml(field, values, addOptions, legacySet) {
        const chips = values.map((value, index) => {
            const legacy = legacySet && legacySet.has(value);
            return `<span class="editor-chip${legacy ? ' editor-chip--legacy' : ''}">${escapeHtml(value)}` +
                `<button type="button" class="editor-chip-remove" data-chip-remove="${field}" data-chip-index="${index}" aria-label="Remove ${escapeAttr(value)}">×</button></span>`;
        }).join('');
        const options = addOptions.map((value) => `<option value="${escapeAttr(value)}">${escapeHtml(value)}</option>`).join('');
        return `<div class="editor-chip-list">${chips}<select class="editor-chip-add" data-chip-add="${field}"><option value="">+ add…</option>${options}</select></div>`;
    }

    function artificialBannerHtml(draft, record) {
        if (!isArtificial(draft)) return '';

        const problems = [];
        if (draft.target !== 'TRAINER') {
            problems.push('ARTIFICIAL attacks must set target to TRAINER.');
        }
        if (!artificialStatuses().includes(draft.status)) {
            problems.push(`ARTIFICIAL attacks need a trainer-effect status (${artificialStatuses().join(', ')}).`);
        }

        const otherCount = EditorApp.store.data.attacks.filter((a) => a !== record && isArtificial(a)).length;
        const count = otherCount + 1;
        const cap = (EditorApp.store.enums.extensions && EditorApp.store.enums.extensions.artificialAttackCap) || 6;
        if (count > cap) {
            problems.push(`Saving would bring the ARTIFICIAL attack count to ${count}, above the cap of ${cap}.`);
        }

        return `
            <div class="editor-warning-banner">
                <p><strong>ARTIFICIAL attack</strong> — ${count} of ${cap} used.</p>
                ${problems.map((text) => `<p>${escapeHtml(text)}</p>`).join('')}
            </div>
        `;
    }

    function formHtml(draft, record) {
        return `
            ${artificialBannerHtml(draft, record)}
            <div class="editor-form-row">
                <label>Name
                    <input type="text" name="name" value="${escapeAttr(draft.name)}">
                </label>
            </div>
            <div class="editor-form-row">
                <label>Type 1${selectHtml('type1', draft.type1, typeValuesInclNone().filter((t) => t !== 'NONE'))}</label>
                <label>Type 2${selectHtml('type2', draft.type2, typeValuesInclNone())}</label>
                <label>Base power<input type="number" name="basePower" min="0" value="${draft.basePower}"></label>
            </div>
            <div class="editor-form-row">
                <label>Status${selectHtml('status', draft.status, statusOptions())}</label>
                <label>Target${selectHtml('target', draft.target, targetOptions())}</label>
            </div>
            <div class="editor-form-row">
                <label>Stat changes
                    ${chipListHtml('statChanges', draft.statChanges || [], Object.values(EditorApp.store.enums.StatChange).sort(), null)}
                </label>
            </div>
            <div class="editor-form-row">
                <label class="editor-form-checkbox">
                    <input type="checkbox" name="full_type_requirements"${draft.full_type_requirements ? ' checked' : ''}>
                    Full type requirements
                </label>
            </div>
        `;
    }

    function renderForm(el, draft, api, record) {
        function paint() {
            el.innerHTML = formHtml(draft, record);
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

            if (field === 'basePower') {
                draft[field] = Number(target.value);
            } else if (field === 'full_type_requirements') {
                draft[field] = target.checked;
            } else {
                draft[field] = target.value;
            }

            if (field === 'type1' || field === 'type2' || field === 'target' || field === 'status') {
                paint();
            }

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

    function openAttackEditor(record) {
        EditorApp.openEditor({
            kind: 'attack',
            fileName: 'attacks',
            record,
            template,
            renderPreview,
            renderForm: (el, draft, api) => renderForm(el, draft, api, record)
        });
    }

    function render(root) {
        root.innerHTML = `
            <div class="editor-tab-toolbar">
                <button type="button" class="editor-btn editor-btn--primary" data-action="add-attack">+ Add attack</button>
            </div>
            <div class="editor-list-slot"></div>
        `;

        root.querySelector('[data-action="add-attack"]').addEventListener('click', () => openAttackEditor(null));

        return EditorListView.createListView({
            root: root.querySelector('.editor-list-slot'),
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
            onSelect: openAttackEditor
        });
    }

    EditorApp.registerTab('attacks', {
        label: 'Attacks',
        render,
        info: {
            title: 'Attack balance notes',
            lines: [
                'Legendary two-type attacks no effect: 85 for single opponent, 80 for all opponents',
                'Legendary two-type attacks + effect: 80 for single opponent, 75 for all opponents',
                'Legendary single-type attacks no effect: 75 for single opponent, 70 for all',
                'Legendary single-type attacks + effect: 70 for single opponent, 65 for all',
                'two-type attacks no effect: 70 for single opponent, 65 for all',
                'two-type attacks + effect: 65 for single opponent, 60 for all',
                'single-type attack no effect: 60 for single opponent, 55 for all',
                'single-type attack + effect: 55 for single opponent, 50 for all'
            ]
        }
    });
})(window.EditorApp, window.EditorPreview, window.EditorListView);
