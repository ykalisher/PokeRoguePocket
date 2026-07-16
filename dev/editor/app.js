/**
 * window.EditorApp: store, tab registry, tab switching, the issues badge,
 * and (phase 29) the generic detail-editor framework: openEditor/saveFile/
 * requestDelete, the dirty guard, jump-links, toasts, and blocking dialogs.
 * Per-type knowledge (forms, previews, columns) lives in the tab_*.js
 * modules; this file stays type-agnostic. Uploads arrive in phase 34.
 */
(function (EditorApp) {
    'use strict';

    const tabs = new Map();
    const tabOrder = [];
    let activeTab = null;
    let activeListHandle = null;

    // The single currently-open detail editor, or null when a tab is
    // showing its list. Shape: { kind, fileName, record, draft, dirty,
    // config: { renderPreview, renderForm, template } }.
    let currentEditor = null;

    const FILE_TO_TAB = {
        'pokemon.json': 'pokemon',
        'attacks.json': 'attacks',
        'items.json': 'items',
        'trainers.json': 'trainers',
        'events.json': 'events',
        'locations.json': 'locations'
    };

    EditorApp.store = {
        data: null,
        enums: null,
        assets: null,
        assetIndex: null,
        engineRefs: null,
        issues: [],
        issueCounts: { error: 0, warning: 0 }
    };

    EditorApp.api = {
        async getData() {
            const res = await fetch('/api/data');
            if (!res.ok) throw new Error(`GET /api/data failed (${res.status})`);
            return res.json();
        },
        async putData(fileName, data) {
            const res = await fetch(`/api/data/${fileName}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            let payload = {};
            try {
                payload = await res.json();
            } catch (err) {
                payload = {};
            }
            if (!res.ok) {
                const err = new Error(payload.error || `PUT /api/data/${fileName} failed (${res.status})`);
                err.status = res.status;
                err.issues = payload.issues || [];
                throw err;
            }
            return payload;
        },
        async upload() {
            throw new Error('TODO(phase 34): EditorApp.api.upload is not implemented yet');
        }
    };

    EditorApp.registerTab = function registerTab(name, tabConfig) {
        tabs.set(name, tabConfig);
        tabOrder.push(name);
        renderTabBar();
    };

    EditorApp.computeIssues = function computeIssues() {
        const { data, enums, assetIndex, engineRefs } = EditorApp.store;
        const issues = window.EditorValidation.validateAll(data, { enums, assetIndex, engineRefs });

        EditorApp.store.issues = issues;
        EditorApp.store.issueCounts = {
            error: issues.filter((issue) => issue.severity === 'error').length,
            warning: issues.filter((issue) => issue.severity === 'warning').length
        };

        paintBadge();
        return issues;
    };

    function renderTabBar() {
        const nav = document.getElementById('editor-tabs');
        if (!nav) return;

        nav.innerHTML = tabOrder.map((name) => {
            const tab = tabs.get(name);
            const isActive = name === activeTab;
            const badge = name === 'issues' ? '<span class="editor-tab-badge" hidden></span>' : '';
            return `<button type="button" class="editor-tab${isActive ? ' is-active' : ''}" data-tab="${name}">${tab.label}${badge}</button>`;
        }).join('');

        nav.querySelectorAll('.editor-tab').forEach((button) => {
            button.addEventListener('click', () => {
                if (button.dataset.tab === activeTab) return;
                if (!confirmLeaveIfDirty()) return;
                currentEditor = null;
                showTab(button.dataset.tab);
            });
        });

        paintBadge();
    }

    function paintBadge() {
        const nav = document.getElementById('editor-tabs');
        if (!nav) return;

        const badge = nav.querySelector('[data-tab="issues"] .editor-tab-badge');
        if (!badge) return;

        const { error, warning } = EditorApp.store.issueCounts;
        if (error > 0) {
            badge.textContent = String(error);
            badge.className = 'editor-tab-badge editor-tab-badge--error';
            badge.hidden = false;
        } else if (warning > 0) {
            badge.textContent = String(warning);
            badge.className = 'editor-tab-badge editor-tab-badge--warning';
            badge.hidden = false;
        } else {
            badge.hidden = true;
        }
    }

    function showTab(name) {
        const tab = tabs.get(name);
        if (!tab) return;

        activeTab = name;
        renderTabBar();

        const view = document.getElementById('editor-view');
        view.innerHTML = '';
        activeListHandle = tab.render(view) || null;
        if (typeof tab.onShow === 'function') tab.onShow();
    }

    function showErrorBanner(err) {
        const banner = document.getElementById('editor-error-banner');
        if (!banner) return;
        banner.textContent = `Failed to load editor data: ${(err && err.message) || err}`;
        banner.hidden = false;
    }

    async function init() {
        try {
            const [data, enums, assets] = await Promise.all([
                fetch('/api/data').then((res) => res.json()),
                fetch('/api/enums').then((res) => res.json()),
                fetch('/api/assets').then((res) => res.json())
            ]);

            EditorApp.store.data = data;
            EditorApp.store.enums = enums;
            EditorApp.store.assets = assets;
            EditorApp.store.assetIndex = {
                portraits: new Set(assets.portraits),
                sprites: new Set(assets.sprites),
                items: new Set(assets.items),
                backgrounds: new Set(assets.backgrounds)
            };
            EditorApp.store.engineRefs = Object.assign({}, enums.engineRefs, {
                resolveSpriteFile: (name, explicitSprite) =>
                    window.PokeRogue.TrainerSprites.resolveSprite(name, explicitSprite).file
            });

            EditorApp.computeIssues();

            if (tabOrder.length > 0) showTab(tabOrder[0]);
        } catch (err) {
            showErrorBanner(err);
        }
    }

    EditorApp.init = init;

    // ------------------------------------------------------------- toasts

    function showToast(message, kind) {
        const el = document.createElement('div');
        el.className = `editor-toast${kind === 'error' ? ' editor-toast--error' : ''}`;
        el.textContent = message;
        document.body.appendChild(el);
        requestAnimationFrame(() => el.classList.add('is-visible'));
        setTimeout(() => {
            el.classList.remove('is-visible');
            setTimeout(() => el.remove(), 250);
        }, 2600);
    }

    // -------------------------------------------------------------- modal

    function escapeHtml(value) {
        return window.EditorListView.escapeHtml(value);
    }

    function escapeAttr(value) {
        return window.EditorListView.escapeAttr(value);
    }

    function showModal({ title, bodyHtml }) {
        const overlay = document.createElement('div');
        overlay.className = 'editor-modal-overlay';
        overlay.innerHTML = `
            <div class="editor-modal" role="dialog" aria-modal="true" aria-label="${escapeAttr(title)}">
                <h2 class="editor-modal-title">${escapeHtml(title)}</h2>
                <div class="editor-modal-body">${bodyHtml}</div>
                <div class="editor-modal-actions">
                    <button type="button" class="editor-btn" data-action="close-modal">Close</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        overlay.addEventListener('click', (event) => {
            const jump = event.target.closest('[data-jump-tab]');
            if (jump) {
                overlay.remove();
                jumpTo(jump.dataset.jumpTab, jump.dataset.jumpKey);
                return;
            }
            if (event.target === overlay || event.target.closest('[data-action="close-modal"]')) {
                overlay.remove();
            }
        });

        return overlay;
    }

    function refRow(ref) {
        const tabName = FILE_TO_TAB[ref.file];
        const label = ref.message
            ? ref.message
            : `${ref.file} — ${ref.recordKey}${ref.field ? ` (${ref.field})` : ''}`;

        if (tabName) {
            return `<li><button type="button" class="editor-link" data-jump-tab="${escapeAttr(tabName)}" data-jump-key="${escapeAttr(ref.recordKey)}">${escapeHtml(label)}</button></li>`;
        }
        return `<li class="editor-muted">${escapeHtml(label)}</li>`;
    }

    function showReferencesDialog(name, refs) {
        showModal({
            title: `Cannot delete "${name}"`,
            bodyHtml: `<p>Blocked: referenced by:</p><ul class="editor-ref-list">${refs.map(refRow).join('')}</ul>`
        });
    }

    function showIssuesDialog(title, issues) {
        const bodyHtml = issues.length
            ? `<ul class="editor-ref-list">${issues.map((issue) => `<li><code>${escapeHtml(issue.code)}</code> — ${escapeHtml(issue.message)}</li>`).join('')}</ul>`
            : '<p>Write blocked by a validation error.</p>';
        showModal({ title, bodyHtml });
    }

    function jumpTo(tabName, key) {
        if (!confirmLeaveIfDirty()) return;
        currentEditor = null;
        showTab(tabName);
        if (activeListHandle && typeof activeListHandle.selectRecord === 'function') {
            activeListHandle.selectRecord(key);
        }
    }

    EditorApp.jumpTo = jumpTo;

    // ------------------------------------------------------- dirty guard

    function confirmLeaveIfDirty() {
        if (!currentEditor || !currentEditor.dirty) return true;
        return window.confirm('You have unsaved changes. Discard them and leave this record?');
    }

    // --------------------------------------------------- issue prediction

    function issueKey(issue) {
        return `${issue.code} ${issue.recordKey}`;
    }

    function dedupeIssues(issues) {
        const seen = new Set();
        return issues.filter((issue) => {
            const key = JSON.stringify(issue);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    // Builds { ...store.data, [fileName]: arr } with the editor's draft
    // spliced into (or appended to) a COPY of that file's array. Used both
    // for save payloads and for predicting the server's write-guard verdict.
    function draftDataset(ed) {
        const base = EditorApp.store.data[ed.fileName];
        const idx = ed.record == null ? -1 : base.indexOf(ed.record);
        const arr = base.slice();
        if (idx === -1) arr.push(ed.draft); else arr[idx] = ed.draft;
        return { arr, data: Object.assign({}, EditorApp.store.data, { [ed.fileName]: arr }) };
    }

    // Mirrors the server's write guard (27-editor-server.md) so the editor
    // can show the same verdict before the user hits Save: any error inside
    // the written file, or any brand-new error anywhere.
    function computePredictedIssues() {
        if (!currentEditor) return [];
        const { enums, assetIndex, engineRefs } = EditorApp.store;
        const options = { enums, assetIndex, engineRefs };
        const before = EditorApp.store.data;
        const { data: after } = draftDataset(currentEditor);

        const beforeErrors = window.EditorValidation.validateAll(before, options).filter((issue) => issue.severity === 'error');
        const afterErrors = window.EditorValidation.validateAll(after, options).filter((issue) => issue.severity === 'error');
        const beforeKeys = new Set(beforeErrors.map(issueKey));

        const targetFile = `${currentEditor.fileName}.json`;
        const inFile = afterErrors.filter((issue) => issue.file === targetFile);
        const brandNew = afterErrors.filter((issue) => !beforeKeys.has(issueKey(issue)));

        return dedupeIssues([...inFile, ...brandNew]);
    }

    function renderFormIssues() {
        const container = document.getElementById('editor-form-issues');
        if (!container) return;
        const issues = computePredictedIssues();
        if (issues.length === 0) {
            container.hidden = true;
            container.innerHTML = '';
            return;
        }
        container.hidden = false;
        container.innerHTML = `<ul class="editor-form-issue-list">${issues.map((issue) =>
            `<li><span class="editor-badge editor-badge--error">${escapeHtml(issue.code)}</span> ${escapeHtml(issue.message)}</li>`
        ).join('')}</ul>`;
    }

    // ----------------------------------------------------------- saveFile

    // Public, generic write path. With no `target`, saves the currently
    // open detail editor (Save button). With an explicit { record, draft }
    // target, saves that pair regardless of what editor (if any) is open —
    // this is how inline list-cell edits commit. Resolves to the file's new
    // array; throws (with .status/.issues on 409) on failure.
    async function saveFile(fileName, target) {
        const ed = target || currentEditor;
        if (!ed) {
            throw new Error(`saveFile(${fileName}): no active editor and no explicit record/draft given`);
        }
        if (!target && ed.fileName !== fileName) {
            throw new Error(`saveFile(${fileName}): active editor is for "${ed.fileName}"`);
        }

        const { arr } = draftDataset({ fileName, record: ed.record, draft: ed.draft });
        await EditorApp.api.putData(fileName, arr);

        EditorApp.store.data[fileName] = arr;
        EditorApp.computeIssues();

        if (currentEditor && currentEditor.fileName === fileName && currentEditor.record === ed.record) {
            currentEditor.record = ed.draft;
            currentEditor.draft = structuredClone(ed.draft);
            currentEditor.dirty = false;
        }

        return arr;
    }

    EditorApp.saveFile = saveFile;

    // Convenience wrapper for inline single-field commits (list_view.js):
    // mutates a clone (never the live record) so byte-clean diffs hold.
    EditorApp.saveFieldEdit = function saveFieldEdit(fileName, record, field, value) {
        const draft = structuredClone(record);
        draft[field] = value;
        return saveFile(fileName, { record, draft });
    };

    // --------------------------------------------------------- delete flow

    async function requestDelete(kind, fileName, record) {
        const name = record.name;
        const refs = window.EditorValidation.findReferences(EditorApp.store.data, kind, name, EditorApp.store.engineRefs);
        if (refs.length > 0) {
            showReferencesDialog(name, refs);
            return;
        }

        if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;

        const arr = EditorApp.store.data[fileName].filter((candidate) => candidate !== record);
        try {
            await EditorApp.api.putData(fileName, arr);
        } catch (err) {
            if (err.status === 409) {
                showReferencesDialog(name, err.issues || []);
                return;
            }
            showToast(`Delete failed: ${err.message}`, 'error');
            return;
        }

        EditorApp.store.data[fileName] = arr;
        EditorApp.computeIssues();
        showToast(`Deleted ${name}`);

        currentEditor = null;
        showTab(activeTab);
    }

    EditorApp.requestDelete = requestDelete;

    // -------------------------------------------------------- openEditor

    function renderDetailChrome() {
        const view = document.getElementById('editor-view');
        const ed = currentEditor;
        const canDelete = ed.record != null;

        view.innerHTML = `
            <div class="editor-detail">
                <div class="editor-detail-bar">
                    <button type="button" class="editor-btn editor-btn--ghost" data-action="back">&larr; Back to list</button>
                    <div class="editor-detail-actions">
                        ${canDelete ? '<button type="button" class="editor-btn editor-btn--danger" data-action="delete">Delete</button>' : ''}
                        <button type="button" class="editor-btn" data-action="revert" disabled>Revert</button>
                        <button type="button" class="editor-btn editor-btn--primary" data-action="save">Save</button>
                    </div>
                </div>
                <div id="editor-form-issues" class="editor-form-issues" hidden></div>
                <div class="editor-split">
                    <div class="editor-preview" id="editor-preview-pane"></div>
                    <div class="editor-form" id="editor-form-pane"></div>
                </div>
            </div>
        `;

        view.querySelector('[data-action="back"]').addEventListener('click', () => {
            if (!confirmLeaveIfDirty()) return;
            currentEditor = null;
            showTab(activeTab);
        });

        const deleteBtn = view.querySelector('[data-action="delete"]');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                requestDelete(currentEditor.kind, currentEditor.fileName, currentEditor.record);
            });
        }

        view.querySelector('[data-action="revert"]').addEventListener('click', () => {
            const ce = currentEditor;
            if (!ce.dirty) return;
            ce.draft = ce.record != null ? structuredClone(ce.record) : ce.config.template();
            ce.dirty = false;
            renderDetailBody();
            updateDetailButtons();
            renderFormIssues();
        });

        view.querySelector('[data-action="save"]').addEventListener('click', async () => {
            const ce = currentEditor;
            if (!ce.dirty) return;
            const saveBtn = view.querySelector('[data-action="save"]');
            saveBtn.disabled = true;
            try {
                await saveFile(ce.fileName);
                showToast('Saved');
                renderDetailChrome();
                renderDetailBody();
                updateDetailButtons();
                renderFormIssues();
            } catch (err) {
                if (err.status === 409) {
                    showIssuesDialog('Save blocked', err.issues || []);
                } else {
                    showToast(`Save failed: ${err.message}`, 'error');
                }
                saveBtn.disabled = false;
            }
        });

        updateDetailButtons();
    }

    function renderDetailBody() {
        const ed = currentEditor;
        const view = document.getElementById('editor-view');
        const previewEl = view.querySelector('#editor-preview-pane');
        const formEl = view.querySelector('#editor-form-pane');

        const api = {
            markDirty() {
                if (!currentEditor) return;
                currentEditor.dirty = true;
                updateDetailButtons();
                renderFormIssues();
            },
            refreshPreview() {
                if (!currentEditor) return;
                ed.config.renderPreview(previewEl, currentEditor.draft);
            }
        };

        ed.config.renderPreview(previewEl, ed.draft);
        ed.config.renderForm(formEl, ed.draft, api);
    }

    function updateDetailButtons() {
        const view = document.getElementById('editor-view');
        if (!view || !currentEditor) return;
        const saveBtn = view.querySelector('[data-action="save"]');
        const revertBtn = view.querySelector('[data-action="revert"]');
        if (saveBtn) {
            saveBtn.classList.toggle('is-dirty', currentEditor.dirty);
            saveBtn.innerHTML = currentEditor.dirty
                ? 'Save <span class="editor-dirty-dot" aria-hidden="true"></span>'
                : 'Save';
        }
        if (revertBtn) revertBtn.disabled = !currentEditor.dirty;
    }

    EditorApp.openEditor = function openEditor(config) {
        if (!confirmLeaveIfDirty()) return;

        const record = config.record || null;
        currentEditor = {
            kind: config.kind,
            fileName: config.fileName,
            record,
            draft: record != null ? structuredClone(record) : config.template(),
            dirty: false,
            config
        };

        renderDetailChrome();
        renderDetailBody();
        renderFormIssues();
    };
})(window.EditorApp = window.EditorApp || {});
