/**
 * WebGPU compute pipeline for compost thermal simulation.
 *
 * Orchestrator: initializes device, creates buffers and bind groups,
 * dispatches all physics shaders (O2, bio heat, column sweep, heat diffusion,
 * moisture transport) entirely on GPU.
 *
 * Buffer layout mirrors CompostGrid flat arrays. Material codes stored
 * as u32 (one per cell) for alignment. Total GPU memory ~19K cells x ~60 bytes ≈ 1.1MB.
 *
 * Dispatch order per tick step:
 *   1. O2 Jacobi (every 5th step, 10 iterations)
 *   2. Bio heat generation (reads temp, moisture, O2, age → writes heatSource)
 *   3. Column sweep convection (reads temp, moisture → writes fanCooling, moistureRemoval)
 *   4. Heat stencil FDM (reads heatSource, fanCooling → writes temp, ping-pong)
 *   5. Moisture per-step (applies moistureRemoval to moisture)
 *   After day completes: moisture daily (gravity drainage + bio water + age increment)
 */

import type { CompostGrid } from '../../types/CompostGrid';
import { COVER_PRESETS, INSULATION_PRESETS, type SimulationConfig } from '../../types/SimulationConfig';
import { humidityRatioFromRH } from '../psychrometrics';
import { computeExitAreaFt2, membraneDerating } from '../fanConvection';
import heatStencilWgsl from './heatStencil.wgsl?raw';
import columnSweepWgsl from './columnSweep.wgsl?raw';
import bioHeatWgsl from './bioHeat.wgsl?raw';
import oxygenJacobiWgsl from './oxygenJacobi.wgsl?raw';
import moistureStepWgsl from './moistureStep.wgsl?raw';

// --- Constants ---

const O2_SOLVE_INTERVAL = 5;
const O2_JACOBI_ITERATIONS = 10;
const WORKGROUP_SIZE = 64;

/** Byte offsets into uniform buffers (must match WGSL struct layouts). */
const HEAT_UNIFORM_AMBIENT_TEMP_OFFSET = 6 * 4;  // f32[6] in Uniforms
const HEAT_UNIFORM_GROUND_TEMP_OFFSET = 7 * 4;    // f32[7] in Uniforms
const O2_UNIFORM_FAN_IS_ON_OFFSET = 5 * 4;        // u32[5] in Uniforms
const MOISTURE_UNIFORM_MODE_OFFSET = 5 * 4;        // u32[5] in Uniforms

// --- Types ---

interface GpuBuffers {
  tempA: GPUBuffer;
  tempB: GPUBuffer;
  material: GPUBuffer;
  moisture: GPUBuffer;
  oxygenA: GPUBuffer;
  oxygenB: GPUBuffer;
  materialAge: GPUBuffer;
  heatSource: GPUBuffer;
  fanCooling: GPUBuffer;
  moistureRemoval: GPUBuffer;
  heatUniforms: GPUBuffer;
  columnUniforms: GPUBuffer;
  bioHeatUniforms: GPUBuffer;
  o2Uniforms: GPUBuffer;
  moistureUniforms: GPUBuffer;
  tempReadback: GPUBuffer;
  moistureReadback: GPUBuffer;
  oxygenReadback: GPUBuffer;
  materialAgeReadback: GPUBuffer;
  heatSourceReadback: GPUBuffer;
}

interface BindGroupSets {
  // Heat stencil (existing)
  heatGroup0: GPUBindGroup;
  heatGroup1: [GPUBindGroup, GPUBindGroup];
  // Column sweep (existing)
  columnGroup0: [GPUBindGroup, GPUBindGroup];
  columnGroup1: GPUBindGroup;
  // Bio heat — ping-pong on temp read (O2 always from oxygenA after even iterations)
  bioHeatGroup: [GPUBindGroup, GPUBindGroup];
  // O2 Jacobi — group 0 ping-pongs on temp, group 1 ping-pongs on O2
  o2Group0: [GPUBindGroup, GPUBindGroup];
  o2Group1: [GPUBindGroup, GPUBindGroup];
  // Moisture step — ping-pong on temp read (for daily T > 80F check)
  moistureGroup: [GPUBindGroup, GPUBindGroup];
}

