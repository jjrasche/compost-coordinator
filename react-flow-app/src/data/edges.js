/**
* Edge definitions for React Flow compost diagram
*
* Philosophy: Edges tell stories through icon convoys.
* Each icon sequence shows: [output material] → [tool] → moving toward next state.
* People are implicit (every edge is a task). Trucks are nodes, not edge icons.
*
* sourceHandle / targetHandle must match handle IDs in CompostNode.jsx:
*   Sources: 'top-source', 'right-source', 'bottom-source', 'left-source'
*   Targets: 'top', 'right', 'bottom', 'left'
*/

export const initialEdges = [
	// ========================================
	// Inbound flow: Households → Collection (weekly)
	// ========================================
	{
		id: 'households-collection',
		type: 'animatedEdge',
		source: 'households',
		sourceHandle: 'left-source',
		sourcePosition: 'left',
		target: 'collection',
		targetHandle: 'right',
		targetPosition: 'right',
		data: {
			icons: ['🪣', '🍎', '📦', '🍂', '🌿'],
			bidirectional: true,
			reverseIcons: ['🧹', '🪣'],
			description: 'Weekly pickup: full buckets of food scraps, cardboard, and leaves head to the collection vehicle. Clean buckets return.',
			tasks: [
				{ name: 'Drive collection route', minPerWeek: 45 },
				{ name: 'Collect food waste buckets', minPerWeek: 75 },
				{ name: 'Collect cardboard', minPerWeek: 45 },
				{ name: 'Return clean buckets', minPerWeek: 45 },
				{ name: 'Bucket cleaning', minPerWeek: 30 }
			],
			frequency: {
				value: 1,
				unit: 'weekly',
				hoursPerPeriod: 4
			},
			volume: {
				amount: 200,
				unit: 'gal/week'
			},
			strokeWidth: 4
		},
		style: {
			strokeWidth: 4,
			stroke: '#22c55e'
		}
	},
	
	// ========================================
	// Collection → Storage (weekly)
	// ========================================
	{
		id: 'collection-greens',
		type: 'animatedEdge',
		source: 'collection',
		sourceHandle: 'bottom-source',
		sourcePosition: 'bottom',
		target: 'greensStore',
		targetHandle: 'top',
		targetPosition: 'top',
		data: {
			icons: ['🍎', '🌿'],
			description: 'Food scraps and grass clippings sorted and stored in greens pile',
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
			strokeWidth: 4
		},
		style: {
			strokeWidth: 4,
			stroke: '#22c55e'
		}
	},
	
	{
		id: 'collection-browns',
		type: 'animatedEdge',
		source: 'collection',
		sourceHandle: 'bottom-source',
		sourcePosition: 'bottom',
		target: 'brownsStore',
		targetHandle: 'top',
		targetPosition: 'top',
		data: {
			icons: ['📦', '✂️', '🍂'],
			description: 'Cardboard shredded and leaves stored in browns pile',
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
			strokeWidth: 4
		},
		style: {
			strokeWidth: 4,
			stroke: '#f59e0b'
		}
	},
	
	// ========================================
	// Storage → Stage 1 (weekly)
	// ========================================
	{
		id: 'greens-stage1',
		type: 'animatedEdge',
		source: 'greensStore',
		sourceHandle: 'bottom-source',
		sourcePosition: 'bottom',
		target: 'stage1',
		targetHandle: 'top',
		targetPosition: 'top',
		data: {
			icons: ['🟢'],
			description: 'Nitrogen-rich greens added to hot composting',
			tasks: [
				{ name: 'Add greens to Stage 1', minPerWeek: 15 }
			],
			frequency: {
				value: 1,
				unit: 'weekly',
				hoursPerPeriod: 0.25
			},
			volume: {
				amount: 150,
				unit: 'gal/week'
			},
			strokeWidth: 3
		},
		style: {
			strokeWidth: 3,
			stroke: '#22c55e'
		}
	},
	
	{
		id: 'browns-stage1',
		type: 'animatedEdge',
		source: 'brownsStore',
		sourceHandle: 'bottom-source',
		sourcePosition: 'bottom',
		target: 'stage1',
		targetHandle: 'top',
		targetPosition: 'top',
		data: {
			icons: ['🟤'],
			description: 'Carbon-rich browns added to hot composting',
			tasks: [
				{ name: 'Add browns to Stage 1', minPerWeek: 15 }
			],
			frequency: {
				value: 1,
				unit: 'weekly',
				hoursPerPeriod: 0.25
			},
			volume: {
				amount: 50,
				unit: 'boxes/week'
			},
			strokeWidth: 3
		},
		style: {
			strokeWidth: 3,
			stroke: '#f59e0b'
		}
	},
	
	// ========================================
	// Composting stage transitions (monthly)
	// ========================================
	{
		id: 'stage1-stage2',
		type: 'animatedEdge',
		source: 'stage1',
		sourceHandle: 'right-source',
		sourcePosition: 'right',
		target: 'stage2',
		targetHandle: 'left',
		targetPosition: 'left',
		data: {
			icons: ['🟤', '⚒️'],
			description: 'Thermophilic output — partially broken down, warm dark mass with visible cardboard bits — pitchforked to Stage 2',
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
			strokeWidth: 3
		},
		style: {
			strokeWidth: 3,
			stroke: '#84cc16'
		}
	},
	
	{
		id: 'stage2-stage3',
		type: 'animatedEdge',
		source: 'stage2',
		sourceHandle: 'right-source',
		sourcePosition: 'right',
		target: 'stage3',
		targetHandle: 'left',
		targetPosition: 'left',
		data: {
			icons: ['🟫', '⚒️'],
			description: 'Mesophilic output — darker, more uniform, earthy with no recognizable food — pitchforked to Stage 3',
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
			strokeWidth: 3
		},
		style: {
			strokeWidth: 3,
			stroke: '#84cc16'
		}
	},
	
	{
		id: 'stage3-stage4',
		type: 'animatedEdge',
		source: 'stage3',
		sourceHandle: 'right-source',
		sourcePosition: 'right',
		target: 'stage4',
		targetHandle: 'left',
		targetPosition: 'left',
		data: {
			icons: ['🪱', '⚒️'],
			description: 'Worm-processed material — rich dark crumbly castings — pitchforked to Stage 4',
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
			strokeWidth: 3
		},
		style: {
			strokeWidth: 3,
			stroke: '#84cc16'
		}
	},
	
	// ========================================
	// Worm migration (one-way: stage4 → stage3)
	// ========================================
	{
		id: 'worms-stage4-stage3',
		type: 'animatedEdge',
		source: 'stage4',
		sourceHandle: 'bottom-source',
		sourcePosition: 'bottom',
		target: 'stage3',
		targetHandle: 'bottom',
		targetPosition: 'bottom',
		data: {
			icons: ['🪱'],
			description: 'Worms autonomously crawl back from Stage 4 to Stage 3 seeking fresh material',
			frequency: {
				value: 1,
				unit: 'continuous',
				hoursPerPeriod: 0
			},
			volume: {
				amount: 0,
				unit: 'worms'
			},
			strokeWidth: 2
		},
		style: {
			strokeWidth: 2,
			stroke: '#ec4899'
		}
	},
	
	// ========================================
	// Stage 4 outputs (monthly)
	// ========================================
	{
		id: 'stage4-tea',
		type: 'animatedEdge',
		source: 'stage4',
		sourceHandle: 'right-source',
		sourcePosition: 'right',
		target: 'tea',
		targetHandle: 'left',
		targetPosition: 'left',
		data: {
			icons: ['🌑'],
			description: 'Dark castings scooped from finished vermicompost for tea brewing',
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
			strokeWidth: 3
		},
		style: {
			strokeWidth: 3,
			stroke: '#06b6d4'
		}
	},
	
	{
		id: 'stage4-distribution',
		type: 'animatedEdge',
		source: 'stage4',
		sourceHandle: 'top-source',
		sourcePosition: 'top',
		target: 'distribution',
		targetHandle: 'bottom',
		targetPosition: 'bottom',
		data: {
			icons: ['🌑'],
			description: 'Finished vermicompost — high-quality dark soil — loaded for distribution',
			tasks: [
				{ name: 'Spread and light expose', minPerMonth: 30 },
				{ name: 'Harvest castings', minPerMonth: 30 },
				{ name: 'Load truck with compost', minPerMonth: 60 }
			],
			frequency: {
				value: 1,
				unit: 'monthly',
				hoursPerPeriod: 2
			},
			volume: {
				amount: 120,
				unit: 'gal compost/month'
			},
			strokeWidth: 3
		},
		style: {
			strokeWidth: 3,
			stroke: '#84cc16'
		}
	},
	
	{
		id: 'tea-distribution',
		type: 'animatedEdge',
		source: 'tea',
		sourceHandle: 'top-source',
		sourcePosition: 'top',
		target: 'distribution',
		targetHandle: 'bottom',
		targetPosition: 'bottom',
		data: {
			icons: ['💧'],
			description: 'Brewed worm tea loaded into containers for distribution',
			tasks: [
				{ name: 'Load tea containers', minPerMonth: 15 }
			],
			frequency: {
				value: 1,
				unit: 'monthly',
				hoursPerPeriod: 0.25
			},
			volume: {
				amount: 20,
				unit: 'gal tea/month'
			},
			strokeWidth: 3
		},
		style: {
			strokeWidth: 3,
			stroke: '#06b6d4'
		}
	},
	
	// ========================================
	// Distribution → Customers (monthly)
	// ========================================
	{
		id: 'distribution-purchasers',
		type: 'animatedEdge',
		source: 'distribution',
		sourceHandle: 'top-source',
		sourcePosition: 'top',
		target: 'purchasers',
		targetHandle: 'bottom',
		targetPosition: 'bottom',
		data: {
			icons: ['🌸', '🌿'],
			description: 'Compost and worm tea delivered to paying customers — gardens, flowerbeds, and lawns bloom',
			tasks: [
				{ name: 'Customer stops (purchasers)', minPerMonth: 180 }
			],
			frequency: {
				value: 1,
				unit: 'monthly',
				hoursPerPeriod: 3
			},
			volume: {
				amount: 120,
				unit: 'gal compost + 20 gal tea/month'
			},
			strokeWidth: 3
		},
		style: {
			strokeWidth: 3,
			stroke: '#84cc16'
		}
	},
	
	{
		id: 'distribution-households',
		type: 'animatedEdge',
		source: 'distribution',
		sourceHandle: 'right-source',
		sourcePosition: 'right',
		target: 'households',
		targetHandle: 'bottom',
		targetPosition: 'bottom',
		data: {
			icons: ['🌸', '🌿'],
			description: 'Compost returns to participating households — making gardens and lawns thrive',
			tasks: [
				{ name: 'Customer stops (households)', minPerMonth: 120 }
			],
			frequency: {
				value: 1,
				unit: 'monthly',
				hoursPerPeriod: 2
			},
			volume: {
				amount: 80,
				unit: 'gal compost/month'
			},
			strokeWidth: 3
		},
		style: {
			strokeWidth: 3,
			stroke: '#22c55e'
		}
	}
];
