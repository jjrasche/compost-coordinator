/**
 * Fan convection model.
 *
 * When the fan runs (30 sec on / 30 min off), ambient-temperature air
 * is pushed upward through the pile from the plenum. This:
 * 1. Cools voxels in the airflow path (convective heat removal)
 * 2. Delivers O2 (handled by oxygenSolver)
 * 3. Removes moisture (handled by moistureTransport)
 *
 * The airflow velocity field is computed from the fan CFM,
 * pile cross-section area, and porosity.
 */

import { CompostGrid, MATERIAL_FROM_CODE } from '../types/CompostGrid';
import type { SimulationConfig } from '../types/SimulationConfig';

/**
 * Compute per-voxel cooling rate from fan convection.
 * Returns array of F/hr cooling at each cell.
 *
 * @param grid - The simulation grid
 * @param config - Simulation configuration
 * @param fanIsOn - Whether the fan is currently blowing
 * @returns Float32Array of cooling rates (F/hr, positive = cooling)
 */
export function computeFanCooling(
  grid: CompostGrid,
  config: SimulationConfig,
  scratchBuffer?: Float32Array,
): Float32Array {
  const cooling = scratchBuffer ?? new Float32Array(grid.totalCells);
  cooling.fill(0);

  const { nx, ny, nz } = grid;
  const { ambientTemp } = config.boundaries;
  const { fanCfm, gateOpening } = config.aeration;

  // Effective CFM through the pile
  const effectiveCfm = fanCfm * gateOpening;

  // Cross-section area of the pile in ft²
  const pileAreaFt2 = (config.pile.width / 12) * (config.pile.depth / 12); // 16 ft²

  // Porosity from config (void fraction of compost)
  const avgPorosity = config.pile.porosity;

  // Superficial velocity (ft/hr) = CFM * 60 / area
  const superficialVelocity = effectiveCfm * 60 / pileAreaFt2;

  // Actual velocity through pores = superficial / porosity
  const poreVelocity = superficialVelocity / avgPorosity; // ft/hr

  // Cell size in feet
  const dx = config.resolution / 12;

  // Volumetric heat transfer coefficient between air and compost
  // h_v ≈ 20-50 BTU/(hr*ft3*F) for air through packed beds at low velocity
  const hVolumetric = 30; // BTU/(hr*ft3*F)

  const plenumCellsY = Math.ceil(config.pile.plenumHeight / config.resolution);

  for (let y = 0; y < ny; y++) {
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        const i = grid.idx(x, y, z);
        const matType = MATERIAL_FROM_CODE[grid.material[i]];

        if (matType !== 'compost') continue;

        const T = grid.temp[i];

        // Air temperature at this height
        // As air rises through the pile, it picks up heat from compost
        // Air temp increases with height (enters at ambient, exits near pile temp)
        const heightAbovePlenum = (y - plenumCellsY) * dx;
        const pileHeightFt = config.pile.height / 12;
        const heightFraction = Math.min(1, heightAbovePlenum / pileHeightFt);

        // Air temperature model: exponential approach to compost temp
        // At bottom: air ≈ ambient. At top: air ≈ compost temp (fully heated)
        const heatingEfficiency = 1 - Math.exp(-3 * heightFraction);
        const airTempAtHeight = ambientTemp + (T - ambientTemp) * heatingEfficiency;

        // Cooling rate: h_v * (T_compost - T_air) / (rho_compost * c_compost)
        // Positive when compost is warmer than air (cooling)
        const deltaT = T - airTempAtHeight;
        const rhoC = 40 * 0.6; // density * specific heat of compost

        // Scale by velocity (higher velocity = more cooling)
        const velocityFactor = poreVelocity / 1000; // normalize to typical range

        cooling[i] = hVolumetric * deltaT * velocityFactor / rhoC;

        // Stronger at bottom (where air is coldest), weaker at top
        cooling[i] *= (1 - heightFraction * 0.7);
      }
    }
  }

  // Scale by duty cycle: the timestep covers hours, but the fan is only on
  // for onSeconds within each cycle. When isFanOn returns true, we computed
  // cooling as if the fan ran the entire timestep. Scale to actual on-fraction.
  const cycleTotalSeconds = config.aeration.onSeconds + config.aeration.offSeconds;
  const dutyCycleFraction = config.aeration.onSeconds / cycleTotalSeconds;
  for (let i = 0; i < cooling.length; i++) {
    cooling[i] *= dutyCycleFraction;
  }

  return cooling;
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
