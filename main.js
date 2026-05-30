/**
 * Pokemon Rogue Pocket - main menu logic
 */

const CURRENT_BATTLE_STORAGE_KEY = 'card-arena-current-battle';
const RUN_STORAGE_KEY = 'pokemon-rogue-pocket-run';
const NEW_RUN_ROUTE = 'area.html?newRun=1';

document.addEventListener('DOMContentLoaded', () => {
    init();
});

/**
 * Initializes the home page event listeners and state.
 */
function init() {
    document.getElementById('btn-new-game').addEventListener('click', handleNewGame);
    document.getElementById('btn-load-game').addEventListener('click', handleLoadGame);

    updateLoadButtonState();
}

/**
 * Handles the "New Game" button click.
 */
function handleNewGame() {
    localStorage.removeItem(CURRENT_BATTLE_STORAGE_KEY);
    localStorage.removeItem(RUN_STORAGE_KEY);
    window.location.href = NEW_RUN_ROUTE;
}

/**
 * Handles the "Load Game" button click.
 */
function handleLoadGame() {
    if (!checkForSavedGames()) return;

    window.location.href = getSavedRunRoute() || 'game.html';
}

/**
 * Checks if there are any saved games and updates the Load Game button state.
 */
function updateLoadButtonState() {
    const loadBtn = document.getElementById('btn-load-game');
    const hasSavedGames = checkForSavedGames();

    loadBtn.disabled = !hasSavedGames;
}

function checkForSavedGames() {
    return Boolean(getSavedRunRoute() || localStorage.getItem(CURRENT_BATTLE_STORAGE_KEY));
}

function getSavedRunRoute() {
    const run = loadSavedRunState();

    if (!run || !run.area) return null;

    if (hasActiveBattleEncounter(run)) return 'game.html';
    if (hasActiveCaptureEncounter(run)) return 'capture.html';
    if (hasActiveMartEncounter(run)) return 'mart.html';

    return 'area.html';
}

function loadSavedRunState() {
    try {
        const rawRun = localStorage.getItem(RUN_STORAGE_KEY);

        return rawRun ? JSON.parse(rawRun) : null;
    } catch (error) {
        console.warn('Could not load saved run.', error);
        return null;
    }
}

function hasActiveCaptureEncounter(run) {
    const activeCaptureNodeId = run.area.activeCaptureNodeId;
    const encounter = activeCaptureNodeId && run.captureEncounters
        ? run.captureEncounters[activeCaptureNodeId]
        : null;

    return Boolean(encounter && !encounter.completed);
}

function hasActiveBattleEncounter(run) {
    const activeBattleNodeId = run.area.activeBattleNodeId;
    const encounter = activeBattleNodeId && run.battleEncounters
        ? run.battleEncounters[activeBattleNodeId]
        : null;

    return Boolean(encounter && !encounter.completed);
}

function hasActiveMartEncounter(run) {
    const activeMartNodeId = run.area.activeMartNodeId;
    const encounter = activeMartNodeId && run.martEncounters
        ? run.martEncounters[activeMartNodeId]
        : null;

    return Boolean(encounter && !encounter.completed);
}
