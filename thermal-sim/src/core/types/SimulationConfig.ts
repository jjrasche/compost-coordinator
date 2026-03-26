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

/**
 * Cover product presets with moisture retention, thermal R-values, and air permeance.
 *
 * R-value physics (ft²·hr·°F/BTU):
 * - None: still air film only → R-0.17 (ASHRAE interior air film)
 * - Fleece: single layer nonwoven + air films → R-0.5
 * - ePTFE: membrane + trapped dead air layer → R-0.75
 * - Tarp: impermeable plastic + dead air pocket underneath → R-2.0
 *
 * Air permeance (CFM/ft²/in.w.g.) — determines backpressure on fan:
 * - None: no membrane → effectively infinite (use large number)
 * - Fleece: open nonwoven fabric → ~50 (ASTM D737, ~200 CFM/ft² at 0.5" w.g.)
 * - ePTFE: microporous PTFE membrane → ~3 (Donaldson Tetratex/Saint-Gobain data,
 *   designed for vapor permeability, not bulk airflow; 1-5 CFM/ft²/in.w.g. typical)
 * - Tarp: impermeable plastic → 0 (no airflow through tarp)
 */
export const COVER_PRESETS = {
  none:   { label: 'None (open air)',              retention: 0.00, rValue: 0.17, airPermeance: 1000 },
  fleece: { label: 'Fleece (~$2/m\u00B2)',         retention: 0.10, rValue: 0.50, airPermeance: 50 },
  eptfe:  { label: 'ePTFE membrane (~$8/m\u00B2)', retention: 0.75, rValue: 0.75, airPermeance: 3 },
  tarp:   { label: 'Tarp (impermeable)',           retention: 1.00, rValue: 2.00, airPermeance: 0 },
} as const;

export type CoverType = keyof typeof COVER_PRESETS;

/**
 * Side insulation presets with R-values.
 *
 * Physics:
 * - None: membrane + still air only → R-0.5
 * - Logs: 6" diameter logs stacked horizontally → 6"/12 / 0.08 k_wood = R-6.25 + air film
 * - Logs + blanket: logs + insulating blanket + dead air gap → R-8 to R-10
 * - Straw bales: 18" deep straw, k_straw ≈ 0.025 → 1.5ft / 0.025 = R-60 (per ft²·hr·°F/BTU)
 *   but straw has convective bypass → effective R ≈ R-6
 */
export const INSULATION_PRESETS = {
  none:           { label: 'None (membrane only)',     rValue: 0.5 },
  logs:           { label: 'Log cabin shell',          rValue: 6.25 },
  logs_blanket:   { label: 'Logs + insulation blanket', rValue: 9.0 },
  strawbales:     { label: 'Straw bales',              rValue: 6.0 },
} as const;

export type InsulationType = keyof typeof INSULATION_PRESETS;

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
  /** Side insulation type — determines side R-value */
  sideInsulation: InsulationType;
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
      sideInsulation: 'none' as InsulationType,
      windSpeed: 5,
    },
    time: {
      heatTimestep: 0.4,    // 24 minutes (within CFL limit for 2" grid)
      moistureInterval: 24,  // daily
      totalHours: 24 * 30,   // 30 days default
    },
  };
}
