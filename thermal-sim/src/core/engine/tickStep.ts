/**
 * Simulation orchestrator — one timestep of the compost thermal model.
 *
 * Pipeline per heat timestep (30 min simulated):
 *   1. Determine fan state (on/off based on duty cycle)
 *   2. Solve steady-state O2 field (Poisson, ~10 Jacobi iterations)
 *   3. Compute biological heat generation at each voxel (f(T, m, O2, age))
 *   4. Column-sweep fan convection: sensible + latent cooling, moisture removal
 *   5. Step heat forward one dt (explicit FDM)
 *   6. Apply fan-driven moisture changes (evaporation/condensation, per timestep)
 *   7. Every moistureInterval: gravity drainage + biological water production
 */

import { CompostGrid, MATERIAL_FROM_CODE, MATERIAL_CODES, isWithinRepose } from '../types/CompostGrid';
import type { SimulationConfig } from '../types/SimulationConfig';
import { computeHeatGeneration } from './bioActivity';
import { stepHeat } from './heatDiffusion';
import { solveOxygenSteadyState } from './oxygenSolver';
import { computeFanCooling, isFanOn } from './fanConvection';
import { updateMoisture } from './moistureTransport';

/** Snapshot of aggregate metrics at a point in time */
export interface StepSnapshot {
  timeHours: number;
  coreTemp: number;
  surfaceTemp: number;
  avgTemp: number;
  totalHeatGen: number;
  avgOxygen: number;
  avgMoisture: number;
  fanOn: boolean;
  /** Estimated pile weight in pounds */
  weightLbs: number;
  /** Pile volume in cubic feet */
  volumeFt3: number;
}

/**
 * Advance the simulation by one heat timestep.
 * Returns a snapshot of aggregate metrics.
 */
export function tickStep(
  grid: CompostGrid,
  config: SimulationConfig,
  simulationTimeHours: number,
): StepSnapshot {
  const fanOn = isFanOn(simulationTimeHours, config);

  // 1. Solve steady-state O2 field
  solveOxygenSteadyState(grid, config, fanOn);

  // 2. Compute biological heat generation per voxel
  const heatSource = grid.heatSourceScratch;
  heatSource.fill(0);
  for (let i = 0; i < grid.totalCells; i++) {
    if (MATERIAL_FROM_CODE[grid.material[i]] !== 'compost') continue;
    heatSource[i] = computeHeatGeneration(
      grid.temp[i], grid.moisture[i], grid.oxygen[i], grid.materialAge[i],
    );
  }

  // 3. Compute fan convective cooling + moisture removal (duty-cycle-averaged)
  const { cooling: fanCooling, moistureRemoval } = computeFanCooling(
    grid, config, grid.fanCoolingScratch, grid.moistureRemovalScratch,
  );

  // 4. Step heat forward
  stepHeat(grid, config, heatSource, fanCooling);

  // 6. Apply fan-driven moisture changes (evaporation removes, condensation adds)
  const dt = config.time.heatTimestep;
  for (let i = 0; i < grid.totalCells; i++) {
    if (moistureRemoval[i] === 0) continue;
    grid.moisture[i] = Math.max(0, Math.min(1.0, grid.moisture[i] - moistureRemoval[i] * dt));
  }

  // 7. Moisture update — gravity drainage + bio water (daily)
  const isNewDay = Math.floor(simulationTimeHours / config.time.moistureInterval)
    !== Math.floor((simulationTimeHours - config.time.heatTimestep) / config.time.moistureInterval);
  if (isNewDay) {
    updateMoisture(grid, config);

    // Age material by 1 day
    for (let i = 0; i < grid.totalCells; i++) {
      if (MATERIAL_FROM_CODE[grid.material[i]] === 'compost') {
        grid.materialAge[i] += 1;
      }
    }

    // Volume reduction: active composting shrinks material ~2% per day
    // Simulated by converting the topmost compost row to air if
    // average material age in the pile exceeds threshold (material has shrunk)
    compactPile(grid, config);
  }

  // 8. Collect metrics
  return collectSnapshot(grid, config, simulationTimeHours, heatSource, fanOn);
}

