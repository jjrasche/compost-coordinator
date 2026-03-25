# Mini-CASP Build Guide

Covered Aerated Static Pile — sealed pressure vessel design for a 4x4x4 ft compost section on a 10-degree slope. No turning required. Weekly additions, monthly stage transfers.

## System Overview

The pile is a low-pressure vessel. A fan pushes air into a perforated pipe at the base. Air rises through rock, then compost. An ePTFE membrane on top creates uniform backpressure across the entire surface, forcing even air distribution through the pile. The membrane is vapor-permeable (CO2 and moisture escape) but waterproof (rain stays out). Retaining logs pinch the membrane and base tarp together at the edges, sealing the vessel.

```
CROSS-SECTION (not to scale):

        ePTFE membrane (vapor-permeable, waterproof)
    ════════════════════════════════════════════════
    ┃         ↑ ↑ ↑ ↑ ↑ ↑ ↑ ↑ ↑ ↑               ┃
    ┃    Uniform backpressure (2-3" WC)            ┃
    ┃                                              ┃
    ┃    Cardboard biocover (4-6" flat pieces)     ┃ ← Poly sheeting
    ┃    ─────────────────────────────────         ┃    on inside of logs
    ┃    Compost mix (greens + browns, 3:1)        ┃
    ┃    ~3.5 ft of material                       ┃
    ┃         ↑ ↑ ↑ ↑ ↑ ↑ ↑ ↑ ↑ ↑               ┃
    ┃    2-3" river rock (1-2" stone)              ┃
    ┃    ═══════[4" PVC pipe]═══════               ┃
    ════════════════════════════════════════════════
         Tarp (airtight base)
         ↑ membrane tucked under ↑
```

## Build Process

### Step 1: Site Prep

1. Clear a 6x6 ft area at the hilltop
2. Level using the natural slope — build up the downhill side with logs stacked to ~8.5" (compensates for 10-degree grade over 4 ft)
3. Dig a shallow groove (~1 inch deep) around the perimeter where the retaining logs will sit
4. Select retaining logs with flat undersides, or shape the ground to conform to the logs

### Step 2: Base Layer

1. Lay the ePTFE membrane flat on the ground, centered, oversized (~8x8 ft for a 4x4 pile)
2. Lay the base tarp (~6x6 ft) on top of the membrane, centered
3. The membrane edges extend past the tarp on all sides — this is intentional

### Step 3: Edge Seal (Cross-Tension Log-Pinch)

This is a 2-3 person job. The base tarp and ePTFE membrane cross over each other at the edges in opposite directions, creating a seal with no single seam to fail.

1. Sew or rivet fabric handles onto the edges of both the base tarp and the ePTFE membrane (webbing loops every 2-3 ft along the perimeter)
2. After loading compost (Step 5), pull the base tarp UP the sides of the pile as high as practical (1-2 ft covers the rock plenum zone where pressure is highest)
3. Simultaneously, pull the ePTFE membrane DOWN the sides and UNDER the pile
4. The two layers cross over each other on the sides — tarp going up, membrane coming down
5. Roll retaining logs against the pile, pressing the tensioned fabric and compost together
6. Optionally loop handle straps over log ends to maintain tension

```
EDGE SEAL DETAIL (cross-section):

         membrane on top
              ↓
    ┌─────────────────────────┐
    │    Compost               │
    │    (compressed at edge    │← LOG pressed against pile
    │     by log + tension)    ██
    │                         ╱██╲
    │    Mesh + bricks      ╱ ██ ╲
    └───────────────────────╱──██──╲──
        tarp goes UP  ────╱   ██   ╲──── membrane goes UNDER
                                ground
```

**Why this works:**
- Two layers going in opposite directions — no single seam, the layers cross and overlap
- The pile itself is the gasket — compost compressed between tensioned fabric and log
- Five airtight faces (tarp covers bottom + lower sides), one breathable face (membrane on top)
- Air can only exit through the membrane on top — exactly what CASP systems want
- Log locks the tension and provides structural retention

Three sides are fixed. The downhill log is removable for monthly stage transfers — re-tension after each transfer.

### Step 4: Pipe and Raised Floor Plenum

