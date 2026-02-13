/**
 * Node data migrated from vanilla config.js to React Flow format
 * Positions updated to match GitHub Pages layout (from localStorage)
 */

export const initialNodes = [
  {
    id: 'households',
    type: 'compostNode',
    position: { x: 621, y: 308 },
    data: {
      label: 'Households',
      category: 'input',
      icon: '🏠',
      description: 'Participating households that provide food waste and cardboard',
      metrics: ['15 homes', '150 gal/week input'],
      tasks: []
    }
  },
  {
    id: 'collection',
    type: 'compostNode',
    position: { x: 11, y: 310 },
    data: {
      label: 'Collection',
      category: 'labor',
      icon: '🚛',
      description: 'Weekly pickup of food waste and cardboard from households',
      metrics: ['16 hr/mo', '15 stops'],
      tasks: [
        { name: 'Drive route', minPerWeek: 45 },
        { name: 'Collect food waste buckets', minPerWeek: 75 },
        { name: 'Collect cardboard', minPerWeek: 45 },
        { name: 'Return clean buckets', minPerWeek: 45 },
        { name: 'Bucket cleaning', minPerWeek: 30 }
      ]
    }
  },
  {
    id: 'brownsStore',
    type: 'compostNode',
    position: { x: -85, y: 486 },
    data: {
      label: 'Browns Store',
      category: 'labor',
      icon: '📦',
      description: 'Carbon-rich materials storage (shredded cardboard)',
      metrics: ['50 gal/week'],
      tasks: []
    }
  },
  {
    id: 'greensStore',
    type: 'compostNode',
    position: { x: 96, y: 488 },
    data: {
      label: 'Greens Store',
      category: 'labor',
      icon: '🍎',
      description: 'Nitrogen-rich materials storage (food waste, grass clippings)',
      metrics: ['150 gal/week'],
      tasks: []
    }
  },
  {
    id: 'stage1',
    type: 'compostNode',
    position: { x: -31, y: 696 },
    data: {
      label: 'Stage 1: Active',
      category: 'composting',
      icon: '🔥',
      description: 'Hot composting phase - thermophilic bacteria break down material at 130-160°F',
      metrics: ['3-4 weeks', '200 gal capacity'],
      tasks: [
        { name: 'Add materials', minPerWeek: 30 },
        { name: 'Monitor temperature', minPerWeek: 5 }
      ]
    }
  },
  {
    id: 'stage2',
    type: 'compostNode',
    position: { x: 188, y: 727 },
    data: {
      label: 'Stage 2: Cooling',
      category: 'composting',
      icon: '🌡️',
      description: 'Temperature drops, mesophilic bacteria take over',
      metrics: ['3-4 weeks'],
      tasks: [
        { name: 'Move pile from Stage 1', minPerMonth: 60 },
        { name: 'Monitor moisture', minPerWeek: 5 }
      ]
    }
  },
  {
    id: 'stage3',
    type: 'compostNode',
    position: { x: 417, y: 763 },
    data: {
      label: 'Stage 3: Worms',
      category: 'composting',
      icon: '🪱',
      description: 'Worms enter and process material into castings',
      metrics: ['3-4 weeks', 'active worm activity'],
      tasks: [
        { name: 'Move pile from Stage 2', minPerMonth: 60 },
        { name: 'Maintain wedge connection', minPerMonth: 10 }
      ]
    }
  },
  {
    id: 'stage4',
    type: 'compostNode',
    position: { x: 627, y: 790 },
    data: {
      label: 'Stage 4: Harvest',
      category: 'composting',
      icon: '🌱',
      description: 'Spread, expose to light, harvest finished vermicompost',
      metrics: ['200 gal/mo', 'worms return to stage 3'],
      tasks: [
        { name: 'Move pile from Stage 3', minPerMonth: 60 },
        { name: 'Spread and light expose', minPerMonth: 30 },
        { name: 'Harvest castings', minPerMonth: 30 }
      ]
    }
  },
  {
    id: 'tea',
    type: 'compostNode',
    position: { x: 833, y: 790 },
    data: {
      label: 'Brew Worm Tea',
      category: 'processing',
      icon: '💧',
      description: 'Aeration vessel where worm castings are steeped to produce liquid fertilizer',
      metrics: ['20 gal/mo', '2 brew cycles'],
      tasks: [
        { name: 'Collect castings', minPerMonth: 15 },
        { name: 'Set up brew', minPerMonth: 20 },
        { name: 'Load brew vat', minPerMonth: 15 }
      ]
    }
  },
  {
    id: 'distribution',
    type: 'compostNode',
    position: { x: 712, y: 557 },
    data: {
      label: 'Distribution',
      category: 'output',
      icon: '🚚',
      description: 'Vehicle/trailer loaded with finished compost and worm tea for delivery to customers and households',
      metrics: ['200 gal/month output'],
      tasks: [
        { name: 'Load truck with compost', minPerMonth: 60 },
        { name: 'Load worm tea containers', minPerMonth: 15 },
        { name: 'Customer stops (purchasers)', minPerMonth: 180 },
        { name: 'Customer stops (households)', minPerMonth: 120 }
      ]
    }
  },
  {
    id: 'purchasers',
    type: 'compostNode',
    position: { x: 824, y: 309 },
    data: {
      label: 'Purchasers',
      category: 'output',
      icon: '🏡',
      description: 'External buyers purchasing finished compost and worm tea',
      metrics: ['10 buyers', '$4,375/mo revenue'],
      tasks: []
    }
  }
];
