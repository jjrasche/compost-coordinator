/**
 * GPU-accelerated simulation runner — streaming day-by-day playback.
 *
 * Runs on main thread (WebGPU requires GPU device access). Dispatches one
 * simulated day per GPU batch, reads back arrays, computes snapshot on CPU,
 * handles material cycle + fan controller, then yields to browser for rendering.
 *
 * Async readback (mapAsync) naturally yields to the browser event loop,
 * so the timeline chart and 3D scene update progressively as each day completes.
 */

import { CompostGrid, initializeGrid, MATERIAL_FROM_CODE, MATERIAL_CODES } from '../../types/CompostGrid';
import type { SimulationConfig } from '../../types/SimulationConfig';
import type { StepSnapshot } from '../tickStep';
import { addFreshMaterial, clearStageForTransfer, compactPile, collectSnapshot } from '../tickStep';
import { computeFanControl, createControllerState } from '../fanController';
import type { SimEvent } from '../../../viz/TimelineChart';
import type { StepWeather, GridCheckpoint } from '../workerProtocol';
import {
  initGpuPipeline, dispatchOneDay, readbackAllArrays, syncGridToGpu,
  updateHeatWeather, updateColumnWeather, updateO2FanState, destroyGpuPipeline,
  type GpuPipeline,
} from './gpuPipeline';

// --- Types ---

export interface GpuSimProgress {
  percent: number;
  currentDay: number;
  totalDays: number;
  snapshot: StepSnapshot;
}

export interface GpuSimResult {
  snapshots: StepSnapshot[];
  gridCheckpoints: GridCheckpoint[];
  events: SimEvent[];
}

export interface GpuSimOptions {
  config: SimulationConfig;
  weatherSteps: StepWeather[] | null;
  fanMode: 'manual' | 'auto';
  checkpointIntervalHours: number;
  onProgress: (progress: GpuSimProgress) => void;
  abortSignal?: AbortSignal;
}

// --- Constants ---

const HOURS_PER_WEEK = 168;
const WEEKS_PER_MONTH = 4;

// --- Orchestrator ---

/**
 * Run a full GPU-accelerated simulation with streaming day-by-day output.
 *
 * Each simulated day: GPU dispatch → readback → snapshot → material cycle → yield.
 * The onProgress callback fires once per day with the snapshot, enabling
 * progressive chart/3D updates.
 */
export async function runGpuSimulation(options: GpuSimOptions): Promise<GpuSimResult> {
  const grid = initializeSimGrid(options.config);
  const gpu = await initGpuPipeline(grid, options.config);

  try {
    return await executeSimLoop(gpu, grid, options);
  } finally {
    destroyGpuPipeline(gpu);
  }
}

// --- Concept functions ---

function initializeSimGrid(config: SimulationConfig): CompostGrid {
  const grid = new CompostGrid(config);
  initializeGrid(grid, config);
  clearCompostAbovePlenum(grid, config);
  return grid;
}

async function executeSimLoop(
  gpu: GpuPipeline,
  grid: CompostGrid,
  options: GpuSimOptions,
): Promise<GpuSimResult> {
  const { config, weatherSteps, fanMode, checkpointIntervalHours, onProgress, abortSignal } = options;
  const dt = config.time.heatTimestep;
  const totalDays = config.time.totalHours / 24;
  const stepsPerDay = Math.round(24 / dt);
  const totalSteps = Math.ceil(config.time.totalHours / dt);
  const checkpointDayInterval = Math.max(1, Math.round(checkpointIntervalHours / 24));

  const snapshots: StepSnapshot[] = [];
  const gridCheckpoints: GridCheckpoint[] = [];
  const events: SimEvent[] = [];
  const controllerState = createControllerState();

  let globalStepIndex = 0;
  let lastWeekAddition = -1;
  let lastMonthTransfer = -1;

  for (let day = 0; day < Math.ceil(totalDays); day++) {
    if (abortSignal?.aborted) break;

    const simTimeHours = day * 24;
    const stepsThisDay = Math.min(stepsPerDay, totalSteps - globalStepIndex);
    if (stepsThisDay <= 0) break;

    // Update weather for this day (use middle-of-day step index)
    applyWeatherForDay(config, gpu, grid, weatherSteps, globalStepIndex + Math.floor(stepsThisDay / 2));

    // Update O2 fan state (use duty-cycle-averaged: fan is "on" for GPU)
    updateO2FanState(gpu, true);

    // Dispatch one day on GPU
    dispatchOneDay(gpu, stepsThisDay, globalStepIndex);
    globalStepIndex += stepsThisDay;

    // Readback arrays (async — yields to browser)
    const readback = await readbackAllArrays(gpu);

    // Copy readback into grid (for CPU-side snapshot + material operations)
    copyReadbackToGrid(grid, readback);

    // Compute snapshot (grid already has readback data from copyReadbackToGrid)
    grid.heatSourceScratch.set(readback.heatSource);
    const snapshot = collectSnapshot(
      grid, config, simTimeHours + 24, grid.heatSourceScratch,
      fanMode !== 'manual',
    );
    snapshots.push(snapshot);

    // Fan controller update
    if (fanMode === 'auto') {
      const output = computeFanControl(snapshot, controllerState);
      config.aeration.onSeconds = output.onSeconds;
      config.aeration.offSeconds = output.offSeconds;
      config.aeration.gateOpening = output.gateOpening;
      // Re-upload column uniforms with new fan settings
      updateColumnWeather(gpu, grid, config);
    }

    // Material cycle (additions/transfers — modifies grid on CPU)
    const materialChanged = applyMaterialCycle(
      grid, config, simTimeHours + 24, lastWeekAddition, lastMonthTransfer, events,
    );
    lastWeekAddition = materialChanged.lastWeekAddition;
    lastMonthTransfer = materialChanged.lastMonthTransfer;

    // Re-sync to GPU if material changed
    if (materialChanged.didChange) {
      syncGridToGpu(gpu, grid);
      updateColumnWeather(gpu, grid, config);
    }

    // Grid checkpoint
    if (day % checkpointDayInterval === 0 || day === Math.ceil(totalDays) - 1) {
      gridCheckpoints.push({
        timeHours: simTimeHours + 24,
        state: grid.saveState(),
        snapshot,
      });
    }

    // Progress callback
    onProgress({
      percent: (day + 1) / Math.ceil(totalDays),
      currentDay: day + 1,
      totalDays: Math.ceil(totalDays),
      snapshot,
    });
  }

  return { snapshots, gridCheckpoints, events };
}

