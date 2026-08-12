/**
 * Pocket Nuzlocke - starter picker page
 *
 * Renders the enabled starter decks (from starter_decks.json) and, on
 * selection, hands off to a fresh run via area.html?newRun=1&starter=<id>.
 *
 * A deck with `requiresAchievement` is hidden entirely until the profile has
 * unlocked that achievement.
 */

(function bootStarterPage(arena, locations) {
    'use strict';

    const state = {
        root: null
    };

    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        state.root = document.getElementById('starter-root');
        state.root.addEventListener('click', handleSelectClick);

        await arena.Data.loadGameData();
        render();
    }

    function render() {
        const decks = Object.values(locations.getUnlockedStarterDecks(arena.GameData));
        state.root.innerHTML = decks.map(renderDeckCard).join('');
    }

    function renderDeckCard(deck) {
        const pokemon = deck.pokemon.map(renderPokemon).join('');
        const cards = [...deck.attacks, ...deck.items]
            .map(([name, count]) => `<li>${count}× ${escapeHtml(name)}</li>`)
            .join('');

        return `
            <button type="button" class="starter-card" data-starter="${escapeHtml(deck.id)}">
                <span class="starter-card-type">${formatType(deck.type)}</span>
                <span class="starter-card-pokemon">${pokemon}</span>
                <ul class="starter-card-cards">${cards}</ul>
                <span class="starter-card-cta">Choose this deck</span>
            </button>`;
    }

    function renderPokemon(name) {
        const record = findRecord('pokemon', name);
        const portrait = record && record.portraitPath
            ? record.portraitPath
            : `assets/portraits/${encodeURIComponent(name)}.png`;

        return `
            <span class="starter-mon">
                <img src="${escapeHtml(portrait)}" alt="${escapeHtml(name)}" class="starter-mon-portrait">
                <span class="starter-mon-name">${escapeHtml(name)}</span>
            </span>`;
    }

    function handleSelectClick(event) {
        const card = event.target.closest('[data-starter]');

        if (!card) return;

        const starterId = card.getAttribute('data-starter');
        window.location.href = `area.html?newRun=1&starter=${encodeURIComponent(starterId)}`;
    }

    function findRecord(collectionKey, name) {
        const records = arena.GameData && arena.GameData[collectionKey];

        return Array.isArray(records)
            ? records.find(record => record.name === name) || null
            : null;
    }

    function formatType(type) {
        if (!type) return '';

        return type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
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
})(window.CardArena = window.CardArena || {}, window.PokeLocations);
