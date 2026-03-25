/**
 * Parameter optimizer for compost thermal performance.
 *
 * Two-phase search:
 *   Phase 1 (coarse): Grid search across fan timing × gate opening at 4" resolution
 *   Phase 2 (refine): Neighborhood search around top 3 from phase 1 at 2" resolution
 *
 * Multi-ambient sweep: Runs at multiple ambient temps to produce a seasonal
 * control strategy (lookup table for the ESP32).
 *
 * Runs async via setTimeout chunking to keep UI responsive.
 */

import { CompostGrid, initializeGrid } from '../types/CompostGrid';
import type { SimulationConfig } from '../types/SimulationConfig';
import { tickStep, addFreshMaterial, type StepSnapshot } from './tickStep';

// ── Types ────────────────────────────────────────────────────────

export interface OptimizableParams {
  fanOnSeconds: number;
  fanOffSeconds: number;
  gateOpening: number;
  additionMoisture: number;
  additionVolGal: number;
}

export interface OptimizationResult {
  params: OptimizableParams;
  score: number;
  thermophilicHours: number;
  overheatHours: number;
  avgCoreTemp: number;
  peakCoreTemp: number;
  fanDutyCycle: number;
  pathogenKillDays: number;
}

export interface SeasonalStrategy {
  ambientTemp: number;
  best: OptimizationResult;
}

export interface OptimizationProgress {
  phase: 'coarse' | 'refine' | 'seasonal';
  candidatesTested: number;
  totalCandidates: number;
  ambientTemp?: number;
  bestSoFar: OptimizationResult | null;
}

// ── Fitness Scoring ──────────────────────────────────────────────

function scoreFitness(snapshots: StepSnapshot[], params: OptimizableParams): OptimizationResult {
  let thermophilicHours = 0;
  let overheatHours = 0;
  let totalCoreTemp = 0;
  let peakCoreTemp = -Infinity;
  let consecutiveThermoDays = 0;
  let maxConsecutiveThermoDays = 0;
  let lastThermoDay = -1;

  const dt = snapshots.length > 1
    ? snapshots[1].timeHours - snapshots[0].timeHours
    : 2;

  for (const snap of snapshots) {
    totalCoreTemp += snap.coreTemp;
    if (snap.coreTemp > peakCoreTemp) peakCoreTemp = snap.coreTemp;

    if (snap.coreTemp >= 131 && snap.coreTemp <= 160) {
      thermophilicHours += dt;

      // Track consecutive days at thermophilic for pathogen kill
      const day = Math.floor(snap.timeHours / 24);
      if (day === lastThermoDay + 1 || day === lastThermoDay) {
        if (day !== lastThermoDay) consecutiveThermoDays++;
      } else {
        consecutiveThermoDays = 1;
      }
      lastThermoDay = day;
      maxConsecutiveThermoDays = Math.max(maxConsecutiveThermoDays, consecutiveThermoDays);
    }

    if (snap.coreTemp > 160) overheatHours += dt;
  }

  const dutyCycle = params.fanOnSeconds / (params.fanOnSeconds + params.fanOffSeconds);
  const avgCore = totalCoreTemp / snapshots.length;
  const totalDays = (snapshots[snapshots.length - 1]?.timeHours ?? 0) / 24;

  // Fitness weights tuned for Jim's priorities:
  // 1. Pathogen kill: EPA requires 3 consecutive days at 131F+ for ASP.
  //    Massive bonus for hitting this threshold.
  const pathogenBonus = maxConsecutiveThermoDays >= 3 ? 500 : maxConsecutiveThermoDays * 100;

  // 2. Thermophilic time: more is better, but diminishing returns past 70% of total
  const thermoFraction = thermophilicHours / (totalDays * 24);
  const thermoScore = thermoFraction < 0.7
    ? thermoFraction * 1000
    : 700 + (thermoFraction - 0.7) * 300;

  // 3. Overheating penalty: kills biology, wastes the process
  const overheatPenalty = overheatHours * 30;

  // 4. Energy: small fan, cheap electricity — minor factor
  const energyPenalty = dutyCycle * 50;

  // 5. Temperature stability: low variance in core temp is better than wild swings
  let tempVariance = 0;
  for (const snap of snapshots) {
    tempVariance += (snap.coreTemp - avgCore) ** 2;
  }
  tempVariance = Math.sqrt(tempVariance / snapshots.length);
  const stabilityPenalty = tempVariance * 2;

  const score = pathogenBonus + thermoScore - overheatPenalty - energyPenalty - stabilityPenalty;

  return {
    params,
    score,
    thermophilicHours,
    overheatHours,
    avgCoreTemp: avgCore,
    peakCoreTemp,
    fanDutyCycle: dutyCycle,
    pathogenKillDays: maxConsecutiveThermoDays,
  };
}

