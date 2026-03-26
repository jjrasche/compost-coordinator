/**
 * Biological activity model — computes heat generation rate at a voxel
 * based on local temperature, moisture, and oxygen availability.
 *
 * DERIVATION (from substrate chemistry, not curve-fitting):
 *
 * Aerobic respiration of organic matter:
 *   C₆H₁₂O₆ + 6 O₂ → 6 CO₂ + 6 H₂O + heat
 *   Glucose: MW = 180 g/mol, heat of combustion = 673 kcal/mol = 2816 kJ/mol
 *
 * Real compost substrates (food waste + cardboard) are not pure glucose.
 * Measured heat of combustion:
 *   - Food waste: ~5000 BTU/lb dry (Tchobanoglous & Kreith, 2002)
 *   - Cardboard: ~7000 BTU/lb dry (higher cellulose fraction)
 *   - Blended 1:2 mix by volume ≈ 1:3 by dry weight → ~6500 BTU/lb dry
 *
 * Decomposition rate during peak thermophilic phase:
 *   - 1.5–3% of remaining VS (volatile solids) per day (Haug 1993, ch. 7)
 *   - Fresh food waste: ~85% VS, cardboard: ~90% VS → blend ≈ 88% VS
 *   - Using 2% per day as the peak rate (mid-range of literature)
 *
 * Compost bulk density: ~40 lb/ft³ wet, ~45% moisture → ~22 lb dry/ft³
 * Volatile solids: 22 × 0.88 = 19.4 lb VS/ft³
 * Daily heat per ft³: 19.4 × 0.02 × 6500 = 2522 BTU/day = 105 BTU/hr
 *
 * This is the PEAK rate under optimal conditions (temp, moisture, O₂, age
 * all at 1.0). The activity factors below modulate it.
 *
 * O₂ consumption (stoichiometric):
 *   Glucose: 192 g O₂ per 180 g glucose → 1.067 g O₂ per g substrate
 *   Heat: 673 kcal per 180 g glucose → 3.739 kcal per g substrate
 *   Ratio: 1.067 / 3.739 = 0.285 g O₂ per kcal = 0.285 g O₂ per 3.968 BTU
 *        = 0.0719 g O₂ per BTU
 *
 *   In volumetric terms:
 *   Air at STP: 1.2 kg/m³ × 0.2095 O₂ mass fraction = 0.251 kg O₂/m³
 *             = 7.11 g O₂/ft³
 *   So 1 BTU of bio heat consumes 0.0719 g O₂ = 0.0719/7.11 = 0.0101 ft³-fraction of O₂
 *   Per ft³ of compost voxel: consume 0.0101 of the local O₂ fraction per BTU
 *
 *   Sanity check: 64 ft³ pile at 4000 BTU/hr × 0.0101 = ~40% O₂ fraction/hr
 *   With 21% ambient, that depletes to ~5% in ~23 min without fan — matches
 *   field observations of 15-30 min O₂ depletion in unventilated piles.
 */

// --- Derived constants ---

/** Heat of combustion for blended food waste + cardboard, BTU/lb dry matter */
const HEAT_OF_COMBUSTION_BTU_LB = 6500;

/** VS fraction of dry matter in food waste + cardboard blend */
const VOLATILE_SOLIDS_FRACTION = 0.88;

/** Peak decomposition rate: fraction of VS consumed per day at optimal conditions */
const PEAK_VS_DECAY_PER_DAY = 0.02;

/** Compost bulk density (lb/ft³, wet) */
const BULK_DENSITY_WET = 40;

/** Moisture content of fresh compost (wet basis fraction) */
const MOISTURE_WET_BASIS = 0.45;

/** Derived: dry matter per ft³ */
const DRY_MATTER_LB_PER_FT3 = BULK_DENSITY_WET * (1 - MOISTURE_WET_BASIS);

/** Derived: volatile solids per ft³ */
const VS_LB_PER_FT3 = DRY_MATTER_LB_PER_FT3 * VOLATILE_SOLIDS_FRACTION;

/** Derived: peak heat rate BTU/(hr·ft³) at optimal conditions */
const PEAK_HEAT_RATE = VS_LB_PER_FT3 * PEAK_VS_DECAY_PER_DAY * HEAT_OF_COMBUSTION_BTU_LB / 24;
// = 19.36 × 0.02 × 6500 / 24 ≈ 105 BTU/(hr·ft³)