export interface GpuPipeline {
  device: GPUDevice;
  heatPipeline: GPUComputePipeline;
  columnPipeline: GPUComputePipeline;
  bioHeatPipeline: GPUComputePipeline;
  o2Pipeline: GPUComputePipeline;
  moisturePipeline: GPUComputePipeline;
  buffers: GpuBuffers;
  bindGroups: BindGroupSets;
  totalCells: number;
  totalColumns: number;
  pingPong: number;
  o2PingPong: number;
}

// --- Initialization ---

export async function initGpuPipeline(
  grid: CompostGrid,
  config: SimulationConfig,
): Promise<GpuPipeline> {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) throw new Error('WebGPU not supported — no adapter found');
  const device = await adapter.requestDevice();

  const buffers = createBuffers(device, grid.totalCells);
  uploadGridState(device, grid, buffers);
  uploadHeatUniforms(device, config, grid, buffers);
  uploadColumnUniforms(device, config, grid, buffers);
  uploadBioHeatUniforms(device, grid, buffers);
  uploadO2Uniforms(device, grid, config, buffers, true);
  uploadMoistureUniforms(device, grid, config, buffers, 0);

  const heatPipeline = createPipeline(device, heatStencilWgsl);
  const columnPipeline = createPipeline(device, columnSweepWgsl);
  const bioHeatPipeline = createPipeline(device, bioHeatWgsl);
  const o2Pipeline = createPipeline(device, oxygenJacobiWgsl);
  const moisturePipeline = createPipeline(device, moistureStepWgsl);

  const bindGroups = createBindGroups(
    device, heatPipeline, columnPipeline, bioHeatPipeline, o2Pipeline, moisturePipeline, buffers,
  );

  return {
    device, heatPipeline, columnPipeline, bioHeatPipeline, o2Pipeline, moisturePipeline,
    buffers, bindGroups,
    totalCells: grid.totalCells,
    totalColumns: grid.nx * grid.nz,
    pingPong: 0,
    o2PingPong: 0,
  };
}

function createPipeline(device: GPUDevice, code: string): GPUComputePipeline {
  return device.createComputePipeline({
    layout: 'auto',
    compute: { module: device.createShaderModule({ code }), entryPoint: 'main' },
  });
}

// --- Buffers ---

function createBuffers(device: GPUDevice, totalCells: number): GpuBuffers {
  const f32Bytes    = totalCells * 4;
  const storageRW   = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
  const uniformBuf  = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;
  const stagingRead = GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST;

  const alloc = (size: number, usage: number) => device.createBuffer({ size, usage });

  return {
    tempA:              alloc(f32Bytes, storageRW),
    tempB:              alloc(f32Bytes, storageRW),
    material:           alloc(f32Bytes, storageRW),
    moisture:           alloc(f32Bytes, storageRW),
    oxygenA:            alloc(f32Bytes, storageRW),
    oxygenB:            alloc(f32Bytes, storageRW),
    materialAge:        alloc(f32Bytes, storageRW),
    heatSource:         alloc(f32Bytes, storageRW),
    fanCooling:         alloc(f32Bytes, storageRW),
    moistureRemoval:    alloc(f32Bytes, storageRW),
    heatUniforms:       alloc(48, uniformBuf),
    columnUniforms:     alloc(96, uniformBuf),
    bioHeatUniforms:    alloc(16, uniformBuf),
    o2Uniforms:         alloc(32, uniformBuf),
    moistureUniforms:   alloc(32, uniformBuf),
    tempReadback:       alloc(f32Bytes, stagingRead),
    moistureReadback:   alloc(f32Bytes, stagingRead),
    oxygenReadback:     alloc(f32Bytes, stagingRead),
    materialAgeReadback: alloc(f32Bytes, stagingRead),
    heatSourceReadback: alloc(f32Bytes, stagingRead),
  };
}

// --- Data upload ---

