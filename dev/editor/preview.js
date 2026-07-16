/**
 * Local normalizers + card factories for the data editor's live previews.
 * Mirrors the (unexported) normalizers in arena/arena_data.js so raw JSON
 * records render through the same window.CardArena.Render.renderCardPreview()
 * the game itself uses, without modifying game code.
 */
(function (EditorPreview, arena) {
    'use strict';

    function compactTypes(types) {
        return types.filter((type) => type && type !== 'NONE');
    }

    // Reimplements formatAssetName() from arena/arena_data.js (not exported).
    function formatAssetName(name) {
        return String(name || 'item')
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
    }

    function normalizePokemonPreview(record) {
        const species = {
            baseAttack: Number(record.baseAttack) || 0,
            baseDefense: Number(record.baseDefense) || 0,
            baseHealth: Number(record.baseHealth) || 1,
            baseSpeed: Number(record.baseSpeed) || 0,
            id: record.id,
            name: record.name,
            type1: record.type1,
            type2: record.type2,
            type3: record.type3
        };

        species.types = compactTypes([species.type1, species.type2, species.type3]);
        species.portraitPath = `assets/portraits/${encodeURIComponent(species.name)}.png`;

        return species;
    }

    function normalizeAttackPreview(record) {
        const attack = {
            basePower: Number(record.basePower) || 0,
            full_type_requirements: Boolean(record.full_type_requirements),
            name: record.name,
            statChanges: Array.isArray(record.statChanges) ? record.statChanges : [],
            status: record.status || 'NONE',
            target: record.target,
            type1: record.type1,
            type2: record.type2
        };

        attack.types = compactTypes([attack.type1, attack.type2]);

        return attack;
    }

    function normalizeItemPreview(record) {
        const rawStatuses = Array.isArray(record.status) ? record.status : compactTypes([record.status]);
        const rawStatChanges = Array.isArray(record.statChanges) ? record.statChanges : [];
        const statChangeTypes = ['ATTACK_DOWN', 'ATTACK_UP', 'DEFENSE_DOWN', 'DEFENSE_UP', 'SPEED_DOWN', 'SPEED_UP'];

        return {
            imagePath: record.imagePath || record.picturePath || record.image || `assets/items/${formatAssetName(record.name)}.png`,
            name: record.name,
            statChanges: rawStatChanges.filter((change) => statChangeTypes.includes(change)),
            status: [...rawStatuses, ...rawStatChanges.filter((change) => !statChangeTypes.includes(change))],
            target: record.target
        };
    }

    // Card factory shapes copied from arena/card_overview.js:54-90.
    function buildPreviewCard(kind, rawRecord, id) {
        if (kind === 'pokemon') {
            const pokemon = normalizePokemonPreview(rawRecord);
            return {
                currentHealth: pokemon.baseHealth,
                currentStatus: [],
                faceUp: true,
                id: id || `editor-pokemon-${pokemon.id || pokemon.name}`,
                kind: 'pokemon',
                owner: 'editor',
                pokemon,
                statChanges: [],
                statStages: { attack: 0, defense: 0, speed: 0 }
            };
        }
        if (kind === 'attack') {
            const attack = normalizeAttackPreview(rawRecord);
            return {
                attack,
                faceUp: true,
                id: id || `editor-attack-${attack.name}`,
                kind: 'attack',
                owner: 'editor'
            };
        }
        if (kind === 'item') {
            const item = normalizeItemPreview(rawRecord);
            return {
                faceUp: true,
                id: id || `editor-item-${item.name}`,
                item,
                kind: 'item',
                owner: 'editor'
            };
        }
        throw new Error(`unknown preview card kind "${kind}"`);
    }

    function renderCardInto(el, kind, rawRecord) {
        const card = buildPreviewCard(kind, rawRecord);
        el.innerHTML = arena.Render.renderCardPreview(card);
    }

    function typeIconHtml(type) {
        return `<img class="type-icon" src="assets/types-svgs/${type}.svg" alt="${type}">`;
    }

    function spritePathFor(trainerRecord) {
        return window.PokeRogue.TrainerSprites.resolveSprite(trainerRecord.name, trainerRecord.sprite).path;
    }

    function itemImagePathFor(itemRecord) {
        return itemRecord.imagePath || `assets/items/${formatAssetName(itemRecord.name)}.png`;
    }

    Object.assign(EditorPreview, {
        buildPreviewCard,
        compactTypes,
        formatAssetName,
        itemImagePathFor,
        normalizeAttackPreview,
        normalizeItemPreview,
        normalizePokemonPreview,
        renderCardInto,
        spritePathFor,
        typeIconHtml
    });
})(window.EditorPreview = window.EditorPreview || {}, window.CardArena);
