/**
 * Simulation Web Worker — runs a full-year batch computation off the main thread.
 *
 * Receives a RunMessage with config + weather data, executes the complete sim loop,
 * posts progress updates, and returns all snapshots + grid checkpoints for scrubber replay.
 */

import { CompostGrid, initializeGrid, MATERIAL_FROM_CODE } from '../types/CompostGrid';
import type { SimulationConfig } from '../types/SimulationConfig';
import { tickStep, addFreshMaterial, clearStageForTransfer, type StepSnapshot } from './tickStep';
import { computeFanControl, createControllerState, type FanControllerState } from './fanController';
import type {
  WorkerInMessage, WorkerOutMessage,
  GridCheckpoint, StepWeather,
} from './workerProtocol';
import type { SimEvent } from '../../viz/TimelineChart';

const HOURS_PER_WEEK = 168;
const WEEKS_PER_MONTH = 4;

self.onmessage = (e: MessageEvent<WorkerInMessage>) => {
  const inMessage = e.data;
  if (inMessage.type === 'run') {
    runBatchSim(inMessage.config, inMessage.weatherSteps, inMessage.fanMode, inMessage.checkpointIntervalHours);
  }
};

// --- Orchestrator ---

/**
 * Run the full batch simulation: initialize grid, step through all timesteps,
 * collect results, post completion.
 */
function runBatchSim(
  config: SimulationConfig,
  weatherSteps: StepWeather[] | null,
  fanMode: 'manual' | 'auto',
  checkpointIntervalHours: number,
): void {
  const grid = initializeBatchGrid(config);
  const dt = config.time.heatTimestep;
  const totalSteps = Math.ceil(config.time.totalHours / dt);
  const checkpointStepInterval = Math.round(checkpointIntervalHours / dt);
  const progressStepInterval = Math.max(1, Math.floor(totalSteps / 200));

  const totalDays = config.time.totalHours / 24;
  const snapshots: StepSnapshot[] = [];
  const gridCheckpoints: GridCheckpoint[] = [];
  const events: SimEvent[] = [];
  const controllerState = createControllerState();

  let simTimeHours = 0;
  let lastWeekAddition = -1;
  let lastMonthTransfer = -1;

  for (let step = 0; step < totalSteps; step++) {
    applyWeatherToConfig(config, weatherSteps, step);

    const snapshot = advanceOneStep(grid, config, simTimeHours, fanMode, controllerState);
    simTimeHours += dt;

    const stepEvents = applyMaterialCycle(grid, config, simTimeHours, lastWeekAddition, lastMonthTransfer);
    lastWeekAddition = stepEvents.lastWeekAddition;
    lastMonthTransfer = stepEvents.lastMonthTransfer;
    for (const ev of stepEvents.newEvents) events.push(ev);

    collectStepResults(step, totalSteps, checkpointStepInterval, snapshot, simTimeHours, grid, snapshots, gridCheckpoints);
    postProgressUpdate(step, progressStepInterval, totalSteps, totalDays, simTimeHours);
  }

  postSimComplete(snapshots, gridCheckpoints, events);
}

// --- Concept functions ---

/** Create and initialize grid, starting with empty pile above plenum. */
function initializeBatchGrid(config: SimulationConfig): CompostGrid {
  const grid = new CompostGrid(config);
  initializeGrid(grid, config);
  clearCompostAbovePlenum(grid, config);
  return grid;
}

/** Apply weather conditions to config for the current step. */
function applyWeatherToConfig(config: SimulationConfig, weatherSteps: StepWeather[] | null, step: number): void {
  if (!weatherSteps || step >= weatherSteps.length) return;
  const stepConditions = weatherSteps[step];
  config.boundaries.ambientTemp = stepConditions.tempF;
  config.boundaries.ambientRH = stepConditions.rh;
  config.boundaries.groundTemp = stepConditions.tempF < 32 ? 32 : 35 + (stepConditions.tempF - 35) * 0.3;
}

