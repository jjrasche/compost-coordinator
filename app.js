/**
 * Compost Coordinator - Main Application
 *
 * Drag-and-drop diagram with static model
 */

import config from './config.js';
import * as calc from './calculator.js';
import { renderDiagram, renderEdges, saveNodePosition, updateNodePosition } from './diagram.js';

// ============================================
// Design Mode State
// ============================================

let designMode = false;

// ============================================
// Drag State
// ============================================

const DRAG_THRESHOLD = 5; // pixels

let dragState = {
    active: false,
    nodeId: null,
    nodeElement: null,
    startX: 0,
    startY: 0,
    startClientX: 0,
    startClientY: 0,
    containerRect: null
};

// ============================================
// Initialize
// ============================================

function init() {
    // Initial render
    renderDiagram();

    // Set up event listeners
    setupDragListeners();
    setupDesignModeToggle();
    setupDetailPanelListeners();

    // Re-render on resize
    window.addEventListener('resize', () => {
        renderDiagram();
    });
}

// ============================================
// Design Mode Toggle
// ============================================

function setupDesignModeToggle() {
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'd') {
            e.preventDefault();
            designMode = !designMode;

            const indicator = document.getElementById('design-mode-indicator');
            indicator.classList.toggle('hidden', !designMode);

            // Update cursor style
            document.body.style.cursor = designMode ? 'move' : 'default';
        }
    });
}

// ============================================
// Drag-and-Drop Functionality
// ============================================

function setupDragListeners() {
    const nodesLayer = document.getElementById('nodes-layer');

    // Use event delegation
    nodesLayer.addEventListener('mousedown', onMouseDown);
    nodesLayer.addEventListener('touchstart', onTouchStart, { passive: false });

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('touchmove', onTouchMove, { passive: true });

    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('touchend', onTouchEnd);
}

function onMouseDown(e) {
    const nodeEl = e.target.closest('.node');
    if (!nodeEl) return;

    // Track click start for both modes
    dragState.startClientX = e.clientX;
    dragState.startClientY = e.clientY;
    dragState.nodeId = nodeEl.getAttribute('data-node-id');
    dragState.nodeElement = nodeEl;

    // Only prevent default and start drag if in design mode
    if (designMode) {
        e.preventDefault();
        const container = document.querySelector('.diagram-container');
        const rect = container.getBoundingClientRect();

        dragState.active = true;
        dragState.startX = e.clientX;
        dragState.startY = e.clientY;
        dragState.containerRect = rect;

        nodeEl.classList.add('dragging');
        nodeEl.style.zIndex = '100';
    }
}

function onTouchStart(e) {
    const nodeEl = e.target.closest('.node');
    if (!nodeEl) return;

    const touch = e.touches[0];

    // Track click start for both modes
    dragState.startClientX = touch.clientX;
    dragState.startClientY = touch.clientY;
    dragState.nodeId = nodeEl.getAttribute('data-node-id');
    dragState.nodeElement = nodeEl;

    // Only prevent default and start drag if in design mode
    if (designMode) {
        e.preventDefault();
        const container = document.querySelector('.diagram-container');
        const rect = container.getBoundingClientRect();

        dragState.active = true;
        dragState.startX = touch.clientX;
        dragState.startY = touch.clientY;
        dragState.containerRect = rect;

        nodeEl.classList.add('dragging');
        nodeEl.style.zIndex = '100';
    }
}


function onMouseMove(e) {
    if (!dragState.active) return;
    e.preventDefault();
    updateDrag(e.clientX, e.clientY);
}

function onTouchMove(e) {
    if (!dragState.active) return;
    const touch = e.touches[0];
    updateDrag(touch.clientX, touch.clientY);
}

function updateDrag(clientX, clientY) {
    const rect = dragState.containerRect;

    // Calculate percentage position (0-1)
    let x = (clientX - rect.left) / rect.width;
    let y = (clientY - rect.top) / rect.height;

    // Snap to 0.01 granularity
    x = Math.round(x * 100) / 100;
    y = Math.round(y * 100) / 100;

    // Clamp to keep nodes within bounds
    x = Math.max(0.05, Math.min(0.95, x));
    y = Math.max(0.05, Math.min(0.95, y));

    // Update node position
    updateNodePosition(dragState.nodeId, x, y);

    // Save to localStorage
    saveNodePosition(dragState.nodeId, x, y);

    // Re-render edges
    renderEdges();
}

function onMouseUp(e) {
    if (!dragState.nodeId) return; // Only skip if no node was clicked
    endDrag(e.clientX, e.clientY);
}

function onTouchEnd(e) {
    if (!dragState.nodeId) return; // Only skip if no node was clicked
    const touch = e.changedTouches[0];
    endDrag(touch.clientX, touch.clientY);
}

function endDrag(clientX, clientY) {
    const nodeEl = dragState.nodeElement;
    if (!nodeEl) return;

    // Calculate distance moved
    const dx = clientX - dragState.startClientX;
    const dy = clientY - dragState.startClientY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // If minimal movement, treat as click (works in both modes)
    if (distance < DRAG_THRESHOLD) {
        showNodeDetail(dragState.nodeId);
    }

    // Clean up drag state (only relevant if in design mode)
    if (dragState.active) {
        nodeEl.classList.remove('dragging');
        nodeEl.style.zIndex = '10';

        setTimeout(() => {
            dragState.active = false;
        }, 100);
    }

    // Reset tracking
    dragState.nodeElement = null;
    dragState.nodeId = null;
}

// ============================================
// Node Detail Panel
// ============================================

function showNodeDetail(nodeId) {
    const node = config.nodes[nodeId];
    if (!node) return;

    const panel = document.getElementById('node-detail');
    const tasks = calc.getTaskBreakdown(nodeId, 15); // Static 15 households

    // Populate panel
    document.getElementById('detail-icon').textContent = node.icon;
    document.getElementById('detail-title').textContent = node.label;
    document.getElementById('detail-description').textContent = node.description;

    // Render tasks
    const tasksContainer = document.getElementById('detail-tasks');
    tasksContainer.innerHTML = '';

    if (tasks.length > 0) {
        tasks.forEach(task => {
            const row = document.createElement('div');
            row.className = 'detail-task';
            row.innerHTML = `
                <span class="detail-task-name">${task.name}</span>
                <span class="detail-task-time">${task.hoursPerMonth.toFixed(2)} hr/mo</span>
            `;
            tasksContainer.appendChild(row);
        });

        // Total
        const total = tasks.reduce((sum, t) => sum + t.hoursPerMonth, 0);
        document.getElementById('detail-total').innerHTML = `
            <span>Total</span>
            <span>${total.toFixed(1)} hr/mo</span>
        `;
        document.getElementById('detail-total').style.display = 'flex';
    } else {
        document.getElementById('detail-total').style.display = 'none';
    }

    // Show panel
    panel.classList.remove('hidden');
}

function setupDetailPanelListeners() {
    const closeBtn = document.getElementById('close-detail');
    const panel = document.getElementById('node-detail');

    closeBtn.addEventListener('click', () => {
        panel.classList.add('hidden');
    });

    // Close on click outside
    document.addEventListener('click', (e) => {
        if (!panel.contains(e.target) && !e.target.closest('.node') && !dragState.active) {
            panel.classList.add('hidden');
        }
    });

    // Close on escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            panel.classList.add('hidden');
        }
    });
}

// ============================================
// Start
// ============================================

document.addEventListener('DOMContentLoaded', init);
