/**
 * Issues tab: grouped by file, with a severity filter, jump-links to the
 * owning record, and Upload buttons on the four missing-asset codes.
 * Sourced from EditorApp.computeIssues() (the same window.EditorValidation.
 * validateAll run that paints the tab-bar badge). Orphan asset codes are
 * informational only (no jump-link, no action — never offer to delete
 * files) since their recordKey is an orphan filename, not a real record.
 */
(function (EditorApp, EditorListView) {
    'use strict';

    const escapeHtml = EditorListView.escapeHtml;
    const escapeAttr = EditorListView.escapeAttr;

    // Asset issue codes carry file:"assets", so the owning tab is keyed off
    // the code rather than the file for those four; everything else keys
    // off the file name. Orphan-* codes are deliberately absent here.
    const CODE_TO_TAB = {
        'assets.missing-portrait': 'pokemon',
        'assets.missing-sprite': 'trainers',
        'assets.missing-item-image': 'items',
        'assets.missing-background': 'locations'
    };
    const FILE_TO_TAB = {
        'pokemon.json': 'pokemon',
        'attacks.json': 'attacks',
        'items.json': 'items',
        'trainers.json': 'trainers',
        'events.json': 'events',
        'locations.json': 'locations'
    };
    const UPLOAD_DIRS = {
        'assets.missing-portrait': 'portraits',
        'assets.missing-sprite': 'sprites',
        'assets.missing-item-image': 'items',
        'assets.missing-background': 'backgrounds'
    };

    function jumpTabFor(issue) {
        return CODE_TO_TAB[issue.code] || FILE_TO_TAB[issue.file] || null;
    }

    function severityLabel(severity) {
        return severity === 'error' ? 'Error' : 'Warning';
    }

    function recordCellHtml(issue) {
        const tab = jumpTabFor(issue);
        if (issue.recordKey === '(dataset)' || !tab) {
            return escapeHtml(issue.recordKey);
        }
        return `<button type="button" class="editor-link" data-jump-tab="${escapeAttr(tab)}" data-jump-key="${escapeAttr(issue.recordKey)}">${escapeHtml(issue.recordKey)}</button>`;
    }

    function actionCellHtml(issue) {
        const dir = UPLOAD_DIRS[issue.code];
        if (!dir) return '';
        const key = escapeAttr(issue.recordKey);
        return `
            <button type="button" class="editor-btn editor-btn--small" data-upload-dir="${dir}" data-upload-key="${key}">Upload…</button>
            <input type="file" accept="image/png" data-upload-dir="${dir}" data-upload-key="${key}" hidden>
        `;
    }

    function renderGroup(fileName, issues) {
        const rows = issues.map((issue) => `
            <tr class="editor-row">
                <td><span class="editor-badge editor-badge--${issue.severity}">${severityLabel(issue.severity)}</span></td>
                <td>${recordCellHtml(issue)}</td>
                <td>${escapeHtml(issue.field || '—')}</td>
                <td>${escapeHtml(issue.code)}</td>
                <td>${escapeHtml(issue.message)}</td>
                <td>${actionCellHtml(issue)}</td>
            </tr>
        `).join('');

        return `
            <section class="editor-issue-group">
                <h2 class="editor-issue-group-title">${escapeHtml(fileName)} <span class="stat-pill">${issues.length}</span></h2>
                <div class="editor-table-wrap">
                    <table class="editor-table">
                        <thead><tr><th>Severity</th><th>Record</th><th>Field</th><th>Code</th><th>Message</th><th>Action</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            </section>
        `;
    }

    function render(root) {
        let severityFilter = '';

        function draw() {
            const issues = EditorApp.store.issues || [];
            const filtered = severityFilter ? issues.filter((issue) => issue.severity === severityFilter) : issues;

            const groups = new Map();
            filtered.forEach((issue) => {
                if (!groups.has(issue.file)) groups.set(issue.file, []);
                groups.get(issue.file).push(issue);
            });
            const fileNames = [...groups.keys()].sort();
            const counts = EditorApp.store.issueCounts || { error: 0, warning: 0 };

            const body = fileNames.length
                ? fileNames.map((fileName) => renderGroup(fileName, groups.get(fileName))).join('')
                : '<p class="editor-empty">No issues.</p>';

            root.innerHTML = `
                <div class="editor-toolbar">
                    <select class="editor-filter" id="editor-issue-severity">
                        <option value="">All severities</option>
                        <option value="error"${severityFilter === 'error' ? ' selected' : ''}>Error</option>
                        <option value="warning"${severityFilter === 'warning' ? ' selected' : ''}>Warning</option>
                    </select>
                    <span class="editor-count">${counts.error} error${counts.error === 1 ? '' : 's'}, ${counts.warning} warning${counts.warning === 1 ? '' : 's'}</span>
                </div>
                ${body}
            `;

            root.querySelector('#editor-issue-severity').addEventListener('change', (event) => {
                severityFilter = event.target.value;
                draw();
            });
        }

        // Delegated on the persistent `root` node (draw() only replaces its
        // innerHTML), so this is wired once per tab activation rather than
        // once per draw() — attaching inside draw() would stack listeners.
        root.addEventListener('click', (event) => {
            const jump = event.target.closest('[data-jump-tab]');
            if (jump) {
                EditorApp.jumpTo(jump.dataset.jumpTab, jump.dataset.jumpKey);
                return;
            }
            const uploadBtn = event.target.closest('button[data-upload-dir]');
            if (uploadBtn) {
                uploadBtn.parentElement.querySelector('input[type="file"]').click();
            }
        });

        root.addEventListener('change', (event) => {
            const input = event.target.closest('input[data-upload-dir]');
            if (!input || !input.files[0]) return;
            EditorApp.uploadAsset(input.dataset.uploadDir, input.dataset.uploadKey, input.files[0])
                .then(draw)
                .catch(() => {});
        });

        draw();
    }

    EditorApp.registerTab('issues', { label: 'Issues', render });
})(window.EditorApp, window.EditorListView);
