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
    // reads them (trainer rank ascending). The stored value stays 'trainer',
    // but that category is now the map level's music: it plays across the whole
    // level, standard/ace battles included.
    const CATEGORY_LABELS = {
        trainer: 'Map & Standard Trainers',
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

    // Derives the id (and, if blank, the title) from an uploaded file's name
    // so the owner never has to type a slug or a file path by hand — see
    // dev/feature_plans (music tab) for why: the owner just picks a category
    // and uploads a track.
    function slugify(text) {
        return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'track';
    }

    function baseName(fileName) {
        return String(fileName || '').replace(/\.[^./]+$/, '');
    }

    function uniqueId(base) {
        const existing = new Set(EditorApp.store.data.music.map((record) => record.id));
        if (!existing.has(base)) return base;
        let n = 2;
        while (existing.has(`${base}-${n}`)) n += 1;
        return `${base}-${n}`;
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
        if (!draft.id) return '<div class="editor-music-placeholder">Upload a file to name and save this track.</div>';
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
        const uploaded = hasFile(draft);
        return `
            <div class="editor-form-row">
                <span class="editor-hint">
                    ${draft.id
                        ? `File: <code>${escapeHtml(canonicalPath(draft))}</code>${uploaded ? ' — uploaded.' : ' — not uploaded yet.'}`
                        : 'Upload a file below to name and save this track automatically.'}
                </span>
            </div>
            <div class="editor-form-row">
                <button type="button" class="editor-btn" data-role="upload-music-btn">Upload…</button>
                <input type="file" accept="audio/mpeg,.mp3,audio/mp4,.m4a" data-role="upload-music-input" hidden>
            </div>
            <span class="editor-hint">Pick a category, then upload an MP3 or M4A — the id, title, and file name are filled in and saved automatically. M4A uploads are converted to MP3 by the server (needs ffmpeg installed).</span>
        `;
    }

    function formHtml(draft) {
        return `
            <div class="editor-form-row">
                <label>ID (slug)
                    <input type="text" name="id" value="${escapeAttr(draft.id)}">
                    <span class="editor-hint">Lowercase, digits and dashes — it becomes the MP3 file name. Auto-filled from the uploaded file's name if left blank.</span>
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

            // The id is the only field the file path derives from, so keep
            // `file` in lockstep whenever it changes — the owner never edits
            // `file` directly.
            if (field === 'id') {
                draft.file = canonicalPath(draft);
                const row = el.querySelector('[data-role="file-row"]');
                if (row) row.innerHTML = fileRowHtml(draft);
            }

            api.markDirty();
            api.refreshPreview();
        });

        el.addEventListener('click', (event) => {
            const uploadBtn = event.target.closest('[data-role="upload-music-btn"]');
            if (uploadBtn) {
                el.querySelector('[data-role="upload-music-input"]').click();
            }
        });

        // Upload does everything: a brand-new track has no id yet, so one is
        // derived from the file name (deduped against existing tracks) and
        // the title is filled in too if blank; the record is saved first
        // (the server's upload route matches a file to an already-saved
        // record by id) and then the file itself is uploaded. Reopening the
        // editor on the saved record afterwards avoids holding onto a
        // `draft` reference that saveFile has since replaced.
        el.addEventListener('change', (event) => {
            const input = event.target.closest('[data-role="upload-music-input"]');
            if (!input || !input.files[0]) return;
            const file = input.files[0];

            if (!draft.id) {
                draft.id = uniqueId(slugify(baseName(file.name)));
                if (!draft.title) draft.title = baseName(file.name);
                draft.file = canonicalPath(draft);
            }

            EditorApp.saveFile('music')
                .then(() => EditorApp.uploadAsset('music', draft.id, file))
                .then(() => {
                    const saved = EditorApp.store.data.music.find((record) => record.id === draft.id);
                    if (saved) openMusicEditor(saved);
                })
                .catch((err) => {
                    if (err && err.status === 409) EditorApp.showIssuesDialog('Save blocked', err.issues || []);
                });
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
