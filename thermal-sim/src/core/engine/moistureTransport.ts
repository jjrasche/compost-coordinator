/**
 * Moisture transport — updated once per simulated day.
 *
 * Two mechanisms (evaporation moved to fanConvection column sweep):
 * 1. Gravity drainage: water moves downward through the pile
 * 2. Biological moisture generation: decomposition produces water
 *
 * Airflow-driven evaporation/condensation is handled per-timestep in
 * fanConvection.ts using psychrometric column sweep with Lewis analogy.
 * Surface evaporation through the membrane is negligible in a sealed
 * CASP system — the airstream carries 95%+ of moisture out.
 *
 * Moisture is expressed as fraction of field capacity (0-1).
 */

import { CompostGrid, MATERIAL_FROM_CODE } from '../types/CompostGrid';
import type { SimulationConfig } from '../types/SimulationConfig';

/**
 * Update the moisture field for one simulated day.
 * Modifies grid.moisture in place.
 */
export function updateMoisture(
  grid: CompostGrid,
  config: SimulationConfig,
): void {
  const { nx, ny, nz } = grid;
  const plenumCellsY = Math.ceil(config.pile.plenumHeight / config.resolution);

  // Pass 1: Gravity drainage (top to bottom)
  for (let y = ny - 1; y > plenumCellsY; y--) {
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        const i = grid.idx(x, y, z);
        if (MATERIAL_FROM_CODE[grid.material[i]] !== 'compost') continue;

        const m = grid.moisture[i];
        if (m <= 0.65) continue; // below field capacity — no drainage

        // Excess moisture drains down
        const excess = (m - 0.65) * 0.1; // 10% of excess drains per day
        grid.moisture[i] -= excess;

        // Add to cell below (if compost)
        if (y > plenumCellsY + 1) {
          const below = grid.idx(x, y - 1, z);
          if (MATERIAL_FROM_CODE[grid.material[below]] === 'compost') {
            grid.moisture[below] = Math.min(1.0, grid.moisture[below] + excess);
          }
        }
      }
    }
  }

  // Pass 2: Biological moisture generation
  // Decomposition produces water as a byproduct (respiration: C6H12O6 + 6O2 → 6CO2 + 6H2O)
  // This slightly increases moisture throughout the pile
  for (let i = 0; i < grid.totalCells; i++) {
    if (MATERIAL_FROM_CODE[grid.material[i]] !== 'compost') continue;
    const T = grid.temp[i];
    if (T > 80) {
      // Active decomposition produces ~0.5% FC moisture per day
      grid.moisture[i] = Math.min(1.0, grid.moisture[i] + 0.005);
    }
  }
}

