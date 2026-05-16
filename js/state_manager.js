/**
 * StateManager handles the loading of game data from external JSON files
 * and local storage.
 */
const StateManager = {
    /**
     * Loads the Pokemon species data from the data folder.
     * @returns {Promise<Pokemon[]>}
     */
    async load_pokemon() {
        try {
            const response = await fetch('pokemon.json');
            if (!response.ok) throw new Error(`Failed to load Pokemon.json: ${response.statusText}`);
            return await response.json();
        } catch (error) {
            console.error("Error loading pokemon data:", error);
            return [];
        }
    },

    /**
     * Loads the item data from the data folder.
     * @returns {Promise<Item[]>}
     */
    async load_items() {
        try {
            const response = await fetch('items.json');
            if (!response.ok) throw new Error(`Failed to load Items.json: ${response.statusText}`);
            return await response.json();
        } catch (error) {
            console.error("Error loading items data:", error);
            return [];
        }
    },

    /**
     * Loads the attack data from the data folder.
     * @returns {Promise<Attack[]>}
     */
    async load_attacks() {
        try {
            const response = await fetch('attacks.json');
            if (!response.ok) throw new Error(`Failed to load Attacks.json: ${response.statusText}`);
            return await response.json();
        } catch (error) {
            console.error("Error loading attacks data:", error);
            return [];
        }
    },

    /**
     * Loads a specific bag from localStorage using the provided ID.
     * @param {string} id - The ID of the bag to load.
     * @returns {Bag|null} The parsed bag data or null if not found.
     */
    load_bag(id) {
        try {
            const key = `bag_${id}`;
            const data = localStorage.getItem(key);
            if (!data) {
                console.warn(`No bag found in localStorage with ID: ${id}`);
                return null;
            }
            return JSON.parse(data);
        } catch (error) {
            console.error(`Error loading bag ${id} from localStorage:`, error);
            return null;
        }
    }
};

// Export to window to ensure functions are callable by the website
window.StateManager = StateManager;
