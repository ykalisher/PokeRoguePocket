/**
 * Squish - Main Menu Logic
 */

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
    // Redirect to the game board page
    window.location.href = 'game.html';
}

/**
 * Handles the "Load Game" button click.
 */
function handleLoadGame() {
    alert('Loading your saved game...');
    // TODO: Implement logic to retrieve saved game state from storage
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
    
    // TODO: Replace this with actual check for saved games in localStorage or database
    const hasSavedGames = checkForSavedGames();

    if (!hasSavedGames) {
        loadBtn.disabled = true;
    } else {
        loadBtn.disabled = false;
    }
}

/**
 * Mock function to simulate checking for saved games.
 * @returns {boolean} True if saved games exist, false otherwise.
 */
function checkForSavedGames() {
    // Currently returning false to demonstrate the inactive state
    return false;
}
