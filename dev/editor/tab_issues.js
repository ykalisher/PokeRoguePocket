/**
 * Issues tab: read-only, grouped by file, with a severity filter. Sourced
 * from EditorApp.computeIssues() (the same window.EditorValidation.validateAll
 * run that paints the tab-bar badge). Upload fixes arrive in phase 34.
 */
(function (EditorApp, EditorListView) {
    'use strict';

    function severityLabel(severity) {
        return severity === 'error' ? 'Error' : 'Warning';
    }

    function renderGroup(fileName, issues) {
        const rows = issues.map((issue) => `
            <tr class="editor-row">
                <td><span class="editor-badge editor-badge--${issue.severity}">${severityLabel(issue.severity)}</span></td>
                <td>${EditorListView.escapeHtml(issue.recordKey)}</td>
                <td>${EditorListView.escapeHtml(issue.field || '—')}</td>
                <td>${EditorListView.escapeHtml(issue.code)}</td>
                <td>${EditorListView.escapeHtml(issue.message)}</td>
            </tr>
        `).join('');

        return `
            <section class="editor-issue-group">
                <h2 class="editor-issue-group-title">${EditorListView.escapeHtml(fileName)} <span class="stat-pill">${issues.length}</span></h2>
                <div class="editor-table-wrap">
                    <table class="editor-table">
                        <thead><tr><th>Severity</th><th>Record</th><th>Field</th><th>Code</th><th>Message</th></tr></thead>
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

        draw();
    }

    EditorApp.registerTab('issues', { label: 'Issues', render });
})(window.EditorApp, window.EditorListView);
