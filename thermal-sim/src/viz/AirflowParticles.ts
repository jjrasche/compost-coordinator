/**
 * Particle-based airflow visualization.
 *
 * Shows air moving from pipe inlet → through plenum → up through compost → out membrane.
 * Three velocity zones: pipe (horizontal), plenum (radial + brick avoidance), compost (upward).
 * Particles spawn on fan-on, coast and fade on fan-off.
 */

import * as THREE from 'three';
import { CompostGrid, MATERIAL_FROM_CODE } from '../core/types/CompostGrid';
import type { SimulationConfig } from '../core/types/SimulationConfig';
import { tempToColor } from './tempColorScale';

type AirZone = 'pipe' | 'plenum' | 'compost' | 'outside';

const MAX_PARTICLES = 1000;
const VISUAL_SPEED_SCALE = 30;  // animation time compression (all velocities scale equally)
const KINEMATIC_VISCOSITY_AIR = 1.74e-4; // ft²/s at ~70°F

export class AirflowParticles {
  readonly points: THREE.Points;

  private grid!: CompostGrid;
  private config!: SimulationConfig;
  private fanOn = false;
  private dutyCycleFraction = 0.13; // fraction of time fan is on

  // Pre-computed zone boundaries (world-space feet)
  private scale = 0;
  private plenumTopWorld = 0;
  private pipeCenterXWorld = 0;
  private pipeCenterZWorld = 0;
  private pipeRadiusWorld = 0;
  private plenumInsetWorld = 0; // edge seal inset
  private gridMaxXWorld = 0;
  private gridMaxYWorld = 0;
  private gridMaxZWorld = 0;

  // Derived velocities (world-space ft/s, with visual scale applied)
  private pipeSpeed = 0;
  private superficialSpeed = 0;   // Q / A_pile — upward velocity in open plenum (no pore restriction)
  private compostSpeed = 0;       // Q / (A_pile × porosity) — interstitial velocity through compost pores
  private plenumRadialMax = 0;    // max radial speed at pipe center (linear decay to zero at edge)
  private pileHalfWidthWorld = 0; // half pile width for radial decay calculation

  // Derived from physics, not hardcoded
  private maxAgeSeconds = 7;       // pile traverse time / compostSpeed (with margin)
  private turbulenceIntensity = 0; // from Reynolds number of plenum flow
  private spawnsPerSecond = 500;   // fills particle budget over one transit lifetime
  private lateralSpeed = 0;        // compost lateral zig-zag speed from tortuosity
  private poreCorrelationTime = 0; // seconds before particle changes lateral direction

  // Pre-computed pipe hole positions [x, y, z] in world-space
  private holePositions: [number, number, number][] = [];
  private holeSpreadWorld = 0; // hole radius in world-space for spawn spread

  // Particle state (SoA layout for cache friendliness)
  private posX = new Float32Array(MAX_PARTICLES);
  private posY = new Float32Array(MAX_PARTICLES);
  private posZ = new Float32Array(MAX_PARTICLES);
  private velX = new Float32Array(MAX_PARTICLES);
  private velY = new Float32Array(MAX_PARTICLES);
  private velZ = new Float32Array(MAX_PARTICLES);
  private age = new Float32Array(MAX_PARTICLES);
  private alive = new Uint8Array(MAX_PARTICLES); // 0=dead, 1=alive
  private spawnAccumulator = 0;
  private nextSlot = 0; // ring buffer cursor

  // THREE.js geometry
  private geometry: THREE.BufferGeometry;
  private positionAttr: THREE.Float32BufferAttribute;
  private colorAttr: THREE.Float32BufferAttribute;
  private colorScratch = new THREE.Color();

