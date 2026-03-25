/**
 * Smoke test for grid initialization and plenum seal.
 * Run with: npx tsx test/particles.smoke.ts
 */

import { CompostGrid, initializeGrid, MATERIAL_FROM_CODE } from '../src/core/types/CompostGrid';
import { createDefaultConfig } from '../src/core/types/SimulationConfig';

const config = createDefaultConfig();
const grid = new CompostGrid(config);
initializeGrid(grid, config);

const scale = config.resolution / 12;
const plenumCellsY = Math.ceil(config.pile.plenumHeight / config.resolution);
const sealCells = 1; // edge seal width

console.log('=== Particle System Smoke Test ===\n');
console.log(`  Grid: ${grid.nx}x${grid.ny}x${grid.nz}, scale=${scale.toFixed(3)} ft/cell`);
console.log(`  Plenum: ${plenumCellsY} cells high, seal: ${sealCells} cell`);

// --- Test 1: Plenum edge seal ---
console.log('\n--- Test 1: Plenum edge seal ---');
let edgeAirCells = 0;
let edgeCompostCells = 0;
let interiorAirCells = 0;

for (let y = 0; y < plenumCellsY; y++) {
  for (let z = 0; z < grid.nz; z++) {
    for (let x = 0; x < grid.nx; x++) {
      const i = grid.idx(x, y, z);
      const mat = MATERIAL_FROM_CODE[grid.material[i]];
      const isEdge = x < sealCells || x >= grid.nx - sealCells ||
                     z < sealCells || z >= grid.nz - sealCells;
      if (isEdge && mat === 'air') edgeAirCells++;
      if (isEdge && mat === 'compost') edgeCompostCells++;
      if (!isEdge && mat === 'air') interiorAirCells++;
    }
  }
}

console.log(`  Edge air cells (should be 0): ${edgeAirCells}`);
console.log(`  Edge compost cells (should be >0): ${edgeCompostCells}`);
console.log(`  Interior air cells (should be >0): ${interiorAirCells}`);

// --- Test 2: No log cells in grid (logs are external) ---
console.log('\n--- Test 2: No log cells in grid ---');
let logCells = 0;
for (let i = 0; i < grid.totalCells; i++) {
  if (MATERIAL_FROM_CODE[grid.material[i]] === 'log') logCells++;
}
console.log(`  Log cells (should be 0): ${logCells}`);

// --- Test 3: Compost fills full footprint above plenum ---
console.log('\n--- Test 3: Compost at full footprint ---');
const testY = plenumCellsY; // first compost layer (at plenum top, full footprint)
let compostAtEdge = MATERIAL_FROM_CODE[grid.material[grid.idx(0, testY, grid.nz / 2)]];
let compostAtCenter = MATERIAL_FROM_CODE[grid.material[grid.idx(grid.nx / 2, testY, grid.nz / 2)]];
console.log(`  Edge cell (0,${testY},${grid.nz/2}): ${compostAtEdge}`);
console.log(`  Center cell (${grid.nx/2},${testY},${grid.nz/2}): ${compostAtCenter}`);

// --- Test 4: Pipe at center ---
console.log('\n--- Test 4: Pipe position ---');
const pipeCenterX = Math.round(config.aeration.pipePosition.x / config.resolution);
const pipeCenterZ = Math.round(config.aeration.pipePosition.z / config.resolution);
const pipeMat = MATERIAL_FROM_CODE[grid.material[grid.idx(pipeCenterX, 0, pipeCenterZ)]];
console.log(`  Pipe center (${pipeCenterX},0,${pipeCenterZ}): ${pipeMat}`);

// --- Validation ---
console.log('\n=== Validation ===');
const checks = [
  { name: 'No air cells at plenum edge (sealed)', pass: edgeAirCells === 0 },
  { name: 'Compost cells at plenum edge (curls under)', pass: edgeCompostCells > 0 },
  { name: 'Air cells in plenum interior (cavity exists)', pass: interiorAirCells > 0 },
  { name: 'No log cells in grid (logs are external)', pass: logCells === 0 },
  { name: 'Compost at grid edge above plenum', pass: compostAtEdge === 'compost' },
  { name: 'Compost at center above plenum', pass: compostAtCenter === 'compost' },
  { name: 'Pipe at center of plenum', pass: pipeMat === 'pipe' },
];

let allPass = true;
for (const c of checks) {
  console.log(`  ${c.pass ? 'PASS' : 'FAIL'}: ${c.name}`);
  if (!c.pass) allPass = false;
}

console.log(`\n${allPass ? 'All checks passed!' : 'Some checks FAILED.'}`);
