/**
 * GPU vs CPU benchmark for heat stencil and column sweep.
 *
 * Runs in browser (WebGPU required). Compares:
 *   1. Heat stencil only: 1000 GPU steps vs 1000 CPU steps
 *   2. Column sweep only: 1000 GPU dispatches vs 1000 CPU calls
 *   3. Full step (column sweep + heat stencil): 1000 steps combined
 *
 * Reports wall time and max absolute temperature difference.
 */

import { CompostGrid, initializeGrid } from '../../types/CompostGrid';
import { createDefaultConfig, type SimulationConfig } from '../../types/SimulationConfig';
import { MATERIAL_FROM_CODE } from '../../types/CompostGrid';
import { stepHeat } from '../heatDiffusion';
import { computeFanCooling } from '../fanConvection';
import { computeHeatGeneration } from '../bioActivity';
import {
  initGpuPipeline,
  dispatchHeatOnly,
  dispatchColumnOnly,
  dispatchNSteps,
  readbackTemp,
  destroyGpuPipeline,
  type GpuPipeline,
} from './gpuPipeline';

interface BenchmarkResult {
  label: string;
  gpuMs: number;
  cpuMs: number;
  speedup: number;
  maxTempDiffF: number;
}

/** Run all benchmarks and return results. */
export async function runBenchmarks(steps: number = 1000): Promise<BenchmarkResult[]> {
  const config = createDefaultConfig();
  const results: BenchmarkResult[] = [];

  // Build grid and compute initial heat source (same for GPU and CPU)
  const grid = new CompostGrid(config);
  initializeGrid(grid, config);
  warmUpGrid(grid);

  const heatSource = computeHeatSource(grid);

  // --- Heat stencil benchmark ---
  results.push(await benchmarkHeatStencil(grid, config, heatSource, steps));

  // --- Column sweep benchmark ---
  results.push(await benchmarkColumnSweep(grid, config, steps));

  // --- Full step benchmark ---
  results.push(await benchmarkFullStep(grid, config, heatSource, steps));

  return results;
}

// --- Individual benchmarks ---

async function benchmarkHeatStencil(
  grid: CompostGrid,
  config: SimulationConfig,
  heatSource: Float32Array,
  steps: number,
): Promise<BenchmarkResult> {
  // GPU run
  const gpu = await initGpuPipeline(grid, config);
  await warmUpGpu(gpu, heatSource);

  const gpuStart = performance.now();
  dispatchHeatOnly(gpu, heatSource, steps);
  const gpuTemp = await readbackTemp(gpu);
  const gpuMs = performance.now() - gpuStart;
  destroyGpuPipeline(gpu);

  // CPU run (same initial state)
  const cpuGrid = cloneGrid(grid, config);
  const fanCooling = new Float32Array(grid.totalCells); // zero — heat only

  const cpuStart = performance.now();
  for (let s = 0; s < steps; s++) {
    stepHeat(cpuGrid, config, heatSource, fanCooling);
  }
  const cpuMs = performance.now() - cpuStart;

  const maxDiff = maxAbsDiff(gpuTemp, cpuGrid.temp);

  return {
    label: 'Heat stencil',
    gpuMs, cpuMs,
    speedup: cpuMs / gpuMs,
    maxTempDiffF: maxDiff,
  };
}

async function benchmarkColumnSweep(
  grid: CompostGrid,
  config: SimulationConfig,
  steps: number,
): Promise<BenchmarkResult> {
  const gpu = await initGpuPipeline(grid, config);

  // GPU: dispatch column sweep N times
  const gpuStart = performance.now();
  dispatchColumnOnly(gpu, steps);
  await gpu.device.queue.onSubmittedWorkDone();
  const gpuMs = performance.now() - gpuStart;
  destroyGpuPipeline(gpu);

  // CPU: call computeFanCooling N times
  const cpuStart = performance.now();
  for (let s = 0; s < steps; s++) {
    computeFanCooling(grid, config);
  }
  const cpuMs = performance.now() - cpuStart;

  // Column sweep doesn't change temp — no accuracy comparison needed
  return {
    label: 'Column sweep',
    gpuMs, cpuMs,
    speedup: cpuMs / gpuMs,
    maxTempDiffF: 0, // not applicable — output is cooling rate, not temp
  };
}

async function benchmarkFullStep(
  grid: CompostGrid,
  config: SimulationConfig,
  heatSource: Float32Array,
  steps: number,
): Promise<BenchmarkResult> {
  const gpu = await initGpuPipeline(grid, config);
  await warmUpGpu(gpu, heatSource);

  const gpuStart = performance.now();
  dispatchNSteps(gpu, heatSource, steps);
  const gpuTemp = await readbackTemp(gpu);
  const gpuMs = performance.now() - gpuStart;
  destroyGpuPipeline(gpu);

  // CPU: column sweep + heat stencil per step
  const cpuGrid = cloneGrid(grid, config);
  const cpuStart = performance.now();
  for (let s = 0; s < steps; s++) {
    const { cooling } = computeFanCooling(cpuGrid, config);
    stepHeat(cpuGrid, config, heatSource, cooling);
  }
  const cpuMs = performance.now() - cpuStart;

  return {
    label: 'Full step (sweep + heat)',
    gpuMs, cpuMs,
    speedup: cpuMs / gpuMs,
    maxTempDiffF: maxAbsDiff(gpuTemp, cpuGrid.temp),
  };
}

