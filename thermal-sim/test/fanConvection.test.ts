/**
 * Unit tests for fan convection column sweep.
 * Verifies heat/mass transfer physics with known inputs.
 * Run: npx tsx test/fanConvection.test.ts
 */
import { CompostGrid, initializeGrid, MATERIAL_CODES } from '../src/core/types/CompostGrid';
import { createDefaultConfig } from '../src/core/types/SimulationConfig';
import { computeFanCooling, computeExitAreaFt2, membraneDerating } from '../src/core/engine/fanConvection';
import type { InsulationType } from '../src/core/types/SimulationConfig';

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

console.log('=== Fan Convection Tests ===\n');

// --- Test 1: Total cooling energy is physically reasonable ---
console.log('Total cooling energy budget:');
{
  const config = createDefaultConfig();
  config.boundaries.ambientTemp = 85;
  config.boundaries.ambientRH = 0.50;
  const grid = new CompostGrid(config);
  initializeGrid(grid, config);

  // Set all compost to 140°F, 55% moisture
  for (let i = 0; i < grid.totalCells; i++) {
    if (grid.material[i] === MATERIAL_CODES.compost) {
      grid.temp[i] = 140;
      grid.moisture[i] = 0.55;
    }
  }

  const { cooling, moistureRemoval } = computeFanCooling(grid, config);

  // Sum total cooling across all cells (duty-cycle-averaged F/hr per cell)
  let totalCoolingFHr = 0;
  let totalMoistureRemoval = 0;
  let compostCells = 0;
  for (let i = 0; i < grid.totalCells; i++) {
    if (grid.material[i] === MATERIAL_CODES.compost) {
      totalCoolingFHr += cooling[i];
      totalMoistureRemoval += moistureRemoval[i];
      compostCells++;
    }
  }

  // With 5 CFM effective, 13% duty, 140°F pile, 85°F ambient:
  // Sensible: ~50 BTU/hr, Latent: ~400 BTU/hr → total ~450 BTU/hr effective
  // Spread across ~3000 cells × 0.00064 ft³ each: avg ~0.3-2 F/hr per cell
  const avgCooling = totalCoolingFHr / compostCells;
  assertRange(avgCooling, 0.05, 5.0, `Average cooling rate: ${avgCooling.toFixed(2)} F/hr`);

  // Total moisture removal should be positive (evaporation at 140F)
  assert(totalMoistureRemoval > 0, 'Net moisture removal is positive (evaporation)');

  // Bottom cells should cool more than top cells (air enters cold)
  const plenumY = Math.ceil(config.pile.plenumHeight / config.resolution);
  const midX = Math.floor(grid.nx / 2);
  const midZ = Math.floor(grid.nz / 2);

  let bottomCooling = 0;
  let topCooling = 0;
  let bottomCount = 0;
  let topCount = 0;

  for (let y = plenumY; y < grid.ny; y++) {
    const i = grid.idx(midX, y, midZ);
    if (grid.material[i] !== MATERIAL_CODES.compost) continue;
    if (y < plenumY + 5) { bottomCooling += cooling[i]; bottomCount++; }
    if (y > grid.ny - 6) { topCooling += cooling[i]; topCount++; }
  }

  if (bottomCount > 0 && topCount > 0) {
    const avgBottom = bottomCooling / bottomCount;
    const avgTop = topCooling / topCount;
    assert(avgBottom > avgTop,
      `Bottom cools more than top: ${avgBottom.toFixed(3)} > ${avgTop.toFixed(3)} F/hr`);
  }
}

// --- Test 2: Condensation in upper layers when air is saturated ---
console.log('\nCondensation behavior:');
{
  const config = createDefaultConfig();
  config.boundaries.ambientTemp = 140; // hot humid air into cool pile
  config.boundaries.ambientRH = 0.90;
  const grid = new CompostGrid(config);
  initializeGrid(grid, config);

  // Set compost to 80°F (cooler than ambient) — air should condense
  for (let i = 0; i < grid.totalCells; i++) {
    if (grid.material[i] === MATERIAL_CODES.compost) {
      grid.temp[i] = 80;
      grid.moisture[i] = 0.55;
    }
  }

  const { moistureRemoval } = computeFanCooling(grid, config);

  // Some cells should have NEGATIVE moisture removal (condensation adds moisture)
  let hasCondensation = false;
  for (let i = 0; i < grid.totalCells; i++) {
    if (grid.material[i] === MATERIAL_CODES.compost && moistureRemoval[i] < -0.0001) {
      hasCondensation = true;
      break;
    }
  }
  assert(hasCondensation, 'Condensation occurs when hot humid air meets cool compost');
}

