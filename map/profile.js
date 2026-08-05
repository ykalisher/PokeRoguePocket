/**
 * Pokemon Rogue Pocket - persistent player profile (lifetime stats + achievements)
 */

(function attachProfile(global) {
    'use strict';

    const STORAGE_KEY = 'pokemon-rogue-pocket-profile';
    const STORAGE_VERSION = 1;

    // The closed set of counters the game keeps. Anything else is an authoring
    // error. Kept here so the data editor can offer exactly these.
    const STAT_KEYS = Object.freeze([
        'runs.started',
        'runs.completed',
        'runs.lost',
        'battles.won',
        'battles.lost',
        'events.seen',
        'captures.completed',
        'attacks.claimed',
        'marts.visited'
    ]);

    // Dynamic families: a concrete suffix (a starter id, a PokeType, a Rank, an
    // event id) is appended to one of these.
    const STAT_PREFIXES = Object.freeze([
        'runs.completed.starter.',
        'runs.completed.mono.',
        'battles.won.rank.',
        'events.seen.'
    ]);

    let profile = null;

    function isKnownStat(key) {
        const stat = String(key || '');

        if (STAT_KEYS.includes(stat)) return true;

        return STAT_PREFIXES.some(prefix => stat.startsWith(prefix) && stat.length > prefix.length);
    }

    function canUseStorage() {
        return typeof localStorage !== 'undefined';
    }

    function createEmptyProfile() {
        return {
            pendingUnlocks: [],
            stats: {},
            unlocked: {},
            version: STORAGE_VERSION
        };
    }

    function normalizeProfile(raw) {
        if (!raw || typeof raw !== 'object' || raw.version !== STORAGE_VERSION) return createEmptyProfile();

        const stats = {};

        if (raw.stats && typeof raw.stats === 'object') {
            Object.keys(raw.stats).forEach(key => {
                const numericValue = Math.max(0, Math.floor(Number(raw.stats[key])) || 0);

                if (!Number.isFinite(numericValue)) return;

                stats[key] = numericValue;
            });
        }

        const unlocked = {};

        if (raw.unlocked && typeof raw.unlocked === 'object') {
            Object.keys(raw.unlocked).forEach(key => {
                if (typeof raw.unlocked[key] === 'string') unlocked[key] = raw.unlocked[key];
            });
        }

        const pendingUnlocks = Array.isArray(raw.pendingUnlocks)
            ? [...new Set(raw.pendingUnlocks.filter(id => typeof id === 'string'))]
            : [];

        return { pendingUnlocks, stats, unlocked, version: STORAGE_VERSION };
    }

    function loadProfile() {
        if (!canUseStorage()) return createEmptyProfile();

        try {
            const rawProfile = localStorage.getItem(STORAGE_KEY);

            if (!rawProfile) return createEmptyProfile();

            return normalizeProfile(JSON.parse(rawProfile));
        } catch (error) {
            console.warn('Could not load profile.', error);
            return createEmptyProfile();
        }
    }

    function saveProfile() {
        if (!canUseStorage()) return false;

        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));

            return true;
        } catch (error) {
            console.warn('Could not save profile.', error);
            return false;
        }
    }

    function getProfile() {
        if (!profile) profile = loadProfile();

        return profile;
    }

    function getStat(key) {
        const current = getProfile().stats[key];

        return Number.isFinite(current) ? current : 0;
    }

    function bumpStat(key, amount = 1) {
        return bumpStats({ [key]: amount })[key];
    }

    function bumpStats(bumps) {
        const currentProfile = getProfile();
        const results = {};
        let changed = false;

        Object.keys(bumps || {}).forEach(key => {
            const amount = Math.floor(Number(bumps[key]));

            results[key] = getStat(key);

            if (!Number.isFinite(amount) || amount <= 0) return;

            const newValue = getStat(key) + amount;

            currentProfile.stats[key] = newValue;
            results[key] = newValue;
            changed = true;
        });

        if (changed) saveProfile();

        return results;
    }

    function isUnlocked(id) {
        return Boolean(getProfile().unlocked[id]);
    }

    function getUnlockedIds() {
        return Object.keys(getProfile().unlocked);
    }

    function clearProfile() {
        if (canUseStorage()) {
            try {
                localStorage.removeItem(STORAGE_KEY);
            } catch (error) {
                // Storage unavailable or blocked; nothing to clean up.
            }
        }

        profile = null;

        return true;
    }

    /**
     * Unlocks every enabled achievement whose counter has reached its threshold
     * and that is not already unlocked. Newly unlocked ids are queued in
     * pendingUnlocks so the next page that renders can toast them. Returns the
     * achievement records that were newly unlocked, in list order.
     */
    function evaluateAchievements(achievements) {
        const list = Array.isArray(achievements) ? achievements : [];
        const unlockedNow = [];
        const currentProfile = getProfile();

        list.forEach(achievement => {
            if (!achievement || !achievement.id) return;
            if (achievement.enabled === false) return;
            if (currentProfile.unlocked[achievement.id]) return;

            const threshold = Number.isFinite(achievement.atLeast) ? achievement.atLeast : 1;

            if (getStat(achievement.stat) < threshold) return;

            currentProfile.unlocked[achievement.id] = new Date().toISOString();
            currentProfile.pendingUnlocks.push(achievement.id);
            unlockedNow.push(achievement);
        });

        if (unlockedNow.length > 0) saveProfile();

        return unlockedNow;
    }

    /**
     * One-call hook for the game pages: apply a batch of counter bumps, then
     * check every achievement. Returns the newly unlocked records.
     */
    function record(bumps, achievements) {
        bumpStats(bumps);
        return evaluateAchievements(achievements);
    }

    function takePendingUnlocks() {
        const currentProfile = getProfile();
        const pending = currentProfile.pendingUnlocks.slice();

        if (pending.length > 0) {
            currentProfile.pendingUnlocks = [];
            saveProfile();
        }

        return pending;
    }

    function getProgress(achievement) {
        const threshold = Number.isFinite(achievement && achievement.atLeast) ? achievement.atLeast : 1;
        const current = getStat(achievement && achievement.stat);

        return { current: Math.min(current, threshold), threshold, unlocked: isUnlocked(achievement && achievement.id) };
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, character => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[character]));
    }

    /**
     * Builds and appends one toast element for an unlocked achievement,
     * staggered by index so several unlocks queue rather than overlap.
     */
    function showUnlockToast(name, description, index) {
        const toast = document.createElement('div');

        toast.className = 'achievement-toast';
        toast.innerHTML = `
            <span class="achievement-toast-label">Achievement Unlocked</span>
            <span class="achievement-toast-name">${escapeHtml(name)}</span>
            <span class="achievement-toast-description">${escapeHtml(description)}</span>
        `;
        toast.style.top = `${18 + index * 76}px`;
        document.body.appendChild(toast);

        requestAnimationFrame(() => toast.classList.add('is-visible'));
        setTimeout(() => {
            toast.classList.remove('is-visible');
            setTimeout(() => toast.remove(), 300);
        }, 4000 + index * 220);
    }

    /**
     * Drains pendingUnlocks and shows one toast per newly unlocked achievement.
     * DOM-only: a no-op without a document, so Node tests can require this file.
     */
    function showPendingUnlocks(achievements) {
        if (typeof document === 'undefined' || !document.body) return [];

        const pending = takePendingUnlocks();

        if (pending.length === 0) return [];

        const byId = new Map((Array.isArray(achievements) ? achievements : [])
            .filter(entry => entry && entry.id)
            .map(entry => [entry.id, entry]));

        pending.forEach((id, index) => {
            const achievement = byId.get(id);

            showUnlockToast(achievement ? achievement.name : id,
                achievement ? achievement.description : '', index);
        });

        return pending;
    }

    global.PokeProfile = {
        STAT_KEYS,
        STAT_PREFIXES,
        STORAGE_KEY,
        STORAGE_VERSION,
        bumpStat,
        bumpStats,
        clearProfile,
        evaluateAchievements,
        getProfile,
        getProgress,
        getStat,
        getUnlockedIds,
        isKnownStat,
        isUnlocked,
        record,
        showPendingUnlocks,
        takePendingUnlocks
    };
})(window);