function uploadGridState(device: GPUDevice, grid: CompostGrid, buf: GpuBuffers): void {
  device.queue.writeBuffer(buf.tempA, 0, grid.temp);

  const matU32 = new Uint32Array(grid.totalCells);
  for (let i = 0; i < grid.totalCells; i++) matU32[i] = grid.material[i];
  device.queue.writeBuffer(buf.material, 0, matU32);

  device.queue.writeBuffer(buf.moisture, 0, grid.moisture);
  device.queue.writeBuffer(buf.oxygenA, 0, grid.oxygen);
  device.queue.writeBuffer(buf.materialAge, 0, grid.materialAge);
}

/** Re-upload all mutable grid arrays after CPU-side material changes. */
export function syncGridToGpu(gpu: GpuPipeline, grid: CompostGrid): void {
  const { device, buffers: buf } = gpu;
  const srcBuf = gpu.pingPong === 0 ? buf.tempA : buf.tempB;
  device.queue.writeBuffer(srcBuf, 0, grid.temp);

  const matU32 = new Uint32Array(grid.totalCells);
  for (let i = 0; i < grid.totalCells; i++) matU32[i] = grid.material[i];
  device.queue.writeBuffer(buf.material, 0, matU32);

  device.queue.writeBuffer(buf.moisture, 0, grid.moisture);

  const o2Buf = gpu.o2PingPong === 0 ? buf.oxygenA : buf.oxygenB;
  device.queue.writeBuffer(o2Buf, 0, grid.oxygen);
  device.queue.writeBuffer(buf.materialAge, 0, grid.materialAge);
}

function uploadHeatUniforms(
  device: GPUDevice, config: SimulationConfig, grid: CompostGrid, buf: GpuBuffers,
): void {
  const data = new ArrayBuffer(48);
  const u32 = new Uint32Array(data);
  const f32 = new Float32Array(data);

  u32[0] = grid.nx;
  u32[1] = grid.ny;
  u32[2] = grid.nz;
  u32[3] = grid.totalCells;
  f32[4] = config.time.heatTimestep;
  f32[5] = config.resolution / 12;
  f32[6] = config.boundaries.ambientTemp;
  f32[7] = config.boundaries.groundTemp;
  f32[8] = COVER_PRESETS[config.boundaries.coverType].rValue;
  f32[9] = INSULATION_PRESETS[config.boundaries.sideInsulation].rValue;
  u32[10] = Math.ceil(config.pile.plenumHeight / config.resolution);
  u32[11] = 0;

  device.queue.writeBuffer(buf.heatUniforms, 0, data);
}

/** Update heat uniforms for changing weather (ambient/ground temp). */
export function updateHeatWeather(gpu: GpuPipeline, ambientTemp: number, groundTemp: number): void {
  gpu.device.queue.writeBuffer(
    gpu.buffers.heatUniforms,
    HEAT_UNIFORM_AMBIENT_TEMP_OFFSET,
    new Float32Array([ambientTemp, groundTemp]),
  );
}

function uploadColumnUniforms(
  device: GPUDevice, config: SimulationConfig, grid: CompostGrid, buf: GpuBuffers,
): void {
  const cellSizeFt = config.resolution / 12;
  const cellVolFt3 = cellSizeFt ** 3;
  const pileAreaFt2 = (config.pile.width / 12) * (config.pile.depth / 12);

  const freeCfm = config.aeration.fanCfm * config.aeration.gateOpening;
  const exitAreaFt2 = computeExitAreaFt2(grid, config);
  const permeance = COVER_PRESETS[config.boundaries.coverType].airPermeance;
  const effectiveCfm = membraneDerating(freeCfm, exitAreaFt2, permeance, 0.5);

  const vSupMs = (effectiveCfm / pileAreaFt2 / 60) * 0.3048;
  const ambientW = humidityRatioFromRH(config.boundaries.ambientTemp, config.boundaries.ambientRH);

  const rhoAmbient = 1.184;
  const totalMassFlowLbHr = rhoAmbient * 0.06243 * effectiveCfm * 60;
  const compostColumns = countCompostColumns(grid);
  const massFlowPerCol = compostColumns > 0 ? totalMassFlowLbHr / compostColumns : totalMassFlowLbHr;

  const dutyCycle = config.aeration.onSeconds / (config.aeration.onSeconds + config.aeration.offSeconds);

  const data = new ArrayBuffer(96);
  const u32 = new Uint32Array(data);
  const f32 = new Float32Array(data);

  u32[0] = grid.nx;
  u32[1] = grid.ny;
  u32[2] = grid.nz;
  u32[3] = grid.totalCells;
  u32[4] = Math.ceil(config.pile.plenumHeight / config.resolution);
  u32[5] = 0; u32[6] = 0; u32[7] = 0;
  f32[8]  = config.boundaries.ambientTemp;
  f32[9]  = ambientW;
  f32[10] = dutyCycle;
  f32[11] = config.pile.porosity;
  f32[12] = config.pile.particleDiameter * 0.0254;
  f32[13] = vSupMs;
  f32[14] = massFlowPerCol;
  f32[15] = cellVolFt3;
  f32[16] = 24 * cellVolFt3;
  f32[17] = config.pile.criticalMoisture;
  f32[18] = config.boundaries.membraneRetention;
  f32[19] = 40 * 0.6;
  f32[20] = 0; f32[21] = 0; f32[22] = 0; f32[23] = 0;

  device.queue.writeBuffer(buf.columnUniforms, 0, data);
}

