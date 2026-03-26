/**
 * Column sweep convection — one thread per (x,z) column.
 *
 * Each thread sweeps upward from plenumTopY, computing Gnielinski heat transfer
 * and Lewis-analogy moisture transfer at each compost cell. Air state evolves
 * cell-to-cell (serial within column, parallel across columns).
 *
 * Outputs: fanCooling (F/hr) and moistureRemoval (FC/hr) per cell.
 *
 * Psychrometric functions translated from psychrometrics.ts:
 *   - Buck equation for saturation pressure
 *   - Sutherland's law for air viscosity
 *   - Gnielinski packed-bed correlation for h_v
 */

const MAT_COMPOST: u32 = 0u;

// Physical constants
const P_ATM_KPA:        f32 = 101.325;
const R_AIR:            f32 = 287.05;    // J/(kg*K)
const C_P_AIR_SI:       f32 = 1006.0;    // J/(kg*K)
const CP_AIR_BTU:       f32 = 0.24;      // BTU/(lb*F)
const H_FG_BTU_PER_LB:  f32 = 1000.0;
const KG_M3_TO_LB_FT3:  f32 = 0.06243;
const F_A:              f32 = 1.6;       // Gnielinski shape factor
const DEAD_MOISTURE_FC:  f32 = 0.30;
const WM3K_TO_BTU:      f32 = 0.01761;   // W/(m3*K) -> BTU/(hr*ft3*F)

struct Uniforms {
  nx:               u32,
  ny:               u32,
  nz:               u32,
  totalCells:       u32,
  plenumTopY:       u32,
  _pad1:            u32,
  _pad2:            u32,
  _pad3:            u32,
  ambientTempF:     f32,
  ambientHumidity:  f32,   // humidity ratio (lb/lb)
  dutyCycle:        f32,
  porosity:         f32,
  dP_m:             f32,   // particle diameter (meters)
  vSupMs:           f32,   // superficial velocity (m/s)
  massFlowLbHr:     f32,   // per-column mass flow
  cellVolFt3:       f32,
  waterPerCellLb:   f32,
  criticalMoisture: f32,
  membraneRetention: f32,
  rhoCCompost:      f32,   // bulk density * specific heat (BTU/(ft3*F))
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> material:  array<u32>;
@group(0) @binding(2) var<storage, read> temp:      array<f32>;
@group(0) @binding(3) var<storage, read> moisture:  array<f32>;
@group(1) @binding(0) var<storage, read_write> fanCooling:      array<f32>;
@group(1) @binding(1) var<storage, read_write> moistureRemoval: array<f32>;

fn cellIdx(x: u32, y: u32, z: u32) -> u32 {
  return y * u.nz * u.nx + z * u.nx + x;
}

// --- Psychrometric functions ---

fn fToC(f: f32) -> f32 { return (f - 32.0) * 5.0 / 9.0; }
fn fToK(f: f32) -> f32 { return fToC(f) + 273.15; }

// Buck equation: saturation vapor pressure (kPa)
fn satPressureKpa(tempF: f32) -> f32 {
  let T = fToC(tempF);
  if (T < 0.0) {
    return 0.611 * exp(22.46 * T / (272.62 + T));
  }
  return 0.61121 * exp((18.678 - T / 234.5) * T / (257.14 + T));
}

// Saturation humidity ratio (lb water / lb dry air)
fn satHumidityRatio(tempF: f32) -> f32 {
  let pSat = satPressureKpa(tempF);
  if (pSat >= P_ATM_KPA) { return 1.0; }
  return 0.622 * pSat / (P_ATM_KPA - pSat);
}

// Air density (kg/m3) at temperature and humidity
fn airDensity(tempF: f32, w: f32) -> f32 {
  let T_K = fToK(tempF);
  let rMix = R_AIR * (1.0 + 1.608 * w) / (1.0 + w);
  return (P_ATM_KPA * 1000.0) / (rMix * T_K);
}

// Sutherland's law: dynamic viscosity (Pa*s)
fn airViscosity(tempF: f32) -> f32 {
  let T_K = fToK(tempF);
  return 1.458e-6 * pow(T_K, 1.5) / (T_K + 110.4);
}

// Thermal conductivity of air (W/(m*K))
fn airConductivity(tempF: f32) -> f32 {
  let T_K = fToK(tempF);
  return 0.0241 * pow(T_K / 273.15, 0.81);
}

// Prandtl number
fn airPrandtl(tempF: f32) -> f32 {
  return airViscosity(tempF) * C_P_AIR_SI / airConductivity(tempF);
}

// Gnielinski packed-bed h_v (W/(m3*K)) with local air conductivity
fn gnielinskiHvLocal(reSup: f32, pr: f32, kAir: f32) -> f32 {
  let rePart = reSup / u.porosity;
  let reClamped = max(rePart, 0.1);

  let nuLam = 0.664 * pow(reClamped, 0.5) * pow(pr, 1.0 / 3.0);
  let nuTurb = 0.037 * pow(reClamped, 0.8) * pr
    / (1.0 + 2.443 * pow(reClamped, -0.1) * (pow(pr, 2.0 / 3.0) - 1.0));

  let nuSphere = 2.0 + sqrt(nuLam * nuLam + nuTurb * nuTurb);
  let nu = F_A * nuSphere;

  let h = nu * kAir / u.dP_m;
  let aV = 6.0 * (1.0 - u.porosity) / u.dP_m;
  return h * aV;
}

// Moisture availability ramp (falling-rate drying)
fn moistureAvailability(mFC: f32) -> f32 {
  if (mFC >= u.criticalMoisture) { return 1.0; }
  if (mFC <= DEAD_MOISTURE_FC)   { return 0.0; }
  return (mFC - DEAD_MOISTURE_FC) / (u.criticalMoisture - DEAD_MOISTURE_FC);
}

// --- Per-cell heat/mass transfer ---

struct AirState {
  tempF: f32,
  w:     f32,   // humidity ratio
}

struct CellResult {
  coolingFPerHr:       f32,
  moistureRemovalFCHr: f32,
  exitAir:             AirState,
}

fn computeCellTransfer(T_compost: f32, moist: f32, inletAir: AirState) -> CellResult {
  let rhoAir = airDensity(inletAir.tempF, inletAir.w);
  let muAir  = airViscosity(inletAir.tempF);
  let kAir   = airConductivity(inletAir.tempF);
  let prAir  = muAir * C_P_AIR_SI / kAir;

  // Reynolds and Gnielinski h_v
  let reSup = rhoAir * u.vSupMs * u.dP_m / muAir;
  let hvBtu = gnielinskiHvLocal(reSup, prAir, kAir) * WM3K_TO_BTU;

  // NTU efficiency
  let ntu = hvBtu * u.cellVolFt3 / (u.massFlowLbHr * CP_AIR_BTU);
  let efficiency = 1.0 - exp(-ntu);

  // Sensible heat
  let airTempNew = inletAir.tempF + (T_compost - inletAir.tempF) * efficiency;
  let qSensible = u.massFlowLbHr * CP_AIR_BTU * (airTempNew - inletAir.tempF);

  // Moisture transfer (Lewis analogy)
  let wSatCompost = satHumidityRatio(T_compost);
  var deltaW: f32;

  if (wSatCompost >= inletAir.w) {
    // Evaporation
    let avail = moistureAvailability(moist);
    deltaW = (wSatCompost - inletAir.w) * efficiency * avail;
  } else {
    // Condensation
    let wSatCond = satHumidityRatio(airTempNew);
    deltaW = -(inletAir.w - wSatCond) * efficiency;
  }

  // Cap at saturation
  var wNew = inletAir.w + deltaW;
  let wSatExit = satHumidityRatio(airTempNew);
  let cappedDeltaW = select(deltaW, wSatExit - inletAir.w, wNew > wSatExit);
  wNew = min(wNew, wSatExit);

  // Latent heat
  let waterEvapLbHr = u.massFlowLbHr * cappedDeltaW;
  let qLatent = waterEvapLbHr * H_FG_BTU_PER_LB;

  let totalCooling = qSensible + qLatent;

  var result: CellResult;
  result.coolingFPerHr = totalCooling / (u.cellVolFt3 * u.rhoCCompost);
  result.moistureRemovalFCHr = waterEvapLbHr / u.waterPerCellLb;
  result.exitAir.tempF = airTempNew;
  result.exitAir.w = wNew;
  return result;
}

// --- Main: one thread per (x,z) column ---

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let col = gid.x;
  let totalColumns = u.nx * u.nz;
  if (col >= totalColumns) { return; }

