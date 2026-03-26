/**
 * Unit tests for psychrometric functions.
 * Reference values from ASHRAE Fundamentals and engineering tables.
 * Run with: npx tsx test/psychrometrics.test.ts
 */

import {
  saturationPressureKpa,
  saturationHumidityRatio,
  humidityRatioFromRH,
  airDensity,
  airViscosity,
  airConductivity,
  gnielinskiHv,
  moistureAvailability,
  wm3kToBtuFt3F,
} from '../src/core/engine/psychrometrics';

let passed = 0;
let failed = 0;

function assertClose(actual: number, expected: number, tolerance: number, label: string): void {
  const relErr = Math.abs(actual - expected) / Math.max(Math.abs(expected), 1e-10);
  if (relErr <= tolerance) {
    passed++;
  } else {
    failed++;
    console.log(`  FAIL: ${label} — got ${actual.toFixed(6)}, expected ${expected.toFixed(6)} (${(relErr * 100).toFixed(2)}% off)`);
  }
}

function assertEqual(actual: number, expected: number, label: string): void {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    console.log(`  FAIL: ${label} — got ${actual}, expected ${expected}`);
  }
}

console.log('=== Psychrometrics Unit Tests ===\n');

// --- Saturation vapor pressure (Buck equation) ---
// Reference: engineering steam tables
console.log('saturationPressureKpa:');
assertClose(saturationPressureKpa(32), 0.611, 0.01, '32°F (0°C) → 0.611 kPa');
assertClose(saturationPressureKpa(212), 101.325, 0.02, '212°F (100°C) → 101.325 kPa');
assertClose(saturationPressureKpa(77), 3.169, 0.02, '77°F (25°C) → 3.169 kPa');
assertClose(saturationPressureKpa(140), 19.93, 0.02, '140°F (60°C) → 19.93 kPa');

// --- Saturation humidity ratio ---
// Reference: ASHRAE psychrometric chart
console.log('saturationHumidityRatio:');
assertClose(saturationHumidityRatio(77), 0.0200, 0.05, '77°F → w_sat ≈ 0.020');
assertClose(saturationHumidityRatio(140), 0.152, 0.05, '140°F → w_sat ≈ 0.152');
assertClose(saturationHumidityRatio(32), 0.00378, 0.05, '32°F → w_sat ≈ 0.0038');

// --- Humidity ratio from RH ---
console.log('humidityRatioFromRH:');
assertClose(humidityRatioFromRH(77, 0.50), 0.0100, 0.05, '77°F 50% RH → w ≈ 0.010');
assertClose(humidityRatioFromRH(77, 1.0), saturationHumidityRatio(77), 0.001, '100% RH = saturation');
assertEqual(humidityRatioFromRH(77, 0), 0, '0% RH → w = 0');

// --- Air density ---
// Reference: standard air at sea level
console.log('airDensity:');
assertClose(airDensity(59, 0), 1.225, 0.02, '59°F (15°C) dry → 1.225 kg/m³');
assertClose(airDensity(140, 0), 1.059, 0.02, '140°F (60°C) dry → ~1.06 kg/m³ (ideal gas)');
// Moist air is lighter than dry air (water vapor is lighter than N2/O2)
const dryRho = airDensity(77, 0);
const moistRho = airDensity(77, 0.01);
if (moistRho < dryRho) { passed++; } else { failed++; console.log('  FAIL: moist air should be lighter than dry air'); }

// --- Air viscosity (Sutherland) ---
// Reference: ~1.81e-5 Pa·s at 15°C
console.log('airViscosity:');
assertClose(airViscosity(59), 1.81e-5, 0.02, '59°F (15°C) → ~1.81e-5 Pa·s');
assertClose(airViscosity(212), 2.17e-5, 0.03, '212°F (100°C) → ~2.17e-5 Pa·s');

// --- Air conductivity ---
// Reference: ~0.0257 W/(m·K) at 25°C
console.log('airConductivity:');
assertClose(airConductivity(77), 0.0257, 0.03, '77°F (25°C) → ~0.0257 W/(m·K)');

// --- Gnielinski h_v ---
// At Re=20, Pr=0.71, eps=0.45, d_p=0.02m, f_a=1.6, k_air=0.028 W/(m·K)
// Re_sup=9 → Re_part=20, Nu≈7.5, h≈10.5 W/(m²·K), a_v=165, h_v≈1737 W/(m³·K)≈30.6 BTU
console.log('gnielinskiHv:');
const hvSI = gnielinskiHv(9, 0.71, 0.45, 0.02, 1.6, 0.028); // reSup=9, rePart=9/0.45=20
const hvBtu = wm3kToBtuFt3F(hvSI);
assertClose(hvBtu, 30.6, 0.05, 'Re_sup=9 (Re_part=20), d_p=20mm → h_v ≈ 30.6 BTU/(hr·ft³·°F)');

// h_v should increase with smaller particles (more surface area)
const hvSmall = gnielinskiHv(10 * 0.45, 0.71, 0.45, 0.01, 1.6, 0.028);
const hvLarge = gnielinskiHv(10 * 0.45, 0.71, 0.45, 0.04, 1.6, 0.028);
if (hvSmall > hvLarge) { passed++; } else { failed++; console.log('  FAIL: smaller particles should give higher h_v'); }

// h_v should be positive
if (hvSI > 0) { passed++; } else { failed++; console.log('  FAIL: h_v must be positive'); }

// --- Moisture availability ---
console.log('moistureAvailability:');
assertEqual(moistureAvailability(0.60, 0.55), 1.0, 'above critical → 1.0');
assertEqual(moistureAvailability(0.55, 0.55), 1.0, 'at critical → 1.0');
assertEqual(moistureAvailability(0.30, 0.55), 0.0, 'at dead → 0.0');
assertEqual(moistureAvailability(0.20, 0.55), 0.0, 'below dead → 0.0');
assertClose(moistureAvailability(0.425, 0.55), 0.5, 0.001, 'midpoint → 0.5');

// --- Summary ---
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
