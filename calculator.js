/**
 * Compost Coordinator - Business Logic Calculator
 *
 * Pure functions for calculating all business metrics:
 * - Input volumes from household count
 * - Output volumes (compost, tea)
 * - Revenue streams
 * - Labor hours
 * - Hourly rate
 *
 * All functions are pure (no side effects) and testable.
 */

// ============================================
// Constants (per-household rates)
// ============================================

const CARDBOARD_PER_HOUSEHOLD_PER_WEEK = 6; // gallons
const FOOD_WASTE_PER_HOUSEHOLD_PER_WEEK = 2; // gallons
const WEEKS_PER_MONTH = 4;

// Conversion: input shrinks ~58% to output (480 gal in → 200 gal out)
const INPUT_TO_OUTPUT_RATIO = 200 / 480; // ~0.417

// Worm tea production
const TEA_CONCENTRATE_BASE = 20; // gallons per month (for base 15 households)
const TEA_DILUTION_RATIO = 10; // 1:10 concentrate to water

// ============================================
// Input Volume Calculations
// ============================================

/**
 * Calculate input volumes based on number of households
 * @param {number} households - Number of participating households
 * @returns {Object} Weekly and monthly input volumes
 */
export function calculateInputVolumes(households) {
    const cardboardPerWeek = households * CARDBOARD_PER_HOUSEHOLD_PER_WEEK;
    const foodWastePerWeek = households * FOOD_WASTE_PER_HOUSEHOLD_PER_WEEK;

    return {
        cardboardPerWeek,
        foodWastePerWeek,
        cardboardPerMonth: cardboardPerWeek * WEEKS_PER_MONTH,
        foodWastePerMonth: foodWastePerWeek * WEEKS_PER_MONTH,
        totalPerWeek: cardboardPerWeek + foodWastePerWeek,
        totalPerMonth: (cardboardPerWeek + foodWastePerWeek) * WEEKS_PER_MONTH
    };
}

// ============================================
// Output Volume Calculations
// ============================================

/**
 * Calculate output volumes from input volumes
 * @param {Object} inputs - Input volumes object
 * @returns {Object} Monthly output volumes
 */
export function calculateOutputVolumes(inputs) {
    const totalInput = inputs.cardboardPerMonth + inputs.foodWastePerMonth;
    const finishedCompostPerMonth = totalInput * INPUT_TO_OUTPUT_RATIO;

    // Tea scales with compost production
    const teaScale = finishedCompostPerMonth / 200;
    const teaConcentrate = TEA_CONCENTRATE_BASE * teaScale;

    return {
        finishedCompostPerMonth,
        wormTeaConcentrate: teaConcentrate,
        wormTeaDiluted: teaConcentrate * TEA_DILUTION_RATIO
    };
}

/**
 * Calculate sellable output after give-back to subscribers
 * @param {number} totalCompost - Total finished compost per month
 * @param {number} households - Number of households
 * @param {number} givebackPerYear - Gallons given back per household per year
 * @returns {number} Sellable gallons per month
 */
export function calculateSellableOutput(totalCompost, households, givebackPerYear) {
    const givebackPerMonth = (households * givebackPerYear) / 12;
    const sellable = totalCompost - givebackPerMonth;
    return Math.max(0, sellable); // Never negative
}

// ============================================
// Revenue Calculations
// ============================================

/**
 * Calculate all revenue streams
 * @param {Object} params - Revenue parameters
 * @returns {Object} Revenue breakdown
 */
export function calculateRevenue({
    households,
    subscriptionPrice,
    compostPrice,
    teaPrice,
    sellableCompost,
    teaConcentrate
}) {
    const subscriptions = households * subscriptionPrice;
    const compost = sellableCompost * compostPrice;
    const tea = teaConcentrate * teaPrice;

    return {
        subscriptions,
        compost,
        tea,
        total: subscriptions + compost + tea
    };
}

// ============================================
// Labor Hour Calculations
// ============================================

/**
 * Calculate labor hours for all tasks
 * @param {number} households - Number of households
 * @returns {Object} Labor hours breakdown
 */
export function calculateLabor(households) {
    // Scale factor (base is 15 households)
    const scale = households / 15;

    // Collection scales linearly with households
    // Base: 16 hr/mo for 15 households
    const collection = 16 * scale;

    // Cardboard processing scales linearly
    // Base: 10 hr/mo for 15 households
    const cardboard = 10 * scale;

    // Composting is mostly fixed (batch processing)
    // Some scaling for larger piles
    // Base: 6.7 hr/mo
    const composting = 6.7 * (0.5 + 0.5 * scale);

    // Worm tea is mostly fixed
    // Base: 1.7 hr/mo
    const tea = 1.7 * (0.5 + 0.5 * scale);

    // Delivery scales with number of customers
    // Base: 6 hr/mo for ~10 stops
    const delivery = 6 * scale;

    const total = collection + cardboard + composting + tea + delivery;

    return {
        collection,
        cardboard,
        composting,
        tea,
        delivery,
        total
    };
}

