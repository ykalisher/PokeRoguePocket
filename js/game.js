/**
 * Squish - Card Arena Prototype
 */

(function bootCardArena(arena) {
    'use strict';

    document.addEventListener('DOMContentLoaded', initGame);

    function initGame() {
        const state = arena.state;

        state.elements.board = document.getElementById('game-board');
        state.elements.popup = document.getElementById('arena-popup');
        state.elements.board.addEventListener('click', arena.Controller.handleArenaClick);
        state.elements.board.addEventListener('pointerdown', arena.Drag.handlePointerDown);
        window.addEventListener('pointermove', arena.Drag.handlePointerMove);
        window.addEventListener('pointerup', arena.Drag.handlePointerUp);
        window.addEventListener('pointercancel', arena.Drag.cancelDrag);

        arena.Controller.resetPrototype();
    }
})(window.CardArena = window.CardArena || {});
