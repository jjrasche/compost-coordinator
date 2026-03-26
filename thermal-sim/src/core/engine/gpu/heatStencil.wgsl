/**
 * 3D heat diffusion stencil — explicit forward Euler on compost voxels.
 *
 * One thread per grid cell. Non-compost materials are handled inline:
 *   - ground: fixed groundTemp
 *   - air: average of vertical neighbors
 *   - everything else: hold current temp
 *
 * Boundary logic matches heatDiffusion.ts:
 *   - Out-of-bounds neighbors: R-value ghost cells (cover top, insulation sides, ground bottom)
 *   - In-bounds air neighbors at dome surface: R-value weighting via neighborTempForCompost
 *   - Plenum air (below plenumTopY): raw temp, no R-value (intended airflow path)
 */

// --- Material codes (must match CompostGrid.ts) ---
const MAT_COMPOST: u32 = 0u;
const MAT_AIR:     u32 = 1u;
const MAT_GROUND:  u32 = 5u;

struct Uniforms {
  nx:          u32,
  ny:          u32,
  nz:          u32,
  totalCells:  u32,
  dt:          f32,   // hours
  dx:          f32,   // feet
  ambientTemp: f32,
  groundTemp:  f32,
  coverRValue: f32,
  sideRValue:  f32,
  plenumTopY:  u32,
  _pad:        u32,
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> material:   array<u32>;
@group(0) @binding(2) var<storage, read> moisture:    array<f32>;
@group(0) @binding(3) var<storage, read> heatSource:  array<f32>;
@group(0) @binding(4) var<storage, read> fanCooling:  array<f32>;
@group(1) @binding(0) var<storage, read> tempIn:      array<f32>;
@group(1) @binding(1) var<storage, read_write> tempOut: array<f32>;

fn cellIdx(x: u32, y: u32, z: u32) -> u32 {
  return y * u.nz * u.nx + z * u.nx + x;
}

// Compost thermal properties (moisture-dependent, matches VoxelState.ts)
fn compostDiffusivity(m: f32) -> f32 {
  let k   = 0.05 + 0.25 * m;
  let rho = 25.0 + 30.0 * m;
  let c   = 0.4  + 0.6  * m;
  return k / (rho * c);
}

fn compostRhoC(m: f32) -> f32 {
  return (25.0 + 30.0 * m) * (0.4 + 0.6 * m);
}

// R-value of one compost cell: dx_ft / k_compost
fn rCell() -> f32 {
  return u.dx / 0.15;
}

// Ghost cell temperature for out-of-bounds neighbors
fn boundaryTemp(x: i32, y: i32, z: i32) -> f32 {
  if (y < 0) { return u.groundTemp; }

  let rc = rCell();

  // Nearest valid surface cell
  let sx = u32(clamp(x, 0, i32(u.nx) - 1));
  let sy = u32(clamp(y, 0, i32(u.ny) - 1));
  let sz = u32(clamp(z, 0, i32(u.nz) - 1));
  let surfaceT = tempIn[cellIdx(sx, sy, sz)];

  if (y >= i32(u.ny)) {
    // Top: cover R-value
    let frac = u.coverRValue / (u.coverRValue + rc);
    return u.ambientTemp + (surfaceT - u.ambientTemp) * frac;
  }

  // Sides: insulation R-value
  let frac = u.sideRValue / (u.sideRValue + rc);
  return u.ambientTemp + (surfaceT - u.ambientTemp) * frac;
}

// Effective neighbor temp accounting for cover/insulation at dome surface air
fn neighborTemp(ni: u32, compostT: f32, dy: i32, neighborY: u32) -> f32 {
  let mat = material[ni];
  if (mat != MAT_AIR) { return tempIn[ni]; }

  // Plenum air: no cover, raw temperature
  if (neighborY < u.plenumTopY) { return tempIn[ni]; }

  let airT = tempIn[ni];
  let rc = rCell();

  if (dy > 0) {
    // Air above compost -> cover membrane
    let frac = u.coverRValue / (u.coverRValue + rc);
    return airT + (compostT - airT) * frac;
  }

  // Air to side or below (non-plenum) -> insulation
  let frac = u.sideRValue / (u.sideRValue + rc);
  return airT + (compostT - airT) * frac;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u.totalCells) { return; }

  let mat = material[i];

  // Recover 3D coords from flat index
  let y = i / (u.nz * u.nx);
  let rem = i % (u.nz * u.nx);
  let z = rem / u.nx;
  let x = rem % u.nx;

  // Ground: fixed temperature
  if (mat == MAT_GROUND) {
    tempOut[i] = u.groundTemp;
    return;
  }

  // Air: average of vertical neighbors
  if (mat == MAT_AIR) {
    var neighborSum: f32 = 0.0;
    var neighborCount: f32 = 0.0;
    if (y > 0u) {
      neighborSum += tempIn[cellIdx(x, y - 1u, z)];
      neighborCount += 1.0;
    }
    if (y < u.ny - 1u) {
      neighborSum += tempIn[cellIdx(x, y + 1u, z)];
      neighborCount += 1.0;
    }
    if (neighborCount > 0.0) {
      tempOut[i] = neighborSum / neighborCount;
    } else {
      tempOut[i] = u.ambientTemp + (u.groundTemp - u.ambientTemp) * 0.3;
    }
    return;
  }

  // Non-compost solids (brick, pipe, log, membrane, tarp, straw): hold temp
  if (mat != MAT_COMPOST) {
    tempOut[i] = tempIn[i];
    return;
  }

  // --- Compost: explicit FDM update ---
  let T = tempIn[i];
  let m = moisture[i];

  // 6-neighbor Laplacian with R-value boundary logic
  let ix = i32(x);
  let iy = i32(y);
  let iz = i32(z);

  let Txm = select(neighborTemp(cellIdx(x - 1u, y, z), T, 0, y),  boundaryTemp(ix - 1, iy, iz),     x == 0u);
  let Txp = select(neighborTemp(cellIdx(x + 1u, y, z), T, 0, y),  boundaryTemp(ix + 1, iy, iz),     x == u.nx - 1u);
  let Tym = select(neighborTemp(cellIdx(x, y - 1u, z), T, -1, y - 1u), boundaryTemp(ix, iy - 1, iz), y == 0u);
  let Typ = select(neighborTemp(cellIdx(x, y + 1u, z), T, 1, y + 1u), boundaryTemp(ix, iy + 1, iz), y == u.ny - 1u);
  let Tzm = select(neighborTemp(cellIdx(x, y, z - 1u), T, 0, y),  boundaryTemp(ix, iy, iz - 1),     z == 0u);
  let Tzp = select(neighborTemp(cellIdx(x, y, z + 1u), T, 0, y),  boundaryTemp(ix, iy, iz + 1),     z == u.nz - 1u);

  let laplacian = (Txm + Txp + Tym + Typ + Tzm + Tzp - 6.0 * T) / (u.dx * u.dx);

  let sourceTerm = heatSource[i] / compostRhoC(m);
  let coolTerm   = fanCooling[i];
  let alpha      = compostDiffusivity(m);

  tempOut[i] = T + u.dt * (alpha * laplacian + sourceTerm - coolTerm);
}
