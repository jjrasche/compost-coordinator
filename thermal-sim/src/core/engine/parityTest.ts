/**
 * GPU/CPU parity test — runs both engines on identical config,
 * compares daily snapshots, reports per-metric max deltas.
 *
 * Must run in browser (WebGPU not available in Node).
 */

import { createDefaultConfig, type SimulationConfig } from '../types/SimulationConfig';
import type { StepSnapshot } from './tickStep';
import { runCpuSimulation } from './cpuSimRunner';
import { runGpuSimulation } from './gpu/gpuSimRunner';

// --- Types ---

export interface MetricDelta {
  metric: string;
  maxDelta: number;
  maxDeltaDay: number;
  tolerance: number;
  passed: boolean;
}

export interface ParityResult {
  totalDays: number;
  metrics: MetricDelta[];
  allPassed: boolean;
  cpuTimeMs: number;
  gpuTimeMs: number;
}

export interface ParityProgress {
  phase: 'cpu' | 'gpu';
  percent: number;
  currentDay: number;
  totalDays: number;
}

// Tolerances: float32 vs float64 accumulation over 30 days
const TOLERANCES: Record<string, number> = {
  coreTemp: 3.0,       // °F — GPU float32 heat stencil drifts ~1-3°F
  avgTemp: 3.0,        // °F
  surfaceTemp: 3.0,    // °F
  avgOxygen: 0.02,     // fraction — Jacobi convergence differs
  avgMoisture: 0.03,   // fraction — column sweep float32 drift
};

// --- Orchestrator ---

/**
 * Run parity test: CPU then GPU on identical 30-day config.
 * Returns per-metric max deltas with pass/fail against tolerances.
 */
export async function runParityTest(
  onProgress?: (progress: ParityProgress) => void,
  durationDays: number = 30,
): Promise<ParityResult> {
  const config = buildParityConfig(durationDays);

  const cpuResult = await runCpuPhase(config, durationDays, onProgress);
  const gpuResult = await runGpuPhase(config, durationDays, onProgress);

  const metrics = compareSnapshots(cpuResult.snapshots, gpuResult.snapshots);
  return {
    totalDays: Math.min(cpuResult.snapshots.length, gpuResult.snapshots.length),
    metrics,
    allPassed: metrics.every(m => m.passed),
    cpuTimeMs: cpuResult.elapsedMs,
    gpuTimeMs: gpuResult.elapsedMs,
  };
}

// --- Concept functions ---

function buildParityConfig(durationDays: number): SimulationConfig {
  const config = createDefaultConfig();
  config.time.totalHours = durationDays * 24;
  // Fixed weather (no API dependency)
  config.boundaries.ambientTemp = 70;
  config.boundaries.ambientRH = 0.6;
  config.boundaries.groundTemp = 55;
  return config;
}

async function runCpuPhase(
  config: SimulationConfig,
  totalDays: number,
  onProgress?: (progress: ParityProgress) => void,
): Promise<{ snapshots: StepSnapshot[]; elapsedMs: number }> {
  const cpuConfig = structuredClone(config);
  const startMs = performance.now();

  const result = await runCpuSimulation({
    config: cpuConfig,
    weatherSteps: null,
    fanMode: 'auto',
    onProgress: onProgress
      ? (p) => onProgress({ phase: 'cpu', percent: p.percent, currentDay: p.currentDay, totalDays })
      : undefined,
  });

  return { snapshots: result.snapshots, elapsedMs: performance.now() - startMs };
}

async function runGpuPhase(
  config: SimulationConfig,
  totalDays: number,
  onProgress?: (progress: ParityProgress) => void,
): Promise<{ snapshots: StepSnapshot[]; elapsedMs: number }> {
  const gpuConfig = structuredClone(config);
  const startMs = performance.now();

  const result = await runGpuSimulation({
    config: gpuConfig,
    weatherSteps: null,
    fanMode: 'auto',
    checkpointIntervalHours: 24,
    onProgress: (p) => {
      if (onProgress) onProgress({ phase: 'gpu', percent: p.percent, currentDay: p.currentDay, totalDays });
    },
  });

  return { snapshots: result.snapshots, elapsedMs: performance.now() - startMs };
}

function compareSnapshots(
  cpuSnapshots: StepSnapshot[],
  gpuSnapshots: StepSnapshot[],
): MetricDelta[] {
  const dayCount = Math.min(cpuSnapshots.length, gpuSnapshots.length);
  const metricNames = Object.keys(TOLERANCES);

  return metricNames.map(metric => findMaxDelta(metric, cpuSnapshots, gpuSnapshots, dayCount));
}

// --- Leaf functions ---

function findMaxDelta(
  metric: string,
  cpuSnapshots: StepSnapshot[],
  gpuSnapshots: StepSnapshot[],
  dayCount: number,
): MetricDelta {
  const tolerance = TOLERANCES[metric];
  let maxDelta = 0;
  let maxDeltaDay = 0;

  for (let day = 0; day < dayCount; day++) {
    const cpuVal = cpuSnapshots[day][metric as keyof StepSnapshot] as number;
    const gpuVal = gpuSnapshots[day][metric as keyof StepSnapshot] as number;
    const delta = Math.abs(cpuVal - gpuVal);

    if (delta > maxDelta) {
      maxDelta = delta;
      maxDeltaDay = day + 1;
    }
  }

  return {
    metric,
    maxDelta,
    maxDeltaDay,
    tolerance,
    passed: maxDelta <= tolerance,
  };
}
