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
		sourcePosition: 'left',
		targetPosition: 'right',
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
			animationDuration: 5
		},
		style: {
			strokeWidth: 4,
			stroke: '#22c55e'
		}
	},
	
	{
		id: 'food-collection-greens',
		source: 'collection',
		target: 'greensStore',
		type: 'animatedEdge',
		sourcePosition: 'bottom',
		targetPosition: 'top',
		data: {
			icons: ['🍎'],  // Food waste to greens store
			description: 'Food waste sorted and stored in greens pile',
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
			strokeWidth: 4,
			animationDuration: 5
		},
		style: {
			strokeWidth: 4,
			stroke: '#22c55e'
		}
	},
	
	{
		id: 'greens-stage1',
		source: 'greensStore',
		target: 'stage1',
		type: 'animatedEdge',
		sourcePosition: 'bottom',
		targetPosition: 'top',
		data: {
			icons: ['🍎'],  // Greens to Stage 1
			description: 'Nitrogen-rich materials added to hot composting',
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
			strokeWidth: 3,
			animationDuration: 5
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
		sourcePosition: 'left',
		targetPosition: 'right',
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
			animationDuration: 5
		},
		style: {
			strokeWidth: 4,
			stroke: '#f59e0b'
		}
	},
	
	{
		id: 'cardboard-collection-browns',
		source: 'collection',
		target: 'brownsStore',
		type: 'animatedEdge',
		sourcePosition: 'bottom',
		targetPosition: 'top',
		data: {
			icons: ['✂️', '📄'],  // Shredding work → shredded cardboard
			description: 'Cardboard broken down, shredded, and stored in browns pile',
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
			strokeWidth: 4,
			animationDuration: 5
		},
		style: {
			strokeWidth: 4,
			stroke: '#f59e0b'
		}
	},
	
	{
		id: 'browns-stage1',
		source: 'brownsStore',
		target: 'stage1',
		type: 'animatedEdge',
		sourcePosition: 'bottom',
		targetPosition: 'top',
		data: {
			icons: ['📄'],  // Browns to Stage 1
			description: 'Carbon-rich materials added to hot composting',
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
			strokeWidth: 3,
			animationDuration: 5
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
		sourcePosition: 'right',
		targetPosition: 'left',
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
			animationDuration: 20
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
		sourcePosition: 'right',
		targetPosition: 'left',
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
			animationDuration: 20
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
		sourcePosition: 'right',
		targetPosition: 'left',
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
			animationDuration: 20
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
		sourcePosition: 'bottom',
		targetPosition: 'bottom',
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
			animationDuration: 20
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
		sourcePosition: 'right',
		targetPosition: 'left',
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
			animationDuration: 20
		},
		style: {
			strokeWidth: 3,
			stroke: '#06b6d4'
		}
	},
	
	// ========================================
	// Output flows (direct to customers)
	// ========================================
	{
		id: 'stage4-purchasers',
		source: 'stage4',
		target: 'purchasers',
		type: 'animatedEdge',
		sourcePosition: 'top',
		targetPosition: 'left',
		data: {
			icons: ['🚚', '🌱'],  // Delivery work → harvested compost
			description: 'Monthly delivery of finished vermicompost to paying customers',
			tasks: [
				{ name: 'Spread and light expose', minPerMonth: 30 },
				{ name: 'Harvest castings', minPerMonth: 30 },
				{ name: 'Load truck', minPerMonth: 60 },
				{ name: 'Customer stops (purchasers)', minPerMonth: 180 }
			],
			frequency: {
				value: 1,
				unit: 'monthly',
				hoursPerPeriod: 5
			},
			volume: {
				amount: 120,
				unit: 'gal compost/month'
			},
			strokeWidth: 3,
			animationDuration: 20
		},
		style: {
			strokeWidth: 3,
			stroke: '#84cc16'
		}
	},
	
	{
		id: 'stage4-households',
		source: 'stage4',
		target: 'households',
		type: 'animatedEdge',
		sourcePosition: 'top',
		targetPosition: 'bottom',
		data: {
			icons: ['🚚', '🌱'],  // Delivery work → compost returns
			description: 'Monthly compost returns to participating households',
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
			strokeWidth: 3,
			animationDuration: 20
		},
		style: {
			strokeWidth: 3,
			stroke: '#22c55e'
		}
	},
	
	{
		id: 'tea-purchasers',
		source: 'tea',
		target: 'purchasers',
		type: 'animatedEdge',
		sourcePosition: 'top',
		targetPosition: 'bottom',
		data: {
			icons: ['🫖', '💧', '🚚'],  // Brewing → tea → delivery
			description: 'Brewed worm tea delivered to customers',
			tasks: [
				{ name: 'Set up brew', minPerMonth: 20 },
				{ name: 'Load brew vat', minPerMonth: 15 },
				{ name: 'Apply at customer sites', minPerMonth: 50 }
			],
			frequency: {
				value: 1,
				unit: 'monthly',
				hoursPerPeriod: 1.42
			},
			volume: {
				amount: 20,
				unit: 'gal tea/month'
			},
			strokeWidth: 3,
			animationDuration: 20
		},
		style: {
			strokeWidth: 3,
			stroke: '#06b6d4'
		}
	}
];
