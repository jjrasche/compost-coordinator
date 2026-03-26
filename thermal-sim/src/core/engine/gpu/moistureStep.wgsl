/**
 * Moisture update shader - one thread per cell.
 *
 * Two modes controlled by uniforms.mode:
 *   mode 0: Per-timestep fan-driven moisture change
 *     moisture -= moistureRemoval * dt, clamped to [0, 1]
 *
 *   mode 1: Daily gravity drainage + bio water production
 *     - Gravity: excess above 0.65 FC drains 10% per day to cell below
 *     - Bio water: active cells (T > 80F) gain 0.005 FC per day
 *     - Also increments materialAge by 1 day for compost cells
 *
 * Gravity drainage requires top-to-bottom ordering. On GPU we approximate
 * by running a single pass — the error is small (each cell drains at most
 * 0.035 FC/day, and drainage propagates one cell per daily call).
 */

const MAT_COMPOST: u32 = 0u;

struct Uniforms {
  nx:         u32,
  ny:         u32,
  nz:         u32,
  totalCells: u32,
  dt:         f32,   // heat timestep in hours (mode 0 only)
  mode:       u32,   // 0 = per-step fan moisture, 1 = daily gravity+bio
  plenumTopY: u32,
  _pad:       u32,
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> material:         array<u32>;
@group(0) @binding(2) var<storage, read_write> moisture:   array<f32>;
@group(0) @binding(3) var<storage, read> moistureRemoval:  array<f32>;
@group(0) @binding(4) var<storage, read> temp:             array<f32>;
@group(0) @binding(5) var<storage, read_write> materialAge: array<f32>;

fn cellIdx(x: u32, y: u32, z: u32) -> u32 {
  return y * u.nz * u.nx + z * u.nx + x;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u.totalCells) { return; }
  if (material[i] != MAT_COMPOST) { return; }

  if (u.mode == 0u) {
    // Per-timestep: apply fan-driven moisture change
    let removal = moistureRemoval[i];
    if (removal != 0.0) {
      moisture[i] = clamp(moisture[i] - removal * u.dt, 0.0, 1.0);
    }
    return;
  }

  // Mode 1: daily update

  // Recover 3D coords
  let y = i / (u.nz * u.nx);
  let rem = i % (u.nz * u.nx);
  let z = rem / u.nx;
  let x = rem % u.nx;

  // Gravity drainage: excess above 0.65 FC drains downward
  let m = moisture[i];
  if (m > 0.65 && y > u.plenumTopY + 1u) {
    let excess = (m - 0.65) * 0.1;
    moisture[i] -= excess;

    // Add to cell below if it's compost
    let belowIdx = cellIdx(x, y - 1u, z);
    if (material[belowIdx] == MAT_COMPOST) {
      // Atomic add not available for f32 in WGSL — approximate with direct write.
      // Acceptable because drainage per cell is small and columns don't overlap.
      moisture[belowIdx] = min(1.0, moisture[belowIdx] + excess);
    }
  }

  // Bio water production: active decomposition adds ~0.5% FC/day
  if (temp[i] > 80.0) {
    moisture[i] = min(1.0, moisture[i] + 0.005);
  }

  // Age material by 1 day
  materialAge[i] += 1.0;
}
