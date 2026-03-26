/**
 * CPU simulation runner — mirrors gpuSimRunner's day-by-day structure.
 *
 * Runs tickStep in-process (main thread) so parity tests can compare
 * GPU and CPU output without Web Worker message overhead.
 * Produces one snapshot per day at the same collection points as GPU.
 */

import { CompostGrid, initializeGrid, MATERIAL_FROM_CODE, MATERIAL_CODES } from '../types/CompostGrid';
import type { SimulationConfig } from '../types/SimulationConfig';
import type { StepSnapshot } from './tickStep';
import { tickStep, addFreshMaterial, clearStageForTransfer } from './tickStep';
import { computeFanControl, createControllerState } from './fanController';
import type { SimEvent } from '../../viz/TimelineChart';
import type { StepWeather } from './workerProtocol';

// --- Types ---

export interface CpuSimProgress {
  percent: number;
  currentDay: number;
  totalDays: number;
  snapshot: StepSnapshot;
}

export interface CpuSimResult {
  snapshots: StepSnapshot[];
  events: SimEvent[];
}

export interface CpuSimOptions {
  config: SimulationConfig;
  weatherSteps: StepWeather[] | null;
  fanMode: 'manual' | 'auto';
  onProgress?: (progress: CpuSimProgress) => void;
}

// --- Constants ---

const HOURS_PER_WEEK = 168;
const WEEKS_PER_MONTH = 4;

// --- Orchestrator ---

/**
 * Run a CPU simulation with day-by-day snapshot collection.
 *
 * Mirrors gpuSimRunner: one snapshot per day, same material cycle timing.
 * Yields to browser between days via setTimeout(0) for UI responsiveness.
 */
export async function runCpuSimulation(options: CpuSimOptions): Promise<CpuSimResult> {
  const grid = initializeSimGrid(options.config);
  return executeSimLoop(grid, options);
}

// --- Concept functions ---

function initializeSimGrid(config: SimulationConfig): CompostGrid {
  const grid = new CompostGrid(config);
  initializeGrid(grid, config);
  clearCompostAbovePlenum(grid, config);
  return grid;
}

async function executeSimLoop(
  grid: CompostGrid,
  options: CpuSimOptions,
): Promise<CpuSimResult> {
  const { config, weatherSteps, fanMode, onProgress } = options;
  const dt = config.time.heatTimestep;
  const totalDays = config.time.totalHours / 24;
  const stepsPerDay = Math.round(24 / dt);
  const totalSteps = Math.ceil(config.time.totalHours / dt);

  const snapshots: StepSnapshot[] = [];
  const events: SimEvent[] = [];
  const controllerState = createControllerState();

  let globalStepIndex = 0;
  let lastWeekAddition = -1;
  let lastMonthTransfer = -1;

  for (let day = 0; day < Math.ceil(totalDays); day++) {
    const stepsThisDay = Math.min(stepsPerDay, totalSteps - globalStepIndex);
    if (stepsThisDay <= 0) break;

    const daySnapshot = advanceOneDay(grid, config, weatherSteps, fanMode, controllerState, globalStepIndex, stepsThisDay);
    globalStepIndex += stepsThisDay;

    const simTimeHours = globalStepIndex * dt;
    const materialResult = applyMaterialCycle(
      grid, config, simTimeHours, lastWeekAddition, lastMonthTransfer, events,
    );
    lastWeekAddition = materialResult.lastWeekAddition;
    lastMonthTransfer = materialResult.lastMonthTransfer;

    snapshots.push(daySnapshot);

    if (onProgress) {
      onProgress({
        percent: (day + 1) / Math.ceil(totalDays),
        currentDay: day + 1,
        totalDays: Math.ceil(totalDays),
        snapshot: daySnapshot,
      });
    }

    // Yield to browser every 5 days
    if (day % 5 === 0) {
      await yieldToBrowser();
    }
  }

  return { snapshots, events };
}

/** Run all timesteps for one day, return end-of-day snapshot. */
function advanceOneDay(
  grid: CompostGrid,
  config: SimulationConfig,
  weatherSteps: StepWeather[] | null,
  fanMode: 'manual' | 'auto',
  controllerState: ReturnType<typeof createControllerState>,
  startStep: number,
  stepCount: number,
): StepSnapshot {
  const dt = config.time.heatTimestep;
  let snapshot: StepSnapshot | null = null;

  for (let s = 0; s < stepCount; s++) {
    const stepIndex = startStep + s;
    const simTimeHours = stepIndex * dt;
    applyWeatherToConfig(config, weatherSteps, stepIndex);
    snapshot = tickStep(grid, config, simTimeHours, stepIndex);

    if (fanMode === 'auto') {
      const output = computeFanControl(snapshot, controllerState);
      config.aeration.onSeconds = output.onSeconds;
      config.aeration.offSeconds = output.offSeconds;
      config.aeration.gateOpening = output.gateOpening;
    }
  }

  return snapshot!;
}

function applyWeatherToConfig(
  config: SimulationConfig,
  weatherSteps: StepWeather[] | null,
  stepIndex: number,
): void {
  if (!weatherSteps || stepIndex >= weatherSteps.length) return;
  const w = weatherSteps[stepIndex];
  config.boundaries.ambientTemp = w.tempF;
  config.boundaries.ambientRH = w.rh;
  config.boundaries.groundTemp = w.tempF < 32 ? 32 : 35 + (w.tempF - 35) * 0.3;
}

function applyMaterialCycle(
  grid: CompostGrid,
  config: SimulationConfig,
  simTimeHours: number,
  lastWeekAddition: number,
  lastMonthTransfer: number,
  events: SimEvent[],
): { lastWeekAddition: number; lastMonthTransfer: number } {
  const currentWeek = Math.floor(simTimeHours / HOURS_PER_WEEK);
  const currentMonth = Math.floor(simTimeHours / (HOURS_PER_WEEK * WEEKS_PER_MONTH));

  if (currentMonth > lastMonthTransfer && currentMonth > 0) {
    clearStageForTransfer(grid, config);
    lastMonthTransfer = currentMonth;
    events.push({ timeHours: simTimeHours, type: 'transfer' });
  }

  if (currentWeek > lastWeekAddition) {
    addFreshMaterial(grid, config, 120);
    lastWeekAddition = currentWeek;
    events.push({ timeHours: simTimeHours, type: 'addition', volumeGallons: 120 });
  }

  // compactPile is called inside tickStep on day boundaries — no separate call needed
  return { lastWeekAddition, lastMonthTransfer };
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

function yieldToBrowser(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}
