/**
 * Pokemon Rogue Pocket - achievements page
 */

(function bootAchievementsPage(arena) {
    'use strict';

    const state = { root: null };

    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        state.root = document.getElementById('achievements-root');

        await arena.Data.loadGameData();

        render();
        window.PokeProfile.showPendingUnlocks(arena.GameData.achievements);
    }

    function render() {
        const achievements = (arena.GameData.achievements || []).filter(entry => entry.enabled !== false);
        const unlockedCount = achievements.filter(entry => window.PokeProfile.isUnlocked(entry.id)).length;

        document.getElementById('achievement-count').textContent = `${unlockedCount} / ${achievements.length}`;

        state.root.innerHTML = achievements.length === 0
            ? '<section class="arena-status">No achievements yet.</section>'
            : achievements.map(renderRow).join('');
    }

    function renderRow(achievement) {
        const progress = window.PokeProfile.getProgress(achievement);
        const isHiddenLocked = achievement.hidden && !progress.unlocked;

        const name = isHiddenLocked ? '???' : escapeHtml(achievement.name);
        const description = isHiddenLocked ? '???' : escapeHtml(achievement.description);

        return `
            <article class="achievement-row ${progress.unlocked ? 'achievement-row--unlocked' : 'achievement-row--locked'}">
                <h2 class="achievement-name">${name}</h2>
                <p class="achievement-description">${description}</p>
                ${renderMeta(achievement, progress, isHiddenLocked)}
            </article>
        `;
    }

    function renderMeta(achievement, progress, isHiddenLocked) {
        if (progress.unlocked) {
            const unlockedAt = window.PokeProfile.getProfile().unlocked[achievement.id];
            const unlockedDate = unlockedAt ? new Date(unlockedAt).toLocaleDateString() : '';

            return `<p class="achievement-unlocked-at">Unlocked ${escapeHtml(unlockedDate)}</p>`;
        }

        if (isHiddenLocked) return '';

        const percent = progress.threshold > 0 ? Math.round((progress.current / progress.threshold) * 100) : 0;

        return `
            <p class="achievement-progress-label">${progress.current} / ${progress.threshold}</p>
            <div class="achievement-progress">
                <div class="achievement-progress-bar" style="width: ${percent}%"></div>
            </div>
        `;
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
})(window.CardArena = window.CardArena || {});
