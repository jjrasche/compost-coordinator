/**
 * Unit tests for weather client — diurnal interpolation and schedule building.
 * No network calls (tests buildWeatherSchedule only).
 * Run: npx tsx test/weatherClient.test.ts
 */
import { buildWeatherSchedule, type DailyWeatherEntry } from '../src/core/environment/weatherClient';

let passed = 0;
let failed = 0;

function assertClose(actual: number, expected: number, tolerance: number, label: string): void {
  const err = Math.abs(actual - expected);
  if (err <= tolerance) { passed++; }
  else { failed++; console.log(`  FAIL: ${label} — got ${actual.toFixed(3)}, expected ${expected.toFixed(3)} (off by ${err.toFixed(3)})`); }
}

function assert(condition: boolean, label: string): void {
  if (condition) { passed++; }
  else { failed++; console.log(`  FAIL: ${label}`); }
}

console.log('=== Weather Client Tests ===\n');

const testDays: DailyWeatherEntry[] = [
  { date: '2025-05-01', highF: 80, lowF: 50, avgRH: 0.60 },
  { date: '2025-05-02', highF: 75, lowF: 55, avgRH: 0.70 },
  { date: '2025-05-03', highF: 90, lowF: 60, avgRH: 0.40 },
];

const schedule = buildWeatherSchedule(new Date('2025-05-01'), testDays);

// --- Test 1: Diurnal temperature at peak and trough ---
console.log('Diurnal temperature cycle:');
{
  // Hour 15 (3pm) should be near daily high
  const at3pm = schedule.lookup(15); // day 0, hour 15
  assertClose(at3pm.tempF, 80, 2, 'Hour 15 (3pm) ≈ daily high (80°F)');

  // Hour 3 (3am) should be near daily low
  const at3am = schedule.lookup(3); // day 0, hour 3
  assertClose(at3am.tempF, 50, 2, 'Hour 3 (3am) ≈ daily low (50°F)');

  // Hour 9 should be between low and high
  const at9am = schedule.lookup(9);
  assert(at9am.tempF > 50 && at9am.tempF < 80, `Hour 9 between low and high: ${at9am.tempF.toFixed(1)}°F`);
}

// --- Test 2: RH inversely correlates with temperature ---
console.log('\nRH inverse correlation:');
{
  const hot = schedule.lookup(15); // peak temp
  const cold = schedule.lookup(3); // trough temp
  assert(hot.rh < cold.rh, `RH at peak temp (${hot.rh.toFixed(2)}) < RH at trough (${cold.rh.toFixed(2)})`);
}

// --- Test 3: Day transitions ---
console.log('\nDay transitions:');
{
  // Hour 24 = day 1 midnight, hour 39 = day 1 at 3pm
  const day1_3pm = schedule.lookup(24 + 15);
  assertClose(day1_3pm.tempF, 75, 2, 'Day 1 hour 15 ≈ day 1 high (75°F)');

  const day2_3pm = schedule.lookup(48 + 15);
  assertClose(day2_3pm.tempF, 90, 2, 'Day 2 hour 15 ≈ day 2 high (90°F)');
}

// --- Test 4: Beyond data range falls back to last day ---
console.log('\nBeyond data range:');
{
  const beyondDay = schedule.lookup(72 + 15); // day 3, no data
  assert(beyondDay.tempF > 50 && beyondDay.tempF < 100, `Falls back gracefully: ${beyondDay.tempF.toFixed(1)}°F`);
}

// --- Test 5: RH bounds ---
console.log('\nRH stays in [0.1, 1.0]:');
{
  for (let h = 0; h < 72; h++) {
    const { rh } = schedule.lookup(h);
    if (rh < 0.1 || rh > 1.0) {
      failed++;
      console.log(`  FAIL: Hour ${h} RH out of bounds: ${rh}`);
      break;
    }
  }
  passed++;
}

// --- Summary ---
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
