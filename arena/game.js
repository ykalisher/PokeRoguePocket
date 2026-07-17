/**
 * Pokemon Rogue Pocket - card arena prototype
 */

(function bootCardArena(arena, runStore, locations) {
    'use strict';

    let activeRun = null;
    let activeBattleEncounter = null;
    let activeTrainer = null;

    document.addEventListener('DOMContentLoaded', initGame);

    /**
     * Page-level arena entry point. It wires DOM events to Controller/Drag,
     * loads card data, then either restores a saved battle or starts the opening
     * placement flow through Controller.resetPrototype().
     */
    async function initGame() {
        if (locations && runStore && typeof runStore.loadRunState === 'function') {
            locations.applyLocationTheme(runStore.loadRunState());
        }

        const state = arena.state;

        state.elements.board = document.getElementById('game-board');
        state.elements.popup = document.getElementById('arena-popup');
        state.elements.board.innerHTML = '<section class="arena-status arena-status--loading">Loading arena data...</section>';
        document.addEventListener('click', handleBattleFlowClick);
        state.elements.board.addEventListener('click', arena.Controller.handleArenaClick);
        state.elements.board.addEventListener('pointerdown', arena.Drag.handlePointerDown);
        window.addEventListener('pointermove', arena.Drag.handlePointerMove);
        window.addEventListener('pointerup', arena.Drag.handlePointerUp);
        window.addEventListener('pointercancel', arena.Drag.cancelDrag);

        await arena.Data.loadGameData();

        loadActiveBattleEncounter();
        configureRunBattle();
        arena.BattleFlow = { handleBattleFinished };

        if (arena.Model.restoreSavedBattleState()) {
            arena.Render.render();
            arena.Model.saveBattleState();
            if (state.finished && activeBattleEncounter) {
                handleBattleFinished(getSavedBattleOutcome());
            }
        } else if (activeBattleEncounter && activeBattleEncounter.outcome) {
            renderBattleResultShell();
            handleBattleFinished(activeBattleEncounter.outcome);
        } else if (activeBattleEncounter && activeTrainer) {
            renderTrainerIntro();
        } else if (activeBattleEncounter) {
            renderBattleUnavailable();
        } else {
            arena.Controller.resetPrototype();
        }
    }

    function handleBattleFlowClick(event) {
        const button = event.target.closest('[data-battle-flow-action]');

        if (!button) return;

        const action = button.dataset.battleFlowAction;

        if (action === 'start') {
            startRunBattle();
        } else if (action === 'continue') {
            completeBattleAndReturnToMap();
        } else if (action === 'start-over') {
            startOver();
        } else if (action === 'main-menu') {
            window.location.href = 'index.html';
        } else if (action === 'area-map') {
            window.location.href = 'area.html';
        }
    }

    function loadActiveBattleEncounter() {
        if (!runStore || typeof runStore.loadRunState !== 'function') return;

        activeRun = runStore.loadRunState();
        activeBattleEncounter = runStore.getActiveBattleEncounter(activeRun);
        activeTrainer = getTrainerForEncounter(activeBattleEncounter);
    }

    function configureRunBattle() {
        if (!activeRun || !activeBattleEncounter || !activeTrainer) return;

        runStore.balancePokemonCollections(activeRun);
        runStore.rebuildActionDeckForActivePokemon(activeRun);
        runStore.saveRunState(activeRun);

        arena.BattleConfig = {
            opponent: { name: getTrainerDisplayName(activeTrainer) },
            player: { name: 'You' }
        };
        arena.BattleDecks = {
            opponent: createTrainerDeckDefinition(activeTrainer),
            player: {
                actionCards: activeRun.collections.actions,
                exactCards: true,
                pokemonCards: activeRun.collections.pokemon
            }
        };
    }

    function renderTrainerIntro() {
        removeBattleFlowOverlay();
        arena.state.elements.board.innerHTML = `
            <section class="battle-flow-screen" aria-label="Trainer battle">
                <div class="battle-flow-card">
                    <img class="battle-flow-sprite" src="${activeTrainer.spritePath}" alt="${getTrainerDisplayName(activeTrainer)}">
                    <div class="battle-flow-copy">
                        <span class="battle-flow-kicker">${getBattleKicker()}</span>
                        <h1>${getTrainerDisplayName(activeTrainer)}</h1>
                        <p>${activeTrainer.rank} trainer</p>
                    </div>
                    <button class="arena-button battle-flow-primary" type="button" data-battle-flow-action="start">Start Battle</button>
                </div>
            </section>
        `;
    }

    function renderBattleUnavailable() {
        removeBattleFlowOverlay();
        arena.state.elements.board.innerHTML = `
            <section class="battle-flow-screen" aria-label="Trainer battle unavailable">
                <div class="battle-flow-card">
                    <div class="battle-flow-copy">
                        <span class="battle-flow-kicker">Trainer Battle</span>
                        <h1>Trainer unavailable</h1>
                        <p>Return to the map to refresh this encounter.</p>
                    </div>
                    <button class="arena-button battle-flow-primary" type="button" data-battle-flow-action="area-map">Back to Map</button>
                </div>
            </section>
        `;
    }

    function startRunBattle() {
        if (!activeRun || !activeBattleEncounter || !activeTrainer) return;

        removeBattleFlowOverlay();
        activeBattleEncounter.startedAt = activeBattleEncounter.startedAt || new Date().toISOString();
        runStore.saveRunState(activeRun);
        configureRunBattle();
        arena.Controller.resetPrototype();
    }

    function handleBattleFinished(outcome) {
        if (!activeRun || !activeBattleEncounter) return;

        activeBattleEncounter.outcome = activeBattleEncounter.outcome || outcome;
        activeBattleEncounter.finishedAt = activeBattleEncounter.finishedAt || new Date().toISOString();

        if (activeBattleEncounter.outcome === 'win' && !activeBattleEncounter.rewardCollected) {
            collectBattleRewards();
        }

        if (activeBattleEncounter.outcome === 'win') {
            completeSourceEvent();
        }

        if (activeBattleEncounter.outcome === 'win' && isRunVictory()) {
            finalizeRunVictory();
        }

        runStore.saveRunState(activeRun);
        renderBattleResultOverlay(activeBattleEncounter.outcome);
    }

    /**
     * Marks the run as won. A victory has no continue-to-map step, so the area
     * completion that Continue normally performs is applied here instead.
     */
    function finalizeRunVictory() {
        const now = new Date().toISOString();

        activeBattleEncounter.completed = true;
        activeBattleEncounter.completedAt = now;
        activeRun.area.completed = true;
        activeRun.area.completedAt = now;
        activeRun.area.completedBossNodeId = activeBattleEncounter.nodeId;
        activeRun.area.activeBattleNodeId = null;
        activeRun.runCompleted = true;
        activeRun.runCompletedAt = now;
    }

    function renderBattleResultShell() {
        arena.state.elements.board.innerHTML = '<section class="arena-status arena-status--loading">Battle complete.</section>';
    }

    function renderBattleResultOverlay(outcome) {
        removeBattleFlowOverlay();

        const overlay = document.createElement('div');
        overlay.className = 'battle-flow-overlay';

        if (outcome === 'win') {
            overlay.innerHTML = isRunVictory() ? renderVictoryResultWindow() : renderWinResultWindow();
        } else {
            overlay.innerHTML = renderLossResultWindow();
        }

        document.body.appendChild(overlay);
    }

    function renderWinResultWindow() {
        return `
            <section class="battle-result-window" role="dialog" aria-modal="true" aria-labelledby="battle-result-title">
                <span class="battle-flow-kicker">Battle Complete</span>
                <h1 id="battle-result-title">${isFinalNodeBattle() ? 'Area cleared' : 'You won'}</h1>
                ${renderWinRewardSummary()}
                <button class="arena-button battle-flow-primary" type="button" data-battle-flow-action="continue">Continue</button>
            </section>
        `;
    }

    function renderVictoryResultWindow() {
        return `
            <section class="battle-result-window battle-result-window--victory" role="dialog" aria-modal="true" aria-labelledby="battle-result-title">
                <span class="battle-flow-kicker">Run Complete</span>
                <h1 id="battle-result-title">Champion!</h1>
                <p>You cleared all ${getTotalLevels()} levels and won the run.</p>
                ${renderWinRewardSummary()}
                <div class="battle-flow-actions">
                    <button class="arena-button battle-flow-primary" type="button" data-battle-flow-action="start-over">Start over</button>
                    <button class="arena-button" type="button" data-battle-flow-action="main-menu">Main menu</button>
                </div>
            </section>
        `;
    }

    function renderLossResultWindow() {
        return `
            <section class="battle-result-window" role="dialog" aria-modal="true" aria-labelledby="battle-result-title">
                <span class="battle-flow-kicker">Battle Complete</span>
                <h1 id="battle-result-title">You lose</h1>
                <p>Your run is over.</p>
                <div class="battle-flow-actions">
                    <button class="arena-button battle-flow-primary" type="button" data-battle-flow-action="start-over">Start over</button>
                    <button class="arena-button" type="button" data-battle-flow-action="main-menu">Main menu</button>
                </div>
            </section>
        `;
    }

    function completeBattleAndReturnToMap() {
        if (!activeRun || !activeBattleEncounter) return;

        activeBattleEncounter.completed = true;
        activeBattleEncounter.completedAt = new Date().toISOString();
        if (activeBattleEncounter.outcome === 'win' && isFinalNodeBattle()) {
            activeRun.area.completed = true;
            activeRun.area.completedAt = activeBattleEncounter.completedAt;
            activeRun.area.completedBossNodeId = activeBattleEncounter.nodeId;
        }
        activeRun.area.activeBattleNodeId = null;
        if (activeBattleEncounter.sourceEventNodeId) {
            activeRun.area.activeEventNodeId = null;
        }
        runStore.saveRunState(activeRun);
        arena.Model.clearSavedBattleState();
        window.location.href = 'area.html';
    }

    function startOver() {
        arena.Model.clearSavedBattleState();
        if (runStore && typeof runStore.clearRunState === 'function') {
            runStore.clearRunState();
        }
        window.location.href = 'starter.html';
    }

    function removeBattleFlowOverlay() {
        const overlay = document.querySelector('.battle-flow-overlay');

        if (overlay) overlay.remove();
    }

    function getTrainerForEncounter(encounter) {
        if (!encounter || !encounter.trainerName) return null;

        const trainers = arena.GameData && Array.isArray(arena.GameData.trainers)
            ? arena.GameData.trainers
            : [];

        return trainers.find(trainer => trainer.name === encounter.trainerName) || null;
    }

    function createTrainerDeckDefinition(trainer) {
        const attackNames = Array.isArray(trainer.attacks) ? trainer.attacks : [];
        const itemNames = Array.isArray(trainer.items) ? trainer.items : [];
        const pokemonNames = Array.isArray(trainer.pokemon) ? trainer.pokemon : [];

        return {
            actionCards: [
                ...attackNames.map(name => ({ kind: 'attack', name })),
                ...itemNames.map(name => ({ kind: 'item', name }))
            ],
            exactCards: true,
            pokemonCards: pokemonNames.map(name => ({ name }))
        };
    }

    function getBattleReward() {
        if (Number.isFinite(activeBattleEncounter && activeBattleEncounter.rewardCash)) {
            return activeBattleEncounter.rewardCash;
        }

        return activeTrainer && Number.isFinite(activeTrainer.cash) ? activeTrainer.cash : 0;
    }

    function collectBattleRewards() {
        const rewardSummary = [];
        const cashReward = getBattleReward();

        if (cashReward > 0) {
            activeRun.cash = (Number.isFinite(activeRun.cash) ? activeRun.cash : 0) + cashReward;
            rewardSummary.push(`Gained ${cashReward} coins.`);
        }

        const rewardEffects = Array.isArray(activeBattleEncounter.rewardEffects)
            ? activeBattleEncounter.rewardEffects
            : [];

        if (rewardEffects.length > 0 && window.PokeEvents && typeof window.PokeEvents.applyEffects === 'function') {
            rewardSummary.push(...window.PokeEvents.applyEffects(activeRun, rewardEffects, {}, {
                gameData: arena.GameData,
                runStore
            }));
            runStore.balancePokemonCollections(activeRun);
            runStore.rebuildActionDeckForActivePokemon(activeRun);
        }

        activeBattleEncounter.rewardSummary = rewardSummary;
        activeBattleEncounter.rewardCollected = true;
    }

    function completeSourceEvent() {
        const sourceEventNodeId = activeBattleEncounter.sourceEventNodeId;

        if (!sourceEventNodeId || !activeRun.eventEncounters) return;

        const eventEncounter = activeRun.eventEncounters[sourceEventNodeId];

        if (!eventEncounter || eventEncounter.completed) return;

        eventEncounter.battleCompleted = true;
        eventEncounter.completed = true;
        eventEncounter.completedAt = new Date().toISOString();
        eventEncounter.resultSummary = Array.isArray(activeBattleEncounter.rewardSummary)
            ? activeBattleEncounter.rewardSummary
            : [];
        eventEncounter.selectedActionId = 'battle';
        activeRun.area.activeEventNodeId = null;
    }

    function renderWinRewardSummary() {
        const rewardSummary = Array.isArray(activeBattleEncounter && activeBattleEncounter.rewardSummary)
            ? activeBattleEncounter.rewardSummary
            : [];

        if (rewardSummary.length === 0) {
            return isFinalNodeBattle()
                ? '<p>The Gym Leader stepped aside.</p>'
                : '<p>The trainer stepped aside.</p>';
        }

        return `
            <ul class="battle-result-rewards">
                ${rewardSummary.map(entry => `<li>${escapeHtml(entry)}</li>`).join('')}
            </ul>
        `;
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function getTrainerDisplayName(trainer) {
        return trainer && trainer.displayName ? trainer.displayName : trainer.name;
    }

    function getBattleKicker() {
        const isFinal = isFinalNodeBattle();

        if (getRunLevel() >= getTotalLevels()) {
            return isFinal ? 'Final Battle' : 'Elite Battle';
        }

        return isFinal ? 'Gym Leader Battle' : 'Trainer Battle';
    }

    // The final node of an area is the one whose id matches the run's bossNodeId.
    function isFinalNodeBattle() {
        if (!activeRun || !activeBattleEncounter || !activeRun.area) return false;

        const bossNodeId = activeRun.area.bossNodeId;

        return Boolean(bossNodeId && activeBattleEncounter.nodeId === bossNodeId);
    }

    // A win on the last level's final node ends the whole run in victory.
    function isRunVictory() {
        return isFinalNodeBattle() && getRunLevel() >= getTotalLevels();
    }

    function getRunLevel() {
        return activeRun && Number.isFinite(activeRun.level) ? activeRun.level : 1;
    }

    function getTotalLevels() {
        return window.PokeLocations && Number.isFinite(window.PokeLocations.TOTAL_LEVELS)
            ? window.PokeLocations.TOTAL_LEVELS
            : 4;
    }

    function getSavedBattleOutcome() {
        if (activeBattleEncounter && activeBattleEncounter.outcome) return activeBattleEncounter.outcome;

        return arena.Model.isPlayerDefeated(arena.state.players.player) ? 'loss' : 'win';
    }
})(window.CardArena = window.CardArena || {}, window.PokeRun, window.PokeLocations);
