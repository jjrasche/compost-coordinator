/**
 * Fan convection model with humidity tracking.
 *
 * RESEARCH BASIS (Mar 2026):
 *
 * Heat transfer: Gnielinski correlation (VDI Heat Atlas, 1978/2010)
 *   Nu = f_a × (2 + √(Nu_lam² + Nu_turb²))
 *   f_a = 1.6 for irregular particles (validated for cylinders, cubes)
 *   Valid Re = 0.1–1000; our system operates at Re ≈ 10–20.
 *   Chosen over Wakao (Re > 15 minimum, no porosity/shape correction).
 *   Cross-checked against Gunn (1978): Nu ≈ 10.8 vs Gnielinski ≈ 10.
 *
 * Mass transfer: Lewis analogy (Le ≈ 1 for air-water)
 *   k_m = h_v / (ρ_air × c_p_air) — no new constants.
 *
 * Psychrometrics: Buck equation for P_sat, standard humidity ratio.
 *
 * Key research findings:
 * - Haug (1993) assumes local thermal equilibrium (LTE) — no explicit h_v.
 *   At typical composting airflow, air equilibrates quickly. Our Gnielinski
 *   gives h_v ≈ 20–25 BTU/(hr·ft³·°F), consistent with LTE for most of pile.
 * - Smith et al. (2017): 86% of heat in exhaust air is latent, 14% sensible.
 *   Evaporative cooling dominates — this model captures it.
 * - Condensation in upper layers confirmed (Li et al. 2021). Positive-pressure
 *   aeration creates bottom-dry, top-wet gradient. Same equation handles it.
 * - Critical moisture ~55% FC for food waste compost (constant→falling rate).
 *   Below 30% FC, biological activity ceases. moistureAvailability() ramps.
 * - Particle diameter: visible d_p ≈ 20mm for 1/3 greens + 2/3 cardboard.
 *   Ergun effective d_p is much smaller (0.5–2mm, Richard et al. 2004) but
 *   that's for pressure drop, not heat transfer surface area.
 *
 * DECISIONS:
 * - Column sweep replaces old per-cell exponential model (exp(-3×h) was a
 *   magic constant). NTU-based air temp/humidity evolves naturally.
 * - Air properties (ρ, μ, k) computed at local air temperature, not ambient.
 * - Condensation handled by allowing sign flip (Δw < 0 → moisture added,
 *   latent heat released to compost).
 * - moistureTransport.ts surface evaporation removed — airstream is the
 *   moisture path in a sealed membrane system.
 * - Total cooling is airflow-limited (insensitive to h_v uncertainty).
 *   h_v only affects spatial distribution within the pile.
 */

import { CompostGrid, MATERIAL_FROM_CODE } from '../types/CompostGrid';
import type { SimulationConfig } from '../types/SimulationConfig';
import {
  saturationHumidityRatio,
  humidityRatioFromRH,
  airDensity,
  airViscosity,
  airConductivity,
  airPrandtl,
  gnielinskiHv,
  moistureAvailability,
  wm3kToBtuFt3F,
} from './psychrometrics';

/** Shape factor for Gnielinski correlation — irregular/cylindrical particles */
const F_A = 1.6;

/** Latent heat of vaporization in BTU/lb */
const H_FG_BTU_PER_LB = 1000;

/**
 * Compute per-voxel cooling rate and moisture removal from fan convection.
 * Fills grid.fanCoolingScratch (F/hr) and grid.moistureRemovalScratch (FC/hr).
 *
 * Sweeps each (x,z) column upward from plenum, tracking air temperature
 * and humidity ratio. At each cell, computes heat and mass transfer using
 * the Gnielinski correlation and Lewis analogy.
 */
