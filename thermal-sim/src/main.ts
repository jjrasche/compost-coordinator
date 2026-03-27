/**
 * Compost Thermal Simulator — main entry point.
 *
 * Batch computation model:
 *   Config change → debounce → Web Worker computes full year →
 *   Timeline shows full projection → scrubber drives 3D view.
 */

import { CompostGrid, initializeGrid } from './core/types/CompostGrid';
import { createDefaultConfig, COVER_PRESETS, type SimulationConfig, type CoverType, type InsulationType } from './core/types/SimulationConfig';
import type { StepSnapshot } from './core/engine/tickStep';
import { PileScene, type FieldType, type CutAxis } from './viz/PileScene';
import { TimelineChart, type SimEvent } from './viz/TimelineChart';
import {
  runOptimizationAsync, runSeasonalSweep, configToParams,
  type OptimizationResult, type OptimizationProgress, type SeasonalStrategy,
} from './core/engine/optimizer';
import {
  fetchSeasonSchedule, fetchNormalsSchedule,
  type WeatherSchedule,
} from './core/environment/weatherClient';
import type {
  WorkerOutMessage, GridCheckpoint, StepWeather, RunMessage,
} from './core/engine/workerProtocol';
import { runGpuSimulation, type GpuSimProgress, type GpuSimResult } from './core/engine/gpu/gpuSimRunner';

function formatFraction(inches: number): string {
  const sixteenths = Math.round(inches * 16);
  if (sixteenths % 16 === 0) return (sixteenths / 16).toString();
  if (sixteenths % 8 === 0) return `${sixteenths / 8}/2`;
  if (sixteenths % 4 === 0) return `${sixteenths / 4}/4`;
  if (sixteenths % 2 === 0) return `${sixteenths / 2}/8`;
  return `${sixteenths}/16`;
}

const LEGENDS: Record<string, string> = {
  temperature: [
    '<div class="legend-item" style="background:#262676;color:#fff">&lt;32</div>',
    '<div class="legend-item" style="background:#3d63b5;color:#fff">50</div>',
    '<div class="legend-item" style="background:#4fb5db;color:#000">70</div>',
    '<div class="legend-item" style="background:#ffd133;color:#000">100</div>',
    '<div class="legend-item" style="background:#ff8c28;color:#000">131</div>',
    '<div class="legend-item" style="background:#db3d28;color:#fff">160+</div>',
  ].join(''),
  oxygen: [
    '<div class="legend-item" style="background:#b31a1a;color:#fff">0%</div>',
    '<div class="legend-item" style="background:#e6b31a;color:#000">5%</div>',
    '<div class="legend-item" style="background:#66cc33;color:#000">10%</div>',
    '<div class="legend-item" style="background:#33cc33;color:#000">21%</div>',
  ].join(''),
  moisture: [
    '<div class="legend-item" style="background:#996633;color:#fff">&lt;30%</div>',
    '<div class="legend-item" style="background:#66b34d;color:#000">40%</div>',
    '<div class="legend-item" style="background:#3380cc;color:#fff">65%</div>',
    '<div class="legend-item" style="background:#1a3399;color:#fff">100%</div>',
  ].join(''),
};

function updateLegend(field: FieldType): void {
  document.getElementById('tempLegend')!.innerHTML = LEGENDS[field] ?? LEGENDS.temperature;
}

// --- State ---
let config = createDefaultConfig();
let grid = new CompostGrid(config); // used for 3D display from checkpoints
let scene: PileScene;
let chart: TimelineChart;

// Batch sim results
let gridCheckpoints: GridCheckpoint[] = [];
let currentScrubberHours = 0;

// Worker
let simWorker: Worker | null = null;
let recomputeTimer: ReturnType<typeof setTimeout> | null = null;
let isComputing = false;

// Weather
let weatherSchedule: WeatherSchedule | null = null;
let weatherMode: 'manual' | string = 'manual';

// Fan mode
let fanMode: 'manual' | 'auto' = 'manual';

// Engine selection
let engineMode: 'cpu' | 'gpu' = 'cpu';
let webGpuAvailable = false;
let gpuAbortController: AbortController | null = null;

// Playback animation
let playing = false;
let playbackAnimId = 0;
let playbackSpeed = 50; // sim hours per real second

const HOURS_PER_WEEK = 168;
const WEEKS_PER_MONTH = 4;

// --- Worker management ---

function createWorker(): Worker {
  return new Worker(new URL('./core/engine/simWorker.ts', import.meta.url), { type: 'module' });
}

function terminateWorker(): void {
  if (simWorker) {
    simWorker.terminate();
    simWorker = null;
  }
}

