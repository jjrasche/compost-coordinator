/**
 * Calculator Tests for Compost Coordinator
 *
 * Tests the business logic for calculating:
 * - Input volumes from households
 * - Output volumes (compost, tea)
 * - Revenue from all streams
 * - Labor hours per task
 * - Hourly rate
 */

import * as calc from '../calculator.js';

// Simple test framework
const tests = [];

function test(name, group, fn) {
    tests.push({ name, group, fn });
}

function assertEqual(actual, expected, message = '') {
    if (actual !== expected) {
        throw new Error(`${message}\nExpected: ${expected}\nActual: ${actual}`);
    }
}

function assertClose(actual, expected, tolerance = 0.01, message = '') {
    if (Math.abs(actual - expected) > tolerance) {
        throw new Error(`${message}\nExpected: ${expected} (±${tolerance})\nActual: ${actual}`);
    }
}

function assertDeepEqual(actual, expected, message = '') {
    const actualStr = JSON.stringify(actual);
    const expectedStr = JSON.stringify(expected);
    if (actualStr !== expectedStr) {
        throw new Error(`${message}\nExpected: ${expectedStr}\nActual: ${actualStr}`);
    }
}

// ============================================
// Input Volume Tests
// ============================================

test('calculateInputVolumes returns correct weekly volumes for 15 households', 'Input Volumes', () => {
    const result = calc.calculateInputVolumes(15);
    assertEqual(result.cardboardPerWeek, 90, 'Cardboard: 15 households × 6 gal/week');
    assertEqual(result.foodWastePerWeek, 30, 'Food waste: 15 households × 2 gal/week');
});

test('calculateInputVolumes returns correct monthly volumes for 15 households', 'Input Volumes', () => {
    const result = calc.calculateInputVolumes(15);
    assertEqual(result.cardboardPerMonth, 360, 'Cardboard: 90 gal/week × 4');
    assertEqual(result.foodWastePerMonth, 120, 'Food waste: 30 gal/week × 4');
});

test('calculateInputVolumes scales with household count', 'Input Volumes', () => {
    const result = calc.calculateInputVolumes(30);
    assertEqual(result.cardboardPerWeek, 180, 'Double households = double cardboard');
    assertEqual(result.foodWastePerWeek, 60, 'Double households = double food waste');
});

test('calculateInputVolumes handles zero households', 'Input Volumes', () => {
    const result = calc.calculateInputVolumes(0);
    assertEqual(result.cardboardPerWeek, 0);
    assertEqual(result.foodWastePerWeek, 0);
});

// ============================================
// Output Volume Tests
// ============================================

test('calculateOutputVolumes returns correct finished compost', 'Output Volumes', () => {
    const inputs = { cardboardPerMonth: 360, foodWastePerMonth: 120 };
    const result = calc.calculateOutputVolumes(inputs);
    // 480 gal input × 0.417 conversion = ~200 gal output
    assertClose(result.finishedCompostPerMonth, 200, 5, 'Finished compost ~200 gal/month');
});

test('calculateOutputVolumes returns correct worm tea volumes', 'Output Volumes', () => {
    const inputs = { cardboardPerMonth: 360, foodWastePerMonth: 120 };
    const result = calc.calculateOutputVolumes(inputs);
    assertEqual(result.wormTeaConcentrate, 20, 'Worm tea concentrate: 20 gal');
    assertEqual(result.wormTeaDiluted, 200, 'Worm tea diluted: 200 gal (10:1 ratio)');
});

test('calculateOutputVolumes scales with input', 'Output Volumes', () => {
    const inputs = { cardboardPerMonth: 720, foodWastePerMonth: 240 };
    const result = calc.calculateOutputVolumes(inputs);
    assertClose(result.finishedCompostPerMonth, 400, 10, 'Double input = double output');
});

// ============================================
// Sellable Output Tests
// ============================================

test('calculateSellableOutput subtracts give-back correctly', 'Sellable Output', () => {
    const result = calc.calculateSellableOutput(200, 15, 10);
    // 15 households × 10 gal/year = 150 gal/year = 12.5 gal/month
    // 200 - 12.5 = 187.5, rounded to 185
    assertClose(result, 187.5, 1, 'Sellable = total - give-back');
});

test('calculateSellableOutput handles high give-back', 'Sellable Output', () => {
    const result = calc.calculateSellableOutput(200, 15, 25);
    // 15 × 25 / 12 = 31.25 gal/month give-back
    // 200 - 31.25 = 168.75
    assertClose(result, 168.75, 1);
});

test('calculateSellableOutput never goes negative', 'Sellable Output', () => {
    const result = calc.calculateSellableOutput(50, 50, 25);
    // 50 × 25 / 12 = 104 gal/month give-back > 50 produced
    assertEqual(result >= 0, true, 'Sellable should not be negative');
});

// ============================================
// Revenue Tests
// ============================================

test('calculateRevenue returns correct subscription revenue', 'Revenue', () => {
    const result = calc.calculateRevenue({
        households: 15,
        subscriptionPrice: 25,
        compostPrice: 20,
        teaPrice: 15,
        sellableCompost: 185,
        teaConcentrate: 20
    });
    assertEqual(result.subscriptions, 375, '15 × $25 = $375');
});

