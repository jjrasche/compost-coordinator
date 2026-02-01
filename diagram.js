/**
 * Compost Coordinator - Diagram Rendering
 *
 * SVG rendering for nodes and edges with animations
 */

import config from './config.js';

// ============================================
// Layout Calculations
// ============================================

/**
 * Get absolute position from relative config position
 */
function getAbsolutePosition(relPos, containerWidth, containerHeight) {
    const padding = config.layout.padding;
    const usableWidth = containerWidth - (padding * 2);
    const usableHeight = containerHeight - (padding * 2);

    return {
        x: padding + (relPos.x * usableWidth),
        y: padding + (relPos.y * usableHeight)
    };
}

/**
 * Get edge connection point on node perimeter
 */
function getEdgeConnectionPoint(nodePos, targetPos, nodeWidth, nodeHeight) {
    const dx = targetPos.x - nodePos.x;
    const dy = targetPos.y - nodePos.y;
    const angle = Math.atan2(dy, dx);

    // Calculate intersection with rectangle
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
 * Generate bezier curve path between two points
 */
function generateBezierPath(start, end, curvature = 0.3) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;

    // Control points
    const cx1 = start.x + dx * curvature;
    const cy1 = start.y;
    const cx2 = end.x - dx * curvature;
    const cy2 = end.y;

    return `M ${start.x} ${start.y} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${end.x} ${end.y}`;
}

// ============================================
// Node Rendering
// ============================================

/**
 * Render all nodes
 */
export function renderNodes(svg, state) {
    const nodesLayer = svg.querySelector('#nodes-layer');
    const rect = svg.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    nodesLayer.innerHTML = '';

    const nodeWidth = config.layout.nodeWidth;
    const nodeHeight = config.layout.nodeHeight;

    Object.values(config.nodes).forEach(node => {
        const pos = getAbsolutePosition(node.position, width, height);

        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.classList.add('node', `category-${node.category}`);
        g.setAttribute('data-node-id', node.id);
        g.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);

        // Node rectangle
        const nodeRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        nodeRect.classList.add('node-rect');
        nodeRect.setAttribute('x', -nodeWidth / 2);
        nodeRect.setAttribute('y', -nodeHeight / 2);
        nodeRect.setAttribute('width', nodeWidth);
        nodeRect.setAttribute('height', nodeHeight);
        g.appendChild(nodeRect);

        // Icon
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        icon.classList.add('node-icon');
        icon.setAttribute('y', -8);
        icon.textContent = node.icon;
        g.appendChild(icon);

        // Label
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.classList.add('node-label');
        label.setAttribute('y', 18);
        label.textContent = node.label;
        g.appendChild(label);

        // Metric (key number from state)
        const metric = getNodeMetric(node, state);
        if (metric) {
            const metricText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            metricText.classList.add('node-metric');
            metricText.setAttribute('y', 32);
            metricText.textContent = metric;
            g.appendChild(metricText);
        }

        nodesLayer.appendChild(g);
    });
}

/**
 * Get the key metric to display on a node
 */
function getNodeMetric(node, state) {
    if (!state) return null;

    switch (node.id) {
        case 'households':
            return `${state.inputs?.households || 15} homes`;
        case 'collection':
            return `${state.labor?.collection?.toFixed(1) || 16} hr/mo`;
        case 'cardboard':
            return `${state.labor?.cardboard?.toFixed(1) || 10} hr/mo`;
        case 'stage1':
        case 'stage2':
        case 'stage3':
            return '3-4 weeks';
        case 'stage4':
            return `${state.outputs?.finishedCompostPerMonth?.toFixed(0) || 200} gal/mo`;
        case 'tea':
            return `${state.outputs?.wormTeaConcentrate?.toFixed(0) || 20} gal/mo`;
        case 'delivery':
            return `${state.labor?.delivery?.toFixed(1) || 6} hr/mo`;
        case 'customers':
            return `$${state.revenue?.total?.toLocaleString() || '4,375'}/mo`;
        default:
            return null;
    }
}

// ============================================
// Edge Rendering
// ============================================

/**
 * Render all edges
 */
export function renderEdges(svg) {
    const edgesLayer = svg.querySelector('#edges-layer');
    const rect = svg.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    edgesLayer.innerHTML = '';

    const nodeWidth = config.layout.nodeWidth;
    const nodeHeight = config.layout.nodeHeight;

    config.edges.forEach(edge => {
        const fromNode = config.nodes[edge.from];
        const toNode = config.nodes[edge.to];

        if (!fromNode || !toNode) return;

        const fromPos = getAbsolutePosition(fromNode.position, width, height);
        const toPos = getAbsolutePosition(toNode.position, width, height);

        // Get connection points on node edges
        const start = getEdgeConnectionPoint(fromPos, toPos, nodeWidth, nodeHeight);
        const end = getEdgeConnectionPoint(toPos, fromPos, nodeWidth, nodeHeight);

        // Create path
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.classList.add('edge', 'animated');
        path.setAttribute('id', `edge-${edge.id}`);
        path.setAttribute('d', generateBezierPath(start, end, config.layout.edgeCurve));
        path.setAttribute('stroke', edge.color);
        edgesLayer.appendChild(path);

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
            edgesLayer.appendChild(label);
        }
    });
}

// ============================================
// Animated Icons
// ============================================

/**
 * Create animated icons flowing along edges
 */
export function renderFlowIcons(svg) {
    const iconsLayer = svg.querySelector('#icons-layer');
    const rect = svg.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    iconsLayer.innerHTML = '';

    const nodeWidth = config.layout.nodeWidth;
    const nodeHeight = config.layout.nodeHeight;

    config.edges.forEach((edge, index) => {
        const fromNode = config.nodes[edge.from];
        const toNode = config.nodes[edge.to];

        if (!fromNode || !toNode) return;

        const fromPos = getAbsolutePosition(fromNode.position, width, height);
        const toPos = getAbsolutePosition(toNode.position, width, height);

        const start = getEdgeConnectionPoint(fromPos, toPos, nodeWidth, nodeHeight);
        const end = getEdgeConnectionPoint(toPos, fromPos, nodeWidth, nodeHeight);

        // Create icon that follows the path
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        icon.classList.add('flow-icon');
        icon.textContent = edge.icon;
        icon.style.offsetPath = `path('${generateBezierPath(start, end, config.layout.edgeCurve)}')`;
        icon.style.animationDelay = `${index * 0.3}s`;

        iconsLayer.appendChild(icon);
    });
}

// ============================================
// Full Render
// ============================================

/**
 * Render complete diagram
 */
export function renderDiagram(svg, state) {
    renderEdges(svg);
    renderNodes(svg, state);
    renderFlowIcons(svg);
}

/**
 * Update node metrics without full re-render
 */
export function updateMetrics(svg, state) {
    const nodes = svg.querySelectorAll('.node');

    nodes.forEach(nodeEl => {
        const nodeId = nodeEl.getAttribute('data-node-id');
        const node = config.nodes[nodeId];
        const metric = getNodeMetric(node, state);

        const metricText = nodeEl.querySelector('.node-metric');
        if (metricText && metric) {
            metricText.textContent = metric;
        }
    });
}