  constructor(grid: CompostGrid, config: SimulationConfig) {
    this.geometry = new THREE.BufferGeometry();
    this.positionAttr = new THREE.Float32BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3);
    this.colorAttr = new THREE.Float32BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3);
    this.geometry.setAttribute('position', this.positionAttr);
    this.geometry.setAttribute('color', this.colorAttr);
    this.geometry.setDrawRange(0, 0);

    const material = new THREE.PointsMaterial({
      vertexColors: true,
      sizeAttenuation: true,
      size: 0.12,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      depthTest: false, // particles show through compost mesh (airflow overlay)
    });

    this.points = new THREE.Points(this.geometry, material);
    this.updateGridReference(grid, config);
  }

  /** Update references when grid state changes (called from PileScene.updateFromGrid) */
  updateGridReference(grid: CompostGrid, config: SimulationConfig, fanOn = false): void {
    this.grid = grid;
    this.config = config;
    this.fanOn = fanOn;
    this.dutyCycleFraction = config.aeration.onSeconds /
      (config.aeration.onSeconds + config.aeration.offSeconds);
    this.recomputeZoneBoundaries();
  }

  /** Orchestrator: advance particles by wall-clock dt */
  tick(dt: number): void {
    this.spawnParticles(dt);
    this.advectParticles(dt);
    this.ageParticles(dt);
    this.recycleDeadParticles();
    this.syncBufferGeometry();
  }

  /** Kill all particles (scrubber seek, sim reset) */
  reset(): void {
    this.alive.fill(0);
    this.age.fill(0);
    this.spawnAccumulator = 0;
    this.nextSlot = 0;
    this.geometry.setDrawRange(0, 0);
  }

  dispose(): void {
    this.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }

  // --- Concept functions ---

  private spawnParticles(dt: number): void {
    if (this.holePositions.length === 0) return;

    // Spawn continuously scaled by duty cycle — the sim advances multiple fan cycles
    // per frame so instantaneous fanOn flickers randomly. Duty cycle gives the average.
    this.spawnAccumulator += this.spawnsPerSecond * this.dutyCycleFraction * dt;
    const toSpawn = Math.floor(this.spawnAccumulator);
    this.spawnAccumulator -= toSpawn;

    for (let i = 0; i < toSpawn; i++) {
      const slot = this.nextSlot;
      this.nextSlot = (this.nextSlot + 1) % MAX_PARTICLES;

      // Pick a random hole to spawn from
      const holeIdx = Math.floor(Math.random() * this.holePositions.length);
      const [hx, hy, hz] = this.holePositions[holeIdx];

      // Spawn at physical hole position with hole-diameter spread
      const spread = this.holeSpreadWorld;
      this.posX[slot] = hx + (Math.random() - 0.5) * spread * 2;
      this.posY[slot] = hy + (Math.random() - 0.5) * spread * 2;
      this.posZ[slot] = hz + (Math.random() - 0.5) * spread * 2;

      // Initial velocity matches the plenum field at spawn position:
      // radial (X) from linear decay model, upward (Y) at superficial speed
      const dx = hx - this.pipeCenterXWorld;
      const distFromCenter = Math.abs(dx);
      const radialFrac = Math.max(0, 1 - distFromCenter / this.pileHalfWidthWorld);
      this.velX[slot] = Math.sign(dx) * this.plenumRadialMax * radialFrac;
      this.velY[slot] = this.superficialSpeed;
      this.velZ[slot] = (Math.random() - 0.5) * this.superficialSpeed * 0.1;
      this.age[slot] = 0;
      this.alive[slot] = 1;
    }
  }

  private advectParticles(dt: number): void {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (!this.alive[i]) continue;

      const wx = this.posX[i];
      const wy = this.posY[i];
      const wz = this.posZ[i];

      // Deterministic velocity field (blended for smooth zone transitions)
      const [nvx, nvy, nvz] = this.computeVelocityAtPosition(wx, wy, wz);
      const blend = Math.min(1, dt * 8);
      this.velX[i] += (nvx - this.velX[i]) * blend;
      this.velY[i] += (nvy - this.velY[i]) * blend;
      this.velZ[i] += (nvz - this.velZ[i]) * blend;

      // Euler integration of deterministic velocity
      this.posX[i] += this.velX[i] * dt;
      this.posY[i] += this.velY[i] * dt;
      this.posZ[i] += this.velZ[i] * dt;

      // Stochastic perturbation applied DIRECTLY to position (bypasses blend filter).
      const zone = this.classifyZone(wx, wy, wz);
      if (zone === 'plenum') {
        // Plenum: turbulence from jet impingement on bricks (Re-derived intensity)
        const speed = Math.sqrt(this.velX[i] ** 2 + this.velY[i] ** 2 + this.velZ[i] ** 2);
        const jitter = speed * this.turbulenceIntensity * dt;
        this.posX[i] += (Math.random() - 0.5) * jitter * 2;
        this.posY[i] += (Math.random() - 0.5) * jitter * 2;
        this.posZ[i] += (Math.random() - 0.5) * jitter * 2;
      } else if (zone === 'compost') {
        // Compost: correlated random walk — air follows a pore channel for ~1 particle
        // diameter, then changes direction. Hash of (particle index, time phase) gives
        // a consistent lateral velocity per pore segment (no extra arrays needed).
        const phase = Math.floor(this.age[i] / this.poreCorrelationTime);
        const seed1 = Math.sin((i * 127 + phase) * 12.9898) * 43758.5453;
        const seed2 = Math.sin((i * 311 + phase) * 78.233) * 43758.5453;
        const lx = (seed1 - Math.floor(seed1) - 0.5) * 2 * this.lateralSpeed;
        const lz = (seed2 - Math.floor(seed2) - 0.5) * 2 * this.lateralSpeed;
        this.posX[i] += lx * dt;
        this.posZ[i] += lz * dt;
      }

      // Floor clamp: air can't go underground, pressure redirects upward
      if (this.posY[i] < 0) {
        this.posY[i] = 0;
        this.velY[i] = Math.abs(this.velY[i]);
      }
    }
  }

  private ageParticles(dt: number): void {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (!this.alive[i]) continue;
      this.age[i] += dt;
    }
  }

  private recycleDeadParticles(): void {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (!this.alive[i]) continue;
      if (this.age[i] > this.maxAgeSeconds) { this.alive[i] = 0; continue; }
      if (this.posY[i] > this.gridMaxYWorld) { this.alive[i] = 0; continue; }
      if (this.posX[i] < 0 || this.posX[i] > this.gridMaxXWorld) { this.alive[i] = 0; continue; }
      if (this.posZ[i] < 0 || this.posZ[i] > this.gridMaxZWorld) { this.alive[i] = 0; continue; }
    }
  }

  private syncBufferGeometry(): void {
    const posArr = this.positionAttr.array as Float32Array;
    const colArr = this.colorAttr.array as Float32Array;
    let aliveCount = 0;

    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (!this.alive[i]) continue;

      const idx = aliveCount * 3;
      posArr[idx] = this.posX[i];
      posArr[idx + 1] = this.posY[i];
      posArr[idx + 2] = this.posZ[i];

      // Color by temperature at this position
      const tempF = this.sampleGridTemperature(this.posX[i], this.posY[i], this.posZ[i]);
      tempToColor(tempF, this.colorScratch);

      // Fade alpha by encoding it into color brightness
      const ageFrac = this.age[i] / this.maxAgeSeconds;
      const brightness = 1.0 - ageFrac * 0.7; // fade to 30% brightness
      colArr[idx] = this.colorScratch.r * brightness;
      colArr[idx + 1] = this.colorScratch.g * brightness;
      colArr[idx + 2] = this.colorScratch.b * brightness;

      aliveCount++;
    }

    this.positionAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.geometry.setDrawRange(0, aliveCount);
  }

  // --- Leaf functions ---

  private recomputeZoneBoundaries(): void {
    const { config, grid } = this;
    this.scale = config.resolution / 12; // cell size in feet
    const plenumCellsY = Math.ceil(config.pile.plenumHeight / config.resolution);
    // Edge seal: 1 cell of compost curls under the plenum
    const sealCells = 1;

    this.plenumTopWorld = plenumCellsY * this.scale;
    this.pipeCenterXWorld = (config.aeration.pipePosition.x / config.resolution) * this.scale;
    this.pipeCenterZWorld = (config.aeration.pipePosition.z / config.resolution) * this.scale;
    this.pipeRadiusWorld = (config.aeration.pipeDiameter / 2 / 12); // feet
    this.plenumInsetWorld = sealCells * this.scale;
    this.gridMaxXWorld = grid.nx * this.scale;
    this.gridMaxYWorld = grid.ny * this.scale;
    this.gridMaxZWorld = grid.nz * this.scale;

    // Precompute visual velocities (ft/s, with visual scale)
    const pipeAreaFt2 = Math.PI * Math.pow(config.aeration.pipeDiameter / 2 / 12, 2);
    const effectiveCfm = config.aeration.fanCfm * config.aeration.gateOpening;
    this.pipeSpeed = (effectiveCfm / 60 / pipeAreaFt2) * VISUAL_SPEED_SCALE; // CFM → ft³/s / area → ft/s

    const pileWidthFt = config.pile.width / 12;
    const pileDepthFt = config.pile.depth / 12;
    const pileAreaFt2 = pileWidthFt * pileDepthFt;
    const porosity = config.pile.porosity;
    const effectiveQ = effectiveCfm / 60; // ft³/s
    const superficialVelocityFtPerSec = effectiveQ / pileAreaFt2;
    this.superficialSpeed = superficialVelocityFtPerSec * VISUAL_SPEED_SCALE;
    this.compostSpeed = (superficialVelocityFtPerSec / porosity) * VISUAL_SPEED_SCALE;

    // Plenum radial velocity from 2D mass conservation:
    // Pipe is a line source along Z. In cross-section (XY plane), air enters at pipe
    // center and spreads in X while leaking upward through compost.
    // v_radial(x) = (Q / (2 · L_pipe · h_plenum)) · max(0, 1 - |x| / W_half)
    // Linear decay: full speed at pipe, zero at pile edge (all flow turned upward).
    const pipeLengthFt = this.gridMaxZWorld - 2 * this.plenumInsetWorld;
    const plenumHeightFt = this.plenumTopWorld;
    const plenumRadialAtPipe = effectiveQ / (2 * pipeLengthFt * plenumHeightFt);
    this.plenumRadialMax = plenumRadialAtPipe * VISUAL_SPEED_SCALE;
    this.pileHalfWidthWorld = this.gridMaxXWorld / 2;

    // Particle max age: time to traverse pile height at compost speed, with 2x margin
    const pileHeightFt = this.gridMaxYWorld - this.plenumTopWorld;
    this.maxAgeSeconds = (pileHeightFt / this.compostSpeed) * 2;

    // Spawn rate: fill the particle budget over one transit lifetime
    // At steady state: spawnRate × dutyCycle × maxAge ≈ MAX_PARTICLES
    this.spawnsPerSecond = MAX_PARTICLES / (this.dutyCycleFraction * this.maxAgeSeconds);

    // Turbulence intensity from Reynolds number at HOLE EXIT (not bulk flow).
    // Jets from holes hitting bricks create the mixing — that's the turbulence source.
    // Re_hole = v_hole × d_hole / ν
    const holeDiameterFt = config.aeration.holeDiameter / 12;
    const holeAreaFt2 = Math.PI * Math.pow(holeDiameterFt / 2, 2);
    const numHolesEstimate = Math.floor(pipeLengthFt / (config.aeration.holeSpacing / 12)) * 2;
    const holeExitVelocity = numHolesEstimate > 0
      ? effectiveQ / (numHolesEstimate * holeAreaFt2) : 0;
    const holeRe = holeExitVelocity * holeDiameterFt / KINEMATIC_VISCOSITY_AIR;
    // Re < 500: laminar jets (5%). Re 500-2000: transitional (5-30%). Re > 2000: turbulent (30%+).
    this.turbulenceIntensity = Math.min(0.35, Math.max(0.05, 0.05 + (holeRe - 500) / 1500 * 0.25));

    // Tortuous path through compost: air zig-zags around particles.
    // Empirical tortuosity for food waste compost: τ ≈ 2 (path length = 2× straight line).
    // From τ, the lateral speed during each "zig": v_lateral = v_vertical × √(τ²-1)
    // Correlation time = how long a particle follows one pore channel before changing direction.
    const tortuosity = 2.0; // empirical for food waste (Kozeny-Carman underestimates by ~1000×)
    this.lateralSpeed = this.compostSpeed * Math.sqrt(tortuosity * tortuosity - 1);
    // Pore channel length ≈ particle diameter; correlation time = channel_length / total_speed
    const particleDiameterFt = 1.0 / 12; // ~1 inch chunks
    const totalPoreSpeed = Math.sqrt(this.compostSpeed ** 2 + this.lateralSpeed ** 2);
    this.poreCorrelationTime = particleDiameterFt / totalPoreSpeed;

    // Precompute pipe hole positions from config
    // Holes at 4 o'clock (120°) and 8 o'clock (240°) from top, spaced along pipe
    this.holePositions = [];
    const holeSpacingFt = config.aeration.holeSpacing / 12;
    // holeDiameter used for spawn spread (stored for reference)
    this.holeSpreadWorld = (config.aeration.holeDiameter ?? 3/8) / 12 / 2;
    // Holes in the bottom 180° arc (3 o'clock → 6 o'clock → 9 o'clock)
    // so air exits downward into the plenum for even distribution
    const holesPerRing = config.aeration.holesPerRing;
    const arcStart = Math.PI / 2;  // 90° = 3 o'clock
    const arcSpan = Math.PI;       // 180° arc
    const holeAngles = holesPerRing === 1
      ? [Math.PI] // single hole points straight down
      : Array.from({ length: holesPerRing }, (_, k) => arcStart + k * arcSpan / (holesPerRing - 1));
    const pipeStartZ = this.plenumInsetWorld + this.scale;
    const pipeEndZ = this.gridMaxZWorld - this.plenumInsetWorld - this.scale;
    const pipeY = this.plenumTopWorld * 0.5;
    for (let z = pipeStartZ + holeSpacingFt; z < pipeEndZ; z += holeSpacingFt) {
      for (const angle of holeAngles) {
        const hx = this.pipeCenterXWorld + Math.sin(angle) * this.pipeRadiusWorld;
        const hy = pipeY + Math.cos(angle) * this.pipeRadiusWorld;
        this.holePositions.push([hx, hy, z]);
      }
    }
  }

  /** Returns [vx, vy, vz] in world-space ft/s for a given position */
  private computeVelocityAtPosition(wx: number, wy: number, wz: number): [number, number, number] {
    const zone = this.classifyZone(wx, wy, wz);

    if (zone === 'outside') return [0, 0, 0];

    // Particles represent time-averaged airflow (duty cycle already modulates spawn rate)
    if (zone === 'pipe') {
      const dz = this.pipeCenterZWorld - wz;
      const dir = dz > 0 ? 1 : (dz < 0 ? -1 : 0);
      return [0, 0, this.pipeSpeed * dir];
    }

    if (zone === 'plenum') {
      // Radial velocity from 2D mass conservation (linear decay from pipe to edge)
      const dx = wx - this.pipeCenterXWorld;
      const distFromCenter = Math.abs(dx);
      const radialFrac = Math.max(0, 1 - distFromCenter / this.pileHalfWidthWorld);
      let vx = Math.sign(dx) * this.plenumRadialMax * radialFrac;

      // Upward velocity = superficial (open cavity, no pore restriction)
      // Air accelerates when entering compost pores (continuity: same Q, smaller area)
      let vy = this.superficialSpeed;

      // Z velocity: minimal (pipe covers full depth, no Z spreading needed)
      let vz = 0;

      // Brick avoidance: deflect perpendicular if next step hits a brick
      const nextGX = Math.floor((wx + vx * 0.016) / this.scale);
      const nextGZ = Math.floor((wz + vz * 0.016) / this.scale);
      const gy = Math.floor(wy / this.scale);
      if (this.isBrickAt(nextGX, gy, nextGZ)) {
        const temp = vx;
        vx = -vz * 0.7;
        vz = temp * 0.7;
      }

      return [vx, vy, vz];
    }

    // Compost zone: Darcy flow upward (deterministic component only)
    return [0, this.compostSpeed, 0];
  }

  private classifyZone(wx: number, wy: number, wz: number): AirZone {
    const gx = Math.floor(wx / this.scale);
    const gy = Math.floor(wy / this.scale);
    const gz = Math.floor(wz / this.scale);

    if (!this.grid.inBounds(gx, gy, gz)) return 'outside';

    const mat = MATERIAL_FROM_CODE[this.grid.material[this.grid.idx(gx, gy, gz)]];
    if (mat === 'pipe') return 'pipe';
    if (mat === 'air') {
      // Air below plenum top = plenum cavity. Air above = empty space (pile not filled yet).
      return wy < this.plenumTopWorld ? 'plenum' : 'outside';
    }
    if (mat === 'compost') return 'compost';
    return 'outside'; // brick, log, ground, etc.
  }

  private sampleGridTemperature(wx: number, wy: number, wz: number): number {
    const gx = Math.min(this.grid.nx - 1, Math.max(0, Math.floor(wx / this.scale)));
    const gy = Math.min(this.grid.ny - 1, Math.max(0, Math.floor(wy / this.scale)));
    const gz = Math.min(this.grid.nz - 1, Math.max(0, Math.floor(wz / this.scale)));
    return this.grid.temp[this.grid.idx(gx, gy, gz)];
  }

  private isBrickAt(gx: number, gy: number, gz: number): boolean {
    if (!this.grid.inBounds(gx, gy, gz)) return false;
    return MATERIAL_FROM_CODE[this.grid.material[this.grid.idx(gx, gy, gz)]] === 'brick';
  }
}