function collectSnapshot(
  grid: CompostGrid,
  config: SimulationConfig,
  timeHours: number,
  heatSource: Float32Array,
  fanOn: boolean,
): StepSnapshot {
  const { nx, ny, nz } = grid;
  const plenumCellsY = Math.ceil(config.pile.plenumHeight / config.resolution);

  let coreTemp = -Infinity;
  let surfaceTemp = Infinity;
  let sumTemp = 0;
  let sumO2 = 0;
  let sumMoisture = 0;
  let totalHeatGen = 0;
  let compostCells = 0;

  const cellVolFt3 = Math.pow(config.resolution / 12, 3);

  for (let y = 0; y < ny; y++) {
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        const i = grid.idx(x, y, z);
        if (MATERIAL_FROM_CODE[grid.material[i]] !== 'compost') continue;

        const T = grid.temp[i];
        compostCells++;
        sumTemp += T;
        sumO2 += grid.oxygen[i];
        sumMoisture += grid.moisture[i];
        totalHeatGen += heatSource[i] * cellVolFt3;

        if (T > coreTemp) coreTemp = T;

        // Surface detection: cells adjacent to non-compost or boundary
        const isSurface = x <= 1 || x >= nx - 2 || y <= plenumCellsY + 1 || y >= ny - 2 || z <= 1 || z >= nz - 2;
        if (isSurface && T < surfaceTemp) surfaceTemp = T;
      }
    }
  }

  const volumeFt3 = compostCells * cellVolFt3;
  // Weight: density depends on moisture. avg moisture × density curve.
  // At 55% moisture: ~42 lbs/ft3. At 65%: ~48 lbs/ft3.
  const avgMoist = compostCells > 0 ? sumMoisture / compostCells : 0.5;
  const avgDensity = 25 + 30 * avgMoist; // lbs/ft3 (dry=25, wet=55)
  const weightLbs = volumeFt3 * avgDensity;

  return {
    timeHours,
    coreTemp: compostCells > 0 ? coreTemp : config.boundaries.ambientTemp,
    surfaceTemp: compostCells > 0 ? surfaceTemp : config.boundaries.ambientTemp,
    avgTemp: compostCells > 0 ? sumTemp / compostCells : config.boundaries.ambientTemp,
    totalHeatGen,
    avgOxygen: compostCells > 0 ? sumO2 / compostCells : 0.21,
    avgMoisture: avgMoist,
    fanOn,
    weightLbs,
    volumeFt3,
  };
}

/**
 * Run the full simulation for the configured duration.
 * Returns an array of snapshots (one per heat timestep).
 */
export function runSimulation(
  grid: CompostGrid,
  config: SimulationConfig,
): StepSnapshot[] {
  const snapshots: StepSnapshot[] = [];
  const totalSteps = Math.ceil(config.time.totalHours / config.time.heatTimestep);

  for (let step = 0; step < totalSteps; step++) {
    const timeHours = step * config.time.heatTimestep;
    const snapshot = tickStep(grid, config, timeHours);
    snapshots.push(snapshot);
  }

  return snapshots;
}

/**
 * Simulate a weekly material addition (~128 gallons = ~17 ft3 of greens+browns).
 * Adds fresh material on TOP of existing compost. If pile is full, compresses
 * existing material (simulates settling) and adds on top.
 *
 * @param layerThicknessInches - thickness of fresh material to add (default 6")
 */