/** Update column sweep uniforms for changing weather + fan controller output. */
export function updateColumnWeather(
  gpu: GpuPipeline, grid: CompostGrid, config: SimulationConfig,
): void {
  uploadColumnUniforms(gpu.device, config, grid, gpu.buffers);
}

function uploadBioHeatUniforms(device: GPUDevice, grid: CompostGrid, buf: GpuBuffers): void {
  const data = new Uint32Array([grid.nx, grid.ny, grid.nz, grid.totalCells]);
  device.queue.writeBuffer(buf.bioHeatUniforms, 0, data);
}

function uploadO2Uniforms(
  device: GPUDevice, grid: CompostGrid, config: SimulationConfig,
  buf: GpuBuffers, fanIsOn: boolean,
): void {
  const data = new ArrayBuffer(32);
  const u32 = new Uint32Array(data);
  const f32 = new Float32Array(data);

  u32[0] = grid.nx;
  u32[1] = grid.ny;
  u32[2] = grid.nz;
  u32[3] = grid.totalCells;
  f32[4] = config.resolution / 12; // dx in feet
  u32[5] = fanIsOn ? 1 : 0;
  u32[6] = 0;
  u32[7] = 0;

  device.queue.writeBuffer(buf.o2Uniforms, 0, data);
}

/** Update O2 uniform fan state between dispatches. */
export function updateO2FanState(gpu: GpuPipeline, fanIsOn: boolean): void {
  gpu.device.queue.writeBuffer(
    gpu.buffers.o2Uniforms,
    O2_UNIFORM_FAN_IS_ON_OFFSET,
    new Uint32Array([fanIsOn ? 1 : 0]),
  );
}

function uploadMoistureUniforms(
  device: GPUDevice, grid: CompostGrid, config: SimulationConfig,
  buf: GpuBuffers, mode: number,
): void {
  const data = new ArrayBuffer(32);
  const u32 = new Uint32Array(data);
  const f32 = new Float32Array(data);

  u32[0] = grid.nx;
  u32[1] = grid.ny;
  u32[2] = grid.nz;
  u32[3] = grid.totalCells;
  f32[4] = config.time.heatTimestep;
  u32[5] = mode;
  u32[6] = Math.ceil(config.pile.plenumHeight / config.resolution);
  u32[7] = 0;

  device.queue.writeBuffer(buf.moistureUniforms, 0, data);
}

/** Switch moisture shader mode (0 = per-step fan, 1 = daily gravity+bio). */
export function setMoistureMode(gpu: GpuPipeline, mode: number): void {
  gpu.device.queue.writeBuffer(
    gpu.buffers.moistureUniforms,
    MOISTURE_UNIFORM_MODE_OFFSET,
    new Uint32Array([mode]),
  );
}

function countCompostColumns(grid: CompostGrid): number {
  let count = 0;
  for (let z = 0; z < grid.nz; z++) {
    for (let x = 0; x < grid.nx; x++) {
      for (let y = 0; y < grid.ny; y++) {
        if (grid.material[grid.idx(x, y, z)] === 0) { count++; break; }
      }
    }
  }
  return count;
}