function applyWeatherForDay(
  config: SimulationConfig,
  gpu: GpuPipeline,
  grid: CompostGrid,
  weatherSteps: StepWeather[] | null,
  stepIndex: number,
): void {
  if (!weatherSteps || stepIndex >= weatherSteps.length) return;

  const w = weatherSteps[stepIndex];
  config.boundaries.ambientTemp = w.tempF;
  config.boundaries.ambientRH = w.rh;
  config.boundaries.groundTemp = w.tempF < 32 ? 32 : 35 + (w.tempF - 35) * 0.3;

  updateHeatWeather(gpu, config.boundaries.ambientTemp, config.boundaries.groundTemp);
  updateColumnWeather(gpu, grid, config);
}

function copyReadbackToGrid(
  grid: CompostGrid,
  readback: { temp: Float32Array; moisture: Float32Array; oxygen: Float32Array; materialAge: Float32Array },
): void {
  grid.temp.set(readback.temp);
  grid.moisture.set(readback.moisture);
  grid.oxygen.set(readback.oxygen);
  grid.materialAge.set(readback.materialAge);
}

function applyMaterialCycle(
  grid: CompostGrid,
  config: SimulationConfig,
  simTimeHours: number,
  lastWeekAddition: number,
  lastMonthTransfer: number,
  events: SimEvent[],
): { lastWeekAddition: number; lastMonthTransfer: number; didChange: boolean } {
  const currentWeek = Math.floor(simTimeHours / HOURS_PER_WEEK);
  const currentMonth = Math.floor(simTimeHours / (HOURS_PER_WEEK * WEEKS_PER_MONTH));
  let didChange = false;

  if (currentMonth > lastMonthTransfer && currentMonth > 0) {
    clearStageForTransfer(grid, config);
    lastMonthTransfer = currentMonth;
    events.push({ timeHours: simTimeHours, type: 'transfer' });
    didChange = true;
  }

  if (currentWeek > lastWeekAddition) {
    addFreshMaterial(grid, config, 120);
    lastWeekAddition = currentWeek;
    events.push({ timeHours: simTimeHours, type: 'addition', volumeGallons: 120 });
    didChange = true;
  }

  // Volume reduction: convert old top-layer compost to air (matches CPU tickStep).
  // Always re-sync after — compactPile is a no-op when conditions aren't met,
  // and the sync cost (~0.3ms) is negligible vs GPU dispatch.
  compactPile(grid, config);
  didChange = true;

  return { lastWeekAddition, lastMonthTransfer, didChange };
}

// --- Leaf functions ---

function clearCompostAbovePlenum(grid: CompostGrid, config: SimulationConfig): void {
  const plenumCellsY = Math.ceil(config.pile.plenumHeight / config.resolution);
  for (let i = 0; i < grid.totalCells; i++) {
    if (MATERIAL_FROM_CODE[grid.material[i]] !== 'compost') continue;
    const { y } = grid.coords(i);
    if (y < plenumCellsY) continue;
    grid.material[i] = MATERIAL_CODES.air;
    grid.temp[i] = config.boundaries.ambientTemp;
    grid.moisture[i] = 0;
    grid.oxygen[i] = 0.21;
    grid.materialAge[i] = 0;
  }
}
