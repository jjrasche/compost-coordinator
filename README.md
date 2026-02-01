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

**Revenue streams:**
- Waste pickup subscriptions ($25/mo)
- Vermicompost sales ($20/gal)
- Worm tea application ($15/gal)

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