/** Build per-step weather array from a weather schedule. */
function buildWeatherSteps(schedule: WeatherSchedule, totalHours: number, dt: number): StepWeather[] {
  const totalSteps = Math.ceil(totalHours / dt);
  const steps: StepWeather[] = new Array(totalSteps);
  for (let i = 0; i < totalSteps; i++) {
    const simHours = i * dt;
    const conditions = schedule.lookup(simHours);
    steps[i] = { tempF: conditions.tempF, rh: conditions.rh };
  }
  return steps;
}

/** Build the RunMessage from current UI state. */
function buildRunMessage(): RunMessage {
  const workerConfig = structuredClone(config);
  const durationDays = parseInt((document.getElementById('durationSelect') as HTMLSelectElement).value);
  workerConfig.time.totalHours = durationDays * 24;

  const weatherSteps = weatherSchedule ? buildWeatherSteps(weatherSchedule, workerConfig.time.totalHours, workerConfig.time.heatTimestep) : null;

  return {
    type: 'run',
    config: workerConfig,
    weatherSteps,
    fanMode,
    checkpointIntervalHours: 24,
  };
}

/** Show computing state in progress bar and header. */
function showComputingState(): void {
  document.getElementById('simProgressBar')!.style.width = '0%';
  document.getElementById('simProgressText')!.textContent = 'Computing...';
  document.getElementById('simStatus')!.textContent = 'Computing...';
}

/** Update progress bar from worker progress message. */
function handleWorkerProgress(percent: number, currentDay: number, totalDays: number): void {
  document.getElementById('simProgressBar')!.style.width = (percent * 100).toFixed(0) + '%';
  document.getElementById('simProgressText')!.textContent = `Day ${currentDay.toFixed(0)} / ${totalDays.toFixed(0)}`;
  document.getElementById('simStatus')!.textContent = `Day ${currentDay.toFixed(0)}...`;
}

/** Handle completed simulation results from worker. */
function handleSimComplete(workerResult: Extract<WorkerOutMessage, { type: 'complete' }>): void {
  isComputing = false;
  document.getElementById('simProgressBar')!.style.width = '100%';
  document.getElementById('simProgressText')!.textContent = '';
  document.getElementById('simStatus')!.textContent = `${workerResult.snapshots.length} snapshots`;

  gridCheckpoints = workerResult.gridCheckpoints;
  chart.loadBatch(workerResult.snapshots, workerResult.events);
  scrubTo(0);
  terminateWorker();
}

/** Handle worker error — show feedback and reset computing state. */
function handleWorkerError(err: ErrorEvent): void {
  isComputing = false;
  document.getElementById('simProgressBar')!.style.width = '0%';
  document.getElementById('simProgressText')!.textContent = '';
  document.getElementById('simStatus')!.textContent = 'Error';
  document.getElementById('status')!.textContent = `Worker error: ${err.message?.slice(0, 50) ?? 'unknown'}`;
  document.getElementById('status')!.style.color = '#d42';
  terminateWorker();
  updatePlayButton();
}

/** Dispatch a full batch computation to the CPU worker. */
function dispatchBatchSim(): void {
  abortGpuSim();
  terminateWorker();
  isComputing = true;
  playing = false;
  updatePlayButton();
  showComputingState();

  const runMessage = buildRunMessage();

  simWorker = createWorker();
  simWorker.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
    const workerReply = e.data;
    if (workerReply.type === 'progress') handleWorkerProgress(workerReply.percent, workerReply.currentDay, workerReply.totalDays);
    if (workerReply.type === 'complete') handleSimComplete(workerReply);
  };
  simWorker.onerror = handleWorkerError;
  simWorker.postMessage(runMessage);
}

function showEngineUnavailable(reason: string): void {
  document.getElementById('engineStatus')!.textContent = reason;
  document.getElementById('engineStatus')!.style.color = '#888';
  (document.getElementById('engineSelect') as HTMLSelectElement).value = 'cpu';
  engineMode = 'cpu';
}

/** Detect WebGPU support and update UI accordingly. */
async function detectWebGpu(): Promise<boolean> {
  if (!navigator.gpu) {
    showEngineUnavailable('No WebGPU');
    return false;
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    showEngineUnavailable('No adapter');
    return false;
  }

  document.getElementById('engineStatus')!.textContent = 'GPU ready';
  document.getElementById('engineStatus')!.style.color = '#6b6';
  return true;
}

/** Abort any in-flight GPU simulation. */
function abortGpuSim(): void {
  if (gpuAbortController) {
    gpuAbortController.abort();
    gpuAbortController = null;
  }
}

