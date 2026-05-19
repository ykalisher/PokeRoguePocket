/**
 * Squish - Main Menu Logic
 */

const CURRENT_BATTLE_STORAGE_KEY = 'card-arena-current-battle';

document.addEventListener('DOMContentLoaded', () => {
    init();
});

/**
 * Initializes the home page event listeners and state.
 */
function init() {
    document.getElementById('btn-new-game').addEventListener('click', handleNewGame);
    document.getElementById('btn-load-game').addEventListener('click', handleLoadGame);
    document.getElementById('btn-settings').addEventListener('click', handleSettings);

    updateLoadButtonState();
}

/**
 * Handles the "New Game" button click.
 */
function handleNewGame() {
    localStorage.removeItem(CURRENT_BATTLE_STORAGE_KEY);
    window.location.href = 'game.html';
}

/**
 * Handles the "Load Game" button click.
 */
function handleLoadGame() {
    if (!checkForSavedGames()) return;

    window.location.href = 'game.html';
}

/**
 * Handles the "Settings" button click.
 */
function handleSettings() {
    alert('Opening Settings menu...');
    // TODO: Implement settings overlay or page
}

/**
 * Checks if there are any saved games and updates the Load Game button state.
 */
function updateLoadButtonState() {
    const loadBtn = document.getElementById('btn-load-game');
    const hasSavedGames = checkForSavedGames();

    loadBtn.disabled = !hasSavedGames;
}

/**
 * Mock function to simulate checking for saved games.
 * @returns {boolean} True if saved games exist, false otherwise.
 */
function checkForSavedGames() {
    return Boolean(localStorage.getItem(CURRENT_BATTLE_STORAGE_KEY));
}
