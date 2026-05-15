/**
 * Squish - pointer drag/drop behavior for player hand cards
 */

(function attachArenaDrag(arena) {
    'use strict';

    const state = arena.state;

    function handlePointerDown(event) {
        if (event.button !== undefined && event.button !== 0) return;

        const cardButton = event.target.closest('[data-card-id]');

        if (!cardButton || !arena.Controller.canPlayerSelectCard()) return;

        const cardId = cardButton.dataset.cardId;

        if (!arena.Model.playerHasCardInHand(cardId)) return;

        state.drag = {
            cardId,
            ghost: null,
            isDragging: false,
            offsetX: 0,
            offsetY: 0,
            pointerId: event.pointerId,
            sourceElement: cardButton,
            startX: event.clientX,
            startY: event.clientY
        };
    }

    function handlePointerMove(event) {
        const drag = state.drag;

        if (!drag || drag.pointerId !== event.pointerId) return;

        const deltaX = event.clientX - drag.startX;
        const deltaY = event.clientY - drag.startY;
        const distance = Math.hypot(deltaX, deltaY);

        if (!drag.isDragging && distance < 8) return;

        if (!drag.isDragging) {
            startCardDrag(event);
        }

        event.preventDefault();
        updateDragGhost(event.clientX, event.clientY);
        updateDropHighlight(event.clientX, event.clientY);
    }

    function handlePointerUp(event) {
        const drag = state.drag;

        if (!drag || drag.pointerId !== event.pointerId) return;

        if (drag.isDragging) {
            event.preventDefault();
            const candidate = getDropCandidate(event.clientX, event.clientY);
            state.suppressNextClick = true;
            finishDrag(candidate);
            return;
        }

        state.drag = null;
    }

    function startCardDrag(event) {
        const drag = state.drag;
        const rect = drag.sourceElement.getBoundingClientRect();
        const ghost = drag.sourceElement.cloneNode(true);

        drag.isDragging = true;
        drag.offsetX = event.clientX - rect.left;
        drag.offsetY = event.clientY - rect.top;
        drag.ghost = ghost;
        drag.sourceElement.classList.add('is-source-dragging');

        ghost.classList.add('drag-ghost');
        ghost.style.width = `${rect.width}px`;
        ghost.style.height = `${rect.height}px`;
        document.body.appendChild(ghost);

        updateDragGhost(event.clientX, event.clientY);
    }

    function updateDragGhost(clientX, clientY) {
        if (!state.drag || !state.drag.ghost) return;

        state.drag.ghost.style.left = `${clientX - state.drag.offsetX}px`;
        state.drag.ghost.style.top = `${clientY - state.drag.offsetY}px`;
    }

    function updateDropHighlight(clientX, clientY) {
        clearDropHighlights();

        const candidate = getDropCandidate(clientX, clientY);

        if (candidate) {
            candidate.element.classList.add('is-drop-target');
        }
    }

    function getDropCandidate(clientX, clientY) {
        const drag = state.drag;
        const element = document.elementFromPoint(clientX, clientY);

        if (!drag || !element) return null;

        const slotElement = element.closest('[data-slot-owner]');

        if (slotElement) {
            const slotIndex = Number(slotElement.dataset.slotIndex);
            const slotOwner = slotElement.dataset.slotOwner;

            if (arena.Controller.canDropCardOnSlot(drag.cardId, slotOwner, slotIndex)) {
                return { element: slotElement, kind: 'slot', slotIndex };
            }
        }

        const boardCardElement = element.closest('[data-board-card-id]');

        if (boardCardElement) {
            const targetCardId = boardCardElement.dataset.boardCardId;

            if (arena.Controller.canDropCardOnOpponentCard(drag.cardId, targetCardId)) {
                return { element: boardCardElement, kind: 'target', targetCardId };
            }
        }

        return null;
    }

    function finishDrag(candidate) {
        const draggedCardId = state.drag.cardId;

        cleanupDrag();

        if (!candidate) return;

        if (candidate.kind === 'slot') {
            state.selectedCardId = draggedCardId;

            if (state.phase === 'opening-place') {
                arena.Controller.placeSelectedOpeningCard();
            } else {
                arena.Controller.placeSelectedCard();
            }
        } else if (candidate.kind === 'target') {
            arena.Controller.attackWithDraggedCard(draggedCardId, candidate.targetCardId);
        }
    }

    function cancelDrag(event) {
        if (event && state.drag && event.pointerId !== state.drag.pointerId) return;

        cleanupDrag();
    }

    function cleanupDrag() {
        clearDropHighlights();

        if (state.drag && state.drag.ghost) {
            state.drag.ghost.remove();
        }

        if (state.drag && state.drag.sourceElement) {
            state.drag.sourceElement.classList.remove('is-source-dragging');
        }

        state.drag = null;
    }

    function clearDropHighlights() {
        document.querySelectorAll('.is-drop-target').forEach(element => {
            element.classList.remove('is-drop-target');
        });
    }

    arena.Drag = {
        cancelDrag,
        handlePointerDown,
        handlePointerMove,
        handlePointerUp
    };
})(window.CardArena = window.CardArena || {});