// --- Bind groups ---

function createBindGroups(
  device: GPUDevice,
  heatPL: GPUComputePipeline,
  columnPL: GPUComputePipeline,
  bioHeatPL: GPUComputePipeline,
  o2PL: GPUComputePipeline,
  moisturePL: GPUComputePipeline,
  buf: GpuBuffers,
): BindGroupSets {
  const bg = (layout: GPUBindGroupLayout, entries: { binding: number; resource: { buffer: GPUBuffer } }[]) =>
    device.createBindGroup({ layout, entries });

  // --- Heat stencil ---
  const heatGroup0 = bg(heatPL.getBindGroupLayout(0), [
    { binding: 0, resource: { buffer: buf.heatUniforms } },
    { binding: 1, resource: { buffer: buf.material } },
    { binding: 2, resource: { buffer: buf.moisture } },
    { binding: 3, resource: { buffer: buf.heatSource } },
    { binding: 4, resource: { buffer: buf.fanCooling } },
  ]);

  const heatG1Layout = heatPL.getBindGroupLayout(1);
  const heatGroup1: [GPUBindGroup, GPUBindGroup] = [
    bg(heatG1Layout, [{ binding: 0, resource: { buffer: buf.tempA } }, { binding: 1, resource: { buffer: buf.tempB } }]),
    bg(heatG1Layout, [{ binding: 0, resource: { buffer: buf.tempB } }, { binding: 1, resource: { buffer: buf.tempA } }]),
  ];

  // --- Column sweep ---
  const colG0Layout = columnPL.getBindGroupLayout(0);
  const columnGroup0: [GPUBindGroup, GPUBindGroup] = [
    bg(colG0Layout, [
      { binding: 0, resource: { buffer: buf.columnUniforms } },
      { binding: 1, resource: { buffer: buf.material } },
      { binding: 2, resource: { buffer: buf.tempA } },
      { binding: 3, resource: { buffer: buf.moisture } },
    ]),
    bg(colG0Layout, [
      { binding: 0, resource: { buffer: buf.columnUniforms } },
      { binding: 1, resource: { buffer: buf.material } },
      { binding: 2, resource: { buffer: buf.tempB } },
      { binding: 3, resource: { buffer: buf.moisture } },
    ]),
  ];

  const columnGroup1 = bg(columnPL.getBindGroupLayout(1), [
    { binding: 0, resource: { buffer: buf.fanCooling } },
    { binding: 1, resource: { buffer: buf.moistureRemoval } },
  ]);

  // --- Bio heat (ping-pong on temp, O2 always from oxygenA after even Jacobi iterations) ---
  const bhLayout = bioHeatPL.getBindGroupLayout(0);
  const bioHeatGroup: [GPUBindGroup, GPUBindGroup] = [
    bg(bhLayout, [
      { binding: 0, resource: { buffer: buf.bioHeatUniforms } },
      { binding: 1, resource: { buffer: buf.material } },
      { binding: 2, resource: { buffer: buf.tempA } },
      { binding: 3, resource: { buffer: buf.moisture } },
      { binding: 4, resource: { buffer: buf.oxygenA } },
      { binding: 5, resource: { buffer: buf.materialAge } },
      { binding: 6, resource: { buffer: buf.heatSource } },
    ]),
    bg(bhLayout, [
      { binding: 0, resource: { buffer: buf.bioHeatUniforms } },
      { binding: 1, resource: { buffer: buf.material } },
      { binding: 2, resource: { buffer: buf.tempB } },
      { binding: 3, resource: { buffer: buf.moisture } },
      { binding: 4, resource: { buffer: buf.oxygenA } },
      { binding: 5, resource: { buffer: buf.materialAge } },
      { binding: 6, resource: { buffer: buf.heatSource } },
    ]),
  ];

  // --- O2 Jacobi ---
  const o2G0Layout = o2PL.getBindGroupLayout(0);
  const o2Group0: [GPUBindGroup, GPUBindGroup] = [
    bg(o2G0Layout, [
      { binding: 0, resource: { buffer: buf.o2Uniforms } },
      { binding: 1, resource: { buffer: buf.material } },
      { binding: 2, resource: { buffer: buf.tempA } },
      { binding: 3, resource: { buffer: buf.moisture } },
      { binding: 4, resource: { buffer: buf.materialAge } },
    ]),
    bg(o2G0Layout, [
      { binding: 0, resource: { buffer: buf.o2Uniforms } },
      { binding: 1, resource: { buffer: buf.material } },
      { binding: 2, resource: { buffer: buf.tempB } },
      { binding: 3, resource: { buffer: buf.moisture } },
      { binding: 4, resource: { buffer: buf.materialAge } },
    ]),
  ];

  const o2G1Layout = o2PL.getBindGroupLayout(1);
  const o2Group1: [GPUBindGroup, GPUBindGroup] = [
    bg(o2G1Layout, [{ binding: 0, resource: { buffer: buf.oxygenA } }, { binding: 1, resource: { buffer: buf.oxygenB } }]),
    bg(o2G1Layout, [{ binding: 0, resource: { buffer: buf.oxygenB } }, { binding: 1, resource: { buffer: buf.oxygenA } }]),
  ];

  // --- Moisture step (ping-pong on temp for daily mode T > 80F check) ---
  const msLayout = moisturePL.getBindGroupLayout(0);
  const moistureGroup: [GPUBindGroup, GPUBindGroup] = [
    bg(msLayout, [
      { binding: 0, resource: { buffer: buf.moistureUniforms } },
      { binding: 1, resource: { buffer: buf.material } },
      { binding: 2, resource: { buffer: buf.moisture } },
      { binding: 3, resource: { buffer: buf.moistureRemoval } },
      { binding: 4, resource: { buffer: buf.tempA } },
      { binding: 5, resource: { buffer: buf.materialAge } },
    ]),
    bg(msLayout, [
      { binding: 0, resource: { buffer: buf.moistureUniforms } },
      { binding: 1, resource: { buffer: buf.material } },
      { binding: 2, resource: { buffer: buf.moisture } },
      { binding: 3, resource: { buffer: buf.moistureRemoval } },
      { binding: 4, resource: { buffer: buf.tempB } },
      { binding: 5, resource: { buffer: buf.materialAge } },
    ]),
  ];

  return { heatGroup0, heatGroup1, columnGroup0, columnGroup1, bioHeatGroup, o2Group0, o2Group1, moistureGroup };
}

