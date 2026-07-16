/**
 * window.EditorApp: store, tab registry, tab switching, and the issues
 * badge. Per-type knowledge lives in the tab_*.js modules; this file stays
 * generic. Write endpoints (putData/upload) arrive in phases 29 and 34.
 */
(function (EditorApp) {
    'use strict';

    const tabs = new Map();
    const tabOrder = [];
    let activeTab = null;

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
        async putData() {
            throw new Error('TODO(phase 29): EditorApp.api.putData is not implemented yet');
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
            button.addEventListener('click', () => showTab(button.dataset.tab));
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
        tab.render(view);
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
})(window.EditorApp = window.EditorApp || {});
