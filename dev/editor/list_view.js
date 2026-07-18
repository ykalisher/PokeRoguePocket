/**
 * Generic searchable/filterable/sortable list component for the data editor.
 * createListView() owns rendering/search/sort/filter state; callers own all
 * domain knowledge (columns, search fields, filter definitions, and how an
 * editable-cell commit is actually saved) via the tab_*.js modules. Columns
 * marked `editable: { parse, validate }` render as click-to-edit numeric
 * cells (Enter/blur commits via config.onCommitEdit, Escape reverts).
 * selectRecord(key) lets EditorApp land jump-links from reference dialogs.
 */
(function (EditorListView) {
    'use strict';

    function escapeHtml(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function escapeAttr(value) {
        return escapeHtml(value).replace(/"/g, '&quot;');
    }

    function fieldText(record, field) {
        if (typeof field === 'function') return String(field(record) || '');
        return String(record[field] === undefined || record[field] === null ? '' : record[field]);
    }

    function createListView(config) {
        const root = config.root;
        const columns = config.columns || [];
        const getKey = config.getKey;
        const searchFields = config.searchFields || [];
        const filters = config.filters || [];
        const onSelect = config.onSelect;
        const onCommitEdit = config.onCommitEdit;

        let records = config.records || [];
        let searchQuery = '';
        const filterValues = {};
        let sortState = config.defaultSort ? { key: config.defaultSort.key, direction: config.defaultSort.direction } : null;
        let selectedKey = null;

        function matchesSearch(record) {
            if (!searchQuery) return true;
            const haystack = searchFields.map((field) => fieldText(record, field)).join('   ').toLowerCase();
            return haystack.includes(searchQuery);
        }

        function matchesFilters(record) {
            return filters.every((filter) => {
                const value = filterValues[filter.key];
                if (!value) return true;
                return filter.match(record, value);
            });
        }

        function visibleRecords() {
            const filtered = records.filter((record) => matchesSearch(record) && matchesFilters(record));

            if (!sortState) return filtered;

            const column = columns.find((col) => col.key === sortState.key);
            if (!column || !column.sortValue) return filtered;

            const dir = sortState.direction === 'desc' ? -1 : 1;
            return filtered.slice().sort((a, b) => {
                const av = column.sortValue(a);
                const bv = column.sortValue(b);
                if (av < bv) return -1 * dir;
                if (av > bv) return 1 * dir;
                return 0;
            });
        }

        function renderToolbar(count) {
            const filterHtml = filters.map((filter) => `
                <select class="editor-filter" data-filter-key="${escapeAttr(filter.key)}">
                    <option value="">All ${escapeHtml(filter.label)}</option>
                    ${filter.options.map((opt) => `<option value="${escapeAttr(opt.value)}"${filterValues[filter.key] === opt.value ? ' selected' : ''}>${escapeHtml(opt.label)}</option>`).join('')}
                </select>
            `).join('');

            return `
                <div class="editor-toolbar">
                    <input type="search" class="editor-search" placeholder="Search…" value="${escapeAttr(searchQuery)}">
                    ${filterHtml}
                    <span class="editor-count">${count} record${count === 1 ? '' : 's'}</span>
                </div>
            `;
        }

        function headerCell(column) {
            const sortable = Boolean(column.sortValue);
            const isActive = sortState && sortState.key === column.key;
            const indicator = isActive ? (sortState.direction === 'desc' ? ' ▼' : ' ▲') : '';
            const attrs = sortable ? ` class="is-sortable" data-sort-key="${escapeAttr(column.key)}"` : '';
            return `<th${attrs}>${escapeHtml(column.label)}${indicator}</th>`;
        }

        function bodyRow(record) {
            const key = getKey(record);
            const selected = selectedKey !== null && String(selectedKey) === String(key) ? ' is-selected' : '';
            const cells = columns.map((column) => {
                if (column.editable) return editableCell(record, column);
                const html = column.render ? column.render(record) : escapeHtml(fieldText(record, column.key));
                const numericClass = column.numeric ? ' class="num"' : '';
                return `<td${numericClass}>${html}</td>`;
            }).join('');
            return `<tr class="editor-row${selected}" data-key="${escapeAttr(String(key))}">${cells}</tr>`;
        }

        function editableCell(record, column) {
            const key = getKey(record);
            const html = column.render ? column.render(record) : escapeHtml(fieldText(record, column.key));
            return `<td class="num is-editable" data-editable-row-key="${escapeAttr(String(key))}" data-editable-col-key="${escapeAttr(column.key)}">${html}</td>`;
        }

        function renderTable(visible) {
            const rows = visible.length
                ? visible.map(bodyRow).join('')
                : `<tr class="editor-row-empty"><td colspan="${columns.length}">No records match.</td></tr>`;

            return `
                <div class="editor-table-wrap">
                    <table class="editor-table">
                        <thead><tr>${columns.map(headerCell).join('')}</tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            `;
        }

        // All interaction is delegated once onto `root` (createListView gets
        // a fresh root per tab render, so listeners never stack). Search,
        // filter, sort, selection, and inline-edit commits then only replace
        // the table (renderBody) — the toolbar DOM survives, which keeps the
        // search input's focus and caret without any restore dance.
        function wireListeners() {
            root.addEventListener('input', (event) => {
                if (!event.target.classList.contains('editor-search')) return;
                searchQuery = event.target.value.trim().toLowerCase();
                renderBody();
            });

            root.addEventListener('change', (event) => {
                if (!event.target.classList.contains('editor-filter')) return;
                filterValues[event.target.dataset.filterKey] = event.target.value;
                renderBody();
            });

            root.addEventListener('click', (event) => {
                const th = event.target.closest('th.is-sortable');
                if (th) {
                    const key = th.dataset.sortKey;
                    if (sortState && sortState.key === key) {
                        sortState = { key, direction: sortState.direction === 'desc' ? 'asc' : 'desc' };
                    } else {
                        sortState = { key, direction: 'desc' };
                    }
                    renderBody();
                    return;
                }

                const cell = event.target.closest('td.is-editable');
                if (cell) {
                    beginCellEdit(cell);
                    return;
                }

                const tr = event.target.closest('tr.editor-row');
                if (tr) {
                    const record = records.find((candidate) => String(getKey(candidate)) === tr.dataset.key);
                    if (!record) return;
                    selectedKey = getKey(record);
                    paintSelection();
                    if (typeof onSelect === 'function') onSelect(record);
                }
            });
        }

        // Selection is just a class toggle — no reason to rebuild the table.
        function paintSelection() {
            root.querySelectorAll('tr.editor-row').forEach((tr) => {
                tr.classList.toggle('is-selected', selectedKey !== null && String(selectedKey) === tr.dataset.key);
            });
        }

        function scrollSelectedIntoView() {
            const selectedRow = root.querySelector('tr.editor-row.is-selected');
            if (selectedRow) selectedRow.scrollIntoView({ block: 'nearest' });
        }

        function beginCellEdit(cell) {
            if (cell.querySelector('input')) return;

            const rowKey = cell.dataset.editableRowKey;
            const colKey = cell.dataset.editableColKey;
            const record = records.find((candidate) => String(getKey(candidate)) === rowKey);
            const column = columns.find((candidate) => candidate.key === colKey);
            if (!record || !column) return;

            const originalHtml = cell.innerHTML;
            const originalValue = fieldText(record, column.key);

            cell.innerHTML = `<input type="number" class="editor-cell-input" value="${escapeAttr(originalValue)}">`;
            const input = cell.querySelector('input');
            input.focus();
            input.select();

            let settled = false;
            let cancelled = false;

            function flashInvalid(message) {
                cell.classList.remove('is-saving');
                cell.innerHTML = originalHtml;
                cell.classList.add('is-invalid');
                if (message) cell.title = message;
                setTimeout(() => {
                    cell.classList.remove('is-invalid');
                    cell.removeAttribute('title');
                }, 1200);
            }

            async function commit() {
                const raw = input.value;
                const parsed = column.editable.parse ? column.editable.parse(raw) : raw;
                const verdict = column.editable.validate ? column.editable.validate(parsed, record) : true;
                if (verdict !== true) {
                    flashInvalid(typeof verdict === 'string' ? verdict : 'Invalid value');
                    return;
                }
                if (typeof onCommitEdit !== 'function') {
                    flashInvalid('No save handler configured');
                    return;
                }
                cell.classList.add('is-saving');
                try {
                    const fresh = await onCommitEdit(record, column, parsed);
                    if (Array.isArray(fresh)) records = fresh;
                    renderBody({ preserveScroll: true });
                } catch (err) {
                    flashInvalid((err && err.message) || 'Save failed');
                }
            }

            function finish() {
                if (settled) return;
                settled = true;
                if (cancelled) {
                    cell.innerHTML = originalHtml;
                    return;
                }
                commit();
            }

            input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    input.blur();
                } else if (event.key === 'Escape') {
                    event.preventDefault();
                    cancelled = true;
                    input.blur();
                }
            });
            input.addEventListener('blur', finish);
        }

        // Replaces only the count + table, leaving the toolbar DOM alone.
        function renderBody(options) {
            const preserveScroll = Boolean(options && options.preserveScroll);
            const visible = visibleRecords();
            const countEl = root.querySelector('.editor-count');
            if (countEl) countEl.textContent = `${visible.length} record${visible.length === 1 ? '' : 's'}`;
            const wrap = root.querySelector('.editor-table-wrap');
            const scroll = preserveScroll && wrap ? { top: wrap.scrollTop, left: wrap.scrollLeft } : null;
            if (wrap) wrap.outerHTML = renderTable(visible);
            if (scroll) {
                // The fresh wrap starts at 0/0; restore instead of scrollSelectedIntoView,
                // which could undo the restore.
                const fresh = root.querySelector('.editor-table-wrap');
                if (fresh) {
                    fresh.scrollTop = scroll.top;
                    fresh.scrollLeft = scroll.left;
                }
                return;
            }
            scrollSelectedIntoView();
        }

        function render() {
            const visible = visibleRecords();
            root.innerHTML = renderToolbar(visible.length) + renderTable(visible);
            scrollSelectedIntoView();
        }

        function update(newRecords) {
            records = newRecords || [];
            render();
        }

        function selectRecord(key) {
            const record = records.find((candidate) => String(getKey(candidate)) === String(key));
            if (!record) return;
            selectedKey = getKey(record);
            paintSelection();
            scrollSelectedIntoView();
            if (typeof onSelect === 'function') onSelect(record);
        }

        wireListeners();
        render();

        return { update, selectRecord };
    }

    Object.assign(EditorListView, { createListView, escapeHtml, escapeAttr });
})(window.EditorListView = window.EditorListView || {});
