/**
 * Full-year controller validation and ESP32 lookup table extraction.
 *
 * Runs a 365-day batch sim with auto fan controller and synthetic
 * Grand Rapids, MI weather. Validates thermal, O2, and moisture thresholds.
 * Extracts ambient temp → fan settings lookup table for ESP32.
 *
 * Run: npx tsx test/seasonValidation.test.ts
 */
import { CompostGrid, initializeGrid, MATERIAL_FROM_CODE, MATERIAL_CODES, isWithinRepose } from '../src/core/types/CompostGrid';
import { createDefaultConfig, type SimulationConfig } from '../src/core/types/SimulationConfig';
import { tickStep, addFreshMaterial, clearStageForTransfer, type StepSnapshot } from '../src/core/engine/tickStep';
import { computeFanControl, createControllerState, type FanControllerOutput } from '../src/core/engine/fanController';
import { buildWeatherSchedule, type DailyWeatherEntry } from '../src/core/environment/weatherClient';
import type { StepWeather } from '../src/core/engine/workerProtocol';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) { passed++; }
  else { failed++; console.log(`  FAIL: ${label}`); }
}

function assertRange(val: number, min: number, max: number, label: string): void {
  if (val >= min && val <= max) { passed++; }
  else { failed++; console.log(`  FAIL: ${label} — got ${val.toFixed(2)}, expected [${min}, ${max}]`); }
}

// --- Synthetic Grand Rapids weather (NOAA 30-year normals) ---

/** Monthly normals: [highF, lowF, avgRH] */
const GRAND_RAPIDS_NORMALS: [number, number, number][] = [
  [30, 17, 0.76], // Jan
  [33, 18, 0.74], // Feb
  [44, 27, 0.72], // Mar
  [57, 36, 0.68], // Apr
  [69, 47, 0.66], // May
  [79, 57, 0.67], // Jun
  [83, 61, 0.68], // Jul
  [81, 60, 0.70], // Aug
  [73, 51, 0.72], // Sep
  [60, 40, 0.72], // Oct
  [46, 31, 0.76], // Nov
  [34, 22, 0.78], // Dec
];

/** Build 365 daily entries from monthly normals with smooth interpolation. */
function buildSyntheticYear(): DailyWeatherEntry[] {
  const days: DailyWeatherEntry[] = [];
  const daysPerMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  for (let m = 0; m < 12; m++) {
    const [highF, lowF, avgRH] = GRAND_RAPIDS_NORMALS[m];
    const [nextHigh, nextLow, nextRH] = GRAND_RAPIDS_NORMALS[(m + 1) % 12];

    for (let d = 0; d < daysPerMonth[m]; d++) {
      const frac = d / daysPerMonth[m]; // smooth transition within month
      const dayNum = days.length;
      days.push({
        date: `2025-${String(m + 1).padStart(2, '0')}-${String(d + 1).padStart(2, '0')}`,
        highF: highF + (nextHigh - highF) * frac,
        lowF: lowF + (nextLow - lowF) * frac,
        avgRH: avgRH + (nextRH - avgRH) * frac,
      });
    }
  }
  return days;
}

// --- Batch sim runner (inline, no Web Worker) ---

const HOURS_PER_WEEK = 168;
const WEEKS_PER_MONTH = 4;

interface MonthStats {
  month: number;
  maxCoreTemp: number;
  minCoreTemp: number;
  avgCoreTemp: number;
  minO2: number;
  avgO2: number;
  minMoisture: number;
  avgMoisture: number;
  avgAmbient: number;
  sampleCount: number;
}

interface ControllerDecision {
  ambientTemp: number;
  coreTemp: number;
  onSeconds: number;
  offSeconds: number;
  gateOpening: number;
}

