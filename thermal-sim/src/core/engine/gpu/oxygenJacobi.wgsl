/**
 * Steady-state O2 Jacobi solver - one thread per cell, one dispatch per iteration.
 *
 * Ping-pong between oxygenIn and oxygenOut. Run 10 dispatches for convergence.
 *
 * Poisson equation: D_eff * nabla^2 C = S(C)
 * Jacobi: C_new = (sum_neighbors - S * dx^2 / D_eff) / N_neighbors
 *
 * Boundary conditions (matches oxygenSolver.ts):
 *   - Air/pipe cells: atmospheric O2 when fan on, slow decay when off
 *   - Top (y == ny-1): membrane partial exchange (0.21 * 0.3)
 *   - Bottom (y == 0): plenum (0.21 when fan on, 0.21*0.5 when off)
 *   - Sides: zero-flux Neumann (reflection)
 *   - Non-compost solids: O2 = 0
 */

const MAT_COMPOST: u32 = 0u;
const MAT_AIR:     u32 = 1u;
const MAT_PIPE:    u32 = 3u;
const ATMOSPHERIC_O2: f32 = 0.21;

// Bio heat constants (must match bioHeat.wgsl for consistency)
const PEAK_HEAT_RATE: f32 = 104.87;
const O2_CONSUMPTION_PER_BTU: f32 = 0.0101;

struct Uniforms {
  nx:         u32,
  ny:         u32,
  nz:         u32,
  totalCells: u32,
  dx:         f32,   // cell size in feet
  fanIsOn:    u32,   // 1 = on, 0 = off
  _pad0:      u32,
  _pad1:      u32,
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> material:    array<u32>;
@group(0) @binding(2) var<storage, read> temp:        array<f32>;
@group(0) @binding(3) var<storage, read> moisture:    array<f32>;
@group(0) @binding(4) var<storage, read> materialAge: array<f32>;

// Ping-pong O2 buffers
@group(1) @binding(0) var<storage, read> oxygenIn:         array<f32>;
@group(1) @binding(1) var<storage, read_write> oxygenOut:   array<f32>;

fn cellIdx(x: u32, y: u32, z: u32) -> u32 {
  return y * u.nz * u.nx + z * u.nx + x;
}

// --- Activity factors (same as bioHeat.wgsl) ---

fn tempActivityFactor(tempF: f32) -> f32 {
  if (tempF < 32.0)  { return 0.0; }
  if (tempF < 50.0)  { return (tempF - 32.0) / 18.0 * 0.05; }
  if (tempF < 80.0)  { return 0.05 + (tempF - 50.0) / 30.0 * 0.25; }
  if (tempF < 110.0) { return 0.30 + (tempF - 80.0) / 30.0 * 0.40; }
  if (tempF < 131.0) { return 0.70 + (tempF - 110.0) / 21.0 * 0.25; }
  if (tempF < 155.0) { return 0.95 + (tempF - 131.0) / 24.0 * 0.05; }
  if (tempF < 170.0) { return 1.0 - (tempF - 155.0) / 15.0 * 0.85; }
  return 0.05;
}

fn moistureActivityFactor(m: f32) -> f32 {
  if (m < 0.20) { return 0.0; }
  if (m < 0.40) { return (m - 0.20) / 0.20; }
  if (m <= 0.65) { return 1.0; }
  if (m < 0.85) { return 1.0 - (m - 0.65) / 0.20 * 0.5; }
  return 0.5 - (m - 0.85) / 0.15 * 0.4;
}

fn oxygenActivityFactor(o2: f32) -> f32 {
  if (o2 < 0.02) { return 0.05; }
  if (o2 < 0.05) { return 0.05 + (o2 - 0.02) / 0.03 * 0.35; }
  if (o2 < 0.10) { return 0.40 + (o2 - 0.05) / 0.05 * 0.50; }
  return 0.90 + (min(o2, 0.21) - 0.10) / 0.11 * 0.10;
}

fn ageActivityFactor(ageDays: f32) -> f32 {
  if (ageDays < 3.0)  { return 0.6 + ageDays / 3.0 * 0.4; }
  if (ageDays < 14.0) { return 1.0; }
  if (ageDays < 30.0) { return 1.0 - (ageDays - 14.0) / 16.0 * 0.4; }
  if (ageDays < 60.0) { return 0.6 - (ageDays - 30.0) / 30.0 * 0.3; }
  return 0.3 - min(0.25, (ageDays - 60.0) / 120.0 * 0.25);
}

// O2 diffusivity: moisture-dependent, ft2/hr (from VoxelState.ts)
// o2D_in2hr = 40 - 38 * moisture; convert in2/hr -> ft2/hr: / 144
fn o2DiffusivityFt2Hr(m: f32) -> f32 {
  return (40.0 - 38.0 * m) / 144.0;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u.totalCells) { return; }

