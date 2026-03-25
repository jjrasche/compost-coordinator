/**
 * Compost Thermal Simulator — main entry point.
 * Runs the FDM solver and updates the Three.js visualization.
 */

import { CompostGrid, initializeGrid, MATERIAL_FROM_CODE, type GridStateSnapshot } from './core/types/CompostGrid';
import { createDefaultConfig, type SimulationConfig } from './core/types/SimulationConfig';
import { tickStep, addFreshMaterial, clearStageForTransfer, type StepSnapshot } from './core/engine/tickStep';
import { PileScene, type FieldType, type CutAxis } from './viz/PileScene';
import { TimelineChart } from './viz/TimelineChart';
import {
  runOptimizationAsync, runSeasonalSweep, configToParams,
  type OptimizationResult, type OptimizationProgress, type SeasonalStrategy,
} from './core/engine/optimizer';

function formatFraction(inches: number): string {
  const sixteenths = Math.round(inches * 16);
  if (sixteenths % 16 === 0) return (sixteenths / 16).toString();
  if (sixteenths % 8 === 0) return `${sixteenths / 8}/2`;
  if (sixteenths % 4 === 0) return `${sixteenths / 4}/4`;
  if (sixteenths % 2 === 0) return `${sixteenths / 2}/8`;
  return `${sixteenths}/16`;
}

// --- State ---
let config = createDefaultConfig();
let grid = new CompostGrid(config);
let scene: PileScene;
let chart: TimelineChart;
let simTimeHours = 0;
let running = false;
let stepsPerFrame = 2;  // how many sim steps per animation frame
let latestSnapshot: StepSnapshot | null = null;
let lastWeekAddition = -1;   // track which week last had material added
let lastMonthTransfer = -1;  // track which month last had transfer
let chartDrawCounter = 0;    // throttle chart redraws

// Grid state history for scrubber replay (snapshot every ~2 sim hours)
interface HistoryEntry { timeHours: number; state: GridStateSnapshot; snap: StepSnapshot; }
let history: HistoryEntry[] = [];
let scrubbing = false;  // true when user is dragging the scrubber

// --- Init ---
function initSimulation(): void {
  config = createDefaultConfig();
  applyUIToConfig();
  grid = new CompostGrid(config);
  initializeGrid(grid, config);

  const plenumCellsY = Math.ceil(config.pile.plenumHeight / config.resolution);

  // Start from empty — clear compost above the plenum zone only.
  // Plenum edge seal (compost curling under at y < plenumCellsY) must stay intact.
  for (let i = 0; i < grid.totalCells; i++) {
    if (MATERIAL_FROM_CODE[grid.material[i]] !== 'compost') continue;
    const { y } = grid.coords(i);
    if (y < plenumCellsY) continue; // preserve plenum edge seal
    grid.material[i] = 1; // air
    grid.temp[i] = config.boundaries.ambientTemp;
    grid.moisture[i] = 0;
    grid.oxygen[i] = 0.21;
    grid.materialAge[i] = 0;
  }

  simTimeHours = 0;
  lastWeekAddition = -1;  // first addition at week 0 when sim starts
  lastMonthTransfer = -1;
  chartDrawCounter = 0;
  history = [];
  chart.reset();
  scene.updateFromGrid(grid, config, false, 0);
  updateDashboard(null);
}

function applyUIToConfig(): void {
  const ambient = parseFloat((document.getElementById('ambientSlider') as HTMLInputElement).value);
  const gate = parseFloat((document.getElementById('gateSlider') as HTMLInputElement).value) / 100;
  const straw = (document.getElementById('strawCheck') as HTMLInputElement).checked;
  const speed = parseInt((document.getElementById('speedSlider') as HTMLInputElement).value);
  const fanOn = parseInt((document.getElementById('fanOnSlider') as HTMLInputElement).value);
  const fanOff = parseInt((document.getElementById('fanOffSlider') as HTMLInputElement).value);

  config.boundaries.ambientTemp = ambient;
  config.boundaries.groundTemp = ambient < 32 ? 32 : 35 + (ambient - 35) * 0.3;
  config.boundaries.hasStraw = straw;
  config.aeration.gateOpening = gate;
  config.aeration.onSeconds = fanOn;
  config.aeration.offSeconds = fanOff;
  config.aeration.holesPerRing = parseInt((document.getElementById('holesPerRingSlider') as HTMLInputElement).value);
  config.aeration.holeSpacing = parseInt((document.getElementById('holeSpacingSlider') as HTMLInputElement).value);
  config.aeration.holeDiameter = parseFloat((document.getElementById('holeDiameterSlider') as HTMLInputElement).value);
  // Plenum height derived from pipe diameter — bricks must be taller than pipe
  config.pile.plenumHeight = config.aeration.pipeDiameter + 0.5;
  stepsPerFrame = speed;
}