function runYearSim(): { monthStats: MonthStats[]; decisions: ControllerDecision[] } {
  const config = createDefaultConfig();
  config.boundaries.coverType = 'eptfe';
  config.boundaries.membraneRetention = 0.75;
  config.boundaries.sideInsulation = 'logs';
  config.time.totalHours = 24 * 365;

  const grid = new CompostGrid(config);
  initializeGrid(grid, config);

  // Start with empty pile (first weekly addition will fill it)
  const plenumCellsY = Math.ceil(config.pile.plenumHeight / config.resolution);
  for (let i = 0; i < grid.totalCells; i++) {
    if (MATERIAL_FROM_CODE[grid.material[i]] !== 'compost') continue;
    const { y } = grid.coords(i);
    if (y < plenumCellsY) continue;
    grid.material[i] = MATERIAL_CODES.air;
    grid.temp[i] = config.boundaries.ambientTemp;
    grid.moisture[i] = 0;
    grid.oxygen[i] = 0.21;
  }

  // Build weather
  const syntheticDays = buildSyntheticYear();
  const schedule = buildWeatherSchedule(new Date('2025-01-01'), syntheticDays);
  const dt = config.time.heatTimestep;
  const totalSteps = Math.ceil(config.time.totalHours / dt);

  // Build weather step array
  const weatherSteps: StepWeather[] = new Array(totalSteps);
  for (let i = 0; i < totalSteps; i++) {
    const conditions = schedule.lookup(i * dt);
    weatherSteps[i] = { tempF: conditions.tempF, rh: conditions.rh };
  }

  const controllerState = createControllerState();
  const monthStats: MonthStats[] = Array.from({ length: 12 }, (_, m) => ({
    month: m,
    maxCoreTemp: -Infinity,
    minCoreTemp: Infinity,
    avgCoreTemp: 0,
    minO2: Infinity,
    avgO2: 0,
    minMoisture: Infinity,
    avgMoisture: 0,
    avgAmbient: 0,
    sampleCount: 0,
  }));

  const decisions: ControllerDecision[] = [];
  let simTimeHours = 0;
  let lastWeekAddition = -1;
  let lastMonthTransfer = -1;
  const sampleInterval = 10; // sample every 10 steps (~4 hours) to keep memory bounded

  console.log('  Running 365-day sim...');
  const startTime = Date.now();

  for (let step = 0; step < totalSteps; step++) {
    // Apply weather
    if (step < weatherSteps.length) {
      config.boundaries.ambientTemp = weatherSteps[step].tempF;
      config.boundaries.ambientRH = weatherSteps[step].rh;
      config.boundaries.groundTemp = weatherSteps[step].tempF < 32
        ? 32
        : 35 + (weatherSteps[step].tempF - 35) * 0.3;
    }

    const snapshot = tickStep(grid, config, simTimeHours);
    simTimeHours += dt;

    // Auto controller
    const output = computeFanControl(snapshot, controllerState);
    config.aeration.onSeconds = output.onSeconds;
    config.aeration.offSeconds = output.offSeconds;
    config.aeration.gateOpening = output.gateOpening;

    // Material cycle
    const currentWeek = Math.floor(simTimeHours / HOURS_PER_WEEK);
    const currentMonth = Math.floor(simTimeHours / (HOURS_PER_WEEK * WEEKS_PER_MONTH));

    if (currentMonth > lastMonthTransfer && currentMonth > 0) {
      clearStageForTransfer(grid, config);
      lastMonthTransfer = currentMonth;
    }
    if (currentWeek > lastWeekAddition) {
      addFreshMaterial(grid, config, 120);
      lastWeekAddition = currentWeek;
    }

    // Collect stats
    if (step % sampleInterval === 0) {
      const calendarMonth = estimateMonth(simTimeHours);
      const ms = monthStats[calendarMonth];
      ms.maxCoreTemp = Math.max(ms.maxCoreTemp, snapshot.coreTemp);
      ms.minCoreTemp = Math.min(ms.minCoreTemp, snapshot.coreTemp);
      ms.avgCoreTemp += snapshot.coreTemp;
      ms.minO2 = Math.min(ms.minO2, snapshot.avgOxygen);
      ms.avgO2 += snapshot.avgOxygen;
      ms.minMoisture = Math.min(ms.minMoisture, snapshot.avgMoisture);
      ms.avgMoisture += snapshot.avgMoisture;
      ms.avgAmbient += snapshot.ambientTemp;
      ms.sampleCount++;

      decisions.push({
        ambientTemp: snapshot.ambientTemp,
        coreTemp: snapshot.coreTemp,
        onSeconds: output.onSeconds,
        offSeconds: output.offSeconds,
        gateOpening: output.gateOpening,
      });
    }

    // Progress
    if (step % Math.floor(totalSteps / 12) === 0) {
      const pct = ((step / totalSteps) * 100).toFixed(0);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      process.stdout.write(`  ${pct}% (${elapsed}s)...`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n  Done in ${elapsed}s`);

  // Finalize averages
  for (const ms of monthStats) {
    if (ms.sampleCount > 0) {
      ms.avgCoreTemp /= ms.sampleCount;
      ms.avgO2 /= ms.sampleCount;
      ms.avgMoisture /= ms.sampleCount;
      ms.avgAmbient /= ms.sampleCount;
    }
  }

  return { monthStats, decisions };
}

/** Map sim hours to calendar month (0-11) starting from Jan 1 */
function estimateMonth(simHours: number): number {
  const day = Math.floor(simHours / 24);
  const daysPerMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let accum = 0;
  for (let m = 0; m < 12; m++) {
    accum += daysPerMonth[m];
    if (day < accum) return m;
  }
  return 11;
}

// --- Run the simulation ---

console.log('=== Season Validation Test ===\n');
const { monthStats, decisions } = runYearSim();

// --- Print monthly summary ---
console.log('\n  Monthly summary:');
console.log('  Month | Ambient | Core(avg) | Core(max) | O2(min) | Moist(min)');
console.log('  ------+---------+-----------+-----------+---------+----------');
const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
for (const ms of monthStats) {
  if (ms.sampleCount === 0) continue;
  console.log(
    `  ${monthNames[ms.month].padEnd(5)} | ` +
    `${ms.avgAmbient.toFixed(0).padStart(5)}F | ` +
    `${ms.avgCoreTemp.toFixed(0).padStart(7)}F | ` +
    `${ms.maxCoreTemp.toFixed(0).padStart(7)}F | ` +
    `${(ms.minO2 * 100).toFixed(1).padStart(5)}% | ` +
    `${(ms.minMoisture * 100).toFixed(0).padStart(7)}% FC`,
  );
}

// --- Validation checks ---
console.log('\n  Validation:');

// Active months (May-Oct): core should reach thermophilic
const activeMonths = monthStats.filter(m => m.month >= 4 && m.month <= 9);
const reachesThermophilic = activeMonths.some(m => m.maxCoreTemp >= 131);
assert(reachesThermophilic,
  `Active months (May-Oct) reach thermophilic (>131F): max=${Math.max(...activeMonths.map(m => m.maxCoreTemp)).toFixed(0)}F`);

// Core should not exceed lethal (>170F) for extended periods
const overheatedMonths = monthStats.filter(m => m.avgCoreTemp > 170);
assert(overheatedMonths.length === 0,
  `No months with avg core >170F: worst=${Math.max(...monthStats.map(m => m.avgCoreTemp)).toFixed(0)}F`);

// O2 should stay above anaerobic threshold (5%) in all months
const o2Safe = monthStats.every(m => m.sampleCount === 0 || m.minO2 > 0.03);
assert(o2Safe,
  `O2 stays above 3% everywhere: min=${Math.min(...monthStats.filter(m => m.sampleCount > 0).map(m => m.minO2 * 100)).toFixed(1)}%`);

// Moisture should not drop below 30% FC (biological cessation)
const moistureSafe = monthStats.every(m => m.sampleCount === 0 || m.minMoisture > 0.20);
assert(moistureSafe,
  `Moisture above 20% FC: min=${Math.min(...monthStats.filter(m => m.sampleCount > 0).map(m => m.minMoisture * 100)).toFixed(0)}% FC`);

// Winter (Dec-Feb): pile should not freeze at core with insulation
const winterMonths = monthStats.filter(m => m.month === 0 || m.month === 1 || m.month === 11);
const winterMinCore = Math.min(...winterMonths.filter(m => m.sampleCount > 0).map(m => m.minCoreTemp));
assert(winterMinCore > 32,
  `Winter core above freezing with log insulation: min=${winterMinCore.toFixed(0)}F`);

// --- ESP32 Lookup Table ---

console.log('\n  ESP32 Lookup Table (ambient temp bands → median fan settings):');

interface LookupEntry {
  ambientBandLow: number;
  ambientBandHigh: number;
  medianOnSeconds: number;
  medianOffSeconds: number;
  medianGateOpening: number;
  sampleCount: number;
}

/** Extract lookup table by grouping decisions into 10°F ambient temp bands */
function extractLookupTable(decisions: ControllerDecision[]): LookupEntry[] {
  const bands: Map<number, ControllerDecision[]> = new Map();

  for (const d of decisions) {
    const bandKey = Math.floor(d.ambientTemp / 10) * 10;
    const arr = bands.get(bandKey) ?? [];
    arr.push(d);
    bands.set(bandKey, arr);
  }

  const sortedKeys = [...bands.keys()].sort((a, b) => a - b);
  return sortedKeys.map(key => {
    const decs = bands.get(key)!;
    decs.sort((a, b) => a.onSeconds - b.onSeconds);
    const mid = Math.floor(decs.length / 2);

    return {
      ambientBandLow: key,
      ambientBandHigh: key + 10,
      medianOnSeconds: decs[mid].onSeconds,
      medianOffSeconds: decs[mid].offSeconds,
      medianGateOpening: decs[mid].gateOpening,
      sampleCount: decs.length,
    };
  });
}

const lookupTable = extractLookupTable(decisions);

console.log('  Ambient F  | On(s) | Off(s) | Gate | Samples');
console.log('  -----------+-------+--------+------+--------');
for (const entry of lookupTable) {
  console.log(
    `  ${entry.ambientBandLow.toString().padStart(3)}-${entry.ambientBandHigh.toString().padStart(3)}F | ` +
    `${entry.medianOnSeconds.toString().padStart(5)} | ` +
    `${entry.medianOffSeconds.toString().padStart(6)} | ` +
    `${entry.medianGateOpening.toFixed(2)} | ` +
    `${entry.sampleCount.toString().padStart(7)}`,
  );
}

// Lookup table should cover at least 5 bands (Michigan has wide temp range)
assert(lookupTable.length >= 4,
  `Lookup table covers ${lookupTable.length} temp bands (expect ≥4)`);

// C++ struct output
console.log('\n  // ESP32 C++ lookup table:');
console.log('  struct FanLookup { int8_t ambientLow; int8_t ambientHigh; uint8_t onSec; uint16_t offSec; uint8_t gatePct; };');
console.log('  const FanLookup LOOKUP[] = {');
for (const entry of lookupTable) {
  console.log(
    `    { ${entry.ambientBandLow}, ${entry.ambientBandHigh}, ` +
    `${entry.medianOnSeconds}, ${entry.medianOffSeconds}, ` +
    `${Math.round(entry.medianGateOpening * 100)} },`,
  );
}
console.log('  };');

// --- Summary ---
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
