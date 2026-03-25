# Bill of Materials — Mini-CASP Stage 1

## Aeration System

| Item | Specification | Source | Est. Cost |
|------|--------------|--------|-----------|
| Inline duct fan | AC Infinity Cloudline A4, 4", 165 CFM, 10-speed controller | [AC Infinity](https://acinfinity.com/cloudline-a4-quiet-inline-fan-4-with-speed-controller/) / Amazon | $55 |
| Blast gate | POWERTEC 70108, 4" | [Amazon](https://www.amazon.com/POWERTEC-70108-4-Inch-Vacuum-Collector/dp/B005VRPQ92) / Home Depot | $8 |
| Flexible coupling | Fernco P1056-44, 4"x4" rubber w/ hose clamps | [Home Depot](https://www.homedepot.com/p/Fernco-4-in-x-4-in-PVC-DWV-Mechanical-Flexible-Coupling-P1056-44/100372298) | $7 |
| **Subtotal** | | | **$70** |

## Controller (ESP32)

| Item | Specification | Source | Est. Cost |
|------|--------------|--------|-----------|
| ESP32 dev board | ESP32-WROOM-32 or similar | Amazon / AliExpress | $8-15 |
| Relay module | 5V single-channel, opto-isolated | Amazon | $3-5 |
| Temperature probe | DS18B20 waterproof, 1m cable | Amazon | $5-8 |
| USB power adapter | 5V 1A, outdoor-rated or sheltered | Amazon | $5-8 |
| Enclosure | Weatherproof junction box or use inverted Rubbermaid tub over entire assembly | On hand / $8 | $0-8 |
| **Subtotal** | | | **$21-44** |

## PVC Pipe

| Item | Specification | Source | Est. Cost |
|------|--------------|--------|-----------|
| Perforated PVC pipe | 4" SDR-35, 10 ft (cut to ~4 ft for under-pile, remainder is solid run to fan) | Home Depot / Lowes | $12-15 |
| PVC end cap | 4" | Home Depot | $3 |
| PVC 90-degree elbow | 4" (optional, depends on pipe routing) | Home Depot | $4 |
| **Subtotal** | | | **$19-22** |

Pre-perforated SDR-35 drain pipe is available at most hardware stores. If drilling your own: 3/8" bit, holes every 4", at 4 and 8 o'clock positions.

## Raised Floor Plenum (Composite)

| Item | Specification | Source | Est. Cost |
|------|--------------|--------|-----------|
| 6-gauge welded wire panel | Utility/cattle panel (4"×4" mesh, 5'×16'), cut to 4×4 ft. Structural layer. | Tractor Supply | $25-35 |
| 1/4" hardware cloth | 23 gauge, 48" wide × 4 ft. Screening layer (sits on panel, no structural load). | Home Depot / Lowes | $12-18 |
| Bricks | Standard (2.25 × 3.75 × 8"), ~15 in a grid at 10-12" spacing | On-site or $0.50-1.00 each | Free - $15 |
| Zip ties | UV-rated, securing hardware cloth to panel | On hand / $5 | $0-5 |
| **Subtotal** | | | **$37-73** |

## Containment

| Item | Specification | Source | Est. Cost |
|------|--------------|--------|-----------|
| ePTFE membrane | ~8 sq meters (~86 sq ft), composting grade. Handles sewn onto edges. | Chinese supplier (Chaoyue, UNM, HANCHEN) via Alibaba / AliExpress | $50-60 |
| Base tarp | ~6x6 ft, standard poly tarp. Handles sewn onto edges. Pulls UP sides during tensioning. | Home Depot / on hand | $10-15 |
| **Subtotal** | | | **$60-75** |

Note on ePTFE sourcing: Gore Cover is the commercial standard but priced for industrial scale ($$$). Chinese ePTFE membrane at $6-7/sq meter is the same base material (expanded polytetrafluoroethylene). Search Alibaba for "ePTFE composting membrane" or "Gore-Tex style compost cover." Expect 2-4 week shipping. Lifespan: 5-10+ years (UV-stable, chemically inert).

Poly sheeting on walls is no longer needed — the base tarp pulled UP the sides during cross-tensioning provides the airtight side barrier.

## Electrical

| Item | Specification | Source | Est. Cost |
|------|--------------|--------|-----------|
| Extension cord (house → hilltop) | 150 ft, 10/3 SJTW, outdoor-rated | Home Depot / Amazon | $100-150 |
| Extension cord (hilltop → valley) | 150 ft, 10/3 SJTW, outdoor-rated | Home Depot / Amazon | $100-150 |
| GFCI outdoor adapter | Plug-in, 15A or 20A | Home Depot | $15-20 |
| Outdoor cord splitter | Weather-resistant, at hilltop junction | Home Depot / Amazon | $15-25 |
| **Subtotal** | | | **$230-345** |

Electrical serves both the compost fan (hilltop) and the electric fence + electronics (valley). Total load <5A. 10 AWG at 300 ft = ~3% voltage drop (within NEC 5% guideline).

## Already On Hand

| Item | Notes |
|------|-------|
| Retaining logs | Multiple available on property. Select flat-bottomed logs for edge seal. |
| Pitchfork | For weekly additions and monthly stage transfers |
| Landscape staples | 6" galvanized |
| Wood chipper | For processing browns (not needed for plenum — using rocks) |
| Rubbermaid tubs | Weather shelter for fan/controller assembly |
| 8x 32-gal Brutes | Overflow / brown storage (not primary staging) |

## Cost Summary

| Category | Range |
|----------|-------|
| Aeration system (fan + blast gate + coupling) | $70 |
| Controller (ESP32 + relay + probe) | $21-44 |
| PVC pipe | $19-22 |
| Raised floor plenum (panel + hardware cloth + bricks) | $37-73 |
| Containment (membrane + tarp) | $60-75 |
| **Stage 1 build total** | **$207-284** |
| Electrical (both runs + GFCI + splitter) | $230-345 |
| **Grand total** | **$437-629** |

### Future Upgrade: Tilt Platform (not included in base build)

| Item | Specification | Source | Est. Cost |
|------|--------------|--------|-----------|
| Steel angle iron frame | 2"×2"×1/4", 4×4 ft rectangle + cross-member | Steel supplier / welding shop | $60-80 |
| HDPE sheet | 3/4" × 4' × 4' | US Plastics / TAP Plastics / McMaster-Carr | $80-120 |
| Strap hinges (2×) | Heavy-duty, bolted to PT 6×6 ground sill | Home Depot | $15-20 |
| Angle iron lip | 2" piece on uphill edge for jack grab | Steel supplier | $3 |
| Hi-lift farm jack | 3 ton, 48" lift range | Harbor Freight / Amazon | $40 |
| **Tilt upgrade total** | | | **$198-263** |

## Sourcing Priority

Order first (longest lead time):
1. **ePTFE membrane** — 2-4 weeks from China. Order immediately.
2. **ESP32 + sensors** — 1-2 weeks if from AliExpress, 2 days from Amazon.

Buy locally (same day):
3. PVC pipe, cap — Home Depot
4. Fernco coupling, blast gate — Home Depot
5. 6-gauge welded wire panel — Tractor Supply
6. 1/4" hardware cloth — Home Depot
7. Extension cords, GFCI adapter, cord splitter — Home Depot
8. Tarp — Home Depot

Already have:
9. Logs, pitchfork, bricks, zip ties, tubs, Brutes