/** Dispatch a GPU-accelerated simulation with streaming day-by-day output. */
async function dispatchGpuSim(): Promise<void> {
  abortGpuSim();
  terminateWorker();
  isComputing = true;
  playing = false;
  updatePlayButton();
  showComputingState();

  // Reset chart for streaming mode
  chart.reset();
  gridCheckpoints = [];

  gpuAbortController = new AbortController();
  const runMessage = buildRunMessage();

  try {
    const result = await runGpuSimulation({
      config: runMessage.config,
      weatherSteps: runMessage.weatherSteps,
      fanMode: runMessage.fanMode,
      checkpointIntervalHours: runMessage.checkpointIntervalHours,
      abortSignal: gpuAbortController.signal,
      onProgress: (progress: GpuSimProgress) => {
        handleWorkerProgress(progress.percent, progress.currentDay, progress.totalDays);

        // Stream snapshot into chart (progressive fill)
        chart.recordSnapshot(progress.snapshot);
        chart.setCurrentTime(progress.snapshot.timeHours);
        chart.draw();

        // Live dashboard update
        updateDashboard(progress.snapshot);
      },
    });

    handleGpuComplete(result);
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    handleGpuError(err as Error);
  }
}

/** Handle completed GPU simulation results. */
function handleGpuComplete(result: GpuSimResult): void {
  isComputing = false;
  gpuAbortController = null;
  document.getElementById('simProgressBar')!.style.width = '100%';
  document.getElementById('simProgressText')!.textContent = '';
  document.getElementById('simStatus')!.textContent = `${result.snapshots.length} snapshots (GPU)`;

  gridCheckpoints = result.gridCheckpoints;
  // Reload chart in batch mode for scrubber support
  chart.loadBatch(result.snapshots, result.events);
  scrubTo(0);
}

/** Handle GPU simulation error. */
function handleGpuError(err: Error): void {
  isComputing = false;
  gpuAbortController = null;
  document.getElementById('simProgressBar')!.style.width = '0%';
  document.getElementById('simProgressText')!.textContent = '';
  document.getElementById('simStatus')!.textContent = 'GPU Error';
  document.getElementById('status')!.textContent = `GPU error: ${err.message?.slice(0, 50) ?? 'unknown'}`;
  document.getElementById('status')!.style.color = '#d42';
  updatePlayButton();
}

/** Route simulation to the selected engine. */
function dispatchSim(): void {
  if (engineMode === 'gpu' && webGpuAvailable) {
    dispatchGpuSim();
  } else {
    dispatchBatchSim();
  }
}

/** Debounced recompute — waits for slider drag to finish */
function scheduleRecompute(): void {
  if (recomputeTimer) clearTimeout(recomputeTimer);
  recomputeTimer = setTimeout(dispatchSim, 400);
}

// --- Scrubber ---

/** Find the nearest checkpoint to a given time using binary search. */
function findNearestCheckpoint(timeHours: number): GridCheckpoint {
  let lo = 0;
  let hi = gridCheckpoints.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (gridCheckpoints[mid].timeHours < timeHours) lo = mid + 1;
    else hi = mid;
  }
  // lo is the first checkpoint >= timeHours; compare with predecessor
  if (lo > 0 && Math.abs(gridCheckpoints[lo - 1].timeHours - timeHours) < Math.abs(gridCheckpoints[lo].timeHours - timeHours)) {
    return gridCheckpoints[lo - 1];
  }
  return gridCheckpoints[lo];
}

/** Scrub to a specific sim time. Updates 3D scene + dashboard from nearest checkpoint. */
function scrubTo(timeHours: number): void {
  if (gridCheckpoints.length === 0) return;

  const nearest = findNearestCheckpoint(timeHours);

  // Restore grid state for 3D visualization
  grid.restoreState(nearest.state);
  currentScrubberHours = nearest.timeHours;

  // Update chart scrubber
  chart.setCurrentTime(nearest.timeHours);
  chart.draw();

  // Update 3D scene
  scene.updateFromGrid(grid, config, nearest.snapshot.fanOn, nearest.timeHours);

  // Update dashboard
  updateDashboard(nearest.snapshot);
}

// --- Playback animation ---

function startPlayback(): void {
  if (gridCheckpoints.length === 0) return;
  playing = true;
  updatePlayButton();

  let lastTimestamp = 0;
  const animate = (timestamp: number) => {
    if (!playing) return;
    if (lastTimestamp > 0) {
      const deltaSeconds = (timestamp - lastTimestamp) / 1000;
      const advanceHours = deltaSeconds * playbackSpeed;
      const nextHours = currentScrubberHours + advanceHours;

      const maxHours = gridCheckpoints[gridCheckpoints.length - 1].timeHours;
      if (nextHours >= maxHours) {
        scrubTo(maxHours);
        stopPlayback();
        return;
      }
      scrubTo(nextHours);
    }
    lastTimestamp = timestamp;
    playbackAnimId = requestAnimationFrame(animate);
  };
  playbackAnimId = requestAnimationFrame(animate);
}