export function addFreshMaterial(
  grid: CompostGrid,
  config: SimulationConfig,
  targetVolumeGallons: number = 128,
): void {
  const { nx, ny, nz } = grid;
  const plenumCellsY = Math.ceil(config.pile.plenumHeight / config.resolution);

  // Target volume in cells: 128 gal = ~17.1 ft³, cell volume = (res/12)³ ft³
  const cellVolFt3 = Math.pow(config.resolution / 12, 3);
  const targetVolFt3 = targetVolumeGallons / 7.48; // gallons to ft³
  const targetCells = Math.round(targetVolFt3 / cellVolFt3);

  // Find the current top of the compost (default: just below plenum top, so first addition starts at plenum top)
  let topY = plenumCellsY - 1;
  for (let y = ny - 1; y >= 0; y--) {
    let found = false;
    for (let z = 0; z < nz && !found; z++) {
      for (let x = 0; x < nx && !found; x++) {
        if (MATERIAL_FROM_CODE[grid.material[grid.idx(x, y, z)]] === 'compost') {
          topY = Math.max(topY, y);
          found = true;
        }
      }
    }
    if (found) break;
  }

  // Add layers one at a time until we've placed enough cells to match target volume
  let cellsPlaced = 0;
  let currentY = topY + 1;

  while (cellsPlaced < targetCells && currentY < ny) {
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        if (!isWithinRepose(x, currentY, z, nx, nz, plenumCellsY, 0)) continue;

        const i = grid.idx(x, currentY, z);
        if (MATERIAL_FROM_CODE[grid.material[i]] === 'compost') continue; // already filled

        grid.material[i] = MATERIAL_CODES.compost;
        grid.temp[i] = config.boundaries.ambientTemp;
        grid.moisture[i] = 0.65;
        grid.oxygen[i] = 0.15;
        grid.materialAge[i] = 0;
        cellsPlaced++;
      }
    }
    currentY++;
  }
}

/**
 * Simulate volume reduction from decomposition.
 * Every 7 days of average pile age, remove the topmost compost layer (convert to air).
 * Real composting shrinks ~50% over 4 weeks ≈ 2% per day ≈ one 2" layer every 4 days.
 */
function compactPile(grid: CompostGrid, config: SimulationConfig): void {
  const { nx, ny, nz } = grid;
  const plenumCellsY = Math.ceil(config.pile.plenumHeight / config.resolution);

  // Find the top of the pile
  let topY = plenumCellsY;
  for (let y = ny - 1; y > plenumCellsY; y--) {
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        if (MATERIAL_FROM_CODE[grid.material[grid.idx(x, y, z)]] === 'compost') {
          topY = Math.max(topY, y);
        }
      }
    }
    if (topY > plenumCellsY) break;
  }

  // Don't compact below minimum pile height (seed layer + a few layers)
  if (topY <= plenumCellsY + 4) return;

  // Only compact if the top layer is old enough.
  // Real compost shrinks ~50% over 4 weeks = ~1 layer per 7 days at 2" resolution.
  // Trigger: top layer average age > 10 days (roughly biweekly compaction)
  let topLayerAgeSum = 0;
  let topLayerCount = 0;
  for (let z = 0; z < nz; z++) {
    for (let x = 0; x < nx; x++) {
      const i = grid.idx(x, topY, z);
      if (MATERIAL_FROM_CODE[grid.material[i]] === 'compost') {
        topLayerAgeSum += grid.materialAge[i];
        topLayerCount++;
      }
    }
  }

  const avgTopAge = topLayerCount > 0 ? topLayerAgeSum / topLayerCount : 0;
  if (avgTopAge < 10) return; // biweekly compaction

  for (let z = 0; z < nz; z++) {
    for (let x = 0; x < nx; x++) {
      const i = grid.idx(x, topY, z);
      if (MATERIAL_FROM_CODE[grid.material[i]] === 'compost') {
        grid.material[i] = MATERIAL_CODES.air;
        grid.temp[i] = config.boundaries.ambientTemp;
        grid.moisture[i] = 0;
        grid.oxygen[i] = 0.21;
        grid.materialAge[i] = 0;
      }
    }
  }
}

/**
 * Simulate monthly transfer: fork all compost to Stage 2.
 * Clears everything above the plenum — weight goes to zero.
 * Fresh weekly additions restart the pile from scratch.
 */
export function clearStageForTransfer(
  grid: CompostGrid,
  config: SimulationConfig,
): void {
  const plenumCellsY = Math.ceil(config.pile.plenumHeight / config.resolution);

  for (let i = 0; i < grid.totalCells; i++) {
    const matType = MATERIAL_FROM_CODE[grid.material[i]];
    if (matType !== 'compost') continue;

    const { y } = grid.coords(i);
    if (y < plenumCellsY) continue; // preserve plenum edge seal
    grid.material[i] = MATERIAL_CODES.air;
    grid.temp[i] = config.boundaries.ambientTemp;
    grid.moisture[i] = 0;
    grid.oxygen[i] = 0.21;
    grid.materialAge[i] = 0;
  }
}
