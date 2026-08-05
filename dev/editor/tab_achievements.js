/**
 * Achievements tab: list (enabled dot, name, id, stat, threshold, hidden
 * marker) plus the full detail editor (achievements.html-style preview left,
 * form right) via EditorApp.openEditor(). See
 * dev/feature_plans/97-achievements-editor-tab.md for the locked spec.
 *
 * The stat namespace (map/profile.js) has nine exact counter keys plus four
 * families whose suffix is data (a starter id, a PokeType, a Rank, an event
 * id) — a plain <select> can't express that, so the form splits `stat` into
 * two controls and rejoins them into the one string the record stores. The
 * split is derived from draft.stat on every paint, never stored separately,
 * so an untouched record round-trips byte-for-byte.
 */
(function (EditorApp, EditorPreview, EditorListView) {
    'use strict';

    const escapeHtml = EditorListView.escapeHtml;
    const escapeAttr = EditorListView.escapeAttr;

    const STAT_LABELS = {
        'runs.started': 'Runs started',
        'runs.completed': 'Runs completed',
        'runs.lost': 'Runs lost',
        'battles.won': 'Battles won',
        'battles.lost': 'Battles lost',
        'events.seen': 'Events seen (total)',
        'captures.completed': 'Captures completed',
        'attacks.claimed': 'Attacks claimed',
        'marts.visited': 'Marts visited'
    };

    const FAMILY_LABELS = {
        'runs.completed.starter.': 'Runs completed with starter…',
        'runs.completed.mono.': 'Runs completed with only type…',
        'battles.won.rank.': 'Battles won vs rank…',
        'events.seen.': 'Times a specific event was seen…'
    };

    function isEnabled(record) {
        return record.enabled !== false;
    }

    function statKeys() {
        return EditorApp.store.enums.statKeys || [];
    }

    function statPrefixes() {
        return EditorApp.store.enums.statPrefixes || [];
    }

    // Derives { selection, suffix } from the joined stat string: selection is
    // either an exact key or a family prefix, suffix is only meaningful for
    // the latter. An unrecognized value (e.g. authored outside the editor)
    // falls back to itself so nothing is silently rewritten on open.
    function splitStat(stat) {
        const value = String(stat || '');
        if (statKeys().includes(value)) return { selection: value, suffix: '' };
        const prefix = statPrefixes().find((candidate) => value.startsWith(candidate));
        if (prefix) return { selection: prefix, suffix: value.slice(prefix.length) };
        return { selection: value, suffix: '' };
    }

    function columns() {
        return [
            {
                key: 'enabled',
                label: 'Enabled',
                render: (record) => `<span class="editor-dot ${isEnabled(record) ? 'editor-dot--on' : 'editor-dot--off'}" title="${isEnabled(record) ? 'Enabled' : 'Disabled'}"></span>`
            },
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
            { key: 'stat', label: 'Stat', render: (record) => `<code>${escapeHtml(record.stat || '')}</code>` },
            { key: 'atLeast', label: 'At least', render: (record) => escapeHtml(String(record.atLeast)) },
            { key: 'hidden', label: 'Hidden', render: (record) => (record.hidden ? '<span class="editor-badge">hidden</span>' : '') }
        ];
    }

    // Canonical new-record key order (97-achievements-editor-tab.md).
    function template() {
        return { id: '', name: '', description: '', stat: 'runs.completed', atLeast: 1, hidden: false, enabled: true };
    }

    // ------------------------------------------------------------ preview

    // Mirrors renderRow()/renderMeta() in map/achievements.js. A draft is
    // never actually unlocked, so isHiddenLocked collapses to draft.hidden.
    function renderPreview(el, draft) {
        const isHiddenLocked = Boolean(draft.hidden);
        const atLeast = Number.isInteger(draft.atLeast) && draft.atLeast >= 1 ? draft.atLeast : 1;
        const name = isHiddenLocked ? '???' : escapeHtml(draft.name || '(unnamed)');
        const description = isHiddenLocked ? '???' : escapeHtml(draft.description || '');
        const meta = isHiddenLocked ? '' : `
            <p class="achievement-progress-label">0 / ${atLeast}</p>
            <div class="achievement-progress">
                <div class="achievement-progress-bar" style="width: 0%"></div>
            </div>
        `;

        el.innerHTML = `
            <article class="achievement-row achievement-row--locked">
                <h2 class="achievement-name">${name}</h2>
                <p class="achievement-description">${description}</p>
                ${meta}
            </article>
        `;
    }

    // --------------------------------------------------------------- form

    function selectHtml(name, current, options, blankLabel) {
        const blank = blankLabel !== undefined
            ? `<option value=""${current ? '' : ' selected'}>${escapeHtml(blankLabel)}</option>`
            : '';
        const opts = options.map(({ value, label }) =>
            `<option value="${escapeAttr(value)}"${value === current ? ' selected' : ''}>${escapeHtml(label)}</option>`
        ).join('');
        return `<select name="${name}">${blank}${opts}</select>`;
    }

    function familyOptions() {
        const known = [
            ...statKeys().map((key) => ({ value: key, label: STAT_LABELS[key] || key })),
            ...statPrefixes().map((prefix) => ({ value: prefix, label: FAMILY_LABELS[prefix] || prefix }))
        ];
        return known;
    }

    function familySelectHtml(draft) {
        const { selection } = splitStat(draft.stat);
        const options = familyOptions();
        const isKnown = options.some((option) => option.value === selection);
        const withCurrent = selection && !isKnown ? [{ value: selection, label: selection }, ...options] : options;
        return selectHtml('statFamily', selection, withCurrent);
    }

    // Data-driven suffix choices for each family; null means "no known list
    // yet, fall back to free text" (only reachable for starter ids today,
    // and only if starter_decks.json somehow has zero enabled decks).
    function suffixOptionsFor(prefix) {
        if (prefix === 'runs.completed.starter.') {
            const decks = EditorApp.store.data.starter_decks;
            if (!Array.isArray(decks) || decks.length === 0) return null;
            return decks.map((deck) => ({ value: deck.id, label: deck.name || deck.id }));
        }
        if (prefix === 'runs.completed.mono.') {
            return Object.values(EditorApp.store.enums.PokeType)
                .filter((type) => type !== 'NONE')
                .sort()
                .map((type) => ({ value: type, label: type }));
        }
        if (prefix === 'battles.won.rank.') {
            return (EditorApp.store.enums.Rank || []).map((rank) => ({ value: rank, label: rank }));
        }
        if (prefix === 'events.seen.') {
            return (EditorApp.store.data.events || [])
                .map((event) => event && event.id)
                .filter(Boolean)
                .map((id) => ({ value: id, label: id }));
        }
        return null;
    }

    function suffixControlHtml(draft) {
        const { selection, suffix } = splitStat(draft.stat);
        if (!statPrefixes().includes(selection)) return '';

        const options = suffixOptionsFor(selection);
        if (options === null) {
            return `<label>Value<input type="text" name="statSuffix" value="${escapeAttr(suffix)}" placeholder="id"></label>`;
        }
        return `<label>Value${selectHtml('statSuffix', suffix, options, 'Select…')}</label>`;
    }

    function formHtml(draft) {
        return `
            <div class="editor-form-row">
                <label>ID (slug)
                    <input type="text" name="id" value="${escapeAttr(draft.id)}">
                </label>
                <label>Name
                    <input type="text" name="name" value="${escapeAttr(draft.name)}">
                </label>
            </div>
            <div class="editor-form-row">
                <label>Description
                    <input type="text" name="description" value="${escapeAttr(draft.description)}">
                </label>
            </div>
            <div class="editor-form-row">
                <label>Counter${familySelectHtml(draft)}</label>
                ${suffixControlHtml(draft)}
                <label>At least
                    <input type="number" name="atLeast" min="1" value="${escapeAttr(draft.atLeast)}">
                </label>
            </div>
            <span class="editor-hint">Counters are lifetime totals across every run, stored separately from the save.</span>
            <div class="editor-form-row">
                <label class="editor-form-checkbox"><input type="checkbox" name="hidden" ${draft.hidden ? 'checked' : ''}> Hidden</label>
                <label class="editor-form-checkbox"><input type="checkbox" name="enabled" ${draft.enabled !== false ? 'checked' : ''}> Enabled</label>
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
            const field = target.name;
            if (!field) return;

            if (field === 'statFamily') {
                draft.stat = target.value;
                paint();
                api.markDirty();
                api.refreshPreview();
                return;
            }

            if (field === 'statSuffix') {
                const { selection } = splitStat(draft.stat);
                draft.stat = selection + target.value;
                api.markDirty();
                api.refreshPreview();
                return;
            }

            if (target.type === 'checkbox') {
                draft[field] = target.checked;
                api.markDirty();
                api.refreshPreview();
                return;
            }

            if (field === 'atLeast') {
                draft.atLeast = Number(target.value);
                api.markDirty();
                api.refreshPreview();
                return;
            }

            draft[field] = target.value;
            api.markDirty();
            api.refreshPreview();
        });
    }

    // ------------------------------------------------------------- editor

    function openAchievementEditor(record) {
        EditorApp.openEditor({
            kind: 'achievement',
            fileName: 'achievements',
            record,
            template,
            renderPreview,
            renderForm
        });
    }

    function render(root) {
        root.innerHTML = `
            <div class="editor-tab-toolbar">
                <button type="button" class="editor-btn editor-btn--primary" data-action="add-achievement">+ Add achievement</button>
            </div>
            <div class="editor-list-slot"></div>
        `;

        root.querySelector('[data-action="add-achievement"]').addEventListener('click', () => openAchievementEditor(null));

        return EditorListView.createListView({
            root: root.querySelector('.editor-list-slot'),
            columns: columns(),
            records: EditorApp.store.data.achievements,
            getKey: (record) => record.id,
            searchFields: ['name', 'id', 'description'],
            filters: [
                {
                    key: 'enabled',
                    label: 'Enabled',
                    options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
                    match: (record, value) => (value === 'yes') === isEnabled(record)
                },
                {
                    key: 'hidden',
                    label: 'Hidden',
                    options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
                    match: (record, value) => (value === 'yes') === Boolean(record.hidden)
                }
            ],
            defaultSort: { key: 'name', direction: 'asc' },
            onSelect: openAchievementEditor
        });
    }

    EditorApp.registerTab('achievements', { label: 'Achievements', render });
})(window.EditorApp, window.EditorPreview, window.EditorListView);
