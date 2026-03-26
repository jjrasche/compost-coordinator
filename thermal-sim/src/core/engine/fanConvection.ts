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
 * - Mass flow distributed across COMPOST cross-section only (not total grid).
 *   Grid includes air and structural cells that don't carry airflow.
 */

import { CompostGrid, MATERIAL_FROM_CODE } from '../types/CompostGrid';
import type { SimulationConfig } from '../types/SimulationConfig';
import { COVER_PRESETS, INSULATION_PRESETS } from '../types/SimulationConfig';
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

// --- Named constants ---

/** Shape factor for Gnielinski correlation — irregular/cylindrical particles */
const F_A = 1.6;

/** Latent heat of vaporization (BTU/lb) */
const H_FG_BTU_PER_LB = 1000;

/** Specific heat of air (BTU/(lb·°F)) */
const CP_AIR_BTU = 0.24;

/** kg/m³ to lb/ft³ conversion factor */
const KG_M3_TO_LB_FT3 = 0.06243;

/** Compost bulk density × specific heat at ~55% moisture (BTU/(ft³·°F)) */
const RHO_C_COMPOST = 40 * 0.6;

/**
 * Fan stall pressure (in. w.g.) — max static pressure at zero flow.
 * Typical 4" inline duct fan (AC Infinity CLOUDLINE T4): 0.64 in.w.g.
 * Conservative estimate for generic inline fans: 0.5 in.w.g.
 */
const FAN_STALL_PRESSURE_IN_WG = 0.5;

/** Water mass per ft³ of compost at 100% field capacity (lb/ft³).
 *  Bulk density ~40 lb/ft³, water fraction at FC ~60% wet basis. */
const WATER_AT_FC_LB_PER_FT3 = 24;

// --- Types ---

/** Air state at a point in the column sweep */
interface AirState {
  tempF: number;
  humidityRatio: number;
}

/** Heat/mass transfer result for a single cell */
interface CellTransferResult {
  coolingFPerHr: number;
  moistureRemovalFCPerHr: number;
  exitAir: AirState;
}

/** Pre-computed column parameters (constant across the sweep) */
interface ColumnParams {
  porosity: number;
  dP_m: number;
  vSupMs: number;
  massFlowLbHr: number;
  cellVolFt3: number;
  waterPerCellLb: number;
  criticalMoisture: number;
  membraneRetention: number;
}

// --- Orchestrator ---

/**
 * Compute per-voxel cooling rate and moisture removal from fan convection.
 * Fills cooling (°F/hr) and moistureRemoval (FC/hr) scratch buffers.
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

  const exitAreaFt2 = computeExitAreaFt2(grid, config);
  const params = buildColumnParams(grid, config, exitAreaFt2);
  const plenumCellsY = Math.ceil(config.pile.plenumHeight / config.resolution);
  const dutyCycle = computeDutyCycle(config);
  const ambientAir = buildAmbientAirState(config);

  sweepAllColumns(grid, params, plenumCellsY, ambientAir, dutyCycle, cooling, moistureRemoval);

  return { cooling, moistureRemoval };
}

// --- Concept functions ---

/** Build sweep parameters from config (computed once, reused for every column). */
function buildColumnParams(grid: CompostGrid, config: SimulationConfig, exitAreaFt2: number): ColumnParams {
  const { fanCfm, gateOpening } = config.aeration;
  const freeCfm = fanCfm * gateOpening;

  // Apply membrane backpressure derating
  const permeance = COVER_PRESETS[config.boundaries.coverType].airPermeance;
  const effectiveCfm = membraneDerating(freeCfm, exitAreaFt2, permeance, FAN_STALL_PRESSURE_IN_WG);

  const cellSizeFt = config.resolution / 12;
  const cellVolFt3 = cellSizeFt * cellSizeFt * cellSizeFt;

  // Superficial velocity based on physical pile cross-section
  const pileAreaFt2 = (config.pile.width / 12) * (config.pile.depth / 12);
  const vSupFtPerSec = effectiveCfm / pileAreaFt2 / 60;

  // Mass flow distributed across compost columns only.
  // Count columns that contain at least one compost cell.
  const compostColumns = countCompostColumns(grid);
  const rhoAmbient = airDensity(
    config.boundaries.ambientTemp,
    humidityRatioFromRH(config.boundaries.ambientTemp, config.boundaries.ambientRH),
  );
  const totalMassFlowLbHr = rhoAmbient * KG_M3_TO_LB_FT3 * effectiveCfm * 60;
  const massFlowLbHr = compostColumns > 0
    ? totalMassFlowLbHr / compostColumns
    : totalMassFlowLbHr;

  return {
    porosity: config.pile.porosity,
    dP_m: config.pile.particleDiameter * 0.0254,
    vSupMs: vSupFtPerSec * 0.3048,
    massFlowLbHr,
    cellVolFt3,
    waterPerCellLb: WATER_AT_FC_LB_PER_FT3 * cellVolFt3,
    criticalMoisture: config.pile.criticalMoisture,
    membraneRetention: config.boundaries.membraneRetention,
  };
}

