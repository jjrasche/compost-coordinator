/**
 * Biological heat generation shader - one thread per cell.
 *
 * Reads temp, moisture, oxygen, materialAge per voxel.
 * Computes heat generation rate using the same piecewise-linear
 * activity curves as bioActivity.ts.
 *
 * Writes to heatSource[] buffer (BTU/(hr*ft3)).
 * Non-compost cells get zero.
 */

const MAT_COMPOST: u32 = 0u;

// --- Derived from substrate chemistry (matches bioActivity.ts) ---
// HEAT_OF_COMBUSTION_BTU_LB = 6500
// VOLATILE_SOLIDS_FRACTION = 0.88
// PEAK_VS_DECAY_PER_DAY = 0.02
// BULK_DENSITY_WET = 40, MOISTURE_WET_BASIS = 0.45
// DRY_MATTER = 40 * 0.55 = 22, VS = 22 * 0.88 = 19.36
// PEAK_HEAT_RATE = 19.36 * 0.02 * 6500 / 24 = 104.87
const PEAK_HEAT_RATE: f32 = 104.87;

struct Uniforms {
  nx:         u32,
  ny:         u32,
  nz:         u32,
  totalCells: u32,
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> material:    array<u32>;
@group(0) @binding(2) var<storage, read> temp:        array<f32>;
@group(0) @binding(3) var<storage, read> moisture:    array<f32>;
@group(0) @binding(4) var<storage, read> oxygen:      array<f32>;
@group(0) @binding(5) var<storage, read> materialAge: array<f32>;
@group(0) @binding(6) var<storage, read_write> heatSource: array<f32>;

// --- Activity factor curves (piecewise linear, matches bioActivity.ts) ---

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

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u.totalCells) { return; }

  if (material[i] != MAT_COMPOST) {
    heatSource[i] = 0.0;
    return;
  }

  heatSource[i] = PEAK_HEAT_RATE
    * tempActivityFactor(temp[i])
    * moistureActivityFactor(moisture[i])
    * oxygenActivityFactor(oxygen[i])
    * ageActivityFactor(materialAge[i]);
}
