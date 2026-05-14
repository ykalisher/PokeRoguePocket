/**
 * Squish - Game Board Logic
 */

document.addEventListener('DOMContentLoaded', () => {
    initGame();
});

function initGame() {
    const card = document.getElementById('game-card');
    const board = document.getElementById('game-board');
    const slots = document.querySelectorAll('.slot');

    let isDragging = false;
    let startX, startY;
    let currentX = 0;
    let currentY = 0;
    let hasMoved = false;

    // Initial position: Center of screen
    resetCardPosition();

    // Mouse Down: Start Dragging
    card.addEventListener('mousedown', (e) => {
        isDragging = true;
        hasMoved = false;
        
        // Calculate offset between mouse and card top-left
        const rect = card.getBoundingClientRect();
        startX = e.clientX - rect.left;
        startY = e.clientY - rect.top;
        
        card.style.transition = 'none'; // Disable transitions while dragging
    });

    // Mouse Move: Update Position
    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        
        hasMoved = true;
        
        // Calculate new position
        const x = e.clientX - startX;
        const y = e.clientY - startY;
        
        card.style.left = `${x}px`;
        card.style.top = `${y}px`;
        card.style.transform = 'none'; // Remove the centering transform during drag
    });

    // Mouse Up: Snap and Alert
    window.addEventListener('mouseup', () => {
        if (!isDragging) return;
        isDragging = false;

        checkSlotCollision(card, slots);
    });

    // Click: Return to center
    card.addEventListener('click', () => {
        // Only return to center if the user didn't just finish a drag
        if (!hasMoved) {
            resetCardPosition();
        }
        // Reset hasMoved for the next interaction
        hasMoved = false;
    });
}

/**
 * Resets the card to the center of the screen.
 */
function resetCardPosition() {
    const card = document.getElementById('game-card');
    card.style.transition = 'all 0.5s ease';
    card.style.left = '50%';
    card.style.top = '50%';
    card.style.transform = 'translate(-50%, -50%)';
}

/**
 * Checks if the card is within any slot and snaps it if it is.
 * @param {HTMLElement} card 
 * @param {NodeList} slots 
 */
function checkSlotCollision(card, slots) {
    const cardRect = card.getBoundingClientRect();
    const cardCenterX = cardRect.left + cardRect.width / 2;
    const cardCenterY = cardRect.top + cardRect.height / 2;

    let snapped = false;

    slots.forEach(slot => {
        const slotRect = slot.getBoundingClientRect();
        const slotCenterX = slotRect.left + slotRect.width / 2;
        const slotCenterY = slotRect.top + slotRect.height / 2;

        // Calculate distance between centers
        const distance = Math.sqrt(
            Math.pow(cardCenterX - slotCenterX, 2) + 
            Math.pow(cardCenterY - slotCenterY, 2)
        );

        // Snap threshold: if center is within 50px of slot center
        if (distance < 50) {
            snapToSlot(card, slot);
            alert(`You dropped the card in ${slot.getAttribute('data-name')}!`);
            snapped = true;
        }
    });

    if (!snapped) {
        // If not snapped, we keep the card where it is, but restore transition for future movements
        card.style.transition = 'all 0.5s ease';
    }
}

/**
 * Magnetically snaps the card to the center of the slot.
 * @param {HTMLElement} card 
 * @param {HTMLElement} slot 
 */
function snapToSlot(card, slot) {
    const slotRect = slot.getBoundingClientRect();
    
    card.style.transition = 'all 0.2s ease-out';
    card.style.left = `${slotRect.left + (slotRect.width - card.offsetWidth) / 2}px`;
    card.style.top = `${slotRect.top + (slotRect.height - card.offsetHeight) / 2}px`;
    card.style.transform = 'none';
}
