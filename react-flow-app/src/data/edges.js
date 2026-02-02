/**
 * Edge data with enhanced schema for React Flow
 * Now includes: multiple icons, work + materials, bidirectional flows, frequency encoding
 */

export const initialEdges = [
  // ========================================
  // Food waste flow (weekly pickup)
  // ========================================
  {
    id: 'food-households-collection',
    source: 'households',
    target: 'collection',
    type: 'animatedEdge',
    data: {
      icons: ['🚛', '🪣', '🍎'],  // Truck (pickup work), dirty buckets, food waste
      bidirectional: true,
      reverseIcons: ['🪣'],  // Clean buckets return
      description: 'Weekly pickup of food waste in 5-gallon buckets',
      tasks: [
        { name: 'Drive collection route (food)', minPerWeek: 45 },
        { name: 'Collect food waste buckets', minPerWeek: 75 },
        { name: 'Return clean buckets', minPerWeek: 45 }
      ],
      frequency: {
        value: 1,
        unit: 'weekly',
        hoursPerPeriod: 2.75
      },
      volume: {
        amount: 150,
        unit: 'gal/week'
      },
      strokeWidth: 4,
      animationDuration: 1.5
    },
    style: {
      strokeWidth: 4,
      stroke: '#22c55e'
    }
  },

  {
    id: 'food-collection-processing',
    source: 'collection',
    target: 'foodWasteProcessing',
    type: 'animatedEdge',
    data: {
      icons: ['🍎'],  // Food waste
      description: 'Food waste moved to processing area',
      tasks: [
        { name: 'Sort and clean', minPerWeek: 30 },
        { name: 'Measure quantities', minPerWeek: 15 }
      ],
      frequency: {
        value: 1,
        unit: 'weekly',
        hoursPerPeriod: 0.75
      },
      volume: {
        amount: 150,
        unit: 'gal/week'
      },
      strokeWidth: 3,
      animationDuration: 2
    },
    style: {
      strokeWidth: 3,
      stroke: '#22c55e'
    }
  },

  {
    id: 'food-processing-stage1',
    source: 'foodWasteProcessing',
    target: 'stage1',
    type: 'animatedEdge',
    data: {
      icons: ['🍎'],  // Food waste to stage 1
      description: 'Prepared food waste added to active composting',
      tasks: [
        { name: 'Add materials to Stage 1', minPerWeek: 30 }
      ],
      frequency: {
        value: 1,
        unit: 'weekly',
        hoursPerPeriod: 0.5
      },
      volume: {
        amount: 150,
        unit: 'gal/week'
      },
      strokeWidth: 3,
      animationDuration: 2
    },
    style: {
      strokeWidth: 3,
      stroke: '#22c55e'
    }
  },

  // ========================================
  // Cardboard flow (weekly pickup)
  // ========================================
  {
    id: 'cardboard-households-collection',
    source: 'households',
    target: 'collection',
    type: 'animatedEdge',
    data: {
      icons: ['🚛', '📦'],  // Truck (shared route), cardboard boxes
      description: 'Weekly pickup of cardboard (shared route with food waste)',
      tasks: [
        { name: 'Collect cardboard', minPerWeek: 45 }
      ],
      frequency: {
        value: 1,
        unit: 'weekly',
        hoursPerPeriod: 0.75
      },
      volume: {
        amount: 50,
        unit: 'boxes/week'
      },
      strokeWidth: 4,
      animationDuration: 1.5
    },
    style: {
      strokeWidth: 4,
      stroke: '#f59e0b'
    }
  },

  {
    id: 'cardboard-collection-processing',
    source: 'collection',
    target: 'cardboard',
    type: 'animatedEdge',
    data: {
      icons: ['📦'],  // Cardboard boxes
      description: 'Cardboard moved to processing area',
      frequency: {
        value: 1,
        unit: 'weekly',
        hoursPerPeriod: 0
      },
      volume: {
        amount: 50,
        unit: 'boxes/week'
      },
      strokeWidth: 3,
      animationDuration: 2
    },
    style: {
      strokeWidth: 3,
      stroke: '#f59e0b'
    }
  },

  {
    id: 'cardboard-processing-stage1',
    source: 'cardboard',
    target: 'stage1',
    type: 'animatedEdge',
    data: {
      icons: ['✂️', '📄'],  // Shredding work → shredded cardboard
      description: 'Cardboard shredding and added to composting',
      tasks: [
        { name: 'Break down + remove plastic', minPerWeek: 90 },
        { name: 'Shred', minPerWeek: 45 },
        { name: 'Bag/containerize', minPerWeek: 15 }
      ],
      frequency: {
        value: 1,
        unit: 'weekly',
        hoursPerPeriod: 2.5
      },
      volume: {
        amount: 50,
        unit: 'boxes/week'
      },
      strokeWidth: 3,
      animationDuration: 2
    },
    style: {
      strokeWidth: 3,
      stroke: '#f59e0b'
    }
  },

  // ========================================
  // Composting stages (monthly transitions)
  // ========================================
  {
    id: 'compost-stage1-stage2',
    source: 'stage1',
    target: 'stage2',
    type: 'animatedEdge',
    data: {
      icons: ['👷', '🦠', '🌡️'],  // Human labor, microbes, heat
      description: 'Monthly pile turning + hot composting decomposition',
      tasks: [
        { name: 'Move pile from Stage 1 to Stage 2', minPerMonth: 60 },
        { name: 'Monitor temperature', minPerWeek: 5 }
      ],
      frequency: {
        value: 1,
        unit: 'monthly',
        hoursPerPeriod: 1.3
      },
      volume: {
        amount: 200,
        unit: 'gal/month'
      },
      strokeWidth: 3,
      animationDuration: 3
    },
    style: {
      strokeWidth: 3,
      stroke: '#84cc16'
    }
  },

  {
    id: 'compost-stage2-stage3',
    source: 'stage2',
    target: 'stage3',
    type: 'animatedEdge',
    data: {
      icons: ['👷', '🦠'],  // Human labor, mesophilic bacteria
      description: 'Monthly pile turning + cooling phase decomposition',
      tasks: [
        { name: 'Move pile from Stage 2 to Stage 3', minPerMonth: 60 },
        { name: 'Monitor moisture', minPerWeek: 5 }
      ],
      frequency: {
        value: 1,
        unit: 'monthly',
        hoursPerPeriod: 1.3
      },
      volume: {
        amount: 200,
        unit: 'gal/month'
      },
      strokeWidth: 3,
      animationDuration: 3
    },
    style: {
      strokeWidth: 3,
      stroke: '#84cc16'
    }
  },

  {
    id: 'compost-stage3-stage4',
    source: 'stage3',
    target: 'stage4',
    type: 'animatedEdge',
    data: {
      icons: ['👷', '🪱'],  // Human labor, worms processing
      description: 'Monthly pile turning + worm processing into castings',
      tasks: [
        { name: 'Move pile from Stage 3 to Stage 4', minPerMonth: 60 },
        { name: 'Maintain wedge connection', minPerMonth: 10 }
      ],
      frequency: {
        value: 1,
        unit: 'monthly',
        hoursPerPeriod: 1.17
      },
      volume: {
        amount: 200,
        unit: 'gal/month'
      },
      strokeWidth: 3,
      animationDuration: 3
    },
    style: {
      strokeWidth: 3,
      stroke: '#84cc16'
    }
  },

  // ========================================
  // Worm migration (bidirectional, autonomous)
  // ========================================
  {
    id: 'worms-stage4-stage3',
    source: 'stage4',
    target: 'stage3',
    type: 'animatedEdge',
    data: {
      icons: ['🪱'],  // Worms migrate autonomously
      bidirectional: true,
      reverseIcons: ['🪱'],  // Worms move both directions
      description: 'Worms autonomously migrate between Stage 3 and Stage 4',
      frequency: {
        value: 1,
        unit: 'continuous',
        hoursPerPeriod: 0  // Autonomous, no labor
      },
      volume: {
        amount: 0,
        unit: 'worms'
      },
      strokeWidth: 2,
      animationDuration: 4
    },
    style: {
      strokeWidth: 2,
      stroke: '#ec4899'
    }
  },

  // ========================================
  // Worm tea production
  // ========================================
  {
    id: 'castings-stage4-tea',
    source: 'stage4',
    target: 'tea',
    type: 'animatedEdge',
    data: {
      icons: ['🌱'],  // Castings for tea brewing
      description: 'Finished vermicompost castings collected for tea brewing',
      tasks: [
        { name: 'Collect castings for tea', minPerMonth: 15 }
      ],
      frequency: {
        value: 1,
        unit: 'monthly',
        hoursPerPeriod: 0.25
      },
      volume: {
        amount: 20,
        unit: 'gal castings/month'
      },
      strokeWidth: 3,
      animationDuration: 2.5
    },
    style: {
      strokeWidth: 3,
      stroke: '#06b6d4'
    }
  },

  {
    id: 'tea-tea-delivery',
    source: 'tea',
    target: 'delivery',
    type: 'animatedEdge',
    data: {
      icons: ['🫖', '💧'],  // Brewing work → worm tea
      description: 'Brewed worm tea ready for delivery',
      tasks: [
        { name: 'Set up brew', minPerMonth: 20 },
        { name: 'Load brew vat', minPerMonth: 15 }
      ],
      frequency: {
        value: 1,
        unit: 'monthly',
        hoursPerPeriod: 0.58
      },
      volume: {
        amount: 20,
        unit: 'gal tea/month'
      },
      strokeWidth: 3,
      animationDuration: 2.5
    },
    style: {
      strokeWidth: 3,
      stroke: '#06b6d4'
    }
  },

  // ========================================
  // Delivery flows
  // ========================================
  {
    id: 'compost-stage4-delivery',
    source: 'stage4',
    target: 'delivery',
    type: 'animatedEdge',
    data: {
      icons: ['🌱'],  // Harvested vermicompost
      description: 'Finished vermicompost ready for delivery',
      tasks: [
        { name: 'Spread and light expose', minPerMonth: 30 },
        { name: 'Harvest castings', minPerMonth: 30 }
      ],
      frequency: {
        value: 1,
        unit: 'monthly',
        hoursPerPeriod: 1
      },
      volume: {
        amount: 200,
        unit: 'gal compost/month'
      },
      strokeWidth: 3,
      animationDuration: 2.5
    },
    style: {
      strokeWidth: 3,
      stroke: '#84cc16'
    }
  },

  {
    id: 'products-delivery-purchasers',
    source: 'delivery',
    target: 'purchasers',
    type: 'animatedEdge',
    data: {
      icons: ['🚚', '💰', '💧', '🌱'],  // Delivery work → payment → tea + compost
      description: 'Monthly delivery to customers (paid orders)',
      tasks: [
        { name: 'Load truck', minPerMonth: 60 },
        { name: 'Customer stops (purchasers)', minPerMonth: 180 }
      ],
      frequency: {
        value: 1,
        unit: 'monthly',
        hoursPerPeriod: 4
      },
      volume: {
        amount: 150,
        unit: 'gal total/month'
      },
      strokeWidth: 3,
      animationDuration: 2.5
    },
    style: {
      strokeWidth: 3,
      stroke: '#84cc16'
    }
  },

  {
    id: 'giveback-delivery-households',
    source: 'delivery',
    target: 'households',
    type: 'animatedEdge',
    data: {
      icons: ['🚚', '💧', '🌱'],  // Delivery work → tea + compost returns
      description: 'Monthly delivery to households (compost returns program)',
      tasks: [
        { name: 'Customer stops (households)', minPerMonth: 120 }
      ],
      frequency: {
        value: 1,
        unit: 'monthly',
        hoursPerPeriod: 2
      },
      volume: {
        amount: 70,
        unit: 'gal total/month'
      },
      strokeWidth: 3,
      animationDuration: 2.5
    },
    style: {
      strokeWidth: 3,
      stroke: '#22c55e'
    }
  }
];
