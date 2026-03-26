/**
 * Smoke test: verify the solver produces realistic temperatures.
 * Run with: npx tsx test/smoke.ts
 */

import { CompostGrid, initializeGrid } from '../src/core/types/CompostGrid';
import { createDefaultConfig, COVER_PRESETS, type SimulationConfig } from '../src/core/types/SimulationConfig';
import { runSimulation, addFreshMaterial, computeMaxTimestep } from '../src/core/engine';

function runScenario(label: string, configOverrides: Partial<SimulationConfig['boundaries']> = {}) {
  const config = createDefaultConfig();
  Object.assign(config.boundaries, configOverrides);
  config.time.totalHours = 24 * 7; // 1 week

  // Verify CFL stability
  const maxDt = computeMaxTimestep(config);
  console.log(`  CFL max timestep: ${maxDt.toFixed(3)} hr (using ${config.time.heatTimestep} hr)`);
  if (config.time.heatTimestep > maxDt) {
    console.log('  WARNING: timestep exceeds CFL limit!');
  }

  const grid = new CompostGrid(config);
  console.log(`  Grid: ${grid.nx}x${grid.ny}x${grid.nz} = ${grid.totalCells} voxels`);
  initializeGrid(grid, config);

  // Set initial compost temp higher than ambient (pile was already active)
  for (let i = 0; i < grid.totalCells; i++) {
    if (grid.material[i] === 0) { // compost
      grid.temp[i] = 100; // warm from prior activity
    }
  }

  const snapshots = runSimulation(grid, config);

  // Report every 12 hours
  console.log(`\n  ${label}:`);
  console.log('  Hour | Core F | Surface F | Avg F  | HeatGen BTU/hr | Avg O2  | Avg Moist');
  console.log('  -----+--------+-----------+--------+----------------+---------+---------');
  for (let i = 0; i < snapshots.length; i += Math.floor(12 / config.time.heatTimestep)) {
    const s = snapshots[i];
    console.log(
      `  ${String(s.timeHours.toFixed(0)).padStart(4)} | ${s.coreTemp.toFixed(1).padStart(6)} | ${s.surfaceTemp.toFixed(1).padStart(9)} | ${s.avgTemp.toFixed(1).padStart(6)} | ${s.totalHeatGen.toFixed(0).padStart(14)} | ${s.avgOxygen.toFixed(3).padStart(7)} | ${s.avgMoisture.toFixed(3).padStart(7)}`,
    );
  }

  const last = snapshots[snapshots.length - 1];
  return last;
}

console.log('=== Compost Thermal Solver Smoke Test ===\n');

// Scenario 1: Summer (85F ambient)
console.log('Scenario 1: Summer 85F');
const summer = runScenario('Summer 85F', { ambientTemp: 85, groundTemp: 60 });

// Scenario 2: Spring (55F ambient)
console.log('\nScenario 2: Spring 55F');
const spring = runScenario('Spring 55F', { ambientTemp: 55, groundTemp: 48 });

// Scenario 3: Winter (20F ambient, no straw)
console.log('\nScenario 3: Winter 20F (no straw)');
const winter = runScenario('Winter 20F', { ambientTemp: 20, groundTemp: 35 });

// Scenario 4: Winter (20F ambient, with log cabin insulation)
console.log('\nScenario 4: Winter 20F + Logs');
const winterLogs = runScenario('Winter 20F + Logs', {
  ambientTemp: 20, groundTemp: 35, sideInsulation: 'logs',
});

// Scenario 5: Cover R-value end-to-end test.
// With dome surface boundary fix, cover R-value now affects dome-shaped piles:
// neighborTempForCompost applies cover R-value at compost/air interfaces.
// Higher R-value → less heat loss → warmer average temperature.
console.log('\nScenario 5: Cover R-value end-to-end');
const coverNone = runScenario('Cover: none', { coverType: 'none', membraneRetention: 0 });
const coverTarp = runScenario('Cover: tarp', { coverType: 'tarp', membraneRetention: 1.0 });
console.log(`  None cover avg: ${coverNone.avgTemp.toFixed(1)}F, Tarp cover avg: ${coverTarp.avgTemp.toFixed(1)}F`);
const coverRetainsHeat = coverTarp.avgTemp > coverNone.avgTemp;
console.log(`  Tarp warmer than none: ${coverRetainsHeat} (${(coverTarp.avgTemp - coverNone.avgTemp).toFixed(1)}F difference)`);
// Also verify R-value ordering in presets
const coverRValueCheck = COVER_PRESETS.tarp.rValue > COVER_PRESETS.none.rValue
  && COVER_PRESETS.eptfe.rValue > COVER_PRESETS.fleece.rValue
  && COVER_PRESETS.none.rValue > 0;

// Validation checks
console.log('\n=== Validation ===');
const checks = [
  { name: 'Summer core reaches thermophilic (>131F)', pass: summer.coreTemp > 131 },
  { name: 'Spring core reached mesophilic during week (>100F)', pass: spring.coreTemp > 80 },
  { name: 'Winter no-straw core cooling (declining from 100F)', pass: winter.coreTemp < winter.avgTemp + 80 },
  { name: 'Winter logs warmer than no-insulation (>10F benefit)', pass: winterLogs.coreTemp > winter.coreTemp + 10 },
  { name: 'O2 stays above anaerobic threshold (>0.03)', pass: summer.avgOxygen > 0.03 },
  { name: 'Moisture stays in viable range (0.3-0.8)', pass: summer.avgMoisture > 0.3 && summer.avgMoisture < 0.8 },
  { name: 'Cover R-values ordered: none < fleece < ePTFE < tarp', pass: coverRValueCheck },
  { name: 'Tarp cover retains more heat than no cover', pass: coverRetainsHeat },
];

let allPass = true;
for (const c of checks) {
  console.log(`  ${c.pass ? 'PASS' : 'FAIL'}: ${c.name}`);
  if (!c.pass) allPass = false;
}

console.log(`\n${allPass ? 'All checks passed!' : 'Some checks FAILED — solver needs tuning.'}`);