/** Count (x,z) columns that contain at least one compost cell. */
function countCompostColumns(grid: CompostGrid): number {
  const { nx, ny, nz } = grid;
  let count = 0;
  for (let z = 0; z < nz; z++) {
    for (let x = 0; x < nx; x++) {
      for (let y = 0; y < ny; y++) {
        if (MATERIAL_FROM_CODE[grid.material[grid.idx(x, y, z)]] === 'compost') {
          count++;
          break; // found one in this column, move to next
        }
      }
    }
  }
  return count;
}

function computeDutyCycle(config: SimulationConfig): number {
  return config.aeration.onSeconds / (config.aeration.onSeconds + config.aeration.offSeconds);
}

function buildAmbientAirState(config: SimulationConfig): AirState {
  return {
    tempF: config.boundaries.ambientTemp,
    humidityRatio: humidityRatioFromRH(config.boundaries.ambientTemp, config.boundaries.ambientRH),
  };
}

/**
 * Compute the ePTFE exit area in ft² based on dome geometry and insulation.
 *
 * When sides are insulated (logs, straw), exhaust air can only exit through
 * the top-facing surface of the dome (compost cells with air directly above).
 * When sides are uninsulated, the entire dome surface is available.
 *
 * Returns the exit area through which air must pass to leave the pile.
 */
export function computeExitAreaFt2(grid: CompostGrid, config: SimulationConfig): number {
  const cellFaceAreaFt2 = (config.resolution / 12) ** 2;
  const sidesSealed = config.boundaries.sideInsulation !== 'none';

  if (!sidesSealed) {
    // All surface cells contribute — count every compost face adjacent to air
    return countAllSurfaceFaces(grid) * cellFaceAreaFt2;
  }

  // Sides insulated: only top-facing faces (compost cell with air or OOB above)
  return countTopSurfaceFaces(grid) * cellFaceAreaFt2;
}

/** Count compost cell faces with air directly above (y+1 is air or out-of-bounds). */
function countTopSurfaceFaces(grid: CompostGrid): number {
  const { nx, ny, nz } = grid;
  let count = 0;
  for (let z = 0; z < nz; z++) {
    for (let x = 0; x < nx; x++) {
      for (let y = ny - 1; y >= 0; y--) {
        const i = grid.idx(x, y, z);
        if (MATERIAL_FROM_CODE[grid.material[i]] !== 'compost') continue;
        // Top of this column's compost: air above or grid boundary
        const aboveIsAir = y >= ny - 1 || MATERIAL_FROM_CODE[grid.material[grid.idx(x, y + 1, z)]] === 'air';
        if (aboveIsAir) count++;
        break; // only the topmost compost cell per column
      }
    }
  }
  return count;
}

