import type { MaterialType } from './VoxelState';
import type { SimulationConfig } from './SimulationConfig';

/**
 * 3D grid storing simulation state.
 * Flat typed arrays for performance (cache-friendly, Web Worker transferable).
 * Index order: [y][z][x] — y is vertical (bottom=0), z is depth, x is width.
 */
export class CompostGrid {
  readonly nx: number;  // cells in X (width)
  readonly ny: number;  // cells in Y (height)
  readonly nz: number;  // cells in Z (depth)
  readonly totalCells: number;
  readonly resolution: number; // inches per cell

  /** Temperature field (Fahrenheit) */
  temp: Float32Array;
  /** Moisture field (fraction of field capacity, 0-1) */
  moisture: Float32Array;
  /** Oxygen field (fraction, 0-0.21) */
  oxygen: Float32Array;
  /** Material age (days since addition) */
  materialAge: Float32Array;
  /** Material type per cell (encoded as uint8) */
  material: Uint8Array;

  /** Scratch buffer for heat FDM updates */
  tempNext: Float32Array;
  /** Scratch buffer for O2 Jacobi iterations */
  o2Scratch: Float32Array;
  /** Scratch buffer for heat source computation */
  heatSourceScratch: Float32Array;
  /** Scratch buffer for fan cooling computation */
  fanCoolingScratch: Float32Array;
  /** Scratch buffer for fan-driven moisture removal (FC/hr, positive = drying) */
  moistureRemovalScratch: Float32Array;

  constructor(config: SimulationConfig) {
    this.resolution = config.resolution;
    this.nx = Math.ceil(config.pile.width / config.resolution);
    this.ny = Math.ceil((config.pile.height + config.pile.plenumHeight) / config.resolution);
    this.nz = Math.ceil(config.pile.depth / config.resolution);
    this.totalCells = this.nx * this.ny * this.nz;

    this.temp = new Float32Array(this.totalCells);
    this.moisture = new Float32Array(this.totalCells);
    this.oxygen = new Float32Array(this.totalCells);
    this.materialAge = new Float32Array(this.totalCells);
    this.material = new Uint8Array(this.totalCells);
    this.tempNext = new Float32Array(this.totalCells);
    this.o2Scratch = new Float32Array(this.totalCells);
    this.heatSourceScratch = new Float32Array(this.totalCells);
    this.fanCoolingScratch = new Float32Array(this.totalCells);
    this.moistureRemovalScratch = new Float32Array(this.totalCells);
  }

  /** Convert 3D index to flat index */
  idx(x: number, y: number, z: number): number {
    return y * this.nz * this.nx + z * this.nx + x;
  }

  /** Convert flat index to 3D coordinates */
  coords(i: number): { x: number; y: number; z: number } {
    const y = Math.floor(i / (this.nz * this.nx));
    const rem = i % (this.nz * this.nx);
    const z = Math.floor(rem / this.nx);
    const x = rem % this.nx;
    return { x, y, z };
  }

  /** Get position in inches for a cell index */
  positionInches(x: number, y: number, z: number): { xi: number; yi: number; zi: number } {
    return {
      xi: (x + 0.5) * this.resolution,
      yi: (y + 0.5) * this.resolution,
      zi: (z + 0.5) * this.resolution,
    };
  }

  /** Check if cell is within grid bounds */
  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && x < this.nx && y >= 0 && y < this.ny && z >= 0 && z < this.nz;
  }

  /** Swap temp and tempNext buffers after a heat step */
  swapTempBuffers(): void {
    const tmp = this.temp;
    this.temp = this.tempNext;
    this.tempNext = tmp;
  }

  /** Save a snapshot of all mutable state (for scrubber replay). */
  saveState(): GridStateSnapshot {
    return {
      temp: new Float32Array(this.temp),
      moisture: new Float32Array(this.moisture),
      oxygen: new Float32Array(this.oxygen),
      materialAge: new Float32Array(this.materialAge),
      material: new Uint8Array(this.material),
    };
  }

  /** Restore a previously saved state. */
  restoreState(snap: GridStateSnapshot): void {
    this.temp.set(snap.temp);
    this.moisture.set(snap.moisture);
    this.oxygen.set(snap.oxygen);
    this.materialAge.set(snap.materialAge);
    this.material.set(snap.material);
  }
}