// --- Full-pipeline dispatch ---

/**
 * Dispatch one simulated day on GPU (stepsPerDay heat steps + daily moisture update).
 *
 * Pipeline per step: O2 (every 5th) → bioHeat → columnSweep → heatStencil → moistureApply
 * After all steps: daily moisture (gravity + bio water + age increment)
 *
 * No CPU readback between steps — entire day runs in one command buffer.
 */
export function dispatchOneDay(gpu: GpuPipeline, stepsPerDay: number, startStepIndex: number): void {
  // Mode 0 (per-step moisture) was set at init or by caller
  const cellWg = Math.ceil(gpu.totalCells / WORKGROUP_SIZE);
  const colWg = Math.ceil(gpu.totalColumns / WORKGROUP_SIZE);

  const encoder = gpu.device.createCommandEncoder();

  for (let s = 0; s < stepsPerDay; s++) {
    const globalStep = startStepIndex + s;

    // O2 Jacobi every O2_SOLVE_INTERVAL steps (10 iterations, even → o2PingPong returns to start)
    if (globalStep % O2_SOLVE_INTERVAL === 0) {
      for (let iter = 0; iter < O2_JACOBI_ITERATIONS; iter++) {
        const pass = encoder.beginComputePass();
        pass.setPipeline(gpu.o2Pipeline);
        pass.setBindGroup(0, gpu.bindGroups.o2Group0[gpu.pingPong]);
        pass.setBindGroup(1, gpu.bindGroups.o2Group1[gpu.o2PingPong]);
        pass.dispatchWorkgroups(cellWg);
        pass.end();
        gpu.o2PingPong = 1 - gpu.o2PingPong;
      }
      // 10 iterations (even) → o2PingPong back to 0
    }

    // Bio heat generation
    const bhPass = encoder.beginComputePass();
    bhPass.setPipeline(gpu.bioHeatPipeline);
    bhPass.setBindGroup(0, gpu.bindGroups.bioHeatGroup[gpu.pingPong]);
    bhPass.dispatchWorkgroups(cellWg);
    bhPass.end();

    // Column sweep convection
    const csPass = encoder.beginComputePass();
    csPass.setPipeline(gpu.columnPipeline);
    csPass.setBindGroup(0, gpu.bindGroups.columnGroup0[gpu.pingPong]);
    csPass.setBindGroup(1, gpu.bindGroups.columnGroup1);
    csPass.dispatchWorkgroups(colWg);
    csPass.end();

    // Heat stencil (writes to opposite temp buffer)
    const hsPass = encoder.beginComputePass();
    hsPass.setPipeline(gpu.heatPipeline);
    hsPass.setBindGroup(0, gpu.bindGroups.heatGroup0);
    hsPass.setBindGroup(1, gpu.bindGroups.heatGroup1[gpu.pingPong]);
    hsPass.dispatchWorkgroups(cellWg);
    hsPass.end();

    gpu.pingPong = 1 - gpu.pingPong;

    // Moisture per-step (mode 0: apply moistureRemoval)
    const msPass = encoder.beginComputePass();
    msPass.setPipeline(gpu.moisturePipeline);
    msPass.setBindGroup(0, gpu.bindGroups.moistureGroup[gpu.pingPong]);
    msPass.dispatchWorkgroups(cellWg);
    msPass.end();
  }

  gpu.device.queue.submit([encoder.finish()]);

  // Daily moisture update (mode 1: gravity drainage + bio water + age increment)
  setMoistureMode(gpu, 1);
  const dailyEncoder = gpu.device.createCommandEncoder();
  const dailyPass = dailyEncoder.beginComputePass();
  dailyPass.setPipeline(gpu.moisturePipeline);
  dailyPass.setBindGroup(0, gpu.bindGroups.moistureGroup[gpu.pingPong]);
  dailyPass.dispatchWorkgroups(cellWg);
  dailyPass.end();
  gpu.device.queue.submit([dailyEncoder.finish()]);

  // Reset mode back to 0 for next day's per-step dispatches
  setMoistureMode(gpu, 0);
}