test('calculateRevenue returns correct compost revenue', 'Revenue', () => {
    const result = calc.calculateRevenue({
        households: 15,
        subscriptionPrice: 25,
        compostPrice: 20,
        teaPrice: 15,
        sellableCompost: 185,
        teaConcentrate: 20
    });
    assertEqual(result.compost, 3700, '185 gal × $20 = $3,700');
});

test('calculateRevenue returns correct tea revenue', 'Revenue', () => {
    const result = calc.calculateRevenue({
        households: 15,
        subscriptionPrice: 25,
        compostPrice: 20,
        teaPrice: 15,
        sellableCompost: 185,
        teaConcentrate: 20
    });
    assertEqual(result.tea, 300, '20 gal × $15 = $300');
});

test('calculateRevenue returns correct total', 'Revenue', () => {
    const result = calc.calculateRevenue({
        households: 15,
        subscriptionPrice: 25,
        compostPrice: 20,
        teaPrice: 15,
        sellableCompost: 185,
        teaConcentrate: 20
    });
    assertEqual(result.total, 4375, '$375 + $3,700 + $300 = $4,375');
});

// ============================================
// Labor Hours Tests
// ============================================

test('calculateLabor returns correct collection hours', 'Labor Hours', () => {
    const result = calc.calculateLabor(15);
    assertEqual(result.collection, 16, 'Collection: 16 hr/mo for 15 households');
});

test('calculateLabor returns correct cardboard hours', 'Labor Hours', () => {
    const result = calc.calculateLabor(15);
    assertEqual(result.cardboard, 10, 'Cardboard processing: 10 hr/mo');
});

test('calculateLabor returns correct composting hours', 'Labor Hours', () => {
    const result = calc.calculateLabor(15);
    assertClose(result.composting, 6.7, 0.1, 'Composting: ~6.7 hr/mo');
});

test('calculateLabor returns correct tea hours', 'Labor Hours', () => {
    const result = calc.calculateLabor(15);
    assertClose(result.tea, 1.7, 0.1, 'Worm tea: ~1.7 hr/mo');
});

test('calculateLabor returns correct delivery hours', 'Labor Hours', () => {
    const result = calc.calculateLabor(15);
    assertEqual(result.delivery, 6, 'Delivery: 6 hr/mo');
});

test('calculateLabor returns correct total', 'Labor Hours', () => {
    const result = calc.calculateLabor(15);
    assertClose(result.total, 40.4, 0.5, 'Total: ~40.4 hr/mo');
});

test('calculateLabor scales with households', 'Labor Hours', () => {
    const result15 = calc.calculateLabor(15);
    const result30 = calc.calculateLabor(30);
    // Collection and cardboard scale linearly
    assertEqual(result30.collection > result15.collection, true, 'Collection scales up');
    assertEqual(result30.cardboard > result15.cardboard, true, 'Cardboard scales up');
    // Composting and tea are somewhat fixed (batch processing)
});

// ============================================
// Hourly Rate Tests
// ============================================

test('calculateHourlyRate returns correct rate', 'Hourly Rate', () => {
    const result = calc.calculateHourlyRate(4375, 40.4);
    assertClose(result, 108.3, 1, '$4,375 / 40.4 hr = ~$108/hr');
});

test('calculateHourlyRate handles zero hours', 'Hourly Rate', () => {
    const result = calc.calculateHourlyRate(1000, 0);
    assertEqual(result, 0, 'Zero hours = zero rate (avoid division by zero)');
});

// ============================================
// Full Model Integration Test
// ============================================

test('calculateFullModel returns complete business metrics', 'Integration', () => {
    const result = calc.calculateFullModel({
        households: 15,
        compostPrice: 20,
        teaPrice: 15,
        subscriptionPrice: 25,
        givebackPerYear: 10
    });

    // Check structure
    assertEqual(typeof result.inputs, 'object', 'Has inputs');
    assertEqual(typeof result.outputs, 'object', 'Has outputs');
    assertEqual(typeof result.revenue, 'object', 'Has revenue');
    assertEqual(typeof result.labor, 'object', 'Has labor');
    assertEqual(typeof result.hourlyRate, 'number', 'Has hourly rate');

    // Check key values
    assertClose(result.revenue.total, 4375, 50, 'Revenue around $4,375');
    assertClose(result.labor.total, 40.4, 1, 'Labor around 40.4 hr');
    assertClose(result.hourlyRate, 108, 5, 'Hourly rate around $108');
});

test('calculateFullModel updates correctly with price changes', 'Integration', () => {
    const result = calc.calculateFullModel({
        households: 15,
        compostPrice: 40, // Doubled!
        teaPrice: 15,
        subscriptionPrice: 25,
        givebackPerYear: 10
    });

    // Compost revenue should roughly double
    assertClose(result.revenue.compost, 7400, 100, 'Doubled compost price = doubled compost revenue');
});

// ============================================
// Run all tests
// ============================================

export function runTests() {
    const results = [];

    for (const t of tests) {
        try {
            t.fn();
            results.push({
                name: t.name,
                group: t.group,
                passed: true
            });
        } catch (error) {
            results.push({
                name: t.name,
                group: t.group,
                passed: false,
                error: error.message
            });
        }
    }

    return results;
}