1. Lay a single 4" perforated PVC pipe (SDR-35) on the base tarp, entering from one side (between or under a retaining log)
2. Pipe runs the length of the pile (~4 ft), capped at the far end
3. Holes are 3/8" diameter, 4" apart, at the 4 o'clock and 8 o'clock positions (pointing down to prevent clogging)
4. Place bricks in a grid pattern across the 4x4 base, spaced 10-12 inches apart (~15 bricks). Standard bricks are 2.25" tall.
5. Lay a 6-gauge welded wire panel (4"×4" mesh, cut from a utility/cattle panel) on top of the bricks. This is the structural layer — handles all 2,500 lbs of compost weight with a 2.5-3x safety factor at 12" brick spacing.
6. Lay 1/4" galvanized hardware cloth (23 gauge) on top of the welded wire panel. This is the screening layer — 1/4" openings retain all food scraps and cardboard. Carries no structural load. Replace annually if corrosion is a concern (~$12-18).
7. This creates a ~2.25" open air cavity under the mesh. Air exits the pipe, fills the cavity uniformly (open space = near-zero resistance to lateral flow), then rises through the composite mesh into the compost above.
8. No loose fill material — nothing to separate during stage transfers. The mesh layers are a clear stopping point when forking.

### Step 5: Load Compost

1. Mix food scraps and shredded cardboard at 3:1 ratio (browns to greens by volume) — rough mix is fine
2. Load onto the hardware cloth, filling to ~4 ft height
3. Ensure compost extends past the retaining logs slightly on all sides

### Step 6: Seal the Top

1. Fold the ePTFE membrane (which is still extending out past the base) up and over the pile
2. Drape over the top and down all sides
3. Tuck excess membrane under the retaining logs or weight with rocks on the ground around the perimeter
4. The pipe exit point is the only penetration — the membrane drapes over/around it

### Step 7: Aeration System

Connect in this order (outside the pile):

```
Extension cord → ESP32 relay (controls power) → Fan (Cloudline A4)
    → Fernco P1056-44 coupling → Blast gate (POWERTEC 4")
    → Solid PVC section → into pile → Perforated PVC under rocks → Cap
```

1. The fan + ESP32 + blast gate assembly sits outside the pile, sheltered under an inverted Rubbermaid tub with a notch cut for cords
2. Insert the DS18B20 temperature probe into the pile center (~2 ft deep) through the membrane, seal the penetration with tape
3. Set initial cycle: 30 seconds on / 30 minutes off, blast gate 1/4 open
4. Power via 150 ft outdoor extension cord (10/3 SJTW) from house

---

## Structural Analysis

### Airflow Distribution

**Problem:** Air enters from a single pipe at the base. Does it distribute evenly across the entire 4x4 pile?

**Three mechanisms work together:**

1. **Raised floor plenum (primary lateral distribution):** Air exits the pipe holes downward, hits the tarp base, and fills the open 2.25" air cavity created by the brick-supported hardware cloth. This cavity has near-zero resistance to lateral flow — it's open space. Air pressure equalizes across the entire 4x4 base before pushing up through the mesh into the compost. No loose fill, no porosity concerns.

2. **ePTFE membrane backpressure (primary vertical distribution):** The membrane creates 2-3 inches water column of uniform resistance across the entire top surface. This is the key difference from a standard open-top ASP. Air must push through the full pile depth AND through the membrane to escape. Because the membrane resistance is uniform everywhere, air distributes evenly — there's no "easy exit" at any particular point.

3. **Sealed side walls (prevents short-circuiting):** Poly sheeting on log faces + log-pinch edge seal blocks the lowest-resistance escape paths. Without sealed sides, air would exit through the rock plenum edges rather than pushing up through dense compost.

**Validation math:**

| Parameter | Value |
|-----------|-------|
| Fan CFM (at speed 5/10, blast gate 1/4 open) | ~30-50 CFM |
| Air delivered per 30-sec cycle | 15-25 cu ft |
| Pile air volume (64 cu ft × 35% porosity) | ~22 cu ft |
| Air changes per fan cycle | ~0.7-1.1 (near-complete replacement) |
| Passive chimney flow between cycles | ~1-3 CFM continuous |
| Engineering standard (continuous) | 10 CFM (4 CFM/CY × 2.4 CY) |
| Effective continuous delivery | ~1.6 CFM (fan) + ~2 CFM (chimney) = ~3.6 CFM |
| Edge leakage with log-pinch seal | Estimated 5-10% |