// --- Readback ---

/** Read back all simulation arrays for CPU-side snapshot computation. */
export async function readbackAllArrays(gpu: GpuPipeline): Promise<{
  temp: Float32Array;
  moisture: Float32Array;
  oxygen: Float32Array;
  materialAge: Float32Array;
  heatSource: Float32Array;
}> {
  const { buffers: buf, totalCells, pingPong, o2PingPong } = gpu;
  const bytes = totalCells * 4;

  const tempSrc = pingPong === 0 ? buf.tempA : buf.tempB;
  const o2Src = o2PingPong === 0 ? buf.oxygenA : buf.oxygenB;

  const encoder = gpu.device.createCommandEncoder();
  encoder.copyBufferToBuffer(tempSrc, 0, buf.tempReadback, 0, bytes);
  encoder.copyBufferToBuffer(buf.moisture, 0, buf.moistureReadback, 0, bytes);
  encoder.copyBufferToBuffer(o2Src, 0, buf.oxygenReadback, 0, bytes);
  encoder.copyBufferToBuffer(buf.materialAge, 0, buf.materialAgeReadback, 0, bytes);
  encoder.copyBufferToBuffer(buf.heatSource, 0, buf.heatSourceReadback, 0, bytes);
  gpu.device.queue.submit([encoder.finish()]);

  const [temp, moisture, oxygen, materialAge, heatSource] = await Promise.all([
    mapAndCopy(buf.tempReadback),
    mapAndCopy(buf.moistureReadback),
    mapAndCopy(buf.oxygenReadback),
    mapAndCopy(buf.materialAgeReadback),
    mapAndCopy(buf.heatSourceReadback),
  ]);

  return { temp, moisture, oxygen, materialAge, heatSource };
}

async function mapAndCopy(buffer: GPUBuffer): Promise<Float32Array> {
  await buffer.mapAsync(GPUMapMode.READ);
  const result = new Float32Array(buffer.getMappedRange().slice(0));
  buffer.unmap();
  return result;
}

