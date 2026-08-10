/**
 * Pocket Nuzlocke - main menu logic
 */

const CURRENT_BATTLE_STORAGE_KEY = 'card-arena-current-battle';
const RUN_STORAGE_KEY = 'pokemon-rogue-pocket-run';
const NEW_RUN_ROUTE = 'starter.html';
// Must track PokeRun.STORAGE_VERSION — main.js loads no shared modules, so the
// Continue button reads the run JSON directly and rejects stale save formats.
const RUN_STORAGE_VERSION = 3;

// Mascot icons shown beside the title; one is picked at random per page load.
// The first entry doubles as the favicon / PWA icon.
const TITLE_ICONS = [
    'nuzlocke-icon.png',
    'angry.png',
    'dizzy.png',
    'inspired.png',
    'normal.png',
    'shouting.png',
    'sigh.png',
    'stunned.png',
];

// Runs at parse time (the script tag sits after the title) so the icon is set
// before the first paint and never swaps visibly.
pickTitleIcon();

document.addEventListener('DOMContentLoaded', () => {
    init();
});

/**
 * Points the title icon at a random mascot image.
 */
function pickTitleIcon() {
    const icon = document.getElementById('menu-title-icon');

    if (!icon) return;

    const name = TITLE_ICONS[Math.floor(Math.random() * TITLE_ICONS.length)];

    icon.src = `assets/icons/${name}`;
}

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
    if (hasActiveAttackEncounter(run)) return 'attack.html';
    if (hasActiveMartEncounter(run)) return 'mart.html';
    if (hasActiveEventEncounter(run)) return 'event.html';

    return 'area.html';
}

function loadSavedRunState() {
    try {
        const rawRun = localStorage.getItem(RUN_STORAGE_KEY);
        const run = rawRun ? JSON.parse(rawRun) : null;

        if (!run || run.version !== RUN_STORAGE_VERSION) return null;

        return run;
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

function hasActiveAttackEncounter(run) {
    const activeAttackNodeId = run.area.activeAttackNodeId;
    const encounter = activeAttackNodeId && run.attackEncounters
        ? run.attackEncounters[activeAttackNodeId]
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

function hasActiveEventEncounter(run) {
    const activeEventNodeId = run.area.activeEventNodeId;
    const encounter = activeEventNodeId && run.eventEncounters
        ? run.eventEncounters[activeEventNodeId]
        : null;

    return Boolean(encounter && !encounter.completed);
}
