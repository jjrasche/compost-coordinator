/**
 * Compost Coordinator - Configuration
 *
 * All data for the visual business model:
 * - Node definitions (stages, processes)
 * - Edge definitions (material flow)
 * - Default input values
 * - Layout positions
 * - Theme colors
 */

export default {
    // ============================================
    // Default Input Values
    // ============================================
    defaults: {
        households: 15,
        compostPrice: 20,
        teaPrice: 15,
        subscriptionPrice: 25,
        givebackPerYear: 10
    },

    // Input ranges for sliders
    ranges: {
        households: { min: 5, max: 50, step: 1 },
        compostPrice: { min: 10, max: 40, step: 1 },
        teaPrice: { min: 5, max: 25, step: 1 },
        subscriptionPrice: { min: 15, max: 35, step: 1 },
        givebackPerYear: { min: 5, max: 25, step: 1 }
    },

    // ============================================
    // Node Definitions
    // ============================================
    nodes: {
        households: {
            id: 'households',
            label: 'Households',
            category: 'input',
            icon: '🏠',
            position: { x: 0.05, y: 0.5 },
            description: 'Participating households that provide food waste and cardboard',
            metrics: ['homes', 'gal/week input'],
            tasks: []
        },
        collection: {
            id: 'collection',
            label: 'Collection Route',
            category: 'labor',
            icon: '🚛',
            position: { x: 0.18, y: 0.5 },
            description: 'Weekly pickup of food waste and cardboard from households',
            metrics: ['hr/mo', 'stops'],
            tasks: [
                { name: 'Drive route', minPerWeek: 45 },
                { name: 'Collect food waste buckets', minPerWeek: 75 },
                { name: 'Collect cardboard', minPerWeek: 45 },
                { name: 'Return clean buckets', minPerWeek: 45 },
                { name: 'Bucket cleaning', minPerWeek: 30 }
            ]
        },
        cardboard: {
            id: 'cardboard',
            label: 'Cardboard Processing',
            category: 'labor',
            icon: '📦',
            position: { x: 0.31, y: 0.25 },
            description: 'Break down, shred, and prepare cardboard for composting',
            metrics: ['hr/mo', 'gal/week'],
            tasks: [
                { name: 'Break down + remove plastic', minPerWeek: 90 },
                { name: 'Shred', minPerWeek: 45 },
                { name: 'Bag/containerize', minPerWeek: 15 }
            ]
        },
        stage1: {
            id: 'stage1',
            label: 'Stage 1: Active',
            category: 'composting',
            icon: '🔥',
            position: { x: 0.44, y: 0.5 },
            description: 'Hot composting phase - thermophilic bacteria break down material at 130-160°F',
            metrics: ['weeks', 'gal capacity'],
            tasks: [
                { name: 'Add materials', minPerWeek: 30 },
                { name: 'Monitor temperature', minPerWeek: 5 }
            ]
        },
        stage2: {
            id: 'stage2',
            label: 'Stage 2: Cooling',
            category: 'composting',
            icon: '🌡️',
            position: { x: 0.54, y: 0.5 },
            description: 'Temperature drops, mesophilic bacteria take over',
            metrics: ['weeks'],
            tasks: [
                { name: 'Move pile from Stage 1', minPerMonth: 60 },
                { name: 'Monitor moisture', minPerWeek: 5 }
            ]
        },
        stage3: {
            id: 'stage3',
            label: 'Stage 3: Worms',
            category: 'composting',
            icon: '🪱',
            position: { x: 0.64, y: 0.5 },
            description: 'Worms enter and process material into castings',
            metrics: ['weeks', 'worm activity'],
            tasks: [
                { name: 'Move pile from Stage 2', minPerMonth: 60 },
                { name: 'Maintain wedge connection', minPerMonth: 10 }
            ]
        },
        stage4: {
            id: 'stage4',
            label: 'Stage 4: Harvest',
            category: 'composting',
            icon: '🌱',
            position: { x: 0.74, y: 0.5 },
            description: 'Spread, expose to light, harvest finished vermicompost',
            metrics: ['gal/mo', 'worm return'],
            tasks: [
                { name: 'Move pile from Stage 3', minPerMonth: 60 },
                { name: 'Spread and light expose', minPerMonth: 30 },
                { name: 'Harvest castings', minPerMonth: 30 }
            ]
        },
        tea: {
            id: 'tea',
            label: 'Worm Tea Brewing',
            category: 'processing',
            icon: '💧',
            position: { x: 0.74, y: 0.25 },
            description: 'Brew aerated worm tea from finished castings',
            metrics: ['gal/mo', 'brew cycles'],
            tasks: [
                { name: 'Collect castings', minPerMonth: 15 },
                { name: 'Set up brew', minPerMonth: 20 },
                { name: 'Load brew vat', minPerMonth: 15 },
                { name: 'Apply at customer sites', minPerMonth: 50 }
            ]
        },
        delivery: {
            id: 'delivery',
            label: 'Delivery',
            category: 'labor',
            icon: '🚚',
            position: { x: 0.84, y: 0.5 },
            description: 'Load truck, deliver to customers, apply worm tea',
            metrics: ['hr/mo', 'stops'],
            tasks: [
                { name: 'Load truck', minPerMonth: 60 },
                { name: 'Customer stops', minPerMonth: 300 }
            ]
        },
        customers: {
            id: 'customers',
            label: 'Customers',
            category: 'output',
            icon: '🏡',
            position: { x: 0.95, y: 0.5 },
            description: 'External buyers plus subscribers receiving give-back',
            metrics: ['buyers', '$/mo revenue'],
            tasks: []
        }
    },

    // ============================================
    // Edge Definitions (Material Flow)
    // ============================================
    edges: [
        // Food waste flow
        {
            id: 'food-households-collection',
            from: 'households',
            to: 'collection',
            material: 'food',
            icon: '🍎',
            label: 'food waste',
            color: '#22c55e'
        },
        {
            id: 'food-collection-stage1',
            from: 'collection',
            to: 'stage1',
            material: 'food',
            icon: '🍎',
            label: '',
            color: '#22c55e'
        },

        // Cardboard flow
        {
            id: 'cardboard-households-collection',
            from: 'households',
            to: 'collection',
            material: 'cardboard',
            icon: '📦',
            label: 'cardboard',
            color: '#f59e0b'
        },
        {
            id: 'cardboard-collection-processing',
            from: 'collection',
            to: 'cardboard',
            material: 'cardboard',
            icon: '📦',
            label: '',
            color: '#f59e0b'
        },
        {
            id: 'cardboard-processing-stage1',
            from: 'cardboard',
            to: 'stage1',
            material: 'cardboard',
            icon: '📦',
            label: 'shredded',
            color: '#f59e0b'
        },

        // Composting stages flow
        {
            id: 'compost-stage1-stage2',
            from: 'stage1',
            to: 'stage2',
            material: 'compost',
            icon: '🌱',
            label: '',
            color: '#84cc16'
        },
        {
            id: 'compost-stage2-stage3',
            from: 'stage2',
            to: 'stage3',
            material: 'compost',
            icon: '🌱',
            label: '',
            color: '#84cc16'
        },
        {
            id: 'compost-stage3-stage4',
            from: 'stage3',
            to: 'stage4',
            material: 'compost',
            icon: '🌱',
            label: '',
            color: '#84cc16'
        },

        // Worm migration (bidirectional)
        {
            id: 'worms-stage4-stage3',
            from: 'stage4',
            to: 'stage3',
            material: 'worms',
            icon: '🪱',
            label: 'worm migration',
            color: '#ec4899',
            bidirectional: true
        },

        // Worm tea flow
        {
            id: 'castings-stage4-tea',
            from: 'stage4',
            to: 'tea',
            material: 'castings',
            icon: '🌱',
            label: 'castings',
            color: '#06b6d4'
        },
        {
            id: 'tea-tea-delivery',
            from: 'tea',
            to: 'delivery',
            material: 'tea',
            icon: '💧',
            label: 'worm tea',
            color: '#06b6d4'
        },

        // Delivery to customers
        {
            id: 'compost-stage4-delivery',
            from: 'stage4',
            to: 'delivery',
            material: 'compost',
            icon: '🌱',
            label: 'finished compost',
            color: '#84cc16'
        },
        {
            id: 'products-delivery-customers',
            from: 'delivery',
            to: 'customers',
            material: 'products',
            icon: '🌱',
            label: '',
            color: '#84cc16'
        }
    ],

    // ============================================
    // Category Colors
    // ============================================
    categoryColors: {
        input: '#6366f1',      // Indigo
        labor: '#f59e0b',      // Amber
        composting: '#22c55e', // Green
        processing: '#06b6d4', // Cyan
        output: '#ec4899'      // Pink
    },

    // ============================================
    // Theme
    // ============================================
    theme: {
        background: '#0f172a',
        surface: '#1e293b',
        surfaceHover: '#334155',
        text: '#f8fafc',
        textMuted: '#94a3b8',
        border: '#475569',
        accent: '#22c55e'
    },

    // ============================================
    // Layout
    // ============================================
    layout: {
        nodeWidth: 120,
        nodeHeight: 60,
        nodeExpandedHeight: 200,
        edgeCurve: 0.3,
        padding: 40
    },

    // ============================================
    // Capital Costs (one-time setup)
    // ============================================
    capitalCosts: [
        { item: 'Shredder', cost: 40 },
        { item: 'Buckets (15)', cost: 75 },
        { item: 'Aeration pipes (PVC)', cost: 30 },
        { item: 'Aquarium pump + airstone', cost: 20 },
        { item: 'Initial worms (1 lb)', cost: 30 },
        { item: 'Misc (tarp, bags, tools)', cost: 50 }
    ],

    // ============================================
    // Seasonal Info
    // ============================================
    seasonal: {
        activeMonths: 9, // March - November
        winterMonths: 3, // December - February
        winterNote: 'Collection continues year-round. Composting slows in winter. Sales resume in spring.'
    }
};