/** Read back current temperature only (for benchmarks). */
export async function readbackTemp(gpu: GpuPipeline): Promise<Float32Array> {
  const srcBuf = gpu.pingPong === 0 ? gpu.buffers.tempA : gpu.buffers.tempB;
  const encoder = gpu.device.createCommandEncoder();
  encoder.copyBufferToBuffer(srcBuf, 0, gpu.buffers.tempReadback, 0, gpu.totalCells * 4);
  gpu.device.queue.submit([encoder.finish()]);
  return mapAndCopy(gpu.buffers.tempReadback);
}

// --- Legacy benchmark dispatch functions ---

/** Submit N steps of column sweep + heat stencil (CPU-provided heatSource). */
export function dispatchNSteps(gpu: GpuPipeline, heatSource: Float32Array, steps: number): void {
  gpu.device.queue.writeBuffer(gpu.buffers.heatSource, 0, heatSource);
  const cellWg = Math.ceil(gpu.totalCells / WORKGROUP_SIZE);
  const colWg = Math.ceil(gpu.totalColumns / WORKGROUP_SIZE);

  const encoder = gpu.device.createCommandEncoder();
  for (let s = 0; s < steps; s++) {
    const colPass = encoder.beginComputePass();
    colPass.setPipeline(gpu.columnPipeline);
    colPass.setBindGroup(0, gpu.bindGroups.columnGroup0[gpu.pingPong]);
    colPass.setBindGroup(1, gpu.bindGroups.columnGroup1);
    colPass.dispatchWorkgroups(colWg);
    colPass.end();

    const heatPass = encoder.beginComputePass();
    heatPass.setPipeline(gpu.heatPipeline);
    heatPass.setBindGroup(0, gpu.bindGroups.heatGroup0);
    heatPass.setBindGroup(1, gpu.bindGroups.heatGroup1[gpu.pingPong]);
    heatPass.dispatchWorkgroups(cellWg);
    heatPass.end();

    gpu.pingPong = 1 - gpu.pingPong;
  }
  gpu.device.queue.submit([encoder.finish()]);
}

/** Dispatch heat stencil only (for isolated benchmark). */
export function dispatchHeatOnly(gpu: GpuPipeline, heatSource: Float32Array, steps: number): void {
  gpu.device.queue.writeBuffer(gpu.buffers.heatSource, 0, heatSource);
  gpu.device.queue.writeBuffer(gpu.buffers.fanCooling, 0, new Float32Array(gpu.totalCells));
  const cellWg = Math.ceil(gpu.totalCells / WORKGROUP_SIZE);

  const encoder = gpu.device.createCommandEncoder();
  for (let s = 0; s < steps; s++) {
    const pass = encoder.beginComputePass();
    pass.setPipeline(gpu.heatPipeline);
    pass.setBindGroup(0, gpu.bindGroups.heatGroup0);
    pass.setBindGroup(1, gpu.bindGroups.heatGroup1[gpu.pingPong]);
    pass.dispatchWorkgroups(cellWg);
    pass.end();
    gpu.pingPong = 1 - gpu.pingPong;
  }
  gpu.device.queue.submit([encoder.finish()]);
}

/** Dispatch column sweep only (for isolated benchmark). */
export function dispatchColumnOnly(gpu: GpuPipeline, steps: number): void {
  const colWg = Math.ceil(gpu.totalColumns / WORKGROUP_SIZE);
  const encoder = gpu.device.createCommandEncoder();
  for (let s = 0; s < steps; s++) {
    const pass = encoder.beginComputePass();
    pass.setPipeline(gpu.columnPipeline);
    pass.setBindGroup(0, gpu.bindGroups.columnGroup0[gpu.pingPong]);
    pass.setBindGroup(1, gpu.bindGroups.columnGroup1);
    pass.dispatchWorkgroups(colWg);
    pass.end();
  }
  gpu.device.queue.submit([encoder.finish()]);
}

/** Release all GPU resources. */
export function destroyGpuPipeline(gpu: GpuPipeline): void {
  for (const buf of Object.values(gpu.buffers) as GPUBuffer[]) buf.destroy();
  gpu.device.destroy();
}