The system operates at ~36% of the continuous engineering standard, which is appropriate for intermittent aeration. O2Compost's 1,600+ systems use similar duty cycles. Between fan pulses, the pile's own heat drives the chimney effect — hot air rising through the membrane pulls fresh air passively through the open pipe. The fan supplements natural convection rather than replacing it.

**Over-drying is the dominant failure mode, not under-aeration.** Urban Worm Company documented a pile crashing from 130°F to 100°F in 2 days from excess airflow. The compost went hydrophobic below 50% moisture and would not reabsorb water. The ePTFE membrane mitigates this by retaining moisture that would otherwise escape as vapor. Start conservative: blast gate 1/4 open, 30 sec on / 30 min off. Adjust based on ESP32 temperature data.

### Weight Distribution

**Pile weight on the raised floor:**

| Component | Weight |
|-----------|--------|
| Compost mix (64 cu ft × 35-45 lbs/cu ft) | 2,240-2,880 lbs |
| Membrane | ~5 lbs |
| **Total on mesh** | **~2,250-2,900 lbs** |

Distributed over 16 sq ft (4x4 base) = **141-181 lbs/sq ft** = **1.0-1.3 PSI**

**Pipe crush resistance:** 4" SDR-35 PVC has a wall thickness of 0.14". The pipe sits below the brick-supported hardware cloth, so compost weight bears on the mesh and bricks, not the pipe directly. The pipe only supports its own weight. No crush risk.

