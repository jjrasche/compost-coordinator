/**
 * Compost Coordinator - Diagram Rendering
 *
 * HTML node rendering + SVG edges with drag-and-drop
 */

import config from './config.js';

const STORAGE_KEY = 'compost-positions';

// ============================================
// Position Management (localStorage)
// ============================================

/**
 * Get saved positions from localStorage
 */
function getSavedPositions() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        return saved ? JSON.parse(saved) : {};
    } catch (e) {
        console.warn('Failed to load saved positions:', e);
        return {};
    }
}

/**
 * Save node position to localStorage
 */
export function saveNodePosition(nodeId, x, y) {
    try {
        const positions = getSavedPositions();
        positions[nodeId] = { x, y };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
    } catch (e) {
        console.warn('Failed to save position:', e);
    }
}

/**
 * Get node position (saved override or config default)
 */
export function getNodePosition(nodeId) {
    const saved = getSavedPositions();
    if (saved[nodeId]) {
        return saved[nodeId];
    }
    return config.nodes[nodeId]?.position || { x: 0.5, y: 0.5 };
}

/**
 * Export current positions as JSON (for copying to config.js)
 */
export function exportPositions() {
    const positions = getSavedPositions();
    console.log('Current node positions:');
    console.log(JSON.stringify(positions, null, 2));
    return positions;
}

// Make exportPositions available globally for console use
window.exportPositions = exportPositions;

// ============================================
// Node Rendering (HTML divs)
// ============================================

/**
 * Render all nodes as HTML divs
 */
export function renderNodes() {
    const nodesLayer = document.getElementById('nodes-layer');
    const container = document.querySelector('.diagram-container');
    const rect = container.getBoundingClientRect();

    nodesLayer.innerHTML = '';

    Object.values(config.nodes).forEach(node => {
        const position = getNodePosition(node.id);

        const nodeEl = document.createElement('div');
        nodeEl.classList.add('node', `category-${node.category}`);
        nodeEl.setAttribute('data-node-id', node.id);
        nodeEl.style.left = `${position.x * 100}%`;
        nodeEl.style.top = `${position.y * 100}%`;

        // Icon
        const icon = document.createElement('div');
        icon.classList.add('node-icon');
        icon.textContent = node.icon;
        nodeEl.appendChild(icon);

        // Label
        const label = document.createElement('div');
        label.classList.add('node-label');
        label.textContent = node.label;
        nodeEl.appendChild(label);

        // Metric (static values)
        const metric = getNodeMetric(node.id);
        if (metric) {
            const metricEl = document.createElement('div');
            metricEl.classList.add('node-metric');
            metricEl.textContent = metric;
            nodeEl.appendChild(metricEl);
        }

        nodesLayer.appendChild(nodeEl);
    });
}

/**
 * Get static metric for a node (hard-coded values)
 */
function getNodeMetric(nodeId) {
    const metrics = {
        households: '15 homes',
        collection: '16 hr/mo',
        cardboard: '10 hr/mo',
        foodWasteProcessing: '3 hr/mo',
        stage1: '3-4 weeks',
        stage2: '3-4 weeks',
        stage3: '3-4 weeks',
        stage4: '200 gal/mo',
        tea: '20 gal/mo',
        delivery: '6 hr/mo',
        purchasers: '$4,375/mo'
    };
    return metrics[nodeId] || null;
}

/**
 * Update single node position (called during drag)
 */
export function updateNodePosition(nodeId, x, y) {
    const nodeEl = document.querySelector(`[data-node-id="${nodeId}"]`);
    if (nodeEl) {
        nodeEl.style.left = `${x * 100}%`;
        nodeEl.style.top = `${y * 100}%`;
    }
}

// ============================================
// Edge Rendering (SVG)
// ============================================

/**
 * Get absolute pixel position from percentage
 */
function getAbsolutePosition(relPos, containerWidth, containerHeight) {
    return {
        x: relPos.x * containerWidth,
        y: relPos.y * containerHeight
    };
}

/**
 * Get edge connection point on node perimeter
 */
function getEdgeConnectionPoint(nodePos, targetPos, nodeWidth, nodeHeight) {
    const dx = targetPos.x - nodePos.x;
    const dy = targetPos.y - nodePos.y;
    const angle = Math.atan2(dy, dx);

    const halfWidth = nodeWidth / 2;
    const halfHeight = nodeHeight / 2;

    let x, y;

    if (Math.abs(Math.cos(angle)) * halfHeight > Math.abs(Math.sin(angle)) * halfWidth) {
        // Intersects left or right edge
        x = nodePos.x + Math.sign(dx) * halfWidth;
        y = nodePos.y + Math.tan(angle) * Math.sign(dx) * halfWidth;
    } else {
        // Intersects top or bottom edge
        x = nodePos.x + (1 / Math.tan(angle)) * Math.sign(dy) * halfHeight;
        y = nodePos.y + Math.sign(dy) * halfHeight;
    }

    return { x, y };
}

/**
 * Generate bezier curve path
 */
function generateBezierPath(start, end, curvature = 0.3) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;

    const cx1 = start.x + dx * curvature;
    const cy1 = start.y;
    const cx2 = end.x - dx * curvature;
    const cy2 = end.y;

    return `M ${start.x} ${start.y} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${end.x} ${end.y}`;
}

/**
 * Render all edges as SVG paths
 */
export function renderEdges() {
    const svg = document.getElementById('edges-layer');
    const container = document.querySelector('.diagram-container');
    const rect = container.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    svg.innerHTML = '';

    const nodeWidth = 120;
    const nodeHeight = 60;

    config.edges.forEach(edge => {
        const fromNode = config.nodes[edge.from];
        const toNode = config.nodes[edge.to];

        if (!fromNode || !toNode) return;

        const fromRelPos = getNodePosition(edge.from);
        const toRelPos = getNodePosition(edge.to);

        const fromPos = getAbsolutePosition(fromRelPos, width, height);
        const toPos = getAbsolutePosition(toRelPos, width, height);

        const start = getEdgeConnectionPoint(fromPos, toPos, nodeWidth, nodeHeight);
        const end = getEdgeConnectionPoint(toPos, fromPos, nodeWidth, nodeHeight);

        // Create path
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.classList.add('edge', 'animated');
        path.setAttribute('id', `edge-${edge.id}`);
        path.setAttribute('d', generateBezierPath(start, end, config.layout.edgeCurve));
        path.setAttribute('stroke', edge.color);
        svg.appendChild(path);

        // Add label if present
        if (edge.label) {
            const midX = (start.x + end.x) / 2;
            const midY = (start.y + end.y) / 2 - 10;

            const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            label.classList.add('edge-label');
            label.setAttribute('x', midX);
            label.setAttribute('y', midY);
            label.setAttribute('text-anchor', 'middle');
            label.textContent = edge.label;
            svg.appendChild(label);
        }
    });
}

// ============================================
// Full Render
// ============================================

/**
 * Render complete diagram (nodes + edges)
 */
export function renderDiagram() {
    renderNodes();
    renderEdges();
}
