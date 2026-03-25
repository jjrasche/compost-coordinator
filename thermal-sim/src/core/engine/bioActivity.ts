/**
 * Biological activity model — computes heat generation rate at a voxel
 * based on local temperature, moisture, and oxygen availability.
 *
 * Heat generation = baseRate × f(temp) × f(moisture) × f(oxygen) × f(age)
 * where each factor is 0-1 representing how favorable that condition is.
 */

/** Maximum heat generation rate for fresh food waste + cardboard at optimal conditions.
 *  Units: BTU per hour per cubic foot of compost. */
const PEAK_HEAT_RATE = 70; // BTU/(hr*ft3) — calibrated to produce ~4500 BTU/hr for 64 ft3 pile at peak

/**
 * Temperature response curve for thermophilic composting bacteria.
 * Returns 0-1 activity factor.
 */
export function tempActivityFactor(tempF: number): number {
  if (tempF < 32) return 0;
  if (tempF < 50) return (tempF - 32) / 18 * 0.05;       // near-zero, psychrophilic only
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
 * Aerobic bacteria need >5% O2. Below that, activity drops sharply.
 * Atmospheric is 21%.
 */
export function oxygenActivityFactor(o2Frac: number): number {
  if (o2Frac < 0.02) return 0.05;  // anaerobic — minimal activity, wrong organisms
  if (o2Frac < 0.05) return 0.05 + (o2Frac - 0.02) / 0.03 * 0.35; // O2-limited
  if (o2Frac < 0.10) return 0.40 + (o2Frac - 0.05) / 0.05 * 0.50; // improving
  return 0.90 + (Math.min(o2Frac, 0.21) - 0.10) / 0.11 * 0.10;    // near-optimal
}

/**
 * Material age factor.
 * Fresh material (week 0-1) has the most easily-degradable carbon.
 * Activity declines as easy carbon is consumed.
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
 * Compute O2 consumption rate at a voxel.
 * Proportional to heat generation (aerobic respiration couples O2 use to heat).
 * Units: fraction of O2 consumed per hour per ft3.
 */
export function computeO2Consumption(heatRate: number): number {
  // Roughly: 1 BTU of biological heat requires consuming ~0.001 fraction-ft3 of O2
  // Calibrated so a 64 ft3 pile at 4500 BTU/hr depletes O2 from 21% to ~5% in 30 min
  // without fan replenishment
  // Scaled so fan at 40 CFM with 30s/30min duty cycle maintains ~10-15% O2 avg
  return heatRate * 0.00008;
}
