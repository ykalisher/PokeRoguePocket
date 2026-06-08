/**
 * Pokemon Rogue Pocket - card arena prototype
 */

(function bootCardArena(arena, runStore) {
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
            opponent: { name: activeTrainer.name },
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
                    <img class="battle-flow-sprite" src="${activeTrainer.spritePath}" alt="${activeTrainer.name}">
                    <div class="battle-flow-copy">
                        <span class="battle-flow-kicker">Trainer Battle</span>
                        <h1>${activeTrainer.name}</h1>
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
            activeRun.cash = (Number.isFinite(activeRun.cash) ? activeRun.cash : 0) + getBattleReward();
            activeBattleEncounter.rewardCollected = true;
        }

        runStore.saveRunState(activeRun);
        renderBattleResultOverlay(activeBattleEncounter.outcome);
    }

    function renderBattleResultShell() {
        arena.state.elements.board.innerHTML = '<section class="arena-status arena-status--loading">Battle complete.</section>';
    }

    function renderBattleResultOverlay(outcome) {
        removeBattleFlowOverlay();

        const overlay = document.createElement('div');
        overlay.className = 'battle-flow-overlay';
        overlay.innerHTML = outcome === 'win'
            ? renderWinResultWindow()
            : renderLossResultWindow();

        document.body.appendChild(overlay);
    }

    function renderWinResultWindow() {
        return `
            <section class="battle-result-window" role="dialog" aria-modal="true" aria-labelledby="battle-result-title">
                <span class="battle-flow-kicker">Battle Complete</span>
                <h1 id="battle-result-title">You won</h1>
                <p>You earned ${getBattleReward()} coins.</p>
                <button class="arena-button battle-flow-primary" type="button" data-battle-flow-action="continue">Continue</button>
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
        activeRun.area.activeBattleNodeId = null;
        runStore.saveRunState(activeRun);
        arena.Model.clearSavedBattleState();
        window.location.href = 'area.html';
    }

    function startOver() {
        arena.Model.clearSavedBattleState();
        if (runStore && typeof runStore.clearRunState === 'function') {
            runStore.clearRunState();
        }
        window.location.href = 'area.html?newRun=1';
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
        return {
            actionCards: [
                ...trainer.attacks.flatMap(attacks => (
                    Array.isArray(attacks)
                        ? attacks.map(name => ({ kind: 'attack', name }))
                        : []
                )),
                ...trainer.items.map(name => ({ kind: 'item', name }))
            ],
            exactCards: true,
            pokemonCards: trainer.pokemon.map(name => ({ name }))
        };
    }

    function getBattleReward() {
        if (Number.isFinite(activeBattleEncounter && activeBattleEncounter.rewardCash)) {
            return activeBattleEncounter.rewardCash;
        }

        return activeTrainer && Number.isFinite(activeTrainer.cash) ? activeTrainer.cash : 0;
    }

    function getSavedBattleOutcome() {
        if (activeBattleEncounter && activeBattleEncounter.outcome) return activeBattleEncounter.outcome;

        const state = arena.state;
        const playerDefeated = isSavedPlayerDefeated(state.players.player);

        return playerDefeated ? 'loss' : 'win';
    }

    function isSavedPlayerDefeated(player) {
        if (!player) return false;

        return Boolean(player.lostByPokemonDeck) ||
            (Number(player.knockoutCount) || 0) >= arena.Constants.KNOCKOUT_LIMIT;
    }
})(window.CardArena = window.CardArena || {}, window.PokeRun);
