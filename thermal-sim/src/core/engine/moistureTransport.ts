/**
 * Moisture transport — updated once per simulated day.
 *
 * Three mechanisms:
 * 1. Gravity drainage: water moves downward through the pile
 * 2. Evaporation at the top surface: temperature-dependent, reduced by membrane
 * 3. Condensation on membrane underside: recycled back into pile
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

  // Pass 2: Evaporation at top surface
  for (let z = 0; z < nz; z++) {
    for (let x = 0; x < nx; x++) {
      // Find top-most compost cell in this column
      for (let y = ny - 1; y >= 0; y--) {
        const i = grid.idx(x, y, z);
        if (MATERIAL_FROM_CODE[grid.material[i]] !== 'compost') continue;

        const T = grid.temp[i];
        const m = grid.moisture[i];

        // Evaporation rate increases with temperature
        // At 150F: high evaporation. At 70F: low.
        // Membrane retains ~70% of moisture vapor
        const membraneRetention = 0.70;
        const evapRate = computeEvapRate(T) * (1 - membraneRetention);

        // Moisture lost per day (fraction of FC)
        const moistureLost = evapRate * m * 0.05;
        grid.moisture[i] = Math.max(0, m - moistureLost);

        // Condensation: some of the evaporated moisture condenses on the membrane
        // and drips back onto the surface. Net effect: membrane recycles moisture.
        // This is already captured by the retention factor above.

        break; // only top cell in column
      }
    }
  }

  // Pass 3: Biological moisture generation
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

/**
 * Evaporation rate factor based on temperature.
 * Returns a dimensionless multiplier (0-1) applied to moisture removal.
 */
function computeEvapRate(tempF: number): number {
  if (tempF < 60) return 0.05;
  if (tempF < 100) return 0.05 + (tempF - 60) / 40 * 0.25;
  if (tempF < 140) return 0.30 + (tempF - 100) / 40 * 0.40;
  return 0.70 + (Math.min(tempF, 180) - 140) / 40 * 0.30;
}
