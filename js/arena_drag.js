/**
 * Squish - pointer drag/drop behavior for player hand cards
 *
 * Drag flow: game.js sends pointerdown/move/up/cancel here. This module creates
 * temporary drag state and visual affordances only; Controller owns every rule
 * decision. On pointerup, finishDrag() passes the semantic drop candidate to
 * Controller.handleCardDrop(), which routes it through the same battle flow as
 * clicks.
 */

(function attachArenaDrag(arena) {
    'use strict';

    const state = arena.state;

    /**
     * Starts tracking a possible drag from a hand card or the floating pending
     * attack card. Called directly by the board pointerdown listener in game.js.
     */
    function handlePointerDown(event) {
        if (event.button !== undefined && event.button !== 0) return;

        const pendingActionCard = event.target.closest('[data-pending-action-card-id]');

        if (pendingActionCard) {
            const cardId = pendingActionCard.dataset.pendingActionCardId;

            if (!arena.Controller.canDragPendingActionCard(cardId)) return;

            state.drag = createDragState(cardId, pendingActionCard, event);
            return;
        }

        const cardButton = event.target.closest('[data-card-id]');

        if (!cardButton || !arena.Controller.canPlayerSelectCard()) return;

        const cardId = cardButton.dataset.cardId;

        if (!arena.Model.playerHasCardInHand(cardId)) return;

        state.drag = createDragState(cardId, cardButton, event);
    }

    /**
     * Captures the initial pointer/card state before the movement threshold is
     * crossed and a visible drag begins.
     */
    function createDragState(cardId, sourceElement, event) {
        return {
            cardId,
            ghost: null,
            isDragging: false,
            offsetX: 0,
            offsetY: 0,
            pointerId: event.pointerId,
            sourceElement,
            startX: event.clientX,
            startY: event.clientY
        };
    }

    /**
     * Promotes a tracked pointer to a real drag after a small movement threshold,
     * then updates the ghost card and current drop highlight.
     */
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

    /**
     * Completes a drag by resolving the current drop candidate, or clears a
     * pointer that never crossed the drag threshold.
     */
    function handlePointerUp(event) {
        const drag = state.drag;

        if (!drag || drag.pointerId !== event.pointerId) return;

        if (drag.isDragging) {
            event.preventDefault();
            const candidate = getDropCandidate(event.clientX, event.clientY);

            state.suppressNextClick = true;
            setTimeout(() => {
                state.suppressNextClick = false;
            }, 0);
            finishDrag(candidate);
            return;
        }

        state.drag = null;
    }

    /**
     * Creates the visual drag ghost and asks the controller which board cards or
     * groups should be highlighted as legal actions.
     */
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

        showDragActionHighlights(drag.cardId);
        updateDragGhost(event.clientX, event.clientY);
    }

    function updateDragGhost(clientX, clientY) {
        if (!state.drag || !state.drag.ghost) return;

        state.drag.ghost.style.left = `${clientX - state.drag.offsetX}px`;
        state.drag.ghost.style.top = `${clientY - state.drag.offsetY}px`;
    }

    /**
     * Refreshes the active drop-target highlight under the pointer.
     */
    function updateDropHighlight(clientX, clientY) {
        clearDropHighlights();

        const candidate = getDropCandidate(clientX, clientY);

        if (candidate) {
            candidate.element.classList.add('is-drop-target');
        }
    }

    /**
     * Converts the element under the pointer into a semantic drop candidate by
     * asking Controller whether slots, board cards, or target groups are legal.
     */
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
            const boardOwner = boardCardElement.dataset.boardOwner;
            const boardCardId = boardCardElement.dataset.boardCardId;
            const dropAction = arena.Controller.getDropActionForBoardCard(drag.cardId, boardOwner, boardCardId);

            if (dropAction) {
                return { element: boardCardElement, ...dropAction };
            }
        }

        const groupElement = element.closest('[data-target-group-owner]');

        if (groupElement) {
            const dropAction = arena.Controller.getDropActionForTargetGroup(drag.cardId, groupElement.dataset.targetGroupOwner);

            if (dropAction) {
                return { element: groupElement, ...dropAction };
            }
        }

        return null;
    }

    /**
     * Clears drag UI and forwards the resolved candidate to the controller so it
     * can place Pokemon, choose attack users, target actions, or use items.
     */
    function finishDrag(candidate) {
        const draggedCardId = state.drag.cardId;

        cleanupDrag();

        if (!candidate) return;

        arena.Controller.handleCardDrop(draggedCardId, candidate);
    }

    /**
     * External cancel entry point for pointercancel or mismatched pointer cleanup.
     */
    function cancelDrag(event) {
        if (event && state.drag && event.pointerId !== state.drag.pointerId) return;

        cleanupDrag();
    }

    /**
     * Removes all transient drag DOM/classes and clears state.drag.
     */
    function cleanupDrag() {
        clearDropHighlights();
        clearDragActionHighlights();

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

    /**
     * Highlights every legal board-card or group action for the card currently
     * being dragged, based entirely on Controller drop checks.
     */
    function showDragActionHighlights(cardId) {
        document.querySelectorAll('[data-board-card-id]').forEach(element => {
            const dropAction = arena.Controller.getDropActionForBoardCard(
                cardId,
                element.dataset.boardOwner,
                element.dataset.boardCardId
            );

            if (!dropAction) return;

            element.classList.add('is-drag-action-preview');

            if (dropAction.kind === 'attack-user') {
                element.classList.add('is-user-option');
            } else if (dropAction.kind === 'target-card' || dropAction.kind === 'target-group') {
                element.classList.add('is-action-target');
            }
        });

        ['player', 'opponent'].forEach(owner => {
            const dropAction = arena.Controller.getDropActionForTargetGroup(cardId, owner);

            if (!dropAction) return;

            const groupElement = document.querySelector(`.side-panel--${owner} .played-slots`);

            if (!groupElement) return;

            if (!groupElement.classList.contains('is-group-target')) {
                groupElement.classList.add('is-group-target');
                groupElement.dataset.dragAddedGroupTarget = 'true';
            }

            groupElement.classList.add('is-drag-group-preview');

            if (!groupElement.dataset.targetGroupOwner) {
                groupElement.dataset.targetGroupOwner = owner;
                groupElement.dataset.dragAddedGroupOwner = 'true';
            }
        });
    }

    /**
     * Removes drag-only action highlights and any temporary group-target data
     * attributes added by showDragActionHighlights().
     */
    function clearDragActionHighlights() {
        document.querySelectorAll('.is-drag-action-preview').forEach(element => {
            element.classList.remove('is-drag-action-preview', 'is-user-option', 'is-action-target');
        });

        document.querySelectorAll('.is-drag-group-preview').forEach(element => {
            element.classList.remove('is-drag-group-preview');

            if (element.dataset.dragAddedGroupTarget === 'true') {
                element.classList.remove('is-group-target');
                element.removeAttribute('data-drag-added-group-target');
            }

            if (element.dataset.dragAddedGroupOwner === 'true') {
                element.removeAttribute('data-target-group-owner');
                element.removeAttribute('data-drag-added-group-owner');
            }
        });
    }

    arena.Drag = {
        cancelDrag,
        handlePointerDown,
        handlePointerMove,
        handlePointerUp
    };
})(window.CardArena = window.CardArena || {});