**Hardware cloth load capacity:** 1/4" galvanized mesh (23 gauge) with bricks spaced 10-12" apart. Maximum unsupported span: 12 inches. Load per span: ~180 lbs/sq ft × 1 sq ft = 180 lbs distributed. 23-gauge welded mesh handles this without deformation. Bricks (standard 2.25 × 3.75 × 8") each support ~500+ lbs in compression — far above the ~180 lbs per brick in this application.

**Tarp durability:** Standard poly tarp under 2,300+ lbs of static load on a smooth brick/mesh surface will last multiple seasons. No abrasion from movement (the pile is static). UV exposure is zero (fully covered). Replace when it tears from forking during stage transfers.

### Pressure Vessel Integrity

**Internal pressure during fan cycles:**

The fan generates up to 0.5" WC static pressure (at the reduced speed/blast gate setting). The membrane creates 2-3" WC backpressure. The system operates at very low pressure — roughly 0.07-0.18 PSI above atmospheric.

**Force on the membrane from internal pressure:**

- At 3" WC (0.11 PSI) over 16 sq ft (2,304 sq in): **~253 lbs of uplift force** distributed across the entire membrane surface
- The membrane weighs ~5 lbs. The cardboard biocover and compost below it weigh thousands of pounds.
- The membrane inflates slightly (billows) during the 30-second fan pulse, then settles during the 30-minute off period
- Edge seal force needed: negligible. The 253 lbs acts upward on the membrane, not outward on the edges. The edge seal only needs to prevent air from sneaking under the logs, which the log weight (50-100 lbs per log × 4 logs = 200-400 lbs on edges) handles with margin.

**Between fan cycles:**

- Residual pressure dissipates through the membrane over minutes (vapor-permeable)
- CO2 and excess moisture escape passively
- No anaerobic risk because the membrane is breathable — it creates resistance, not a hermetic seal

### Thermal Performance

**Heat generation:** Thermophilic bacteria generate 3-5 BTU per pound of volatile solids per day. A 2,500 lb pile with 60% volatile solids content generates roughly 4,500-7,500 BTU/day.

**Heat loss pathways:**

| Path | Mechanism | Mitigation |
|------|-----------|------------|
| Top surface | Convection + radiation | ePTFE membrane blocks wind convection; retains some radiant heat |
| Sides | Conduction through logs + convection | Cross-tensioned tarp covers lower sides; logs provide ~R-1 per inch |
| Bottom | Conduction to ground | Tarp + 2.25" brick air cavity provides slight insulation; ground is ~55°F in summer |
| Aeration | Fan pushes cool air through pile | Intermittent cycle (30 sec/30 min) minimizes cooling; blast gate restricts volume |
| Evaporation | Moisture loss carries latent heat | Membrane retains moisture — biggest thermal benefit vs open-top ASP |

**Expected temperature profile (active season, March-October):**
- Core: 130-160°F (thermophilic, pathogen-kill range)
- Mid-depth: 110-140°F
- Near-surface: 90-120°F
- Edge (near logs): 80-110°F

The membrane's moisture retention is the largest thermal benefit. In an open-top ASP, evaporative cooling is the dominant heat loss mechanism (each pound of water evaporated removes ~1,000 BTU). The membrane traps moisture vapor, which condenses on its underside and drips back into the pile. This recirculation significantly reduces net heat loss.

---

## Weekly Operation

1. Release tension on one side (lift log, free handle straps)
2. Fold back membrane
3. Dump food scraps from collection buckets
4. Mix in shredded cardboard at 3:1 ratio (alternate scoops + fork-toss, 60 seconds)
5. Re-drape membrane, re-tension edge, re-seat log
6. Check ESP32 temp reading — adjust blast gate or cycle timing if needed

**Time: ~30-45 minutes** including collection route.

## Monthly Stage Transfer

1. Remove the downhill retaining log (it's just resting, not staked)
2. Fold back membrane on the downhill side
3. Fork compost off the top of the hardware cloth, over the edge, into Stage 2 below
4. Bricks and mesh stay behind — obvious stopping point when forking
5. Re-tension edge: re-drape membrane, pull tarp up, re-seat downhill log
6. Repeat Stage 2 → Stage 3 if applicable
7. Refill Stage 1 with fresh material over the following weeks

**Time: 20-40 minutes per stage**, two workers with pitchforks.

---

## Future Upgrade: Tilt Platform for Stage Transfer

If manual forking becomes a bottleneck, the raised floor can be upgraded to a tiltable dump platform. This is a bolt-on addition — the composite mesh floor, bricks, and pipe sit on top of the platform.

### Concept

The platform hinges on the downhill edge. A hi-lift farm jack on the uphill side lifts the platform to ~30°. Compost slides off the HDPE surface into the next stage downhill. Then hose down the platform and reload.

```
SIDE VIEW — tilt in action:

                    ╱ compost slides out
                  ╱     ↓ ↓ ↓
                ╱─────────────────╲
              ╱  HDPE platform      ║
            ╱  + mesh + bricks      ║ ← hi-lift jack nose
          ╱                         ║    under angle iron lip
        ╱                           ║
  ═══╱══════════════════════        ║
  HINGE                        [JACK BASE]
  (downhill edge)              (on ground, uphill)
```

### Tilt Force Analysis

- Platform + compost: ~2,500 lbs
- Hinge on downhill edge, jack on uphill edge (48" apart)
- Center of gravity: 24" from hinge (center of 4ft bed)
- **Force to start lift: 2,500 × 24" / 48" = 1,250 lbs**
- Hi-lift farm jack: rated 7,000 lbs (3.5 ton). Safety factor: 5.6x
- Lift needed for 30° tilt: 24 inches
- Pumps: ~24 (one inch per pump), about 1 minute of work
- The jack is portable — walk it over, slide the nose under the angle iron lip, pump, dump, remove

### Materials

| Component | Spec | Cost |
|-----------|------|------|
| Steel angle iron frame | 2"×2"×1/4", welded/bolted 4×4 ft rectangle + center cross-member | $60-80 |
| HDPE sheet | 3/4" × 4' × 4', screwed to frame | $80-120 |
| Strap hinges | 2× heavy-duty, bolted to PT 6×6 ground sill on downhill edge | $15-20 |
| Angle iron lip | 2" piece on uphill edge for jack to grab under | $3 |
| Hi-lift farm jack | 3 ton, 48" lift | $40 |
| **Total** | | **$198-263** |

### Why HDPE (not wood)

Hot (130-160°F), wet (50-60% moisture), acidic (pH 4-6) compost destroys wood:
- OSB: delaminates in weeks
- Plywood: structural failure in 2-4 months
- Pressure-treated plywood: 6-12 months, chemicals leach into compost

HDPE (high-density polyethylene) is rated for continuous service to 230°F, impervious to water/acid/biology, and the slippery surface helps compost slide during tilt. Lasts indefinitely.

### Build Sequence

Don't build this initially. Fork manually for the first few months. If the monthly transfer is the pain point, add the platform under the existing raised floor as an upgrade. The mesh, bricks, and pipe sit on top of the HDPE exactly as they sit on the tarp today.
