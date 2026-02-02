# Compost Coordinator

**Youth-Operated Vermicomposting Business Model**

Interactive visual tool for planning and explaining a hyperlocal composting operation that converts neighborhood food waste into premium vermicompost.

## Quick Start

```bash
# No build step required - just serve the files
python -m http.server 8081

# Open in browser
http://localhost:8081
```

## What It Does

Visualizes a 4-stage vermicomposting system with adjustable inputs. Shows how material flows from households through composting stages to customers, calculating labor hours and revenue in real-time.

## Business Model Summary

| Metric | Value |
|--------|-------|
| Households served | 15 |
| Monthly revenue | $4,375 |
| Monthly labor | 40.4 hours |
| Effective rate | **$108/hr** |
| Setup cost | ~$250 |
| Annual revenue | ~$40,000 |

### Revenue Streams

| Stream | Units | Price | Monthly |
|--------|-------|-------|---------|
| Waste pickup subscription | 15 households | $25/mo | $375 |
| Vermicompost sales | 185 gal | $20/gal | $3,700 |
| Worm tea application | 20 gal | $15/gal | $300 |
| **Total** | | | **$4,375** |

### Input Requirements (per month)

| Input | Per Household | Total (15 households) |
|-------|---------------|----------------------|
| Cardboard | 24 gal | 360 gal |
| Food waste | 8 gal | 120 gal |
| **Total input** | 32 gal | 480 gal |

### Output Production

| Output | Volume | Notes |
|--------|--------|-------|
| Finished vermicompost | 200 gal | ~42% of input volume |
| Give-back to subscribers | -12.5 gal | 10 gal/year per household |
| Sellable compost | 187.5 gal | What gets sold |
| Worm tea concentrate | 20 gal | Diluted 10:1 for application |

### Labor Hours (per month)

| Task | Hours | Notes |
|------|-------|-------|
| **Collection** | 16.0 | |
| - Drive route | 3.0 | 45 min/week |
| - Collect food waste buckets | 5.0 | 5 min × 15 households |
| - Collect cardboard | 3.0 | 3 min × 15 households |
| - Return clean buckets | 3.0 | 3 min × 15 households |
| - Bucket cleaning | 2.0 | 30 min/week batch |
| **Cardboard Processing** | 10.0 | |
| - Break down + remove plastic | 6.0 | 90 min/week |
| - Shred | 3.0 | 45 min/week |
| - Bag/containerize | 1.0 | 15 min/week |
| **Composting** | 6.7 | |
| - Add materials to Stage 1 | 2.0 | 30 min/week |
| - Monitor Stages 2-4 | 0.7 | 10 min/week |
| - Move piles (3 moves) | 3.0 | 60 min each, monthly |
| - Harvest Stage 4 | 1.0 | 60 min, monthly |
| **Worm Tea** | 1.7 | |
| - Collect castings | 0.25 | 15 min |
| - Set up brew | 0.33 | 20 min |
| - Load brew vat | 0.25 | 15 min |
| - Apply at customer sites | 0.83 | 50 min |
| **Delivery** | 6.0 | |
| - Load truck | 1.0 | 60 min |
| - Customer stops | 5.0 | 10 stops × 30 min |
| **Total** | **40.4** | |

### Capital Costs (scaled operation)

| Category | Item | Cost |
|----------|------|------|
| **Composting** | Pallet bins (4x, salvaged) | $0 |
| | Pitchforks (2x) | $50 |
| | Heavy-duty wheelbarrow | $150 |
| | Collection buckets (20x) | $100 |
| | Compost thermometer | $30 |
| **Cardboard** | Electric leaf shredder | $200 |
| **Worm Tea** | 50-gal drum + aerator pump | $100 |
| | Spigots and fittings | $30 |
| **Logistics** | Used zero-turn mower (54") | $4,000 |
| | Used ATV (Honda/Yamaha) | $2,500 |
| | Small utility trailer | $500 |
| **Lawn Service** | Gas backpack blower | $400 |
| | Cyclone Rake tow-behind (415 gal) | $2,500 |
| **Total** | | **~$10,560** |

### Future Service Add-ons

| Service | Equipment | Cost | Rate |
|---------|-----------|------|------|
| Lawn aeration | Tow-behind aerator | $300-500 | $50-100/yard |
| Mowing | (included with zero-turn) | - | $40-60/yard |
| Leaf removal | (included with Cyclone Rake) | - | $50+/yard |

### Subscription Model

| Type | Price | Notes |
|------|-------|-------|
| Monthly | $25/mo | Trial period, higher churn |
| Annual | $250/yr | Preferred - predictable, fewer fees |
| HOA contract | Custom | Lump sum, no per-household transactions |

**Scaling path:** Start with 10-15 individual households → prove model → pitch HOA board for neighborhood-wide contract.

### Composting Stages

| Stage | Duration | What Happens |
|-------|----------|--------------|
| Stage 1: Active | 3-4 weeks | Hot composting at 130-160°F |
| Stage 2: Cooling | 3-4 weeks | Temperature drops, bacteria shift |
| Stage 3: Worms | 3-4 weeks | Worms enter and process material |
| Stage 4: Harvest | Ongoing | Spread, light expose, collect castings |

**Physical setup:** 4×4×4 ft piles on slope, gravity-flow between stages, log barriers, PVC aeration pipes.

### Seasonal Operation (Michigan)

| Period | Months | Activity | Revenue |
|--------|--------|----------|---------|
| Active | Mar-Nov (9) | Full operation | $4,375/mo |
| Winter | Dec-Feb (3) | Collection only, stockpile | $375/mo |
| **Annual** | 12 | | **$40,500** |

## Features

- Adjust inputs (households, prices, give-back amounts)
- See revenue, labor, and $/hr update live
- Click nodes to view task breakdowns
- Animated material flow visualization

## Tech Stack

- Vanilla JavaScript (ES Modules)
- HTML5 / CSS3
- SVG for diagram rendering
- No dependencies, no build tools

## File Structure

```
├── index.html      # Page structure
├── app.js          # Event handling, state
├── calculator.js   # Business logic (tested)
├── config.js       # All data: nodes, edges, prices
├── diagram.js      # SVG rendering
├── styles.css      # Dark theme, animations
└── tests/
    ├── calculator.test.js
    └── test-runner.html
```

## The Story

Youth-produced. Hyperlocal. Food-waste-diverted. Carbon-negative.

Neighbors pay $25/month for food waste pickup. Their scraps become premium vermicompost delivered back to the community. Local high schoolers run the operation, earning $50-100/hr effective rate while learning regenerative agriculture.

## License

MIT