// --- Helpers ---

/** Pre-heat the grid so we're benchmarking non-trivial thermal gradients. */
function warmUpGrid(grid: CompostGrid): void {
  for (let i = 0; i < grid.totalCells; i++) {
    if (MATERIAL_FROM_CODE[grid.material[i]] === 'compost') {
      // Simulate a warm pile center
      const { x, y, z } = grid.coords(i);
      const cx = grid.nx / 2, cy = grid.ny / 2, cz = grid.nz / 2;
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2);
      const maxDist = Math.sqrt(cx ** 2 + cy ** 2 + cz ** 2);
      grid.temp[i] = 75 + 60 * Math.max(0, 1 - dist / maxDist);
    }
  }
}

function computeHeatSource(grid: CompostGrid): Float32Array {
  const hs = new Float32Array(grid.totalCells);
  for (let i = 0; i < grid.totalCells; i++) {
    if (MATERIAL_FROM_CODE[grid.material[i]] !== 'compost') continue;
    hs[i] = computeHeatGeneration(grid.temp[i], grid.moisture[i], grid.oxygen[i], grid.materialAge[i]);
  }
  return hs;
}

function cloneGrid(grid: CompostGrid, config: SimulationConfig): CompostGrid {
  const clone = new CompostGrid(config);
  clone.temp.set(grid.temp);
  clone.moisture.set(grid.moisture);
  clone.oxygen.set(grid.oxygen);
  clone.materialAge.set(grid.materialAge);
  clone.material.set(grid.material);
  return clone;
}

/** Run a few GPU dispatches to warm up the pipeline (shader compilation, etc). */
async function warmUpGpu(gpu: GpuPipeline, heatSource: Float32Array): Promise<void> {
  dispatchHeatOnly(gpu, heatSource, 5);
  await gpu.device.queue.onSubmittedWorkDone();
  // Reset ping-pong back to 0 for clean benchmark start
  // (5 steps flips pong to 1 since 5 is odd)
  gpu.pingPong = 0;
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let maxDiff = 0;
  for (let i = 0; i < a.length; i++) {
    maxDiff = Math.max(maxDiff, Math.abs(a[i] - b[i]));
  }
  return maxDiff;
}

// --- Browser entry point ---

function log(msg: string): void {
  const el = document.getElementById('benchmark-output');
  if (el) el.textContent += msg + '\n';
}

function formatResult(r: BenchmarkResult): string {
  const lines = [
    `--- ${r.label} ---`,
    `  GPU: ${r.gpuMs.toFixed(1)} ms`,
    `  CPU: ${r.cpuMs.toFixed(1)} ms`,
    `  Speedup: ${r.speedup.toFixed(1)}x`,
  ];
  if (r.maxTempDiffF > 0) lines.push(`  Max temp diff: ${r.maxTempDiffF.toFixed(4)} F`);
  return lines.join('\n');
}

/**
 * Run all benchmarks with per-test step counts and log results to DOM.
 * Called from benchmark.html: benchmarkAll(heatSteps, columnSteps, fullSteps)
 */
export async function benchmarkAll(
  heatSteps: number = 1000,
  columnSteps: number = 1000,
  fullSteps: number = 200,
): Promise<void> {
  const config = createDefaultConfig();
  const grid = new CompostGrid(config);
  initializeGrid(grid, config);
  warmUpGrid(grid);
  const heatSource = computeHeatSource(grid);

  log(`=== WebGPU Benchmark ===`);
  log(`Grid: ${grid.nx}x${grid.ny}x${grid.nz} = ${grid.totalCells.toLocaleString()} cells\n`);

  log(`Running heat stencil (${heatSteps} steps)...`);
  const heatResult = await benchmarkHeatStencil(grid, config, heatSource, heatSteps);
  log(formatResult(heatResult) + '\n');

  log(`Running column sweep (${columnSteps} steps)...`);
  const colResult = await benchmarkColumnSweep(grid, config, columnSteps);
  log(formatResult(colResult) + '\n');

  log(`Running full step (${fullSteps} steps)...`);
  const fullResult = await benchmarkFullStep(grid, config, heatSource, fullSteps);
  log(formatResult(fullResult) + '\n');

  const verdict = heatResult.speedup > 20 && colResult.speedup > 5
    ? 'PASS: Speedups exceed thresholds (heat >20x, column >5x). Full GPU rewrite justified.'
    : `REVIEW: Heat ${heatResult.speedup.toFixed(1)}x (target >20x), Column ${colResult.speedup.toFixed(1)}x (target >5x)`;
  log(verdict);
}