function stopPlayback(): void {
  playing = false;
  cancelAnimationFrame(playbackAnimId);
  updatePlayButton();
}

function updatePlayButton(): void {
  const btn = document.getElementById('playBtn')!;
  btn.textContent = playing ? '\u23f8 Pause' : '\u25b6 Play';
  (btn as HTMLButtonElement).disabled = isComputing || gridCheckpoints.length === 0;
}

// --- Dashboard ---

function colorForTemp(tempF: number): string {
  if (tempF >= 160) return '#d42';     // overheating — red
  if (tempF >= 131) return '#6b6';     // thermophilic — green
  if (tempF >= 100) return '#fc0';     // mesophilic — yellow
  if (tempF >= 40) return '#6be';      // psychrophilic — blue
  return '#48c';                        // frozen — deep blue
}

function colorForOxygen(o2Fraction: number): string {
  if (o2Fraction < 0.05) return '#d42'; // anaerobic risk — red
  if (o2Fraction < 0.10) return '#fc0'; // low — yellow
  return '#6b6';                         // healthy — green
}

function colorForMoisture(moistFraction: number): string {
  if (moistFraction < 0.30) return '#d42'; // too dry — red
  if (moistFraction > 0.70) return '#d42'; // waterlogged — red
  if (moistFraction < 0.40 || moistFraction > 0.65) return '#fc0'; // marginal — yellow
  return '#6b6';                            // ideal 40-65% — green
}

function colorForBioActivity(activity: number): string {
  if (activity > 0.3) return '#6c4';  // active — green
  if (activity > 0.1) return '#fc0';  // low — yellow
  return '#888';                       // dormant — grey
}

function updateDashboard(snap: StepSnapshot | null): void {
  const dayEl = document.getElementById('simDay')!;
  const coreEl = document.getElementById('coreTemp')!;
  const surfEl = document.getElementById('surfTemp')!;
  const avgEl = document.getElementById('avgTemp')!;
  const heatEl = document.getElementById('heatGen')!;
  const o2El = document.getElementById('avgO2')!;
  const moistEl = document.getElementById('avgMoist')!;
  const statusEl = document.getElementById('status')!;
  const weekEl = document.getElementById('weekNum')!;
  const monthEl = document.getElementById('monthNum')!;
  if (!snap) {
    dayEl.textContent = '0';
    coreEl.textContent = '--';
    surfEl.textContent = '--';
    avgEl.textContent = '--';
    heatEl.textContent = '--';
    o2El.textContent = '--';
    moistEl.textContent = '--';
    document.getElementById('bioActivity')!.textContent = '--';
    statusEl.textContent = 'Ready';
    weekEl.textContent = '0';
    monthEl.textContent = '0';
    return;
  }

  const days = snap.timeHours / 24;
  dayEl.textContent = days.toFixed(1);
  coreEl.textContent = snap.coreTemp.toFixed(0) + '°F';
  coreEl.style.color = colorForTemp(snap.coreTemp);
  surfEl.textContent = snap.surfaceTemp.toFixed(0) + '°F';
  avgEl.textContent = snap.avgTemp.toFixed(0) + '°F';
  heatEl.textContent = snap.totalHeatGen.toFixed(0) + ' BTU/hr';
  o2El.textContent = (snap.avgOxygen * 100).toFixed(1) + '%';
  o2El.style.color = colorForOxygen(snap.avgOxygen);
  moistEl.textContent = (snap.avgMoisture * 100).toFixed(0) + '% FC';
  moistEl.style.color = colorForMoisture(snap.avgMoisture);
  const bioEl = document.getElementById('bioActivity')!;
  bioEl.textContent = (snap.avgBioActivity * 100).toFixed(0) + '%';
  bioEl.style.color = colorForBioActivity(snap.avgBioActivity);

  const weightEl = document.getElementById('pileWeight')!;
  const volEl = document.getElementById('pileVol')!;
  weightEl.textContent = snap.weightLbs.toFixed(0) + ' lbs';
  volEl.textContent = snap.volumeFt3.toFixed(1) + ' ft³';

  // Material cycle tracking
  const currentWeek = Math.floor(snap.timeHours / HOURS_PER_WEEK);
  const currentMonth = Math.floor(snap.timeHours / (HOURS_PER_WEEK * WEEKS_PER_MONTH));
  weekEl.textContent = currentWeek.toString();
  monthEl.textContent = currentMonth.toString();

  if (snap.coreTemp >= 160) {
    statusEl.textContent = 'OVERHEATING';
    statusEl.style.color = '#d42';
  } else if (snap.coreTemp >= 131) {
    statusEl.textContent = 'THERMOPHILIC';
    statusEl.style.color = '#6b6';
  } else if (snap.coreTemp >= 100) {
    statusEl.textContent = 'MESOPHILIC';
    statusEl.style.color = '#fc0';
  } else if (snap.coreTemp >= 40) {
    statusEl.textContent = 'PSYCHROPHILIC';
    statusEl.style.color = '#6be';
  } else {
    statusEl.textContent = 'FROZEN';
    statusEl.style.color = '#48c';
  }
}

