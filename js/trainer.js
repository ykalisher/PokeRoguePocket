/**
 * Represents an NPC Trainer in the game.
 */
class Trainer {
    /**
     * @param {string} name - The name of the trainer.
     * @param {Pokemon[]} pokemon - A list of Pokemon instances belonging to the trainer.
     * @param {Array} actionDeck - A list of items or attacks available to the trainer.
     * @param {string} imageFilePath - The file path to the trainer's image.
     * @param {int} cash - Cash trainer pays out on loss
     */
    constructor(name, pokemon, actionDeck, imageFilePath, cash) {
        this.name = name;
        this.pokemon = pokemon;
        this.actionDeck = actionDeck;
        this.imageFilePath = imageFilePath;
        this.cash = cash;
    }
}