export interface GridStateSnapshot {
  temp: Float32Array;
  moisture: Float32Array;
  oxygen: Float32Array;
  materialAge: Float32Array;
  material: Uint8Array;
}

/** Material type encoding for Uint8Array storage */
export const MATERIAL_CODES: Record<MaterialType, number> = {
  compost: 0,
  air: 1,
  brick: 2,
  pipe: 3,
  log: 4,
  ground: 5,
  membrane: 6,
  tarp: 7,
  straw: 8,
};

export const MATERIAL_FROM_CODE: MaterialType[] = [
  'compost', 'air', 'brick', 'pipe', 'log', 'ground', 'membrane', 'tarp', 'straw',
];

/**
 * Initialize grid geometry — place materials based on pile configuration.
 * Sets material types, initial temperatures, moisture, and oxygen.
 */
export function initializeGrid(grid: CompostGrid, config: SimulationConfig): void {
  const { pile, boundaries, aeration } = config;
  const res = grid.resolution;

  const plenumCellsY = Math.ceil(pile.plenumHeight / res);
  const pipeCenterX = Math.round(aeration.pipePosition.x / res);
  const pipeCenterZ = Math.round(aeration.pipePosition.z / res);
  const pipeRadiusCells = Math.ceil(aeration.pipeDiameter / 2 / res);
  // Edge seal: 1 cell of compost curls under plenum to prevent air short-circuit
  const sealCells = 1;

  // Precompute optimized brick positions (avoids pipe lane + hole exit zones)
  const brickSet = new Set<number>();
  for (const b of computeBrickLayout(config)) {
    brickSet.add(b.x * grid.nz + b.z);
  }

  for (let y = 0; y < grid.ny; y++) {
    for (let z = 0; z < grid.nz; z++) {
      for (let x = 0; x < grid.nx; x++) {
        const i = grid.idx(x, y, z);

        // Determine material type based on position
        let mat: MaterialType = 'compost';

        // Plenum zone (below compost)
        if (y < plenumCellsY) {
          // Edge cells: compost curls under plenum, sealing perimeter
          if (x < sealCells || x >= grid.nx - sealCells ||
              z < sealCells || z >= grid.nz - sealCells) {
            mat = 'compost';
          }
          // Check if this is the pipe
          else {
            const dxPipe = x - pipeCenterX;
            const dzPipe = z - pipeCenterZ;
            if (dxPipe * dxPipe + dzPipe * dzPipe <= pipeRadiusCells * pipeRadiusCells) {
              mat = 'pipe';
            }
            else if (brickSet.has(x * grid.nz + z)) {
              mat = 'brick';
            }
            else {
              mat = 'air';
            }
          }
        }
        // Above plenum: compost within angle of repose, air outside
        // No log walls — logs are external clamps, not inside the grid
        else if (!isWithinRepose(x, y, z, grid.nx, grid.nz, plenumCellsY, 0)) {
          mat = 'air';
        }

        grid.material[i] = MATERIAL_CODES[mat];

        // Initial conditions
        grid.temp[i] = mat === 'ground' ? boundaries.groundTemp : boundaries.ambientTemp;
        grid.moisture[i] = mat === 'compost' ? 0.55 : 0;  // 55% FC for compost
        grid.oxygen[i] = mat === 'air' || mat === 'pipe' ? 0.21 : (mat === 'compost' ? 0.15 : 0);
        grid.materialAge[i] = mat === 'compost' ? 7 : 0;  // 1 week old at start
      }
    }
  }
}