// --- UI Bindings ---

function applyUIToConfig(): void {
  const ambient = parseFloat((document.getElementById('ambientSlider') as HTMLInputElement).value);
  const humidity = parseFloat((document.getElementById('humiditySlider') as HTMLInputElement).value) / 100;
  const gate = parseFloat((document.getElementById('gateSlider') as HTMLInputElement).value) / 100;
  const insulation = (document.getElementById('insulationSelect') as HTMLSelectElement).value as InsulationType;
  const fanOn = parseInt((document.getElementById('fanOnSlider') as HTMLInputElement).value);
  const fanOff = parseInt((document.getElementById('fanOffSlider') as HTMLInputElement).value);

  config.boundaries.ambientTemp = ambient;
  config.boundaries.ambientRH = humidity;
  config.boundaries.groundTemp = ambient < 32 ? 32 : 35 + (ambient - 35) * 0.3;
  const coverType = (document.getElementById('coverSelect') as HTMLSelectElement).value as CoverType;
  config.boundaries.coverType = coverType;
  config.boundaries.membraneRetention = COVER_PRESETS[coverType].retention;
  config.boundaries.sideInsulation = insulation;
  config.aeration.gateOpening = gate;
  config.aeration.onSeconds = fanOn;
  config.aeration.offSeconds = fanOff;
  config.aeration.holesPerRing = parseInt((document.getElementById('holesPerRingSlider') as HTMLInputElement).value);
  config.aeration.holeSpacing = parseInt((document.getElementById('holeSpacingSlider') as HTMLInputElement).value);
  config.aeration.holeDiameter = parseFloat((document.getElementById('holeDiameterSlider') as HTMLInputElement).value);
  config.pile.plenumHeight = config.aeration.pipeDiameter + 0.5;
}