// ── Headless Simulation ──────────────────────────────────────────

/**
 * Run a headless simulation, yielding to the UI every ~50ms of compute
 * to prevent freezing. Returns a promise.
 */
async function runHeadless(
  baseConfig: SimulationConfig,
  params: OptimizableParams,
  durationDays: number,
  coarseResolution: boolean,
): Promise<StepSnapshot[]> {
  const config: SimulationConfig = {
    resolution: coarseResolution ? 4 : baseConfig.resolution,
    pile: { ...baseConfig.pile },
    aeration: {
      ...baseConfig.aeration,
      onSeconds: params.fanOnSeconds,
      offSeconds: params.fanOffSeconds,
      gateOpening: params.gateOpening,
    },
    boundaries: { ...baseConfig.boundaries },
    time: {
      ...baseConfig.time,
      heatTimestep: coarseResolution ? 1.6 : baseConfig.time.heatTimestep,
    },
  };

  const grid = new CompostGrid(config);
  initializeGrid(grid, config);

  // Warm start
  for (let i = 0; i < grid.totalCells; i++) {
    if (grid.material[i] === 0) grid.temp[i] = 100;
  }

  const totalHours = durationDays * 24;
  const dt = config.time.heatTimestep;
  const snapshots: StepSnapshot[] = [];
  let simTime = 0;
  let lastWeek = -1;

  const recordInterval = Math.max(1, Math.floor(4 / dt));
  let stepCount = 0;
  // Yield every N steps — tuned so each compute chunk is ~30-50ms
  const yieldEvery = coarseResolution ? 60 : 20;

  while (simTime < totalHours) {
    const snap = tickStep(grid, config, simTime);
    simTime += dt;
    stepCount++;

    const currentWeek = Math.floor(simTime / 168);
    if (currentWeek > lastWeek) {
      const layerInches = params.additionVolGal / 128 * 6;
      addFreshMaterial(grid, config, layerInches);
      lastWeek = currentWeek;
    }

    if (stepCount % recordInterval === 0) {
      snapshots.push(snap);
    }

    if (stepCount % yieldEvery === 0) {
      await yieldToUI();
    }
  }

  return snapshots;
}

// ── Candidate Generation ─────────────────────────────────────────

interface SearchCandidate {
  params: OptimizableParams;
  phase: 'coarse' | 'refine';
}

function generateCoarseCandidates(base: OptimizableParams): SearchCandidate[] {
  const candidates: SearchCandidate[] = [];

  // Fan timing: 6 on × 6 off = 36 combos
  const onValues = [10, 20, 30, 45, 60, 90];
  const offValues = [600, 900, 1200, 1800, 2700, 3600];

  // Gate openings: 5 values
  const gateValues = [0.15, 0.25, 0.40, 0.60, 1.0];

  // Cross fan timing × gate = 36 × 5 = 180 candidates
  // Too many — sample strategically: all timings at current gate, all gates at current timing
  for (const on of onValues) {
    for (const off of offValues) {
      candidates.push({
        params: { ...base, fanOnSeconds: on, fanOffSeconds: off },
        phase: 'coarse',
      });
    }
  }

  for (const gate of gateValues) {
    candidates.push({
      params: { ...base, gateOpening: gate },
      phase: 'coarse',
    });
  }

  return candidates;
}

function generateRefineCandidates(
  topResults: OptimizationResult[],
  base: OptimizableParams,
): SearchCandidate[] {
  const candidates: SearchCandidate[] = [];

  // Only refine the top 2 (not 3) to keep candidate count manageable
  for (const result of topResults.slice(0, 2)) {
    const p = result.params;

    // Refine fan on-time: ±5s around best
    for (const delta of [-5, 5]) {
      const on = Math.max(5, p.fanOnSeconds + delta);
      candidates.push({ params: { ...p, fanOnSeconds: on }, phase: 'refine' });
    }

    // Refine fan off-time: ±60s around best
    for (const delta of [-60, 60]) {
      const off = Math.max(60, p.fanOffSeconds + delta);
      candidates.push({ params: { ...p, fanOffSeconds: off }, phase: 'refine' });
    }

    // Refine gate: ±0.05 around best
    for (const delta of [-0.05, 0.05]) {
      const gate = Math.max(0.05, Math.min(1.0, p.gateOpening + delta));
      candidates.push({ params: { ...p, gateOpening: gate }, phase: 'refine' });
    }
  }

  return candidates; // ~12 candidates instead of ~36
}

// ── Async Execution ──────────────────────────────────────────────

/**
 * Run optimization asynchronously (yields to UI between candidates).
 * Returns a promise that resolves with ranked results.
 */