// --- Test 3: No cooling when fan gate is closed ---
console.log('\nZero gate = zero cooling:');
{
  const config = createDefaultConfig();
  config.aeration.gateOpening = 0;
  const grid = new CompostGrid(config);
  initializeGrid(grid, config);

  for (let i = 0; i < grid.totalCells; i++) {
    if (grid.material[i] === MATERIAL_CODES.compost) grid.temp[i] = 140;
  }

  const { cooling } = computeFanCooling(grid, config);

  let maxCooling = 0;
  for (let i = 0; i < grid.totalCells; i++) maxCooling = Math.max(maxCooling, Math.abs(cooling[i]));

  // Gate closed means zero CFM, NTU is computed from zero mass flow — check for NaN/Infinity
  assert(isFinite(maxCooling), `No NaN/Infinity with zero gate: max=${maxCooling}`);
}

// --- Test 4: Membrane retention reduces net moisture loss ---
console.log('\nMembrane retention:');
{
  const configNoRetention = createDefaultConfig();
  configNoRetention.boundaries.ambientTemp = 85;
  configNoRetention.boundaries.ambientRH = 0.50;
  configNoRetention.boundaries.coverType = 'none';
  configNoRetention.boundaries.membraneRetention = 0;

  const configWithRetention = createDefaultConfig();
  configWithRetention.boundaries.ambientTemp = 85;
  configWithRetention.boundaries.ambientRH = 0.50;
  configWithRetention.boundaries.coverType = 'eptfe';
  configWithRetention.boundaries.membraneRetention = 0.75;

  // Run both with identical grids
  const gridA = new CompostGrid(configNoRetention);
  initializeGrid(gridA, configNoRetention);
  const gridB = new CompostGrid(configWithRetention);
  initializeGrid(gridB, configWithRetention);

  for (let i = 0; i < gridA.totalCells; i++) {
    if (gridA.material[i] === MATERIAL_CODES.compost) {
      gridA.temp[i] = 140;
      gridA.moisture[i] = 0.55;
      gridB.temp[i] = 140;
      gridB.moisture[i] = 0.55;
    }
  }

  const resultA = computeFanCooling(gridA, configNoRetention);
  const resultB = computeFanCooling(gridB, configWithRetention);

  let totalRemovalA = 0;
  let totalRemovalB = 0;
  for (let i = 0; i < gridA.totalCells; i++) {
    if (gridA.material[i] === MATERIAL_CODES.compost) {
      totalRemovalA += resultA.moistureRemoval[i];
      totalRemovalB += resultB.moistureRemoval[i];
    }
  }

  assert(totalRemovalA > 0, `No-retention has positive moisture removal: ${totalRemovalA.toFixed(4)}`);
  assert(totalRemovalB > 0, `With-retention has positive moisture removal: ${totalRemovalB.toFixed(4)}`);
  assert(totalRemovalB < totalRemovalA,
    `Retention reduces moisture loss: ${totalRemovalB.toFixed(4)} < ${totalRemovalA.toFixed(4)}`);

  // 75% retention should reduce net loss by roughly 40-75% (not exactly 75% because
  // retention only applies to evaporation, not condensation in upper layers)
  const reductionFrac = 1 - totalRemovalB / totalRemovalA;
  assertRange(reductionFrac, 0.20, 0.80,
    `Retention reduces loss by ${(reductionFrac * 100).toFixed(0)}% (expect 20-80%)`);
}

// --- Test 5: Retention returns latent heat to top cell ---
console.log('\nRetention latent heat return:');
{
  const configNoRetention = createDefaultConfig();
  configNoRetention.boundaries.ambientTemp = 85;
  configNoRetention.boundaries.ambientRH = 0.50;
  configNoRetention.boundaries.membraneRetention = 0;

  const configWithRetention = createDefaultConfig();
  configWithRetention.boundaries.ambientTemp = 85;
  configWithRetention.boundaries.ambientRH = 0.50;
  configWithRetention.boundaries.membraneRetention = 0.75;

  const gridA = new CompostGrid(configNoRetention);
  initializeGrid(gridA, configNoRetention);
  const gridB = new CompostGrid(configWithRetention);
  initializeGrid(gridB, configWithRetention);

  for (let i = 0; i < gridA.totalCells; i++) {
    if (gridA.material[i] === MATERIAL_CODES.compost) {
      gridA.temp[i] = 140;
      gridA.moisture[i] = 0.55;
      gridB.temp[i] = 140;
      gridB.moisture[i] = 0.55;
    }
  }

  const resultA = computeFanCooling(gridA, configNoRetention);
  const resultB = computeFanCooling(gridB, configWithRetention);

  // Find the topmost compost cell in a center column
  const midX = Math.floor(gridA.nx / 2);
  const midZ = Math.floor(gridA.nz / 2);
  let topIdx = -1;
  for (let y = gridA.ny - 1; y >= 0; y--) {
    const i = gridA.idx(midX, y, midZ);
    if (gridA.material[i] === MATERIAL_CODES.compost) { topIdx = i; break; }
  }

  if (topIdx >= 0) {
    // Top cell with retention should have LESS cooling (latent heat returned)
    assert(resultB.cooling[topIdx] < resultA.cooling[topIdx],
      `Top cell cooling reduced by retention: ${resultB.cooling[topIdx].toFixed(4)} < ${resultA.cooling[topIdx].toFixed(4)}`);
  }
}

