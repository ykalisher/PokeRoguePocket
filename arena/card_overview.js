/**
 * Pokemon Rogue Pocket - card overview page
 */

(function bootCardOverview(arena) {
    'use strict';

    let selectedType = null;

    document.addEventListener('DOMContentLoaded', initOverview);

    async function initOverview() {
        const root = document.getElementById('card-overview');

        await arena.Data.loadGameData();

        root.innerHTML = `
            ${renderSection('Pokemon', 'pokemon', arena.GameData.pokemon.slice().sort((a, b) => a.id.localeCompare(b.id)).map(createPokemonPreviewCard))}
            ${renderSection('Attacks', 'attacks', arena.GameData.attacks.map(createAttackPreviewCard))}
            ${renderSection('Items', 'items', arena.GameData.items.map(createItemPreviewCard))}
        `;
        root.addEventListener('click', handleOverviewClick);
        updateTypeFilter();
    }

    function renderSection(title, id, cards) {
        return `
            <section class="overview-section" aria-labelledby="${id}-overview-title">
                <header class="overview-section-header">
                    <h2 id="${id}-overview-title">${title}</h2>
                    <span class="stat-pill">${cards.length}</span>
                </header>
                <div class="overview-card-grid">
                    ${cards.map(renderOverviewCard).join('') || '<span class="empty-hand">Empty</span>'}
                </div>
            </section>
        `;
    }

    function renderOverviewCard(card) {
        const types = arena.Model.getCardTypes(card);
        const attributes = [
            'data-overview-card',
            `data-card-kind="${card.kind}"`,
            `data-card-types="${types.join(' ')}"`
        ].join(' ');

        return arena.Render.renderCardPreview(card, {
            attributes,
            typeButtons: true
        });
    }

    function createPokemonPreviewCard(pokemon, index) {
        return {
            currentHealth: pokemon.baseHealth,
            currentStatus: [],
            faceUp: true,
            id: `overview-pokemon-${pokemon.id || index}`,
            kind: 'pokemon',
            owner: 'overview',
            pokemon,
            statChanges: [],
            statStages: {
                attack: 0,
                defense: 0,
                speed: 0
            }
        };
    }

    function createAttackPreviewCard(attack, index) {
        return {
            attack,
            faceUp: true,
            id: `overview-attack-${slugify(attack.name)}-${index}`,
            kind: 'attack',
            owner: 'overview'
        };
    }

    function createItemPreviewCard(item, index) {
        return {
            faceUp: true,
            id: `overview-item-${slugify(item.name)}-${index}`,
            item,
            kind: 'item',
            owner: 'overview'
        };
    }

    function handleOverviewClick(event) {
        const typeButton = event.target.closest('[data-type]');

        if (!typeButton) return;

        selectedType = selectedType === typeButton.dataset.type
            ? null
            : typeButton.dataset.type;
        updateTypeFilter();
    }

    function updateTypeFilter() {
        const root = document.getElementById('card-overview');
        const label = document.getElementById('type-filter-label');
        const hasFilter = Boolean(selectedType);

        root.classList.toggle('is-filtered', hasFilter);
        label.textContent = hasFilter ? formatTypeName(selectedType) : 'All Types';

        root.querySelectorAll('[data-overview-card]').forEach(card => {
            const types = card.dataset.cardTypes.split(/\s+/).filter(Boolean);
            const isMatch = hasFilter && types.includes(selectedType);

            card.classList.toggle('is-type-match', isMatch);
            card.classList.toggle('is-type-dimmed', hasFilter && !isMatch);
        });

        root.querySelectorAll('[data-type]').forEach(button => {
            const isSelected = hasFilter && button.dataset.type === selectedType;

            button.classList.toggle('is-type-selected', isSelected);
            button.setAttribute('aria-pressed', String(isSelected));
        });
    }

    function formatTypeName(type) {
        return String(type || '')
            .toLowerCase()
            .split('_')
            .map(part => part ? part[0].toUpperCase() + part.slice(1) : '')
            .join(' ');
    }

    function slugify(value) {
        return String(value || 'attack')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }
})(window.CardArena = window.CardArena || {});