/** Run one sim step + fan controller update. */
function advanceOneStep(
  grid: CompostGrid,
  config: SimulationConfig,
  simTimeHours: number,
  fanMode: 'manual' | 'auto',
  controllerState: FanControllerState,
): StepSnapshot {
  const snapshot = tickStep(grid, config, simTimeHours);

  if (fanMode === 'auto') {
    const output = computeFanControl(snapshot, controllerState);
    config.aeration.onSeconds = output.onSeconds;
    config.aeration.offSeconds = output.offSeconds;
    config.aeration.gateOpening = output.gateOpening;
  }

  return snapshot;
}

/** Handle weekly additions and monthly transfers. Returns updated trackers + any new events. */
function applyMaterialCycle(
  grid: CompostGrid,
  config: SimulationConfig,
  simTimeHours: number,
  lastWeekAddition: number,
  lastMonthTransfer: number,
): { lastWeekAddition: number; lastMonthTransfer: number; newEvents: SimEvent[] } {
  const currentWeek = Math.floor(simTimeHours / HOURS_PER_WEEK);
  const currentMonth = Math.floor(simTimeHours / (HOURS_PER_WEEK * WEEKS_PER_MONTH));
  const newEvents: SimEvent[] = [];

  if (currentMonth > lastMonthTransfer && currentMonth > 0) {
    clearStageForTransfer(grid, config);
    lastMonthTransfer = currentMonth;
    newEvents.push({ timeHours: simTimeHours, type: 'transfer' });
  }

  if (currentWeek > lastWeekAddition) {
    addFreshMaterial(grid, config, 120);
    lastWeekAddition = currentWeek;
    newEvents.push({ timeHours: simTimeHours, type: 'addition', volumeGallons: 120 });
  }

  return { lastWeekAddition, lastMonthTransfer, newEvents };
}

/** Store snapshot and grid checkpoint if this step is a collection point. */
function collectStepResults(
  step: number,
  totalSteps: number,
  checkpointStepInterval: number,
  snapshot: StepSnapshot,
  simTimeHours: number,
  grid: CompostGrid,
  snapshots: StepSnapshot[],
  gridCheckpoints: GridCheckpoint[],
): void {
  if (step % 4 === 0) {
    snapshots.push(snapshot);
  }
  if (step % checkpointStepInterval === 0 || step === totalSteps - 1) {
    gridCheckpoints.push({ timeHours: simTimeHours, state: grid.saveState(), snapshot });
  }
}

/** Post progress to main thread (throttled to ~200 updates). */
function postProgressUpdate(step: number, progressStepInterval: number, totalSteps: number, totalDays: number, simTimeHours: number): void {
  if (step % progressStepInterval !== 0) return;
  const progress: WorkerOutMessage = {
    type: 'progress',
    percent: step / totalSteps,
    currentDay: simTimeHours / 24,
    totalDays,
  };
  self.postMessage(progress);
}

/** Post final results to main thread. */
function postSimComplete(snapshots: StepSnapshot[], gridCheckpoints: GridCheckpoint[], events: SimEvent[]): void {
  const complete: WorkerOutMessage = { type: 'complete', snapshots, gridCheckpoints, events };
  self.postMessage(complete);
}

// --- Leaf functions ---

/** Clear compost above plenum — starts pile empty for first weekly addition. */
function clearCompostAbovePlenum(grid: CompostGrid, config: SimulationConfig): void {
  const plenumCellsY = Math.ceil(config.pile.plenumHeight / config.resolution);
  for (let i = 0; i < grid.totalCells; i++) {
    if (MATERIAL_FROM_CODE[grid.material[i]] !== 'compost') continue;
    const { y } = grid.coords(i);
    if (y < plenumCellsY) continue;
    grid.material[i] = 1; // air
    grid.temp[i] = config.boundaries.ambientTemp;
    grid.moisture[i] = 0;
    grid.oxygen[i] = 0.21;
    grid.materialAge[i] = 0;
  }
}