  let z = col / u.nx;
  let x = col % u.nx;

  var air: AirState;
  air.tempF = u.ambientTempF;
  air.w     = u.ambientHumidity;

  var columnEvapTotal: f32 = 0.0;
  var topCompostIdx: i32 = -1;

  // Sweep upward from plenum top
  for (var y: u32 = u.plenumTopY; y < u.ny; y = y + 1u) {
    let i = cellIdx(x, y, z);
    if (material[i] != MAT_COMPOST) { continue; }

    let result = computeCellTransfer(temp[i], moisture[i], air);

    fanCooling[i]      = result.coolingFPerHr * u.dutyCycle;
    moistureRemoval[i] = result.moistureRemovalFCHr * u.dutyCycle;
    air = result.exitAir;

    if (result.moistureRemovalFCHr > 0.0) {
      columnEvapTotal += result.moistureRemovalFCHr * u.dutyCycle;
    }
    topCompostIdx = i32(i);
  }

  // Membrane retention: condensate drips back to top cell
  if (u.membraneRetention > 0.0 && columnEvapTotal > 0.0 && topCompostIdx >= 0) {
    let retainedFCHr = columnEvapTotal * u.membraneRetention;
    let idx = u32(topCompostIdx);
    moistureRemoval[idx] -= retainedFCHr;

    // Latent heat credit from condensation
    let retainedWaterLbHr = retainedFCHr * u.waterPerCellLb;
    let latentReturnBtuHr = retainedWaterLbHr * H_FG_BTU_PER_LB;
    fanCooling[idx] -= latentReturnBtuHr / (u.cellVolFt3 * u.rhoCCompost);
  }
}