/**
 * Stoichiometric O₂ consumption per BTU of biological heat.
 * Units: fraction of local O₂ consumed per BTU per ft³ of compost.
 *
 * From glucose stoichiometry:
 *   0.0719 g O₂ per BTU / 7.11 g O₂ per ft³ air = 0.0101
 */
const O2_CONSUMPTION_PER_BTU = 0.0101;

/**
 * Temperature response curve for composting microorganisms.
 * Returns 0-1 activity factor.
 *
 * Shape based on Rosso (1993) cardinal temperature model:
 *   T_min ≈ 32°F, T_opt ≈ 131-140°F, T_max ≈ 170°F
 * Approximated as piecewise linear for computational speed.
 */
export function tempActivityFactor(tempF: number): number {
  if (tempF < 32) return 0;
  if (tempF < 50) return (tempF - 32) / 18 * 0.05;       // psychrophilic only
  if (tempF < 80) return 0.05 + (tempF - 50) / 30 * 0.25; // slow mesophilic ramp
  if (tempF < 110) return 0.30 + (tempF - 80) / 30 * 0.40; // active mesophilic
  if (tempF < 131) return 0.70 + (tempF - 110) / 21 * 0.25; // approaching thermophilic
  if (tempF < 155) return 0.95 + (tempF - 131) / 24 * 0.05; // peak thermophilic plateau
  if (tempF < 170) return 1.0 - (tempF - 155) / 15 * 0.85;  // rapid decline — bacteria dying
  return 0.05; // near-dead
}

/**
 * Moisture response curve.
 * Optimal: 50-65% of field capacity. Too dry or waterlogged kills activity.
 */
export function moistureActivityFactor(moistureFrac: number): number {
  if (moistureFrac < 0.20) return 0;                               // too dry, dormant
  if (moistureFrac < 0.40) return (moistureFrac - 0.20) / 0.20;   // ramp up
  if (moistureFrac <= 0.65) return 1.0;                            // optimal range
  if (moistureFrac < 0.85) return 1.0 - (moistureFrac - 0.65) / 0.20 * 0.5; // declining
  return 0.5 - (moistureFrac - 0.85) / 0.15 * 0.4;               // waterlogged, anaerobic
}

/**
 * Oxygen response curve.
 * Aerobic bacteria need >5% O₂. Below that, activity drops sharply.
 */
export function oxygenActivityFactor(o2Frac: number): number {
  if (o2Frac < 0.02) return 0.05;  // anaerobic — minimal activity, wrong organisms
  if (o2Frac < 0.05) return 0.05 + (o2Frac - 0.02) / 0.03 * 0.35; // O₂-limited
  if (o2Frac < 0.10) return 0.40 + (o2Frac - 0.05) / 0.05 * 0.50; // improving
  return 0.90 + (Math.min(o2Frac, 0.21) - 0.10) / 0.11 * 0.10;    // near-optimal
}

/**
 * Material age factor.
 * Fresh material (week 0-1) has the most easily-degradable carbon.
 * Activity declines as easy carbon is consumed.
 *
 * Shape from first-order VS decay: at 2%/day, 50% of VS is consumed
 * by day 35. Remaining VS is increasingly recalcitrant (lignin, etc.).
 */
export function ageActivityFactor(ageDays: number): number {
  if (ageDays < 3) return 0.6 + ageDays / 3 * 0.4; // ramping up (lag phase)
  if (ageDays < 14) return 1.0;                     // peak — easy carbon available
  if (ageDays < 30) return 1.0 - (ageDays - 14) / 16 * 0.4; // declining
  if (ageDays < 60) return 0.6 - (ageDays - 30) / 30 * 0.3; // slow
  return 0.3 - Math.min(0.25, (ageDays - 60) / 120 * 0.25); // residual
}

/**
 * Compute volumetric heat generation rate at a single voxel.
 * Returns BTU per hour per cubic foot.
 */
export function computeHeatGeneration(
  tempF: number,
  moistureFrac: number,
  oxygenFrac: number,
  ageDays: number,
): number {
  return PEAK_HEAT_RATE
    * tempActivityFactor(tempF)
    * moistureActivityFactor(moistureFrac)
    * oxygenActivityFactor(oxygenFrac)
    * ageActivityFactor(ageDays);
}

/**
 * Compute O₂ consumption rate at a voxel.
 * Derived from aerobic respiration stoichiometry.
 * Units: fraction of O₂ consumed per hour per ft³.
 */
export function computeO2Consumption(heatRate: number): number {
  return heatRate * O2_CONSUMPTION_PER_BTU;
}