/**
 * Get detailed task breakdown for a category
 * @param {string} category - Category name
 * @param {number} households - Number of households
 * @returns {Array} Array of task objects
 */
export function getTaskBreakdown(category, households) {
    const scale = households / 15;

    const breakdowns = {
        collection: [
            { name: 'Drive route', minPerWeek: 45, hoursPerMonth: (45 / 60) * 4 * scale },
            { name: 'Collect food waste buckets', minPerWeek: 75, hoursPerMonth: (75 / 60) * 4 * scale },
            { name: 'Collect cardboard', minPerWeek: 45, hoursPerMonth: (45 / 60) * 4 * scale },
            { name: 'Return clean buckets', minPerWeek: 45, hoursPerMonth: (45 / 60) * 4 * scale },
            { name: 'Bucket cleaning', minPerWeek: 30, hoursPerMonth: (30 / 60) * 4 * scale }
        ],
        cardboard: [
            { name: 'Break down + remove plastic', minPerWeek: 90, hoursPerMonth: (90 / 60) * 4 * scale },
            { name: 'Shred (90 gal)', minPerWeek: 45, hoursPerMonth: (45 / 60) * 4 * scale },
            { name: 'Bag/containerize', minPerWeek: 15, hoursPerMonth: (15 / 60) * 4 * scale }
        ],
        composting: [
            { name: 'Add materials to Stage 1', minPerWeek: 30, hoursPerMonth: (30 / 60) * 4 },
            { name: 'Monitor Stages 2-4', minPerWeek: 10, hoursPerMonth: (10 / 60) * 4 },
            { name: 'Move pile 1→2', minPerMonth: 60, hoursPerMonth: 1 },
            { name: 'Move pile 2→3', minPerMonth: 60, hoursPerMonth: 1 },
            { name: 'Move pile 3→4', minPerMonth: 60, hoursPerMonth: 1 },
            { name: 'Harvest Stage 4', minPerMonth: 60, hoursPerMonth: 1 }
        ],
        tea: [
            { name: 'Collect castings for brew', minPerMonth: 15, hoursPerMonth: 0.25 },
            { name: 'Set up brew', minPerMonth: 20, hoursPerMonth: 0.33 },
            { name: 'Load brew vat', minPerMonth: 15, hoursPerMonth: 0.25 },
            { name: 'Apply at customer sites', minPerMonth: 50, hoursPerMonth: 0.83 }
        ],
        delivery: [
            { name: 'Load truck', minPerMonth: 60, hoursPerMonth: 1 * scale },
            { name: 'Customer stops (10×30min)', minPerMonth: 300, hoursPerMonth: 5 * scale }
        ]
    };

    return breakdowns[category] || [];
}

// ============================================
// Hourly Rate Calculation
// ============================================

/**
 * Calculate effective hourly rate
 * @param {number} revenue - Monthly revenue
 * @param {number} hours - Monthly hours
 * @returns {number} Hourly rate
 */
export function calculateHourlyRate(revenue, hours) {
    if (hours === 0) return 0;
    return revenue / hours;
}

// ============================================
// Full Model Integration
// ============================================

/**
 * Calculate complete business model from inputs
 * @param {Object} params - All input parameters
 * @returns {Object} Complete business metrics
 */
export function calculateFullModel({
    households,
    compostPrice,
    teaPrice,
    subscriptionPrice,
    givebackPerYear
}) {
    // Calculate input volumes
    const inputs = calculateInputVolumes(households);

    // Calculate output volumes
    const outputs = calculateOutputVolumes(inputs);

    // Calculate sellable amount after give-back
    const sellableCompost = calculateSellableOutput(
        outputs.finishedCompostPerMonth,
        households,
        givebackPerYear
    );

    // Calculate revenue
    const revenue = calculateRevenue({
        households,
        subscriptionPrice,
        compostPrice,
        teaPrice,
        sellableCompost,
        teaConcentrate: outputs.wormTeaConcentrate
    });

    // Calculate labor
    const labor = calculateLabor(households);

    // Calculate hourly rate
    const hourlyRate = calculateHourlyRate(revenue.total, labor.total);

    return {
        inputs,
        outputs: {
            ...outputs,
            sellableCompost
        },
        revenue,
        labor,
        hourlyRate,
        // Annual projections (9 months active, 3 months winter)
        annual: {
            activeMonths: 9,
            winterMonths: 3,
            revenue: (revenue.total * 9) + (revenue.subscriptions * 3),
            hours: (labor.total * 9) + (16 * 3), // Winter: collection only
            hourlyRate: 0 // Calculated below
        }
    };
}
