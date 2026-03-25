/**
 * Steady-state oxygen solver.
 *
 * Since O2 diffuses ~200x faster than heat, it equilibrates between heat steps.
 * Instead of time-stepping O2, we solve the steady-state Poisson equation:
 *
 *   ∇²O2 = consumption(T, m, O2) / D_o2
 *
 * with boundary conditions:
 *   - Plenum air cavity: O2 = 0.21 (atmospheric, refreshed by fan)
 *   - Top membrane: O2 flux proportional to membrane permeability
 *   - Sides/bottom: zero flux (sealed by tarp/logs)
 *
 * Solved iteratively using Jacobi relaxation (simple, parallelizable).
 * Converges in 5-15 iterations for this geometry.
 */

import { CompostGrid, MATERIAL_FROM_CODE } from '../types/CompostGrid';
import type { SimulationConfig } from '../types/SimulationConfig';
import { getMaterialProperties } from '../types/VoxelState';
import { computeHeatGeneration, computeO2Consumption } from './bioActivity';

const ATMOSPHERIC_O2 = 0.21;

/**
 * Solve for steady-state O2 distribution.
 * Modifies grid.oxygen in place.
 *
 * @param grid - The simulation grid (reads temp, moisture, material; writes oxygen)
 * @param config - Simulation configuration
 * @param fanIsOn - Whether the fan is currently running (affects plenum O2 refresh)
 * @param iterations - Number of Jacobi iterations (default 10)
 */
export function solveOxygenSteadyState(
  grid: CompostGrid,
  config: SimulationConfig,
  fanIsOn: boolean,
  iterations: number = 10,
): void {
  const { nx, ny, nz } = grid;
  const plenumCellsY = Math.ceil(config.pile.plenumHeight / config.resolution);

  const o2Next = grid.o2Scratch;

  for (let iter = 0; iter < iterations; iter++) {
    for (let y = 0; y < ny; y++) {
      for (let z = 0; z < nz; z++) {
        for (let x = 0; x < nx; x++) {
          const i = grid.idx(x, y, z);
          const matType = MATERIAL_FROM_CODE[grid.material[i]];

          // Air cavity and pipe: atmospheric O2 (refreshed by fan or residual)
          if (matType === 'air' || matType === 'pipe') {
            o2Next[i] = fanIsOn ? ATMOSPHERIC_O2 : Math.max(grid.oxygen[i] * 0.95, 0.10);
            continue;
          }

          // Non-compost solids: no O2
          if (matType !== 'compost') {
            o2Next[i] = 0;
            continue;
          }

          // Compost: Jacobi update
          // Average of neighbors minus consumption
          let neighborSum = 0;
          let neighborCount = 0;

          if (x > 0)    { neighborSum += grid.oxygen[grid.idx(x-1, y, z)]; neighborCount++; }
          if (x < nx-1) { neighborSum += grid.oxygen[grid.idx(x+1, y, z)]; neighborCount++; }
          if (y > 0)    { neighborSum += grid.oxygen[grid.idx(x, y-1, z)]; neighborCount++; }
          if (y < ny-1) { neighborSum += grid.oxygen[grid.idx(x, y+1, z)]; neighborCount++; }
          if (z > 0)    { neighborSum += grid.oxygen[grid.idx(x, y, z-1)]; neighborCount++; }
          if (z < nz-1) { neighborSum += grid.oxygen[grid.idx(x, y, z+1)]; neighborCount++; }

          // At boundaries: zero-flux (Neumann) for sealed sides
          // Top boundary: some O2 exchange through membrane
          if (y === ny - 1) {
            neighborSum += ATMOSPHERIC_O2 * 0.3; // membrane lets some O2 in
            neighborCount++;
          }
          if (x === 0 || x === nx - 1 || z === 0 || z === nz - 1) {
            // Sealed sides: reflect (Neumann zero-flux)
            // Already handled by not adding a neighbor
          }
          if (y === 0) {
            // Bottom: reflects or gets O2 from plenum below
            neighborSum += ATMOSPHERIC_O2 * (fanIsOn ? 1.0 : 0.3);
            neighborCount++;
          }

          const avgNeighbor = neighborCount > 0 ? neighborSum / neighborCount : grid.oxygen[i];

          // Consumption term: biology consumes O2 proportional to heat generation
          const heatRate = computeHeatGeneration(
            grid.temp[i], grid.moisture[i], grid.oxygen[i], grid.materialAge[i],
          );
          const consumption = computeO2Consumption(heatRate);

          // Jacobi update for Poisson equation: ∇²O2 = consumption / D_o2
          // Discretized: o2_new = avg_neighbors - consumption * dx² / D_o2
          const dx = config.resolution / 12; // feet
          const props = getMaterialProperties('compost', grid.moisture[i]);
          const d_o2_ft2hr = props.o2Diffusivity / 144; // convert in²/hr to ft²/hr
          const consumptionDelta = d_o2_ft2hr > 0
            ? consumption * dx * dx / d_o2_ft2hr
            : 0;

          o2Next[i] = Math.max(0.01, Math.min(ATMOSPHERIC_O2, avgNeighbor - consumptionDelta));
        }
      }
    }

    // Copy o2Next back to grid.oxygen for next iteration
    grid.oxygen.set(o2Next);
  }
}