// --- Test 6: Membrane derating pure math ---
console.log('\nMembrane derating (fan curve):');
{
  // No restriction: huge exit area → derating ≈ 1.0
  const noRestriction = membraneDerating(8, 100, 50, 0.5);
  assertRange(noRestriction, 7.9, 8.0, `Large exit area: ${noRestriction.toFixed(2)} ≈ 8 CFM`);

  // Impermeable tarp: permeance = 0 → stall
  const tarpStall = membraneDerating(8, 10, 0, 0.5);
  assert(tarpStall === 0, `Tarp (permeance=0) stalls fan: ${tarpStall}`);

  // Zero gate → zero regardless
  const zeroGate = membraneDerating(0, 10, 3, 0.5);
  assert(zeroGate === 0, `Zero gate flow: ${zeroGate}`);

  // Moderate restriction: small area + ePTFE permeance
  // capacity = 5 ft² × 3 × 0.5 = 7.5, effective = 8 × 7.5 / (7.5 + 8) = 3.87
  const moderate = membraneDerating(8, 5, 3, 0.5);
  assertRange(moderate, 3.5, 4.2, `Moderate restriction: ${moderate.toFixed(2)} CFM (from 8)`);
}

// --- Test 7: Exit area changes with side insulation ---
console.log('\nExit area vs insulation:');
{
  const configOpen = createDefaultConfig();
  configOpen.boundaries.sideInsulation = 'none' as InsulationType;
  const gridOpen = new CompostGrid(configOpen);
  initializeGrid(gridOpen, configOpen);
  const areaOpen = computeExitAreaFt2(gridOpen, configOpen);

  const configSealed = createDefaultConfig();
  configSealed.boundaries.sideInsulation = 'logs' as InsulationType;
  const gridSealed = new CompostGrid(configSealed);
  initializeGrid(gridSealed, configSealed);
  const areaSealed = computeExitAreaFt2(gridSealed, configSealed);

  assert(areaOpen > areaSealed,
    `Open sides: ${areaOpen.toFixed(1)} ft² > sealed: ${areaSealed.toFixed(1)} ft²`);
  assert(areaSealed > 0, `Sealed still has top exit: ${areaSealed.toFixed(1)} ft²`);
  // Top-only should be roughly 30-60% of total (dome has lots of side surface)
  const topFraction = areaSealed / areaOpen;
  assertRange(topFraction, 0.05, 0.70,
    `Top fraction: ${(topFraction * 100).toFixed(0)}% of total surface`);
}

// --- Test 8: Backpressure reduces cooling ---
console.log('\nBackpressure reduces cooling with sealed sides:');
{
  const configOpen = createDefaultConfig();
  configOpen.boundaries.ambientTemp = 85;
  configOpen.boundaries.sideInsulation = 'none' as InsulationType;
  configOpen.boundaries.coverType = 'eptfe';
  configOpen.boundaries.membraneRetention = 0.75;

  const configSealed = createDefaultConfig();
  configSealed.boundaries.ambientTemp = 85;
  configSealed.boundaries.sideInsulation = 'logs' as InsulationType;
  configSealed.boundaries.coverType = 'eptfe';
  configSealed.boundaries.membraneRetention = 0.75;

  const gridOpen = new CompostGrid(configOpen);
  initializeGrid(gridOpen, configOpen);
  const gridSealed = new CompostGrid(configSealed);
  initializeGrid(gridSealed, configSealed);

  for (let i = 0; i < gridOpen.totalCells; i++) {
    if (gridOpen.material[i] === MATERIAL_CODES.compost) {
      gridOpen.temp[i] = 140;
      gridOpen.moisture[i] = 0.55;
    }
    if (gridSealed.material[i] === MATERIAL_CODES.compost) {
      gridSealed.temp[i] = 140;
      gridSealed.moisture[i] = 0.55;
    }
  }

  const resultOpen = computeFanCooling(gridOpen, configOpen);
  const resultSealed = computeFanCooling(gridSealed, configSealed);

  let totalCoolingOpen = 0, totalCoolingSealed = 0;
  for (let i = 0; i < gridOpen.totalCells; i++) {
    if (gridOpen.material[i] === MATERIAL_CODES.compost) totalCoolingOpen += resultOpen.cooling[i];
    if (gridSealed.material[i] === MATERIAL_CODES.compost) totalCoolingSealed += resultSealed.cooling[i];
  }

  assert(totalCoolingOpen > totalCoolingSealed,
    `Open sides cool more: ${totalCoolingOpen.toFixed(2)} > ${totalCoolingSealed.toFixed(2)}`);
}

// --- Summary ---
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
