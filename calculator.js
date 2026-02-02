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
const GRASS_CLIPPINGS_PER_HOUSEHOLD_PER_WEEK = 4; // gallons (mowing season only)
const WEEKS_PER_MONTH = 4;

// ============================================
// Equipment & Capital Costs
// ============================================

export const EQUIPMENT = {
    // Core composting (minimal - mostly manual)
    composting: {
        palletBins: { cost: 0, description: '4x pallet bins (free/salvaged)', depreciationYears: 10 },
        pitchforks: { cost: 50, description: '2x pitchforks', depreciationYears: 5 },
        wheelbarrow: { cost: 150, description: 'Heavy-duty wheelbarrow', depreciationYears: 10 },
        buckets: { cost: 100, description: '20x 5-gal buckets for collection', depreciationYears: 3 },
        thermometer: { cost: 30, description: 'Compost thermometer', depreciationYears: 5 },
        subtotal: 330
    },
    // Cardboard processing
    cardboard: {
        shredder: { cost: 200, description: 'Electric leaf shredder (doubles for cardboard)', depreciationYears: 5 },
        subtotal: 200
    },
    // Worm tea production
    wormTea: {
        brewingVat: { cost: 100, description: '50-gal drum + aerator pump', depreciationYears: 5 },
        spigots: { cost: 30, description: 'Spigots and fittings', depreciationYears: 5 },
        subtotal: 130
    },
    // Logistics & delivery
    logistics: {
        zeroTurn: { cost: 4000, description: 'Used zero-turn mower (Husqvarna/Toro 54")', depreciationYears: 7 },
        atv: { cost: 2500, description: 'Used ATV (Honda Rancher/Yamaha Grizzly)', depreciationYears: 10 },
        trailer: { cost: 500, description: 'Small utility trailer', depreciationYears: 10 },
        subtotal: 7000
    },
    // Leaf/lawn service (target $50+/hr)
    lawnService: {
        backpackBlower: { cost: 400, description: 'Gas backpack blower (Stihl/Echo)', depreciationYears: 7 },
        cycloneRake: { cost: 2500, description: 'Cyclone Rake tow-behind vacuum (415 gal)', depreciationYears: 10 },
        subtotal: 2900
    }
};

// Calculate total startup cost
export function calculateStartupCost(includeLawnService = true) {
    let total = EQUIPMENT.composting.subtotal +
                EQUIPMENT.cardboard.subtotal +
                EQUIPMENT.wormTea.subtotal +
                EQUIPMENT.logistics.subtotal;
    if (includeLawnService) {
        total += EQUIPMENT.lawnService.subtotal;
    }
    return total;
}

// Calculate annual depreciation
export function calculateAnnualDepreciation(includeLawnService = true) {
    let depreciation = 0;
    const categories = ['composting', 'cardboard', 'wormTea', 'logistics'];
    if (includeLawnService) categories.push('lawnService');

    for (const cat of categories) {
        for (const [key, item] of Object.entries(EQUIPMENT[cat])) {
            if (key !== 'subtotal' && item.depreciationYears) {
                depreciation += item.cost / item.depreciationYears;
            }
        }
    }
    return depreciation;
}

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
    givebackPerYear,
    includeLawnService = true
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

    // Capital costs
    const startupCost = calculateStartupCost(includeLawnService);
    const annualDepreciation = calculateAnnualDepreciation(includeLawnService);

    return {
        inputs,
        outputs: {
            ...outputs,
            sellableCompost
        },
        revenue,
        labor,
        hourlyRate,
        capital: {
            startupCost,
            annualDepreciation,
            equipment: EQUIPMENT
        },
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

// ============================================
// Youth Labor Regulations
// ============================================

export const YOUTH_LABOR = {
    // Co-op policy: require 4-H cert for ALL powered equipment operators
    coopPolicy: {
        rule: 'All youth operating powered equipment must have 4-H Tractor Safety certification',
        reason: 'Liability protection, safety training, professionalism',
        minAgeForPoweredEquipment: 14
    },
    // Legal minimums by equipment type
    legalMinimums: {
        handTools: { minAge: 12, certification: null, notes: 'With parental consent' },
        electricShredder: { minAge: 14, certification: null, notes: 'Non-hazardous' },
        zeroTurn: { minAge: 14, certification: '4-H Tractor Safety', notes: 'Co-op requires for all ages' },
        atv: { minAge: 14, certification: '4-H Tractor Safety', notes: 'Co-op requires for all ages' },
        tractor: { minAge: 14, certification: '4-H Tractor Safety', notes: 'Over 20 PTO HP' },
        truckDriving: { minAge: 16, certification: 'Drivers license', notes: 'No CDL for small trucks' }
    },
    // Parental exemption (legal, but co-op still requires training)
    parentalExemption: 'Law allows parents to let their kids operate anything on family land, but co-op still requires certification',
    // Certification info
    certification: {
        name: '4-H Tractor and Machinery Certification',
        provider: 'Local 4-H extension office',
        cost: 'Free',
        duration: '1-2 day course',
        ages: '14+',
        allows: 'Tractors, ATVs, zero-turns, other power equipment',
        penalty: 'Up to $10,000 fine for employers hiring uncertified 14-15 year olds'
    }
};