function bindControls(): void {
  // Playback
  const playBtn = document.getElementById('playBtn')!;
  playBtn.addEventListener('click', () => {
    if (playing) stopPlayback();
    else startPlayback();
  });

  const speedSlider = document.getElementById('playbackSpeed') as HTMLInputElement;
  speedSlider.addEventListener('input', () => {
    playbackSpeed = parseInt(speedSlider.value);
    document.getElementById('playbackSpeedVal')!.textContent = playbackSpeed + 'x';
  });

  // Config sliders — all trigger recompute on mouseup
  const recomputeSliderIds = ['ambientSlider', 'humiditySlider', 'gateSlider',
    'fanOnSlider', 'fanOffSlider', 'holesPerRingSlider', 'holeSpacingSlider', 'holeDiameterSlider'];

  for (const id of recomputeSliderIds) {
    const el = document.getElementById(id) as HTMLInputElement;

    // Live value display on input
    el.addEventListener('input', () => {
      updateSliderDisplay(id);
      applyUIToConfig();
    });

    // Trigger recompute on mouseup (debounced)
    el.addEventListener('change', () => {
      // Manual fan slider interaction disconnects auto fan mode
      if (['fanOnSlider', 'fanOffSlider', 'gateSlider'].includes(id) && fanMode !== 'manual') {
        fanMode = 'manual';
        (document.getElementById('fanModeSelect') as HTMLSelectElement).value = 'manual';
        document.getElementById('fanConcern')!.textContent = '--';
        for (const fid of ['fanOnSlider', 'fanOffSlider', 'gateSlider']) {
          (document.getElementById(fid) as HTMLInputElement).disabled = false;
        }
      }

      // Manual slider interaction disconnects weather mode
      if ((id === 'ambientSlider' || id === 'humiditySlider') && weatherMode !== 'manual') {
        weatherMode = 'manual';
        weatherSchedule = null;
        (document.getElementById('weatherSource') as HTMLSelectElement).value = 'manual';
        document.getElementById('weatherStatus')!.textContent = 'Manual';
        document.getElementById('startDateRow')!.style.display = 'none';
      }

      applyUIToConfig();
      scheduleRecompute();
    });
  }

  // Dropdowns trigger immediate recompute
  for (const id of ['insulationSelect', 'coverSelect', 'durationSelect']) {
    document.getElementById(id)!.addEventListener('change', () => {
      applyUIToConfig();
      scheduleRecompute();
    });
  }

  // Fan mode selector
  const fanModeSelect = document.getElementById('fanModeSelect') as HTMLSelectElement;
  fanModeSelect.addEventListener('change', () => {
    fanMode = fanModeSelect.value as 'manual' | 'auto';
    const isAuto = fanMode === 'auto';
    for (const id of ['fanOnSlider', 'fanOffSlider', 'gateSlider']) {
      (document.getElementById(id) as HTMLInputElement).disabled = isAuto;
    }
    if (!isAuto) {
      document.getElementById('fanConcern')!.textContent = '--';
      document.getElementById('fanConcern')!.style.color = '#666';
    }
    scheduleRecompute();
  });

  // Weather source selector
  const weatherSelect = document.getElementById('weatherSource') as HTMLSelectElement;
  const startDateRow = document.getElementById('startDateRow')!;
  const startDateInput = document.getElementById('startDate') as HTMLInputElement;
  const weatherStatusEl = document.getElementById('weatherStatus')!;

  weatherSelect.addEventListener('change', () => loadWeatherSource());
  startDateInput.addEventListener('change', () => {
    if (weatherMode !== 'manual') loadWeatherSource();
  });

  async function loadWeatherSource(): Promise<void> {
    const source = weatherSelect.value;
    weatherMode = source;

    if (source === 'manual') {
      weatherSchedule = null;
      weatherStatusEl.textContent = 'Manual';
      startDateRow.style.display = 'none';
      chart.setStartDate(null);
      scheduleRecompute();
      return;
    }

    startDateRow.style.display = 'flex';
    const startDate = new Date(startDateInput.value + 'T00:00:00');
    const durationDays = parseInt((document.getElementById('durationSelect') as HTMLSelectElement).value);

    weatherStatusEl.textContent = 'Loading...';
    weatherStatusEl.style.color = '#fc0';

    try {
      if (source === 'average') {
        weatherSchedule = await fetchNormalsSchedule(startDate, durationDays);
      } else {
        const year = parseInt(source);
        const yearStart = new Date(year, startDate.getMonth(), startDate.getDate());
        weatherSchedule = await fetchSeasonSchedule(yearStart, durationDays);
        weatherSchedule.startDate = yearStart;
      }

      const dayCount = weatherSchedule.days.length;
      weatherStatusEl.textContent = `${dayCount} days loaded`;
      weatherStatusEl.style.color = '#6b6';
      chart.setStartDate(startDate);
      scheduleRecompute();
    } catch (err) {
      weatherStatusEl.textContent = `Error: ${(err as Error).message.slice(0, 30)}`;
      weatherStatusEl.style.color = '#d42';
      weatherSchedule = null;
      weatherMode = 'manual';
    }
  }

  // Engine selector
  const engineSelect = document.getElementById('engineSelect') as HTMLSelectElement;
  engineSelect.addEventListener('change', () => {
    engineMode = engineSelect.value as 'cpu' | 'gpu';
    const statusEl = document.getElementById('engineStatus')!;
    if (engineMode === 'gpu' && !webGpuAvailable) {
      statusEl.textContent = 'No WebGPU';
      statusEl.style.color = '#d42';
      engineMode = 'cpu';
      engineSelect.value = 'cpu';
      return;
    }
    statusEl.textContent = engineMode === 'gpu' ? 'GPU' : 'CPU';
    statusEl.style.color = engineMode === 'gpu' ? '#6b6' : '#666';
    scheduleRecompute();
  });

  // Field selector
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.field-btn')) {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.field-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      scene.field = btn.dataset.field as FieldType;
      updateLegend(btn.dataset.field as FieldType);
      scene.updateFromGrid(grid, config);
    });
  }

  // Cut plane controls
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.cut-btn')) {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cut-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      scene.cutAxis = btn.dataset.axis as CutAxis;
      scene.updateFromGrid(grid, config);
    });
  }

  document.getElementById('cutSlider')!.addEventListener('input', (e) => {
    scene.cutPosition = parseFloat((e.target as HTMLInputElement).value) / 100;
    document.getElementById('cutVal')!.textContent = Math.round(scene.cutPosition * 100) + '%';
    scene.updateFromGrid(grid, config);
  });

  // Optimizer — single ambient
  document.getElementById('optimizeBtn')!.addEventListener('click', async () => {
    const statusEl = document.getElementById('optimizerStatus')!;
    const resultsEl = document.getElementById('optimizerResults')!;
    const progressEl = document.getElementById('optimizerProgress')!;

    statusEl.textContent = 'Phase 1: Coarse grid search...';
    resultsEl.innerHTML = '';
    progressEl.style.width = '0%';

    const params = configToParams(config);
    const results = await runOptimizationAsync(config, params, 21, (p: OptimizationProgress) => {
      const phaseName = p.phase === 'coarse' ? 'Coarse grid' : 'Refining top 3';
      statusEl.textContent = `${phaseName}: ${p.candidatesTested}/${p.totalCandidates}`;
      progressEl.style.width = (p.candidatesTested / p.totalCandidates * 100).toFixed(0) + '%';
    });

    progressEl.style.width = '100%';
    statusEl.textContent = `Done — ${results.length} best configs. Click to apply.`;
    resultsEl.innerHTML = results.map((r, i) => formatResult(r, i)).join('');
    bindApplyButtons(resultsEl);
  });

  // Seasonal sweep
  document.getElementById('seasonalBtn')!.addEventListener('click', async () => {
    const statusEl = document.getElementById('optimizerStatus')!;
    const resultsEl = document.getElementById('optimizerResults')!;
    const progressEl = document.getElementById('optimizerProgress')!;

    statusEl.textContent = 'Running seasonal sweep across 6 ambient temps...';
    resultsEl.innerHTML = '';
    progressEl.style.width = '0%';

    const params = configToParams(config);
    const strategies = await runSeasonalSweep(config, params, (p: OptimizationProgress) => {
      statusEl.textContent = `${p.ambientTemp}°F: ${p.candidatesTested}/${p.totalCandidates}`;
      progressEl.style.width = (p.candidatesTested / p.totalCandidates * 100).toFixed(0) + '%';
    });

    progressEl.style.width = '100%';
    statusEl.textContent = 'ESP32 seasonal lookup table:';
    resultsEl.innerHTML = formatSeasonalTable(strategies);
  });
}

