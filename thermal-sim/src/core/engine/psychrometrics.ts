/**
 * Psychrometric functions for air-water vapor calculations.
 *
 * All temperatures in Fahrenheit (converted internally to Celsius).
 * Pressures in kPa. Humidity ratios in lb water / lb dry air.
 */

const P_ATM_KPA = 101.325;
const R_AIR = 287.05; // J/(kg·K) — specific gas constant for dry air
const C_P_AIR = 1006; // J/(kg·K) — specific heat of dry air (nearly constant)
const H_FG = 2_260_000; // J/kg — latent heat of vaporization (~1000 BTU/lb)

// --- Temperature conversion ---

function fToC(f: number): number {
  return (f - 32) * 5 / 9;
}

function fToK(f: number): number {
  return fToC(f) + 273.15;
}

// --- Saturation vapor pressure: Buck equation ---
// Valid 0-100°C, accuracy ±0.02% over that range.

export function saturationPressureKpa(tempF: number): number {
  const T = fToC(tempF);
  if (T < 0) return 0.611 * Math.exp(22.46 * T / (272.62 + T)); // ice
  return 0.61121 * Math.exp((18.678 - T / 234.5) * T / (257.14 + T));
}

// --- Humidity ratio at saturation ---
// w_sat = 0.622 * P_sat / (P_atm - P_sat)

export function saturationHumidityRatio(tempF: number): number {
  const pSat = saturationPressureKpa(tempF);
  if (pSat >= P_ATM_KPA) return 1.0; // boiling — fully saturated
  return 0.622 * pSat / (P_ATM_KPA - pSat);
}

// --- Humidity ratio from temperature and relative humidity ---

export function humidityRatioFromRH(tempF: number, rh: number): number {
  return saturationHumidityRatio(tempF) * rh;
}

// --- Air density (kg/m³) at temperature, accounting for humidity ---
// Uses ideal gas law for moist air: ρ = P / (R_mix * T)
// R_mix = R_air * (1 + 1.608 * w) / (1 + w)

export function airDensity(tempF: number, w: number = 0): number {
  const T_K = fToK(tempF);
  const rMix = R_AIR * (1 + 1.608 * w) / (1 + w);
  return (P_ATM_KPA * 1000) / (rMix * T_K);
}

// --- Dynamic viscosity of air (Pa·s) — Sutherland's law ---

export function airViscosity(tempF: number): number {
  const T_K = fToK(tempF);
  return 1.458e-6 * Math.pow(T_K, 1.5) / (T_K + 110.4);
}

// --- Thermal conductivity of air (W/(m·K)) ---

export function airConductivity(tempF: number): number {
  const T_K = fToK(tempF);
  return 0.0241 * Math.pow(T_K / 273.15, 0.81);
}

// --- Prandtl number of air (nearly constant ~0.71) ---

export function airPrandtl(tempF: number): number {
  const mu = airViscosity(tempF);
  const k = airConductivity(tempF);
  return mu * C_P_AIR / k;
}

// --- Gnielinski packed bed correlation (VDI Heat Atlas) ---
// Returns volumetric heat transfer coefficient h_v in W/(m³·K)
//
// Inputs:
//   reSup — superficial Reynolds number: ρ * v_sup * d_p / μ
//   pr    — Prandtl number
//   eps   — void fraction (porosity)
//   dP    — particle diameter in meters
//   fA    — shape factor (1.6 for cylinders/cubes/irregular, 2.1 for rings)

export function gnielinskiHv(
  reSup: number,
  pr: number,
  eps: number,
  dP: number,
  fA: number,
  kAir: number,
): number {
  // Particle Reynolds number = Re_sup / eps
  const rePart = reSup / eps;

  const nuLam = 0.664 * Math.pow(Math.max(rePart, 0.1), 0.5) * Math.pow(pr, 1 / 3);

  const reClamped = Math.max(rePart, 0.1);
  const nuTurb = 0.037 * Math.pow(reClamped, 0.8) * pr
    / (1 + 2.443 * Math.pow(reClamped, -0.1) * (Math.pow(pr, 2 / 3) - 1));

  const nuSphere = 2 + Math.sqrt(nuLam * nuLam + nuTurb * nuTurb);
  const nu = fA * nuSphere;

  // Surface heat transfer coefficient h [W/(m²·K)]
  const h = nu * kAir / dP;

  // Specific surface area a_v [m²/m³] for packed bed
  const aV = 6 * (1 - eps) / dP;

  return h * aV;
}

// --- Moisture availability factor ---
// Ramps evaporation down as compost dries below critical moisture content.
// Above criticalMoisture: constant-rate drying (availability = 1.0)
// Between deadMoisture and critical: falling-rate (linear ramp)
// Below deadMoisture: no evaporation

const DEAD_MOISTURE_FC = 0.30; // below this, no evaporation possible

export function moistureAvailability(moistureFC: number, criticalMoistureFC: number): number {
  if (moistureFC >= criticalMoistureFC) return 1.0;
  if (moistureFC <= DEAD_MOISTURE_FC) return 0.0;
  return (moistureFC - DEAD_MOISTURE_FC) / (criticalMoistureFC - DEAD_MOISTURE_FC);
}

// --- Unit conversion for interface with BTU/imperial system ---

/** W/(m³·K) to BTU/(hr·ft³·°F) */
export function wm3kToBtuFt3F(wm3k: number): number {
  return wm3k * 0.01761;
}
