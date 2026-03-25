/**
 * Smoke test: verify the solver produces realistic temperatures.
 * Run with: npx tsx test/smoke.ts
 */

import { CompostGrid, initializeGrid } from '../src/core/types/CompostGrid';
import { createDefaultConfig, type SimulationConfig } from '../src/core/types/SimulationConfig';
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

// Scenario 4: Winter (20F ambient, with straw)
console.log('\nScenario 4: Winter 20F + Straw');
const winterStraw = runScenario('Winter 20F + Straw', {
  ambientTemp: 20, groundTemp: 35, hasStraw: true,
});

// Validation checks
console.log('\n=== Validation ===');
const checks = [
  { name: 'Summer core reaches thermophilic (>131F)', pass: summer.coreTemp > 131 },
  { name: 'Spring core reached mesophilic during week (>100F)', pass: spring.coreTemp > 80 },
  { name: 'Winter no-straw core cooling (declining from 100F)', pass: winter.coreTemp < winter.avgTemp + 80 },
  { name: 'Winter straw core stays warm (>100F)', pass: winterStraw.coreTemp > 100 },
  { name: 'O2 stays above anaerobic threshold (>0.03)', pass: summer.avgOxygen > 0.03 },
  { name: 'Moisture stays in viable range (0.3-0.8)', pass: summer.avgMoisture > 0.3 && summer.avgMoisture < 0.8 },
];

let allPass = true;
for (const c of checks) {
  console.log(`  ${c.pass ? 'PASS' : 'FAIL'}: ${c.name}`);
  if (!c.pass) allPass = false;
}

console.log(`\n${allPass ? 'All checks passed!' : 'Some checks FAILED — solver needs tuning.'}`);
