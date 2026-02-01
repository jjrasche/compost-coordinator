/**
 * Compost Coordinator - Main Application
 *
 * Event handling, state management, and UI updates
 */

import config from './config.js';
import * as calc from './calculator.js';
import { renderDiagram, updateMetrics } from './diagram.js';

// ============================================
// State
// ============================================

let state = {
    inputs: { ...config.defaults },
    // Computed values filled by updateState()
};

// ============================================
// Initialize
// ============================================

function init() {
    // Initial calculation
    updateState();

    // Set up event listeners
    setupInputListeners();
    setupNodeClickListeners();
    setupDetailPanelListeners();

    // Render capital costs
    renderCapitalCosts();

    // Initial render
    const svg = document.getElementById('diagram');
    renderDiagram(svg, state);

    // Re-render on resize
    window.addEventListener('resize', () => {
        renderDiagram(svg, state);
    });
}

// ============================================
// State Management
// ============================================

function updateState() {
    const model = calc.calculateFullModel({
        households: state.inputs.households,
        compostPrice: state.inputs.compostPrice,
        teaPrice: state.inputs.teaPrice,
        subscriptionPrice: state.inputs.subscriptionPrice,
        givebackPerYear: state.inputs.givebackPerYear
    });

    state = {
        inputs: state.inputs,
        ...model
    };

    updateUI();
}

// ============================================
// UI Updates
// ============================================

function updateUI() {
    // Header stats
    document.getElementById('stat-revenue').textContent = `$${state.revenue.total.toLocaleString()}`;
    document.getElementById('stat-hours').textContent = state.labor.total.toFixed(1);
    document.getElementById('stat-hourly').textContent = `$${Math.round(state.hourlyRate)}`;

    // Input values
    document.getElementById('value-households').textContent = state.inputs.households;
    document.getElementById('value-compost-price').textContent = state.inputs.compostPrice;
    document.getElementById('value-tea-price').textContent = state.inputs.teaPrice;
    document.getElementById('value-subscription-price').textContent = state.inputs.subscriptionPrice;
    document.getElementById('value-giveback').textContent = state.inputs.givebackPerYear;

    // Outputs - Inputs
    document.getElementById('output-cardboard').textContent = `${state.inputs.cardboardPerMonth} gal`;
    document.getElementById('output-food').textContent = `${state.inputs.foodWastePerMonth} gal`;

    // Outputs - Products
    document.getElementById('output-compost').textContent = `${state.outputs.finishedCompostPerMonth.toFixed(0)} gal`;
    const givebackPerMonth = (state.inputs.households * state.inputs.givebackPerYear / 12);
    document.getElementById('output-giveback').textContent = `-${givebackPerMonth.toFixed(1)} gal`;
    document.getElementById('output-sellable').textContent = `${state.outputs.sellableCompost.toFixed(1)} gal`;
    document.getElementById('output-tea').textContent = `${state.outputs.wormTeaConcentrate.toFixed(0)} gal`;

    // Revenue
    document.getElementById('revenue-subscriptions').textContent = `$${state.revenue.subscriptions.toLocaleString()}`;
    document.getElementById('revenue-compost').textContent = `$${state.revenue.compost.toLocaleString()}`;
    document.getElementById('revenue-tea').textContent = `$${state.revenue.tea.toLocaleString()}`;
    document.getElementById('revenue-total').textContent = `$${state.revenue.total.toLocaleString()}`;

    // Labor
    document.getElementById('labor-collection').textContent = `${state.labor.collection.toFixed(1)} hr`;
    document.getElementById('labor-cardboard').textContent = `${state.labor.cardboard.toFixed(1)} hr`;
    document.getElementById('labor-composting').textContent = `${state.labor.composting.toFixed(1)} hr`;
    document.getElementById('labor-tea').textContent = `${state.labor.tea.toFixed(1)} hr`;
    document.getElementById('labor-delivery').textContent = `${state.labor.delivery.toFixed(1)} hr`;
    document.getElementById('labor-total').textContent = `${state.labor.total.toFixed(1)} hr`;

    // Annual
    const annualRevenue = (state.revenue.total * 9) + (state.revenue.subscriptions * 3);
    const annualHours = (state.labor.total * 9) + (state.labor.collection * 3);
    const annualRate = annualHours > 0 ? annualRevenue / annualHours : 0;

    document.getElementById('annual-revenue').textContent = `$${annualRevenue.toLocaleString()}`;
    document.getElementById('annual-hours').textContent = Math.round(annualHours);
    document.getElementById('annual-rate').textContent = `$${Math.round(annualRate)}/hr`;

    // Update diagram metrics
    const svg = document.getElementById('diagram');
    updateMetrics(svg, state);
}

// ============================================
// Input Listeners
// ============================================

function setupInputListeners() {
    const inputs = [
        { id: 'input-households', key: 'households' },
        { id: 'input-compost-price', key: 'compostPrice' },
        { id: 'input-tea-price', key: 'teaPrice' },
        { id: 'input-subscription-price', key: 'subscriptionPrice' },
        { id: 'input-giveback', key: 'givebackPerYear' }
    ];

    inputs.forEach(({ id, key }) => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('input', (e) => {
                state.inputs[key] = parseInt(e.target.value, 10);
                updateState();
            });
        }
    });
}

// ============================================
// Node Click Handlers
// ============================================

function setupNodeClickListeners() {
    const svg = document.getElementById('diagram');

    svg.addEventListener('click', (e) => {
        const nodeEl = e.target.closest('.node');
        if (nodeEl) {
            const nodeId = nodeEl.getAttribute('data-node-id');
            showNodeDetail(nodeId);
        }
    });
}

function showNodeDetail(nodeId) {
    const node = config.nodes[nodeId];
    if (!node) return;

    const panel = document.getElementById('node-detail');
    const tasks = calc.getTaskBreakdown(nodeId, state.inputs.households);

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
        if (!panel.contains(e.target) && !e.target.closest('.node')) {
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
// Capital Costs
// ============================================

function renderCapitalCosts() {
    const container = document.getElementById('capital-costs');
    let total = 0;

    config.capitalCosts.forEach(item => {
        const row = document.createElement('div');
        row.className = 'capital-cost-row';
        row.innerHTML = `
            <span>${item.item}</span>
            <span>$${item.cost}</span>
        `;
        container.appendChild(row);
        total += item.cost;
    });

    // Total row
    const totalRow = document.createElement('div');
    totalRow.className = 'capital-cost-row total';
    totalRow.innerHTML = `
        <span>Total Setup</span>
        <span>$${total}</span>
    `;
    container.appendChild(totalRow);
}

// ============================================
// Start
// ============================================

document.addEventListener('DOMContentLoaded', init);
