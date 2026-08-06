/**
 * Music tab: list (title, id, category, file dot, enabled dot) plus the
 * detail editor, whose preview is an inline <audio> player so the owner can
 * hear an uploaded track without leaving the editor. See
 * dev/feature_plans/101-music-editor-tab.md for the locked spec.
 *
 * The stored category values stay the internal ones (`boss`, not "Gym
 * Leaders") — only the labels shown here are the UI wording, exactly as
 * everywhere else in this repo.
 */
(function (EditorApp, EditorPreview, EditorListView) {
    'use strict';

    const escapeHtml = EditorListView.escapeHtml;
    const escapeAttr = EditorListView.escapeAttr;

    // Mirrors MUSIC_CATEGORIES in arena/arena_data.js, in the order the owner
    // reads them (trainer rank ascending).
    const CATEGORY_LABELS = {
        trainer: 'Standard/Ace Trainers',
        boss: 'Gym Leaders',
        elite: 'Elites',
        legendary: 'Legendary Battles'
    };
    const CATEGORY_VALUES = Object.keys(CATEGORY_LABELS);

    function isEnabled(record) {
        return record.enabled !== false;
    }

    function categoryLabel(category) {
        return CATEGORY_LABELS[category] || category || '';
    }

    function fileName(record) {
        return record && record.id ? `${record.id}.mp3` : '';
    }

    function hasFile(record) {
        const name = fileName(record);
        return Boolean(name) && EditorApp.store.assetIndex.music.has(name);
    }

    function canonicalPath(record) {
        return record && record.id ? `assets/music/${record.id}.mp3` : '';
    }

    function dotHtml(on, onTitle, offTitle) {
        return `<span class="editor-dot ${on ? 'editor-dot--on' : 'editor-dot--off'}" title="${escapeAttr(on ? onTitle : offTitle)}"></span>`;
    }

    function columns() {
        return [
            {
                key: 'title',
                label: 'Title',
                render: (record) => escapeHtml(record.title || ''),
                sortValue: (record) => record.title
            },
            {
                key: 'id',
                label: 'ID',
                render: (record) => escapeHtml(record.id || ''),
                sortValue: (record) => record.id
            },
            { key: 'category', label: 'Category', render: (record) => escapeHtml(categoryLabel(record.category)) },
            { key: 'file', label: 'File', render: (record) => dotHtml(hasFile(record), 'File uploaded', 'No file uploaded') },
            { key: 'enabled', label: 'Enabled', render: (record) => dotHtml(isEnabled(record), 'Enabled', 'Disabled') }
        ];
    }

    // Canonical new-record key order (98-music-overview.md's locked spec).
    function template() {
        return { id: '', title: '', category: 'trainer', file: '', enabled: true };
    }

    // ------------------------------------------------------------ preview

    function playerHtml(draft) {
        if (!draft.id) return '<div class="editor-music-placeholder">Enter an id to name the file.</div>';
        if (!hasFile(draft)) {
            return `
                <div class="editor-music-placeholder">
                    <code>${escapeHtml(canonicalPath(draft))}</code><br>
                    <span class="editor-badge editor-badge--warning">no file uploaded yet</span>
                </div>
            `;
        }
        return `<audio class="editor-music-player" controls preload="none" src="/${escapeAttr(canonicalPath(draft))}"></audio>`;
    }

    function renderPreview(el, draft) {
        el.innerHTML = `
            <div class="editor-music-panel">
                <h2 class="editor-music-title">${escapeHtml(draft.title || '(untitled)')}</h2>
                <p class="editor-music-category">${escapeHtml(categoryLabel(draft.category))}</p>
                ${playerHtml(draft)}
                ${isEnabled(draft) ? '' : '<span class="editor-badge">disabled — out of rotation</span>'}
            </div>
        `;
    }

    // --------------------------------------------------------------- form

    function categorySelectHtml(draft) {
        const options = CATEGORY_VALUES.map((value) =>
            `<option value="${escapeAttr(value)}"${value === draft.category ? ' selected' : ''}>${escapeHtml(CATEGORY_LABELS[value])}</option>`
        ).join('');
        return `<select name="category">${options}</select>`;
    }

    function fileRowHtml(draft) {
        const canonical = canonicalPath(draft);
        const isCanonical = Boolean(draft.file) && draft.file === canonical;
        const uploaded = hasFile(draft);
        return `
            <div class="editor-form-row">
                <span class="editor-hint">
                    ${draft.file ? `Current: <code>${escapeHtml(draft.file)}</code>` : 'No file path set.'}
                    ${draft.id ? ` (canonical: <code>${escapeHtml(canonical)}</code>)` : ' (enter an id to compute the canonical path)'}
                    ${uploaded ? ' — file uploaded.' : ''}
                </span>
            </div>
            <div class="editor-form-row">
                <button type="button" class="editor-btn" data-action="set-canonical-file" ${draft.id ? '' : 'disabled'}>
                    ${isCanonical ? 'Canonical path set' : 'Set canonical path'}
                </button>
                <button type="button" class="editor-btn" data-role="upload-music-btn" ${draft.id ? '' : 'disabled'}>Upload…</button>
                <input type="file" accept="audio/mpeg,.mp3,audio/mp4,.m4a" data-role="upload-music-input" hidden>
            </div>
            <span class="editor-hint">Save the track first, then upload its file — the upload is matched to the saved record's id. M4A uploads are converted to MP3 by the server (needs ffmpeg installed).</span>
        `;
    }

    function formHtml(draft) {
        return `
            <div class="editor-form-row">
                <label>ID (slug)
                    <input type="text" name="id" value="${escapeAttr(draft.id)}">
                    <span class="editor-hint">Lowercase, digits and dashes — it becomes the MP3 file name.</span>
                </label>
                <label>Title
                    <input type="text" name="title" value="${escapeAttr(draft.title)}">
                </label>
            </div>
            <div class="editor-form-row">
                <label>Category${categorySelectHtml(draft)}</label>
                <label class="editor-form-checkbox"><input type="checkbox" name="enabled" ${isEnabled(draft) ? 'checked' : ''}> Enabled</label>
            </div>
            <div data-role="file-row">${fileRowHtml(draft)}</div>
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

            if (target.type === 'checkbox') {
                draft[field] = target.checked;
            } else {
                draft[field] = target.value;
            }

            if (field === 'id') {
                const row = el.querySelector('[data-role="file-row"]');
                if (row) row.innerHTML = fileRowHtml(draft);
            }

            api.markDirty();
            api.refreshPreview();
        });

        el.addEventListener('click', (event) => {
            const canonicalBtn = event.target.closest('[data-action="set-canonical-file"]');
            if (canonicalBtn && draft.id) {
                draft.file = canonicalPath(draft);
                paint();
                api.markDirty();
                api.refreshPreview();
                return;
            }

            const uploadBtn = event.target.closest('[data-role="upload-music-btn"]');
            if (uploadBtn && draft.id) {
                el.querySelector('[data-role="upload-music-input"]').click();
            }
        });

        el.addEventListener('change', (event) => {
            const input = event.target.closest('[data-role="upload-music-input"]');
            if (!input || !input.files[0] || !draft.id) return;
            EditorApp.uploadAsset('music', draft.id, input.files[0])
                .then(() => {
                    paint();
                    api.refreshPreview();
                })
                .catch(() => {});
        });
    }

    // ------------------------------------------------------------- editor

    function openMusicEditor(record) {
        EditorApp.openEditor({
            kind: 'track',
            fileName: 'music',
            record,
            template,
            renderPreview,
            renderForm
        });
    }

    function render(root) {
        root.innerHTML = `
            <div class="editor-tab-toolbar">
                <button type="button" class="editor-btn editor-btn--primary" data-action="add-track">+ Add track</button>
            </div>
            <div class="editor-list-slot"></div>
        `;

        root.querySelector('[data-action="add-track"]').addEventListener('click', () => openMusicEditor(null));

        return EditorListView.createListView({
            root: root.querySelector('.editor-list-slot'),
            columns: columns(),
            records: EditorApp.store.data.music,
            getKey: (record) => record.id,
            searchFields: ['title', 'id'],
            filters: [
                {
                    key: 'category',
                    label: 'Category',
                    options: CATEGORY_VALUES.map((value) => ({ value, label: CATEGORY_LABELS[value] })),
                    match: (record, value) => record.category === value
                },
                {
                    key: 'enabled',
                    label: 'Enabled',
                    options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
                    match: (record, value) => (value === 'yes') === isEnabled(record)
                }
            ],
            defaultSort: { key: 'title', direction: 'asc' },
            onSelect: openMusicEditor
        });
    }

    EditorApp.registerTab('music', { label: 'Music', render });
})(window.EditorApp, window.EditorPreview, window.EditorListView);
