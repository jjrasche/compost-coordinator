/**
 * Steady-state oxygen solver.
 *
 * O₂ diffuses ~200× faster than heat, so it equilibrates between heat steps.
 * We solve the steady-state reaction-diffusion equation:
 *
 *   D_eff × ∇²C = S(C)
 *
 * where:
 *   C    = O₂ mole fraction (0–0.21)
 *   D_eff = effective O₂ diffusivity in compost pore space
 *   S(C) = volumetric consumption rate (depends on C through bio activity)
 *
 * Boundary conditions:
 *   - Plenum (air/pipe cells): C = 0.21 when fan is on
 *   - Top membrane: partial exchange with atmosphere
 *   - Sides/bottom: zero-flux (sealed by tarp/logs)
 *
 * Jacobi discretization (3D, 6-point stencil):
 *   C_new = (sum_neighbors + S_term) / N_neighbors
 *   where S_term = S(C) × dx² / D_eff
 *
 * The consumption term enters as a source in the Poisson equation,
 * absorbed into the neighbor average. This ensures correct scaling
 * between diffusion and consumption regardless of consumption magnitude.
 *
 * DESIGN NOTE: The fan duty cycle affects O₂ through the plenum boundary
 * condition (fan on = 0.21, fan off = depleting), NOT through a time-averaged
 * source term. The solver runs each heat timestep and sees the instantaneous
 * fan state.
 */

import { CompostGrid, MATERIAL_FROM_CODE } from '../types/CompostGrid';
import type { SimulationConfig } from '../types/SimulationConfig';
import { getMaterialProperties } from '../types/VoxelState';
import { computeHeatGeneration, computeO2Consumption } from './bioActivity';

const ATMOSPHERIC_O2 = 0.21;

/**
 * Solve for steady-state O₂ distribution.
 * Modifies grid.oxygen in place.
 */
export function solveOxygenSteadyState(
  grid: CompostGrid,
  config: SimulationConfig,
  fanIsOn: boolean,
  iterations: number = 10,
): void {
  const { nx, ny, nz } = grid;
  const o2Next = grid.o2Scratch;
  const dx = config.resolution / 12; // cell size in feet

  for (let iter = 0; iter < iterations; iter++) {
    for (let y = 0; y < ny; y++) {
      for (let z = 0; z < nz; z++) {
        for (let x = 0; x < nx; x++) {
          const i = grid.idx(x, y, z);
          const matType = MATERIAL_FROM_CODE[grid.material[i]];

          if (matType === 'air' || matType === 'pipe') {
            o2Next[i] = computePlenumO2(grid.oxygen[i], fanIsOn);
            continue;
          }

          if (matType !== 'compost') {
            o2Next[i] = 0;
            continue;
          }

          o2Next[i] = computeCompostO2(grid, config, x, y, z, i, dx, fanIsOn);
        }
      }
    }

    grid.oxygen.set(o2Next);
  }
}

/** O₂ in plenum air: atmospheric when fan runs, slowly depletes when off. */
function computePlenumO2(currentO2: number, fanIsOn: boolean): number {
  if (fanIsOn) return ATMOSPHERIC_O2;
  // Fan off: plenum O₂ decays as adjacent compost consumes it.
  // Decay toward ~15% (residual atmospheric diffusion through membrane gaps).
  return currentO2 * 0.97 + 0.15 * 0.03;
}

/**
 * Jacobi update for a single compost cell.
 *
 * Poisson equation: ∇²C = S/D
 * Discretized (3D, uniform grid):
 *   (sum_neighbors - 6C) / dx² = S / D
 *   C = (sum_neighbors - S × dx² / D) / 6
 *
 * For boundary cells, missing neighbors are replaced by boundary conditions.
 */
function computeCompostO2(
  grid: CompostGrid,
  config: SimulationConfig,
  x: number, y: number, z: number,
  i: number,
  dx: number,
  fanIsOn: boolean,
): number {
  const { nx, ny, nz } = grid;

  // Sum of all 6 neighbors (or boundary values for edge cells)
  let neighborSum = 0;
  let neighborCount = 0;

  if (x > 0)    { neighborSum += grid.oxygen[grid.idx(x-1, y, z)]; neighborCount++; }
  if (x < nx-1) { neighborSum += grid.oxygen[grid.idx(x+1, y, z)]; neighborCount++; }
  if (y > 0)    { neighborSum += grid.oxygen[grid.idx(x, y-1, z)]; neighborCount++; }
  if (y < ny-1) { neighborSum += grid.oxygen[grid.idx(x, y+1, z)]; neighborCount++; }
  if (z > 0)    { neighborSum += grid.oxygen[grid.idx(x, y, z-1)]; neighborCount++; }
  if (z < nz-1) { neighborSum += grid.oxygen[grid.idx(x, y, z+1)]; neighborCount++; }

  // Boundary conditions for missing neighbors
  if (y === ny - 1) {
    // Top: membrane allows partial O₂ exchange
    neighborSum += ATMOSPHERIC_O2 * 0.3;
    neighborCount++;
  }
  if (y === 0) {
    // Bottom: plenum provides O₂ (full when fan on, partial when off)
    neighborSum += ATMOSPHERIC_O2 * (fanIsOn ? 1.0 : 0.5);
    neighborCount++;
  }
  // Sides: zero-flux Neumann (missing neighbor not added = reflection)

  // Consumption: how much O₂ biology removes at this cell
  const heatRate = computeHeatGeneration(
    grid.temp[i], grid.moisture[i], grid.oxygen[i], grid.materialAge[i],
  );
  const consumptionPerHr = computeO2Consumption(heatRate);

  // Convert to Poisson source term: S × dx² / D_eff
  const props = getMaterialProperties('compost', grid.moisture[i]);
  const dEffFt2Hr = props.o2Diffusivity / 144; // in²/hr → ft²/hr
  const sourceTerm = dEffFt2Hr > 0
    ? consumptionPerHr * dx * dx / dEffFt2Hr
    : 0;

  // Jacobi: C_new = (sum_neighbors - sourceTerm) / neighborCount
  const raw = (neighborSum - sourceTerm) / neighborCount;
  return Math.max(0.01, Math.min(ATMOSPHERIC_O2, raw));
}
