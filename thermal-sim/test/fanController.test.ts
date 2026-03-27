/**
 * Unit tests for fan controller demand signals and orchestrator.
 * Validates hysteresis behavior, demand curves, and combined output.
 * Run: npx tsx test/fanController.test.ts
 */
import {
  computeCoolingDemand, computeOxygenDemand, computeMoistureProtection,
  computeColdProtection, computeFanControl, createControllerState,
  type FanControllerState,
} from '../src/core/engine/fanController';
import type { StepSnapshot } from '../src/core/engine/tickStep';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) { passed++; }
  else { failed++; console.log(`  FAIL: ${label}`); }
}

function assertRange(val: number, min: number, max: number, label: string): void {
  if (val >= min && val <= max) { passed++; }
  else { failed++; console.log(`  FAIL: ${label} — got ${val.toFixed(4)}, expected [${min}, ${max}]`); }
}

function assertClose(val: number, expected: number, tolerance: number, label: string): void {
  if (Math.abs(val - expected) <= tolerance) { passed++; }
  else { failed++; console.log(`  FAIL: ${label} — got ${val.toFixed(4)}, expected ${expected.toFixed(4)} ±${tolerance}`); }
}

/** Build a minimal snapshot for controller testing */
function makeSnapshot(overrides: Partial<StepSnapshot> = {}): StepSnapshot {
  return {
    timeHours: 0, coreTemp: 120, surfaceTemp: 100, avgTemp: 110,
    totalHeatGen: 500, avgOxygen: 0.15, avgMoisture: 0.55,
    fanOn: true, weightLbs: 500, volumeFt3: 15, avgBioActivity: 0.5,
    ambientTemp: 75, dutyCycle: 0.13,
    ...overrides,
  };
}

console.log('=== Fan Controller Tests ===\n');

// --- Cooling demand ---
console.log('Cooling demand:');
{
  // Below deactivate threshold: zero demand
  assertClose(computeCoolingDemand(130, false), 0, 0.001, 'Below 135F inactive → 0');
  assertClose(computeCoolingDemand(130, true), 0, 0.001, 'Below 135F active → 0');

  // Above activate threshold: full demand
  assertClose(computeCoolingDemand(150, false), 1.0, 0.001, 'Above 145F → 1.0');
  assertClose(computeCoolingDemand(150, true), 1.0, 0.001, 'Above 145F active → 1.0');

  // In hysteresis band, inactive: stays off
  assertClose(computeCoolingDemand(140, false), 0, 0.001, 'Hysteresis band, inactive → 0');

  // In hysteresis band, active: ramps proportionally
  assertClose(computeCoolingDemand(140, true), 0.5, 0.001, 'Hysteresis band, active, 140F → 0.5');
  assertClose(computeCoolingDemand(135, true), 0, 0.001, 'Hysteresis band, active, 135F → 0');
}

// --- Oxygen demand ---
console.log('Oxygen demand:');
{
  // Above deactivate threshold (healthy O2): zero demand
  assertClose(computeOxygenDemand(0.15, false), 0, 0.001, 'O2=15% → 0');

  // Below activate threshold (O2 depleted): full demand
  assertClose(computeOxygenDemand(0.05, false), 1.0, 0.001, 'O2=5% → 1.0');

  // In hysteresis band, inactive: stays off
  assertClose(computeOxygenDemand(0.10, false), 0, 0.001, 'O2=10% inactive → 0');

  // In hysteresis band, active: ramps
  assertClose(computeOxygenDemand(0.10, true), 0.5, 0.001, 'O2=10% active → 0.5');
}

// --- Moisture protection ---
console.log('Moisture protection:');
{
  // Wet pile: no protection
  assertClose(computeMoistureProtection(0.60, false), 0, 0.001, 'Moist=60% → 0');

  // Dry pile: full protection
  assertClose(computeMoistureProtection(0.40, false), 1.0, 0.001, 'Moist=40% → 1.0');

  // In band, active: ramps
  assertClose(computeMoistureProtection(0.485, true), 0.5, 0.001, 'Moist=48.5% active → 0.5');
}

// --- Cold protection ---
console.log('Cold protection:');
{
  // Warm: no protection
  assertClose(computeColdProtection(75), 0, 0.001, 'Ambient 75F → 0');
  assertClose(computeColdProtection(40), 0, 0.001, 'Ambient 40F → 0');

  // Cold: full protection
  assertClose(computeColdProtection(10), 1.0, 0.001, 'Ambient 10F → 1.0');
  assertClose(computeColdProtection(-5), 1.0, 0.001, 'Ambient -5F → 1.0');

  // Mid-range: linear ramp
  assertClose(computeColdProtection(25), 0.5, 0.001, 'Ambient 25F → 0.5');
}