export async function runOptimizationAsync(
  baseConfig: SimulationConfig,
  currentParams: OptimizableParams,
  durationDays: number,
  onProgress: (p: OptimizationProgress) => void,
): Promise<OptimizationResult[]> {

  // Phase 1: Coarse grid search at 4" resolution
  const coarseCandidates = generateCoarseCandidates(currentParams);
  const coarseResults: OptimizationResult[] = [];

  for (let i = 0; i < coarseCandidates.length; i++) {
    const { params } = coarseCandidates[i];
    const snapshots = await runHeadless(baseConfig, params, durationDays, true);
    const result = scoreFitness(snapshots, params);
    coarseResults.push(result);

    coarseResults.sort((a, b) => b.score - a.score);
    onProgress({
      phase: 'coarse',
      candidatesTested: i + 1,
      totalCandidates: coarseCandidates.length,
      bestSoFar: coarseResults[0],
    });
  }

  coarseResults.sort((a, b) => b.score - a.score);
  const topCoarse = coarseResults.slice(0, 3);

  // Phase 2: Refine around top 3 at 3" resolution (faster than full 2" but finer than coarse 4")
  const refineCandidates = generateRefineCandidates(topCoarse, currentParams);
  const refineResults: OptimizationResult[] = [...topCoarse];

  // Signal phase transition immediately
  onProgress({
    phase: 'refine',
    candidatesTested: coarseCandidates.length,
    totalCandidates: coarseCandidates.length + refineCandidates.length,
    bestSoFar: topCoarse[0],
  });
  await yieldToUI();

  for (let i = 0; i < refineCandidates.length; i++) {
    const { params } = refineCandidates[i];
    // 3" resolution, 14 days — faster than full sim but finer than coarse
    const refineConfig: SimulationConfig = {
      ...baseConfig,
      pile: { ...baseConfig.pile },
      aeration: { ...baseConfig.aeration },
      boundaries: { ...baseConfig.boundaries },
      time: { ...baseConfig.time },
    };
    refineConfig.resolution = 3;
    refineConfig.time.heatTimestep = 0.8;
    const snapshots = await runHeadless(refineConfig, params, 14, false);
    const result = scoreFitness(snapshots, params);
    refineResults.push(result);

    refineResults.sort((a, b) => b.score - a.score);
    onProgress({
      phase: 'refine',
      candidatesTested: coarseCandidates.length + i + 1,
      totalCandidates: coarseCandidates.length + refineCandidates.length,
      bestSoFar: refineResults[0],
    });
  }

  refineResults.sort((a, b) => b.score - a.score);
  return refineResults.slice(0, 5);
}

/**
 * Run seasonal sweep: optimize at multiple ambient temps.
 * Produces a lookup table for ESP32 seasonal control.
 */
export async function runSeasonalSweep(
  baseConfig: SimulationConfig,
  currentParams: OptimizableParams,
  onProgress: (p: OptimizationProgress) => void,
): Promise<SeasonalStrategy[]> {
  const ambientTemps = [35, 50, 65, 75, 85, 95];
  const strategies: SeasonalStrategy[] = [];

  for (const ambient of ambientTemps) {
    const seasonConfig: SimulationConfig = {
      ...baseConfig,
      pile: { ...baseConfig.pile },
      aeration: { ...baseConfig.aeration },
      boundaries: {
        ...baseConfig.boundaries,
        ambientTemp: ambient,
        groundTemp: ambient < 32 ? 32 : 35 + (ambient - 35) * 0.3,
      },
      time: { ...baseConfig.time },
    };

    // Smaller candidate set for seasonal sweep (speed)
    const candidates = generateCoarseCandidates(currentParams);
    let bestResult: OptimizationResult | null = null;

    for (let i = 0; i < candidates.length; i++) {
      const { params } = candidates[i];
      const snapshots = await runHeadless(seasonConfig, params, 14, true);
      const result = scoreFitness(snapshots, params);

      if (!bestResult || result.score > bestResult.score) {
        bestResult = result;
      }

      onProgress({
        phase: 'seasonal',
        candidatesTested: i + 1,
        totalCandidates: candidates.length,
        ambientTemp: ambient,
        bestSoFar: bestResult,
      });
    }

    if (bestResult) {
      strategies.push({ ambientTemp: ambient, best: bestResult });
    }
  }

  return strategies;
}

// ── Helpers ──────────────────────────────────────────────────────

function yieldToUI(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

export function configToParams(config: SimulationConfig): OptimizableParams {
  return {
    fanOnSeconds: config.aeration.onSeconds,
    fanOffSeconds: config.aeration.offSeconds,
    gateOpening: config.aeration.gateOpening,
    additionMoisture: 0.65,
    additionVolGal: 128,
  };
}