function updateSliderDisplay(id: string): void {
  const el = document.getElementById(id) as HTMLInputElement;
  switch (id) {
    case 'ambientSlider':
      document.getElementById('ambientVal')!.textContent = el.value + '°F'; break;
    case 'humiditySlider':
      document.getElementById('humidityVal')!.textContent = el.value + '%'; break;
    case 'gateSlider':
      document.getElementById('gateVal')!.textContent = el.value + '%'; break;
    case 'fanOnSlider':
      document.getElementById('fanOnVal')!.textContent = el.value + 's'; break;
    case 'fanOffSlider': {
      const sec = parseInt(el.value);
      document.getElementById('fanOffVal')!.textContent = sec >= 60 ? (sec / 60).toFixed(0) + 'm' : sec + 's';
      break;
    }
    case 'holesPerRingSlider':
      document.getElementById('holesPerRingVal')!.textContent = el.value; break;
    case 'holeSpacingSlider':
      document.getElementById('holeSpacingVal')!.textContent = el.value + '"'; break;
    case 'holeDiameterSlider':
      document.getElementById('holeDiameterVal')!.textContent = formatFraction(parseFloat(el.value)) + '"'; break;
  }
}

function bindApplyButtons(container: HTMLElement): void {
  for (const btn of container.querySelectorAll<HTMLButtonElement>('.apply-btn')) {
    btn.addEventListener('click', () => {
      const on = parseInt(btn.dataset.on!);
      const off = parseInt(btn.dataset.off!);
      const gate = parseFloat(btn.dataset.gate!);

      config.aeration.onSeconds = on;
      config.aeration.offSeconds = off;
      config.aeration.gateOpening = gate;

      (document.getElementById('fanOnSlider') as HTMLInputElement).value = on.toString();
      (document.getElementById('fanOffSlider') as HTMLInputElement).value = off.toString();
      (document.getElementById('gateSlider') as HTMLInputElement).value = (gate * 100).toString();
      document.getElementById('fanOnVal')!.textContent = on + 's';
      document.getElementById('fanOffVal')!.textContent = off >= 60 ? (off / 60).toFixed(0) + 'm' : off + 's';
      document.getElementById('gateVal')!.textContent = (gate * 100).toFixed(0) + '%';

      btn.textContent = 'Applied';
      btn.style.background = '#4a6a4e';

      scheduleRecompute();
    });
  }
}