// --- Orchestrator: idle conditions ---
console.log('Orchestrator — idle:');
{
  const state = createControllerState();
  const snap = makeSnapshot({ coreTemp: 120, avgOxygen: 0.15, avgMoisture: 0.55, ambientTemp: 75 });
  const output = computeFanControl(snap, state);

  // All demands near zero → minimal fan settings
  assert(output.dominantConcern === 'idle', 'Idle conditions → idle concern');
  assertRange(output.onSeconds, 15, 30, 'Idle → near-minimum on time');
  assertRange(output.offSeconds, 3000, 3600, 'Idle → near-maximum off time');
  assertRange(output.gateOpening, 0.10, 0.15, 'Idle → near-minimum gate');
}

// --- Orchestrator: hot pile needs cooling ---
console.log('Orchestrator — cooling demand:');
{
  const state = createControllerState();
  const snap = makeSnapshot({ coreTemp: 155, avgOxygen: 0.15, avgMoisture: 0.55, ambientTemp: 75 });
  const output = computeFanControl(snap, state);

  assert(output.dominantConcern === 'cooling', 'Hot pile → cooling concern');
  assertRange(output.onSeconds, 100, 120, 'Hot → near-maximum on time');
  assertRange(output.offSeconds, 120, 300, 'Hot → near-minimum off time');
  assertRange(output.gateOpening, 0.50, 0.60, 'Hot → wide gate');
}

// --- Orchestrator: O2 depleted ---
console.log('Orchestrator — O2 demand:');
{
  const state = createControllerState();
  const snap = makeSnapshot({ coreTemp: 120, avgOxygen: 0.04, avgMoisture: 0.55, ambientTemp: 75 });
  const output = computeFanControl(snap, state);

  assert(output.dominantConcern === 'oxygen', 'Low O2 → oxygen concern');
  assertRange(output.onSeconds, 100, 120, 'Low O2 → near-maximum on time');
}

// --- Orchestrator: hot AND dry → cooling attenuated by moisture protection ---
console.log('Orchestrator — competing demands:');
{
  const state = createControllerState();
  // First tick at hot+wet to activate cooling
  computeFanControl(makeSnapshot({ coreTemp: 150, avgOxygen: 0.15, avgMoisture: 0.55, ambientTemp: 75 }), state);
  // Second tick: moisture drops
  const snap = makeSnapshot({ coreTemp: 150, avgOxygen: 0.15, avgMoisture: 0.40, ambientTemp: 75 });
  const output = computeFanControl(snap, state);

  // Should still cool but at reduced intensity
  assertRange(output.onSeconds, 35, 80, 'Hot+dry → attenuated on time (between idle and max)');
  assert(output.onSeconds < 120, 'Hot+dry → on time less than pure cooling');
}

// --- Orchestrator: cold winter → reduced fan ---
console.log('Orchestrator — cold protection:');
{
  const state = createControllerState();
  const snap = makeSnapshot({ coreTemp: 120, avgOxygen: 0.15, avgMoisture: 0.55, ambientTemp: 5 });
  const output = computeFanControl(snap, state);

  assert(output.dominantConcern === 'cold_protect', 'Very cold → cold_protect concern');
  assertRange(output.onSeconds, 15, 30, 'Cold → minimal on time');
}

// --- Hysteresis: state persists across calls ---
console.log('Hysteresis persistence:');
{
  const state = createControllerState();

  // Activate cooling (above 145)
  computeFanControl(makeSnapshot({ coreTemp: 150 }), state);
  assert(state.coolingActive === true, 'Cooling activates at 150F');

  // Drop to hysteresis band (135-145): should stay active
  computeFanControl(makeSnapshot({ coreTemp: 140 }), state);
  assert(state.coolingActive === true, 'Cooling stays active at 140F (hysteresis)');

  // Drop below deactivate (135): should deactivate
  computeFanControl(makeSnapshot({ coreTemp: 130 }), state);
  assert(state.coolingActive === false, 'Cooling deactivates at 130F');

  // Rise back to hysteresis band: should NOT reactivate
  computeFanControl(makeSnapshot({ coreTemp: 140 }), state);
  assert(state.coolingActive === false, 'Cooling stays off at 140F after deactivation');
}

// --- Summary ---
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
