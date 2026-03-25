/**
 * 3D Finite Difference Method heat diffusion solver.
 *
 * Explicit forward Euler: T_new = T + dt * (alpha * laplacian(T) + Q / (rho * c))
 *
 * Boundary conditions:
 * - Top (y = max): convective + radiative to ambient through membrane
 * - Sides: convective to ambient through logs (lower) or membrane (upper)
 * - Bottom (y = 0): conductive to ground temperature
 * - Straw (if present): additional R-value on top and sides
 */

import { CompostGrid, MATERIAL_FROM_CODE } from '../types/CompostGrid';
import { getMaterialProperties } from '../types/VoxelState';
import type { SimulationConfig } from '../types/SimulationConfig';

/**
 * Advance the temperature field by one timestep using explicit FDM.
 * Writes results into grid.tempNext, then swaps buffers.
 *
 * @param grid - The simulation grid
 * @param config - Simulation configuration
 * @param heatSource - Pre-computed volumetric heat generation per cell (BTU/hr/ft3)
 * @param fanCooling - Pre-computed fan convective cooling per cell (F/hr)
 */
export function stepHeat(
  grid: CompostGrid,
  config: SimulationConfig,
  heatSource: Float32Array,
  fanCooling: Float32Array,
): void {
  const { nx, ny, nz } = grid;
  const dt = config.time.heatTimestep; // hours
  const dx = config.resolution / 12;   // convert inches to feet

  const { ambientTemp, groundTemp } = config.boundaries;

  for (let y = 0; y < ny; y++) {
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        const i = grid.idx(x, y, z);
        const matCode = grid.material[i];
        const matType = MATERIAL_FROM_CODE[matCode];

        // Only compost voxels are time-stepped.
        // Air cavity: equilibrates instantly, set to weighted avg of neighbors.
        // Ground: fixed temperature. Brick/pipe/log: thermal mass but not diffused
        // (they equilibrate fast and their CFL constraint would force tiny timesteps).
        if (matType === 'ground') {
          grid.tempNext[i] = groundTemp;
          continue;
        }
        if (matType === 'air') {
          // Air cavity: instant equilibrium between ground below and compost above
          grid.tempNext[i] = ambientTemp + (groundTemp - ambientTemp) * 0.3;
          // Override with neighbor average if surrounded by warm compost
          let neighborSum = 0, neighborCount = 0;
          if (y > 0)    { neighborSum += grid.temp[grid.idx(x, y-1, z)]; neighborCount++; }
          if (y < grid.ny-1) { neighborSum += grid.temp[grid.idx(x, y+1, z)]; neighborCount++; }
          if (neighborCount > 0) grid.tempNext[i] = neighborSum / neighborCount;
          continue;
        }
        if (matType !== 'compost') {
          // Brick, pipe, log, membrane, tarp, straw: hold at neighbor average
          grid.tempNext[i] = grid.temp[i]; // thermal inertia, minimal change
          continue;
        }

        const T = grid.temp[i];
        const moisture = grid.moisture[i];
        const props = getMaterialProperties(matType, moisture);

        // Compute Laplacian ∇²T using central differences
        // For boundary cells, use ghost cell with appropriate boundary condition
        const Txm = x > 0     ? grid.temp[grid.idx(x-1, y, z)] : boundaryTemp(x-1, y, z, grid, config);
        const Txp = x < nx-1  ? grid.temp[grid.idx(x+1, y, z)] : boundaryTemp(x+1, y, z, grid, config);
        const Tym = y > 0     ? grid.temp[grid.idx(x, y-1, z)] : boundaryTemp(x, y-1, z, grid, config);
        const Typ = y < ny-1  ? grid.temp[grid.idx(x, y+1, z)] : boundaryTemp(x, y+1, z, grid, config);
        const Tzm = z > 0     ? grid.temp[grid.idx(x, y, z-1)] : boundaryTemp(x, y, z-1, grid, config);
        const Tzp = z < nz-1  ? grid.temp[grid.idx(x, y, z+1)] : boundaryTemp(x, y, z+1, grid, config);

        const laplacian = (Txm + Txp + Tym + Typ + Tzm + Tzp - 6 * T) / (dx * dx);

        // Heat source term: Q / (rho * c) converts BTU/hr/ft3 → F/hr
        const sourceTermF = heatSource[i] / (props.density * props.specificHeat);

        // Fan cooling term (pre-computed, already in F/hr)
        const coolTermF = fanCooling[i];

        // Forward Euler update
        const alpha = props.diffusivity; // ft2/hr
        const dT = dt * (alpha * laplacian + sourceTermF - coolTermF);

        grid.tempNext[i] = T + dT;
      }
    }
  }

  grid.swapTempBuffers();
}

/**
 * Ghost cell temperature for boundary conditions.
 * Returns the effective temperature outside the grid at the given position.
 */
function boundaryTemp(
  x: number, y: number, z: number,
  grid: CompostGrid,
  config: SimulationConfig,
): number {
  const { ambientTemp, groundTemp, hasStraw, strawThickness } = config.boundaries;

  if (y < 0) return groundTemp;

  // R-value of one compost grid cell (ft²·hr·°F/BTU)
  const rCell = (config.resolution / 12) / 0.15; // dx_ft / conductivity
  // Straw R-value: thickness_ft / conductivity (k_straw ≈ 0.025 BTU/hr/ft/F)
  const strawR = hasStraw ? (strawThickness / 12) / 0.025 : 0;

  // Nearest valid surface cell for R-value weighting
  const sx = Math.max(0, Math.min(grid.nx - 1, x));
  const sy = Math.max(0, Math.min(grid.ny - 1, y));
  const sz = Math.max(0, Math.min(grid.nz - 1, z));
  const surfaceTemp = grid.temp[grid.idx(sx, sy, sz)];

  // Top boundary: membrane + still air films (R ≈ 0.75 with wind) + optional straw
  if (y >= grid.ny) {
    const rBoundary = 0.75 + strawR;
    const frac = rBoundary / (rBoundary + rCell);
    return ambientTemp + (surfaceTemp - ambientTemp) * frac;
  }

  // Side boundaries: tarp + membrane + log (all external, uniform R-value)
  // Log lies on side outside: ~3" average thickness against flat surface, k_wood ≈ 0.08
  // Plus tarp + membrane air films ≈ 0.5
  const logR = (config.boundaries.logDiameter / 2 / 12) / 0.08; // half-diameter as average thickness
  const rBoundary = logR + 0.5 + strawR;
  const frac = rBoundary / (rBoundary + rCell);

  return ambientTemp + (surfaceTemp - ambientTemp) * frac;
}

/**
 * Check CFL stability condition.
 * Returns the maximum safe timestep in hours.
 */
export function computeMaxTimestep(config: SimulationConfig): number {
  const dx = config.resolution / 12; // feet
  // Max diffusivity of time-stepped materials (compost only, air is not time-stepped)
  // Wet compost: k=0.3, rho=55, c=0.7 → alpha = 0.3/(55*0.7) = 0.0078 ft2/hr
  // Dry compost: k=0.05, rho=25, c=0.4 → alpha = 0.05/(25*0.4) = 0.005 ft2/hr
  const alphaMax = 0.01; // ft2/hr (conservative upper bound for compost)
  // CFL: dt <= dx^2 / (2 * n * alpha) where n = 3 dimensions
  return (dx * dx) / (2 * 3 * alphaMax);
}