/** Count all compost faces adjacent to air (any direction) for total surface area. */
function countAllSurfaceFaces(grid: CompostGrid): number {
  const { nx, ny, nz } = grid;
  let faces = 0;
  for (let y = 0; y < ny; y++) {
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        const i = grid.idx(x, y, z);
        if (MATERIAL_FROM_CODE[grid.material[i]] !== 'compost') continue;
        // Check all 6 neighbors — count faces adjacent to air or out-of-bounds (treated as air)
        if (x === 0      || MATERIAL_FROM_CODE[grid.material[grid.idx(x-1, y, z)]] === 'air') faces++;
        if (x === nx - 1 || MATERIAL_FROM_CODE[grid.material[grid.idx(x+1, y, z)]] === 'air') faces++;
        if (y === 0      || MATERIAL_FROM_CODE[grid.material[grid.idx(x, y-1, z)]] === 'air') faces++;
        if (y === ny - 1 || MATERIAL_FROM_CODE[grid.material[grid.idx(x, y+1, z)]] === 'air') faces++;
        if (z === 0      || MATERIAL_FROM_CODE[grid.material[grid.idx(x, y, z-1)]] === 'air') faces++;
        if (z === nz - 1 || MATERIAL_FROM_CODE[grid.material[grid.idx(x, y, z+1)]] === 'air') faces++;
      }
    }
  }
  return faces;
}

/**
 * Compute effective CFM after membrane backpressure derating.
 *
 * Physics: fan operates on a linear pressure-flow curve (Q = Q_free × (1 - P/P_stall)).
 * Membrane creates pressure drop P = Q / (A_exit × permeance).
 * Solving for the operating point:
 *
 *   effectiveCfm = freeCfm × capacity / (capacity + freeCfm)
 *
 * where capacity = exitArea × permeance × stallPressure = max CFM the membrane
 * can pass at the fan's stall pressure. When capacity >> freeCfm, derating ≈ 1.
 * When capacity → 0 (impermeable tarp), effectiveCfm → 0 (fan stalls).
 */
export function membraneDerating(
  freeCfm: number,
  exitAreaFt2: number,
  airPermeance: number,
  stallPressure: number,
): number {
  if (freeCfm <= 0) return 0;
  const capacity = exitAreaFt2 * airPermeance * stallPressure;
  if (capacity <= 0) return 0; // impermeable cover → stall
  return freeCfm * capacity / (capacity + freeCfm);
}

/** Sweep all (x,z) columns upward, accumulating cooling and moisture removal.
 *  Membrane retention: fraction of evaporated moisture that condenses on the cover
 *  and drips back to the top compost cell. Reduces net moisture loss. */
function sweepAllColumns(
  grid: CompostGrid,
  params: ColumnParams,
  plenumCellsY: number,
  ambientAir: AirState,
  dutyCycle: number,
  cooling: Float32Array,
  moistureRemoval: Float32Array,
): void {
  const { nx, ny, nz } = grid;
  const retention = params.membraneRetention;

  for (let z = 0; z < nz; z++) {
    for (let x = 0; x < nx; x++) {
      let air: AirState = { ...ambientAir };
      let columnEvapTotal = 0;
      let topCompostIdx = -1;

      for (let y = plenumCellsY; y < ny; y++) {
        const i = grid.idx(x, y, z);
        if (MATERIAL_FROM_CODE[grid.material[i]] !== 'compost') continue;

        const result = computeCellTransfer(
          grid.temp[i], grid.moisture[i], air, params,
        );

        cooling[i] = result.coolingFPerHr * dutyCycle;
        moistureRemoval[i] = result.moistureRemovalFCPerHr * dutyCycle;
        air = result.exitAir;

        // Track net evaporation for membrane retention
        if (result.moistureRemovalFCPerHr > 0) {
          columnEvapTotal += result.moistureRemovalFCPerHr * dutyCycle;
        }
        topCompostIdx = i;
      }

      // Membrane retention: condensate drips back to top cell.
      // Returns both moisture AND latent heat (condensation releases energy).
      if (retention > 0 && columnEvapTotal > 0 && topCompostIdx >= 0) {
        const retainedFCHr = columnEvapTotal * retention;
        moistureRemoval[topCompostIdx] -= retainedFCHr;

        // Latent heat credit: condensation warms the top cell
        const retainedWaterLbHr = retainedFCHr * params.waterPerCellLb;
        const latentReturnBtuHr = retainedWaterLbHr * H_FG_BTU_PER_LB;
        cooling[topCompostIdx] -= latentReturnBtuHr / (params.cellVolFt3 * RHO_C_COMPOST);
      }
    }
  }
}