function formatResult(r: OptimizationResult, rank: number): string {
  const on = r.params.fanOnSeconds;
  const off = r.params.fanOffSeconds;
  const offLabel = off >= 60 ? (off / 60).toFixed(0) + 'm' : off + 's';
  const gate = (r.params.gateOpening * 100).toFixed(0);
  const thermo = r.thermophilicHours.toFixed(0);
  const overheat = r.overheatHours.toFixed(0);
  const avg = r.avgCoreTemp.toFixed(0);
  const peak = r.peakCoreTemp.toFixed(0);
  const duty = (r.fanDutyCycle * 100).toFixed(1);
  const pathogen = r.pathogenKillDays;
  const isBest = rank === 0;

  return `<div style="margin:3px 0;padding:4px;background:${isBest?'#2a3a2a':'#222'};border-radius:3px;border-left:3px solid ${isBest?'#6b6':'#444'};">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <b style="color:${isBest?'#6b6':'#aaa'}">#${rank+1}</b>
      <button class="apply-btn btn" style="font-size:0.65rem;padding:1px 8px;"
        data-on="${on}" data-off="${off}" data-gate="${r.params.gateOpening}">Apply</button>
    </div>
    <div style="margin-top:2px;">
      Fan: <b>${on}s</b> on / <b>${offLabel}</b> off | Gate: <b>${gate}%</b> | Duty: ${duty}%
    </div>
    <div style="margin-top:1px;">
      <span style="color:#6b6">${thermo}h thermo</span> |
      ${overheat !== '0' ? `<span style="color:#d42">${overheat}h overheat</span> | ` : ''}
      Peak: ${peak}°F | Avg: ${avg}°F
    </div>
    <div style="margin-top:1px;">
      Pathogen kill: <span style="color:${pathogen>=3?'#6b6':'#fc0'}">${pathogen} consecutive days ${pathogen>=3?'(EPA met)':'(need 3)'}</span>
    </div>
    <div style="color:#555;margin-top:1px;">Score: ${r.score.toFixed(0)}</div>
  </div>`;
}

function formatSeasonalTable(strategies: SeasonalStrategy[]): string {
  let html = `<table style="width:100%;font-size:0.68rem;border-collapse:collapse;margin-top:4px;">
    <tr style="color:#888;border-bottom:1px solid #333;">
      <th style="text-align:left;padding:2px;">Ambient</th>
      <th>Fan On</th>
      <th>Fan Off</th>
      <th>Gate</th>
      <th>Core</th>
      <th style="color:#6b6">Kill</th>
    </tr>`;

  for (const s of strategies) {
    const b = s.best;
    const offLabel = b.params.fanOffSeconds >= 60
      ? (b.params.fanOffSeconds / 60).toFixed(0) + 'm'
      : b.params.fanOffSeconds + 's';
    const killColor = b.pathogenKillDays >= 3 ? '#6b6' : '#fc0';

    html += `<tr style="border-bottom:1px solid #2a2a3e;">
      <td style="padding:2px;"><b>${s.ambientTemp}°F</b></td>
      <td style="text-align:center;">${b.params.fanOnSeconds}s</td>
      <td style="text-align:center;">${offLabel}</td>
      <td style="text-align:center;">${(b.params.gateOpening*100).toFixed(0)}%</td>
      <td style="text-align:center;">${b.avgCoreTemp.toFixed(0)}°F</td>
      <td style="text-align:center;color:${killColor}">${b.pathogenKillDays}d</td>
    </tr>`;
  }

  html += '</table>';
  html += `<p style="font-size:0.62rem;color:#555;margin-top:6px;">
    Program these into the ESP32 as ambient-temperature breakpoints.
    Sensor reads ambient → lookup table selects fan timing + gate.
  </p>`;

  return html;
}

// --- Boot ---
/** Wire up collapsible panel headers and chart toggle. */
function bindCollapsePanels(): void {
  for (const panel of document.querySelectorAll('.panel')) {
    const header = panel.querySelector('h3');
    if (!header) continue;
    header.addEventListener('click', () => panel.classList.toggle('collapsed'));
  }

  const chartToggle = document.getElementById('chartToggle')!;
  const app = document.querySelector('.app')!;
  chartToggle.addEventListener('click', () => {
    chartToggle.classList.toggle('collapsed');
    app.classList.toggle('chart-collapsed');
    // Trigger chart resize after layout change
    window.dispatchEvent(new Event('resize'));
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const sceneContainer = document.getElementById('scene-container')!;
  const chartContainer = document.getElementById('chart-container')!;

  scene = new PileScene(sceneContainer);
  chart = new TimelineChart(chartContainer);

  // Initialize grid for 3D display (empty pile)
  grid = new CompostGrid(config);
  initializeGrid(grid, config);

  // Chart seek: click/drag on the chart to scrub through time
  chart.onSeek = (seekTimeHours: number) => {
    if (playing) stopPlayback();
    scrubTo(seekTimeHours);
  };

  bindControls();
  bindCollapsePanels();
  applyUIToConfig();
  updateDashboard(null);
  scene.updateFromGrid(grid, config, false, 0);

  // Detect WebGPU, then auto-compute on boot
  detectWebGpu().then(available => {
    webGpuAvailable = available;
    if (available) {
      engineMode = 'gpu';
      (document.getElementById('engineSelect') as HTMLSelectElement).value = 'gpu';
    }
    dispatchSim();
  });
});
