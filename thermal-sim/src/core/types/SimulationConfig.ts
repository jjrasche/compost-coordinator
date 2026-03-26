/** Configuration for the compost thermal simulation */
export interface SimulationConfig {
  /** Grid resolution in inches per cell */
  resolution: number;
  /** Pile dimensions in inches */
  pile: PileDimensions;
  /** Aeration system configuration */
  aeration: AerationConfig;
  /** Boundary conditions */
  boundaries: BoundaryConfig;
  /** Simulation time parameters */
  time: TimeConfig;
}

export interface PileDimensions {
  width: number;   // inches (X axis)
  depth: number;   // inches (Z axis, into screen)
  height: number;  // inches (Y axis, up)
  /** Plenum height — derived from pipe diameter + 0.5" clearance. Do not set manually. */
  plenumHeight: number;
  porosity: number;      // void fraction of compost (0-1, typically 0.3-0.4)
  /** Effective particle diameter in inches (for heat/mass transfer correlations) */
  particleDiameter: number;
  /** Critical moisture (fraction of FC) below which evaporation enters falling-rate regime */
  criticalMoisture: number;
}

export interface AerationConfig {
  /** Pipe diameter in inches */
  pipeDiameter: number;
  /** Pipe center position (X, Z) in inches from pile corner */
  pipePosition: { x: number; z: number };
  /** Fan CFM at current speed/gate setting */
  fanCfm: number;
  /** Duty cycle: seconds on */
  onSeconds: number;
  /** Duty cycle: seconds off */
  offSeconds: number;
  /** Blast gate opening fraction (0-1) */
  gateOpening: number;
  /** Spacing between pipe holes in inches (along pipe length) */
  holeSpacing: number;
  /** Diameter of each pipe hole in inches */
  holeDiameter: number;
  /** Number of holes around the pipe circumference at each position */
  holesPerRing: number;
}

/** Cover product presets with moisture retention fractions */
export const COVER_PRESETS = {
  none:   { label: 'None (open air)',        retention: 0.00 },
  fleece: { label: 'Fleece (~$2/m\u00B2)',   retention: 0.10 },
  eptfe:  { label: 'ePTFE membrane (~$8/m\u00B2)', retention: 0.75 },
  tarp:   { label: 'Tarp (impermeable)',     retention: 1.00 },
} as const;

export type CoverType = keyof typeof COVER_PRESETS;

export interface BoundaryConfig {
  /** Ambient air temperature F */
  ambientTemp: number;
  /** Ground temperature F (stable soil temp below pile) */
  groundTemp: number;
  /** Ambient relative humidity (0-1) */
  ambientRH: number;
  /** Cover type — determines moisture retention fraction */
  coverType: CoverType;
  /** Fraction of evaporated moisture returned to pile by cover condensation (0-1).
   *  Derived from coverType. Do not set manually. */
  membraneRetention: number;
  /** Log diameter in inches (logs are external, lying on side for edge seal) */
  logDiameter: number;
  /** Whether straw bale insulation is present */
  hasStraw: boolean;
  /** Straw bale thickness in inches */
  strawThickness: number;
  /** Wind speed mph (affects convective loss at membrane surface) */
  windSpeed: number;
}

export interface TimeConfig {
  /** Heat equation timestep in hours */
  heatTimestep: number;
  /** Moisture update interval in hours */
  moistureInterval: number;
  /** Total simulation duration in hours */
  totalHours: number;
}

export function createDefaultConfig(): SimulationConfig {
  return {
    resolution: 2,  // 2 inches per cell
    pile: {
      width: 48,
      depth: 48,
      height: 60,   // extra headroom for dome above logs
      plenumHeight: 4.5,  // pipeDiameter(4) + 0.5" clearance — bricks must be taller than pipe
      porosity: 0.45,  // void fraction for fresh food waste + browns (bulking agent)
      particleDiameter: 0.79, // ~20mm — effective d_p for 1/3 food waste + 2/3 shredded cardboard
      criticalMoisture: 0.55, // FC fraction: constant→falling rate drying transition
    },
    aeration: {
      pipeDiameter: 4,
      pipePosition: { x: 24, z: 24 },  // centered
      fanCfm: 40,     // after blast gate throttling
      onSeconds: 90,    // optimized: 90s on
      offSeconds: 600,  // optimized: 10m off (13% duty cycle)
      gateOpening: 0.20, // optimized: 20% open
      holeSpacing: 4, // inches between hole rings along pipe
      holeDiameter: 3/8, // 3/8" drill bit
      holesPerRing: 3, // holes evenly spaced around circumference
    },
    boundaries: {
      ambientTemp: 75,
      groundTemp: 55,
      ambientRH: 0.50, // Michigan summer average
      coverType: 'eptfe' as CoverType,
      membraneRetention: COVER_PRESETS.eptfe.retention,
      logDiameter: 6, // logs lie on side outside pile for edge seal
      hasStraw: false,
      strawThickness: 18,
      windSpeed: 5,
    },
    time: {
      heatTimestep: 0.4,    // 24 minutes (within CFL limit for 2" grid)
      moistureInterval: 24,  // daily
      totalHours: 24 * 30,   // 30 days default
    },
  };
}
