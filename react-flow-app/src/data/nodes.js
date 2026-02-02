/**
 * Node data migrated from vanilla config.js to React Flow format
 * Position conversion: percentage * 1000 = pixels (for 1000x1000 viewport)
 */

export const initialNodes = [
  {
    id: 'households',
    type: 'compostNode',
    position: { x: 580, y: 160 },
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
    position: { x: 340, y: 160 },
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
    id: 'cardboard',
    type: 'compostNode',
    position: { x: 100, y: 160 },
    data: {
      label: 'Cardboard Processing',
      category: 'labor',
      icon: '📦',
      description: 'Break down, shred, and prepare cardboard for composting',
      metrics: ['10 hr/mo', '50 gal/week'],
      tasks: [
        { name: 'Break down + remove plastic', minPerWeek: 90 },
        { name: 'Shred', minPerWeek: 45 },
        { name: 'Bag/containerize', minPerWeek: 15 }
      ]
    }
  },
  {
    id: 'foodWasteProcessing',
    type: 'compostNode',
    position: { x: 220, y: 420 },
    data: {
      label: 'Food Waste Processing',
      category: 'labor',
      icon: '🍎',
      description: 'Sort, prepare, and measure food waste before composting',
      metrics: ['3 hr/mo'],
      tasks: [
        { name: 'Sort and clean', minPerWeek: 30 },
        { name: 'Measure quantities', minPerWeek: 15 }
      ]
    }
  },
  {
    id: 'stage1',
    type: 'compostNode',
    position: { x: 100, y: 700 },
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
    position: { x: 260, y: 700 },
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
    position: { x: 420, y: 700 },
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
    position: { x: 580, y: 700 },
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
    position: { x: 800, y: 700 },
    data: {
      label: 'Brew Worm Tea',
      category: 'processing',
      icon: '💧',
      description: 'Brew aerated worm tea from finished castings',
      metrics: ['20 gal/mo', '2 brew cycles'],
      tasks: [
        { name: 'Collect castings', minPerMonth: 15 },
        { name: 'Set up brew', minPerMonth: 20 },
        { name: 'Load brew vat', minPerMonth: 15 },
        { name: 'Apply at customer sites', minPerMonth: 50 }
      ]
    }
  },
  {
    id: 'delivery',
    type: 'compostNode',
    position: { x: 680, y: 440 },
    data: {
      label: 'Delivery',
      category: 'labor',
      icon: '🚚',
      description: 'Load truck, deliver to customers, apply worm tea',
      metrics: ['6 hr/mo', '10 stops'],
      tasks: [
        { name: 'Load truck', minPerMonth: 60 },
        { name: 'Customer stops', minPerMonth: 300 }
      ]
    }
  },
  {
    id: 'purchasers',
    type: 'compostNode',
    position: { x: 800, y: 160 },
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