  let mat = material[i];

  // Recover 3D coords
  let y = i / (u.nz * u.nx);
  let rem = i % (u.nz * u.nx);
  let z = rem / u.nx;
  let x = rem % u.nx;

  // Air/pipe: atmospheric when fan on, slow decay when off
  if (mat == MAT_AIR || mat == MAT_PIPE) {
    if (u.fanIsOn == 1u) {
      oxygenOut[i] = ATMOSPHERIC_O2;
    } else {
      oxygenOut[i] = oxygenIn[i] * 0.97 + 0.15 * 0.03;
    }
    return;
  }

  // Non-compost solids: no O2
  if (mat != MAT_COMPOST) {
    oxygenOut[i] = 0.0;
    return;
  }

  // --- Compost: Jacobi iteration ---

  var neighborSum: f32 = 0.0;
  var neighborCount: u32 = 0u;

  if (x > 0u)        { neighborSum += oxygenIn[cellIdx(x - 1u, y, z)]; neighborCount++; }
  if (x < u.nx - 1u) { neighborSum += oxygenIn[cellIdx(x + 1u, y, z)]; neighborCount++; }
  if (y > 0u)        { neighborSum += oxygenIn[cellIdx(x, y - 1u, z)]; neighborCount++; }
  if (y < u.ny - 1u) { neighborSum += oxygenIn[cellIdx(x, y + 1u, z)]; neighborCount++; }
  if (z > 0u)        { neighborSum += oxygenIn[cellIdx(x, y, z - 1u)]; neighborCount++; }
  if (z < u.nz - 1u) { neighborSum += oxygenIn[cellIdx(x, y, z + 1u)]; neighborCount++; }

  // Boundary contributions for missing neighbors
  if (y == u.ny - 1u) {
    // Top: membrane partial exchange
    neighborSum += ATMOSPHERIC_O2 * 0.3;
    neighborCount++;
  }
  if (y == 0u) {
    // Bottom: plenum
    let plenumO2 = select(ATMOSPHERIC_O2 * 0.5, ATMOSPHERIC_O2, u.fanIsOn == 1u);
    neighborSum += plenumO2;
    neighborCount++;
  }
  // Sides: zero-flux Neumann — missing neighbor not added (reflection)

  // Consumption term: S(C) = heatRate * O2_CONSUMPTION_PER_BTU
  let heatRate = PEAK_HEAT_RATE
    * tempActivityFactor(temp[i])
    * moistureActivityFactor(moisture[i])
    * oxygenActivityFactor(oxygenIn[i])
    * ageActivityFactor(materialAge[i]);
  let consumptionPerHr = heatRate * O2_CONSUMPTION_PER_BTU;

  // Source term: S * dx^2 / D_eff
  let dEff = o2DiffusivityFt2Hr(moisture[i]);
  var sourceTerm: f32 = 0.0;
  if (dEff > 0.0) {
    sourceTerm = consumptionPerHr * u.dx * u.dx / dEff;
  }

  // Jacobi: C_new = (sum_neighbors - sourceTerm) / neighborCount
  let raw = (neighborSum - sourceTerm) / f32(neighborCount);
  oxygenOut[i] = clamp(raw, 0.01, ATMOSPHERIC_O2);
}