/**
 * Compute heat and mass transfer for a single compost cell.
 *
 * Uses Gnielinski correlation for h_v, NTU-efficiency for heat exchange,
 * and Lewis analogy (same efficiency) for mass transfer.
 */
function computeCellTransfer(
  T_compost: number,
  moisture: number,
  inletAir: AirState,
  params: ColumnParams,
): CellTransferResult {
  const { porosity, dP_m, vSupMs, massFlowLbHr, cellVolFt3, waterPerCellLb, criticalMoisture } = params;

  // Air properties at current air temperature
  const rhoAir = airDensity(inletAir.tempF, inletAir.humidityRatio);
  const muAir = airViscosity(inletAir.tempF);
  const kAir = airConductivity(inletAir.tempF);
  const prAir = airPrandtl(inletAir.tempF);

  // Reynolds number and Gnielinski h_v
  const reSup = rhoAir * vSupMs * dP_m / muAir;
  const hvBtu = wm3kToBtuFt3F(gnielinskiHv(reSup, prAir, porosity, dP_m, F_A, kAir));

  // NTU and efficiency for this cell
  const ntu = hvBtu * cellVolFt3 / (massFlowLbHr * CP_AIR_BTU);
  const efficiency = 1 - Math.exp(-ntu);

  // Sensible heat exchange
  const airTempNew = inletAir.tempF + (T_compost - inletAir.tempF) * efficiency;
  const qSensibleBtuHr = massFlowLbHr * CP_AIR_BTU * (airTempNew - inletAir.tempF);

  // Mass transfer (Lewis analogy)
  const deltaW = computeMoistureTransfer(
    T_compost, moisture, inletAir.humidityRatio, airTempNew, efficiency, criticalMoisture,
  );

  let wAirNew = inletAir.humidityRatio + deltaW;

  // Cap at saturation for exit air temperature
  const wSatExit = saturationHumidityRatio(airTempNew);
  const cappedDeltaW = wAirNew > wSatExit ? wSatExit - inletAir.humidityRatio : deltaW;
  wAirNew = Math.min(wAirNew, wSatExit);

  // Latent heat from evaporation/condensation
  const waterEvapLbHr = massFlowLbHr * cappedDeltaW;
  const qLatentBtuHr = waterEvapLbHr * H_FG_BTU_PER_LB;

  // Total cooling rate (°F/hr)
  const totalCoolingBtuHr = qSensibleBtuHr + qLatentBtuHr;
  const coolingFPerHr = totalCoolingBtuHr / (cellVolFt3 * RHO_C_COMPOST);

  // Moisture removal rate (FC/hr)
  const moistureRemovalFCPerHr = waterEvapLbHr / waterPerCellLb;

  return {
    coolingFPerHr,
    moistureRemovalFCPerHr,
    exitAir: { tempF: airTempNew, humidityRatio: wAirNew },
  };
}

/**
 * Compute humidity ratio change (deltaW) for evaporation or condensation.
 *
 * Evaporation: compost surface is wetter than air → positive deltaW (air gains moisture).
 * Condensation: air is more humid than compost surface → negative deltaW (compost gains moisture).
 */
function computeMoistureTransfer(
  T_compost: number,
  moisture: number,
  wAirIn: number,
  airTempNew: number,
  efficiency: number,
  criticalMoisture: number,
): number {
  const wSatCompost = saturationHumidityRatio(T_compost);

  if (wSatCompost >= wAirIn) {
    // Evaporation: limited by moisture availability
    const availability = moistureAvailability(moisture, criticalMoisture);
    return (wSatCompost - wAirIn) * efficiency * availability;
  }

  // Condensation: air is supersaturated relative to compost surface
  const wSatAtCondensationTemp = saturationHumidityRatio(airTempNew);
  return -(wAirIn - wSatAtCondensationTemp) * efficiency;
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