export function computeFanCooling(
  grid: CompostGrid,
  config: SimulationConfig,
  coolingScratch?: Float32Array,
  moistureScratch?: Float32Array,
): { cooling: Float32Array; moistureRemoval: Float32Array } {
  const cooling = coolingScratch ?? new Float32Array(grid.totalCells);
  const moistureRemoval = moistureScratch ?? new Float32Array(grid.totalCells);
  cooling.fill(0);
  moistureRemoval.fill(0);

  const { nx, ny, nz } = grid;
  const { ambientTemp, ambientRH } = config.boundaries;
  const { fanCfm, gateOpening } = config.aeration;
  const porosity = config.pile.porosity;
  const dP_inches = config.pile.particleDiameter;
  const criticalMoisture = config.pile.criticalMoisture;

  // Effective airflow
  const effectiveCfm = fanCfm * gateOpening;

  // Pile cross-section area (ft²) and cell geometry
  const pileAreaFt2 = (config.pile.width / 12) * (config.pile.depth / 12);
  const cellSizeFt = config.resolution / 12;
  const cellVolFt3 = cellSizeFt * cellSizeFt * cellSizeFt;

  // Superficial velocity (ft/s)
  const vSupFtPerSec = effectiveCfm / pileAreaFt2 / 60;

  // Convert particle diameter to meters for Gnielinski
  const dP_m = dP_inches * 0.0254;

  // Number of columns in the grid
  const nColumns = nx * nz;

  // Mass flow rate of dry air per column (lb/hr)
  // Total: ρ × Q (in ft³/hr). Per column: divide by number of columns.
  const rhoAmbient = airDensity(ambientTemp, humidityRatioFromRH(ambientTemp, ambientRH));
  const rhoAmbientLbFt3 = rhoAmbient * 0.06243;
  const totalMassFlowLbHr = rhoAmbientLbFt3 * effectiveCfm * 60;
  const massFlowPerColumnLbHr = totalMassFlowLbHr / nColumns;

  // Ambient humidity ratio
  const wAmbient = humidityRatioFromRH(ambientTemp, ambientRH);

  const plenumCellsY = Math.ceil(config.pile.plenumHeight / config.resolution);

  // Duty cycle scaling
  const cycleTotalSeconds = config.aeration.onSeconds + config.aeration.offSeconds;
  const dutyCycleFraction = config.aeration.onSeconds / cycleTotalSeconds;

  // Compost thermal properties for converting BTU/hr to F/hr
  // rho_compost × c_compost ≈ density × specificHeat (moisture-dependent)
  // Using representative values; per-cell would be more accurate but slower
  const rhoC_compost = 40 * 0.6; // BTU/(ft³·°F) at ~55% moisture

  // Water mass per cell at 100% FC (lb)
  // Compost bulk density ~40 lb/ft³, water content at FC ~60% wet basis
  // So water ≈ 0.6 × 40 × cellVol = 24 × cellVol lb per ft³ at FC=1.0
  const waterPerCellAtFC_lb = 24 * cellVolFt3;

  // Column sweep
  for (let z = 0; z < nz; z++) {
    for (let x = 0; x < nx; x++) {
      // Air state entering from plenum
      let airTemp = ambientTemp;
      let wAir = wAmbient;

      // Sweep upward from just above plenum
      for (let y = plenumCellsY; y < ny; y++) {
        const i = grid.idx(x, y, z);
        const matType = MATERIAL_FROM_CODE[grid.material[i]];

        if (matType !== 'compost') continue;

        const T_compost = grid.temp[i];
        const moisture = grid.moisture[i];

        // Air properties at current air temperature
        const rhoAir = airDensity(airTemp, wAir);
        const muAir = airViscosity(airTemp);
        const kAir = airConductivity(airTemp);
        const prAir = airPrandtl(airTemp);

        // Superficial velocity in m/s (convert from ft/s)
        const vSup_ms = vSupFtPerSec * 0.3048;

        // Superficial Reynolds number
        const reSup = rhoAir * vSup_ms * dP_m / muAir;

        // Gnielinski volumetric heat transfer coefficient [W/(m³·K)]
        const hvSI = gnielinskiHv(reSup, prAir, porosity, dP_m, F_A, kAir);

        // Convert to BTU/(hr·ft³·°F)
        const hvBtu = wm3kToBtuFt3F(hvSI);

        // NTU for this cell: h_v × V_cell / (ṁ × c_p)
        // c_p_air ≈ 0.24 BTU/(lb·°F)
        const cpAirBtu = 0.24;
        const ntu = hvBtu * cellVolFt3 / (massFlowPerColumnLbHr * cpAirBtu);
        const efficiency = 1 - Math.exp(-ntu);

        // --- Sensible heat exchange ---
        const airTempNew = airTemp + (T_compost - airTemp) * efficiency;
        const qSensibleBtuHr = massFlowPerColumnLbHr * cpAirBtu * (airTempNew - airTemp);

        // --- Mass transfer (Lewis analogy, same efficiency) ---
        const wSatCompost = saturationHumidityRatio(T_compost);
        const availability = moistureAvailability(moisture, criticalMoisture);

        // Driving force: saturation at compost temp vs current air humidity
        let deltaW = (wSatCompost - wAir) * efficiency * availability;

        // If deltaW < 0: condensation (air is supersaturated relative to compost)
        // Condensation doesn't need moisture availability — it always happens
        if (wSatCompost < wAir) {
          const wSatAtCondensationTemp = saturationHumidityRatio(airTempNew);
          deltaW = -(wAir - wSatAtCondensationTemp) * efficiency; // negative = condensation
        }

        let wAirNew = wAir + deltaW;

        // Cap at saturation for the new air temperature
        const wSatAirAtExit = saturationHumidityRatio(airTempNew);
        if (wAirNew > wSatAirAtExit) {
          wAirNew = wSatAirAtExit;
          deltaW = wAirNew - wAir;
        }

        // --- Latent heat ---
        // Positive deltaW = evaporation = cools compost
        // Negative deltaW = condensation = warms compost
        const waterEvapLbHr = massFlowPerColumnLbHr * deltaW;
        const qLatentBtuHr = waterEvapLbHr * H_FG_BTU_PER_LB;

        // Total cooling rate for this cell (F/hr)
        // Sensible: air absorbs heat from compost → cools compost
        // Latent: evaporation removes heat → cools compost (or condensation warms it)
        const totalCoolingBtuHr = qSensibleBtuHr + qLatentBtuHr;
        const coolingFPerHr = totalCoolingBtuHr / (cellVolFt3 * rhoC_compost);

        // Moisture removal rate (FC/hr)
        // waterEvapLbHr is lb water removed per hour from this cell
        // Convert to FC fraction: divide by water at FC=1.0
        const moistureRateFCHr = waterEvapLbHr / waterPerCellAtFC_lb;

        // Apply duty cycle and store
        cooling[i] = coolingFPerHr * dutyCycleFraction;
        moistureRemoval[i] = moistureRateFCHr * dutyCycleFraction;

        // Update air state for next cell up
        airTemp = airTempNew;
        wAir = wAirNew;
      }
    }
  }

  return { cooling, moistureRemoval };
}

/**
 * Determine if the fan is on at a given simulation time.
 * Follows the duty cycle: onSeconds on, offSeconds off, repeating.
 */
export function isFanOn(simulationTimeHours: number, config: SimulationConfig): boolean {
  const cycleTotalSeconds = config.aeration.onSeconds + config.aeration.offSeconds;
  const timeInCycleSeconds = (simulationTimeHours * 3600) % cycleTotalSeconds;
  return timeInCycleSeconds < config.aeration.onSeconds;
}