// --- Simulation Loop ---
function simLoop(): void {
  if (!running) return;

  for (let i = 0; i < stepsPerFrame; i++) {
    latestSnapshot = tickStep(grid, config, simTimeHours);
    simTimeHours += config.time.heatTimestep;

    const currentWeek = Math.floor(simTimeHours / 168);
    const currentMonth = Math.floor(simTimeHours / (168 * 4));

    // Monthly transfer FIRST (clear the stage, every 4 weeks)
    if (currentMonth > lastMonthTransfer && currentMonth > 0) {
      clearStageForTransfer(grid, config);
      lastMonthTransfer = currentMonth;
      chart.recordEvent({ timeHours: simTimeHours, type: 'transfer' });
    }

    // Weekly material addition (128 gal ≈ 6" layer of greens+browns)
    if (currentWeek > lastWeekAddition) {
      addFreshMaterial(grid, config, 128);
      lastWeekAddition = currentWeek;
      chart.recordEvent({ timeHours: simTimeHours, type: 'addition', volumeGallons: 128 });
    }

    // Record snapshot to chart (every 4th step to keep data manageable)
    if (latestSnapshot && chartDrawCounter % 4 === 0) {
      chart.recordSnapshot(latestSnapshot);
    }

    // Save grid state for scrubber replay (~every 2 sim hours = every 5 steps)
    if (latestSnapshot && chartDrawCounter % 5 === 0) {
      // Cap history to avoid unbounded memory (~500 entries = ~1000 sim hours)
      if (history.length > 500) history.splice(0, 50);
      history.push({ timeHours: simTimeHours, state: grid.saveState(), snap: latestSnapshot });
    }
    chartDrawCounter++;
  }

  scene.updateFromGrid(grid, config, latestSnapshot!.fanOn, simTimeHours);
  updateDashboard(latestSnapshot);

  // Redraw chart every 3 frames (throttle for performance)
  if (chartDrawCounter % 3 === 0) chart.draw();

  requestAnimationFrame(simLoop);
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
  const lastAddEl = document.getElementById('lastAdd')!;
  const lastTransEl = document.getElementById('lastTransfer')!;

  if (!snap) {
    dayEl.textContent = '0';
    coreEl.textContent = '--';
    surfEl.textContent = '--';
    avgEl.textContent = '--';
    heatEl.textContent = '--';
    o2El.textContent = '--';
    moistEl.textContent = '--';
    statusEl.textContent = 'Ready';
    weekEl.textContent = '0';
    monthEl.textContent = '0';
    lastAddEl.textContent = '--';
    lastTransEl.textContent = '--';
    return;
  }

  const days = snap.timeHours / 24;
  dayEl.textContent = days.toFixed(1);
  coreEl.textContent = snap.coreTemp.toFixed(0) + '°F';
  surfEl.textContent = snap.surfaceTemp.toFixed(0) + '°F';
  avgEl.textContent = snap.avgTemp.toFixed(0) + '°F';
  heatEl.textContent = snap.totalHeatGen.toFixed(0) + ' BTU/hr';
  o2El.textContent = (snap.avgOxygen * 100).toFixed(1) + '%';
  moistEl.textContent = (snap.avgMoisture * 100).toFixed(0) + '% FC';

  const weightEl = document.getElementById('pileWeight')!;
  const volEl = document.getElementById('pileVol')!;
  weightEl.textContent = snap.weightLbs.toFixed(0) + ' lbs';
  volEl.textContent = snap.volumeFt3.toFixed(1) + ' ft³';

  // Material cycle tracking
  const currentWeek = Math.floor(snap.timeHours / 168);
  const currentMonth = Math.floor(snap.timeHours / (168 * 4));
  weekEl.textContent = currentWeek.toString();
  monthEl.textContent = currentMonth.toString();
  lastAddEl.textContent = lastWeekAddition >= 0 ? `Day ${(lastWeekAddition * 7).toFixed(0)}` : '--';
  lastTransEl.textContent = lastMonthTransfer >= 0 ? `Day ${(lastMonthTransfer * 28).toFixed(0)}` : '--';

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
function bindControls(): void {
  const playBtn = document.getElementById('playBtn')!;
  const resetBtn = document.getElementById('resetBtn')!;

  playBtn.addEventListener('click', () => {
    running = !running;
    playBtn.textContent = running ? 'Pause' : 'Play';
    if (running) requestAnimationFrame(simLoop);
  });

  resetBtn.addEventListener('click', () => {
    running = false;
    playBtn.textContent = 'Play';
    initSimulation();
  });

  // Sliders
  const sliderIds = ['ambientSlider', 'gateSlider', 'speedSlider', 'fanOnSlider', 'fanOffSlider',
    'holesPerRingSlider', 'holeSpacingSlider', 'holeDiameterSlider'];
  for (const id of sliderIds) {
    document.getElementById(id)!.addEventListener('input', () => {
      applyUIToConfig();
      // Update value displays
      document.getElementById('ambientVal')!.textContent =
        (document.getElementById('ambientSlider') as HTMLInputElement).value + '°F';
      document.getElementById('gateVal')!.textContent =
        (document.getElementById('gateSlider') as HTMLInputElement).value + '%';
      document.getElementById('speedVal')!.textContent =
        (document.getElementById('speedSlider') as HTMLInputElement).value + 'x';
      document.getElementById('fanOnVal')!.textContent =
        (document.getElementById('fanOnSlider') as HTMLInputElement).value + 's';
      const offSec = parseInt((document.getElementById('fanOffSlider') as HTMLInputElement).value);
      document.getElementById('fanOffVal')!.textContent =
        offSec >= 60 ? (offSec / 60).toFixed(0) + 'm' : offSec + 's';
      document.getElementById('holesPerRingVal')!.textContent =
        (document.getElementById('holesPerRingSlider') as HTMLInputElement).value;
      document.getElementById('holeSpacingVal')!.textContent =
        (document.getElementById('holeSpacingSlider') as HTMLInputElement).value + '"';
      const holeDiam = parseFloat((document.getElementById('holeDiameterSlider') as HTMLInputElement).value);
      document.getElementById('holeDiameterVal')!.textContent = formatFraction(holeDiam) + '"';
      scene.updateFromGrid(grid, config, latestSnapshot?.fanOn ?? false, simTimeHours);
    });
  }

  document.getElementById('strawCheck')!.addEventListener('change', applyUIToConfig);

  // Field selector
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.field-btn')) {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.field-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      scene.field = btn.dataset.field as FieldType;
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

function bindApplyButtons(container: HTMLElement): void {
  for (const btn of container.querySelectorAll<HTMLButtonElement>('.apply-btn')) {
    btn.addEventListener('click', () => {
      const on = parseInt(btn.dataset.on!);
      const off = parseInt(btn.dataset.off!);
      const gate = parseFloat(btn.dataset.gate!);

      config.aeration.onSeconds = on;
      config.aeration.offSeconds = off;
      config.aeration.gateOpening = gate;

      // Update sliders to match
      (document.getElementById('fanOnSlider') as HTMLInputElement).value = on.toString();
      (document.getElementById('fanOffSlider') as HTMLInputElement).value = off.toString();
      (document.getElementById('gateSlider') as HTMLInputElement).value = (gate * 100).toString();
      document.getElementById('fanOnVal')!.textContent = on + 's';
      document.getElementById('fanOffVal')!.textContent = off >= 60 ? (off / 60).toFixed(0) + 'm' : off + 's';
      document.getElementById('gateVal')!.textContent = (gate * 100).toFixed(0) + '%';

      btn.textContent = 'Applied';
      btn.style.background = '#4a6a4e';
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
document.addEventListener('DOMContentLoaded', () => {
  const sceneContainer = document.getElementById('scene-container')!;
  const chartContainer = document.getElementById('chart-container')!;

  scene = new PileScene(sceneContainer);
  chart = new TimelineChart(chartContainer);

  // Chart expander toggle
  const chartPanel = document.getElementById('chartPanel')!;
  const chartExpander = document.getElementById('chartExpander')!;
  chartExpander.addEventListener('click', () => {
    chartPanel.classList.toggle('open');
    chartExpander.classList.toggle('open');
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  });

  // Chart seek: click/drag on the chart to scrub through time
  chart.onSeek = (seekTimeHours: number) => {
    // Pause the simulation while scrubbing
    if (running) {
      running = false;
      document.getElementById('playBtn')!.textContent = 'Play';
    }

    // Find the nearest history entry
    if (history.length === 0) return;
    let nearest = history[0];
    let nearestDist = Math.abs(nearest.timeHours - seekTimeHours);
    for (const entry of history) {
      const dist = Math.abs(entry.timeHours - seekTimeHours);
      if (dist < nearestDist) { nearest = entry; nearestDist = dist; }
    }

    // Restore grid state and update visualization
    grid.restoreState(nearest.state);
    simTimeHours = nearest.timeHours;
    chart.setCurrentTime(nearest.timeHours);
    chart.draw();
    scene.updateFromGrid(grid, config, nearest.snap.fanOn, nearest.timeHours);
    updateDashboard(nearest.snap);
  };

  bindControls();
  initSimulation();
});