/**
 * Compute optimal brick support positions for the plenum.
 *
 * Constraints:
 * - Max 12" unsupported span (hardware cloth structural limit under compost load)
 * - Clear lane around pipe axis in X (pipe body + jet clearance from upper-arc holes)
 * - Edge seal inset (bricks start 1 cell inside perimeter)
 *
 * The pipe provides support directly beneath the hardware cloth along its length,
 * so the clear lane doesn't create an unsupported span.
 */
export function computeBrickLayout(config: SimulationConfig): { x: number; z: number }[] {
  const res = config.resolution;
  const nx = Math.ceil(config.pile.width / res);
  const nz = Math.ceil(config.pile.depth / res);
  const spacingCells = Math.round(12 / res);

  const pipeCX = Math.round(config.aeration.pipePosition.x / res);
  const pipeRadCells = config.aeration.pipeDiameter / 2 / res;
  const exclusionXCells = Math.ceil(pipeRadCells + 1.5);

  const sealCells = 1;
  const bricks: { x: number; z: number }[] = [];

  for (let z = sealCells + 1; z < nz - sealCells; z += spacingCells) {
    for (let x = sealCells + 1; x < nx - sealCells; x += spacingCells) {
      if (Math.abs(x - pipeCX) <= exclusionXCells) continue;
      bricks.push({ x, z });
    }
  }

  return bricks;
}

/**
 * Check if a cell at (x, y, z) is within the angle of repose for a pile.
 * Above the log zone, each layer above the logs is inset by ~1 cell per layer
 * to create a ~40° slope (tan(40°) ≈ 0.84, so roughly 1 cell inset per 1 cell up).
 *
 * @param logTopY - the y index where logs end and the tapered compost begins
 */
/**
 * Pile shape model: rounded mound with angle of repose.
 *
 * Compost at ~55% moisture has angle of repose ~38-40°.
 * Piles form a rounded dome/bell profile (not a pyramid).
 *
 * The dome starts at the plenum top and uses the full grid footprint as base.
 * No internal log walls — logs are external clamps for the edge seal.
 */

function reposeInset(
  heightAboveBase: number,
  maxHeight: number,
  halfWidth: number,
): number {
  if (heightAboveBase <= 0) return 0;
  if (maxHeight <= 0) return halfWidth;

  const t = Math.min(1, heightAboveBase / maxHeight);
  // Rounded dome: radius shrinks as sqrt(1 - t^1.8)
  const radiusFrac = Math.sqrt(Math.max(0, 1 - Math.pow(t, 1.8)));
  return halfWidth - halfWidth * radiusFrac;
}

/** Max dome height above base (cell units). Half-width × tan(39°). */
function maxDomeHeight(nx: number): number {
  return (nx / 2) * Math.tan(39 * Math.PI / 180);
}

export function isWithinRepose(
  x: number, y: number, z: number,
  nx: number, nz: number,
  baseY: number,
  _unused: number,
): boolean {
  if (y <= baseY) {
    // At or below base: full footprint
    return x >= 0 && x < nx && z >= 0 && z < nz;
  }

  const h = y - baseY;
  const maxH = maxDomeHeight(nx);
  if (h > maxH) return false;

  const insetX = reposeInset(h, maxH, nx / 2);
  const insetZ = reposeInset(h, maxH, nz / 2);

  return x >= insetX && x < nx - insetX && z >= insetZ && z < nz - insetZ;
}

export function reposeEdgeFactor(
  x: number, y: number, z: number,
  nx: number, nz: number,
  baseY: number,
  _unused: number,
): number {
  if (y <= baseY) return 1.0;

  const h = y - baseY;
  const maxH = maxDomeHeight(nx);
  if (h > maxH) return 0;

  const insetX = reposeInset(h, maxH, nx / 2);
  const insetZ = reposeInset(h, maxH, nz / 2);

  const distLeft = x - insetX;
  const distRight = (nx - insetX) - x - 1;
  const distFront = z - insetZ;
  const distBack = (nz - insetZ) - z - 1;
  const minDist = Math.min(distLeft, distRight, distFront, distBack);

  return Math.max(0, Math.min(1, minDist));
}
