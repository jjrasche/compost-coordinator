/** State of a single grid cell in the compost simulation. */
export interface VoxelState {
  /** Temperature in Fahrenheit */
  temp: number;
  /** Moisture content as fraction of field capacity (0-1) */
  moisture: number;
  /** Oxygen concentration as fraction (0-0.21, where 0.21 = atmospheric) */
  oxygen: number;
  /** Age of material in days since addition (0 = fresh, affects bio activity) */
  materialAge: number;
  /** Bulk density in lbs/ft3 (affects thermal properties) */
  density: number;
}

/** Material type for each voxel — determines thermal/transport properties */
export type MaterialType =
  | 'compost'   // active compost mix (greens + browns)
  | 'air'       // plenum air cavity
  | 'brick'     // structural support
  | 'pipe'      // PVC aeration pipe
  | 'log'       // retaining log
  | 'ground'    // soil below the pile
  | 'membrane'  // ePTFE top cover
  | 'tarp'      // base tarp
  | 'straw';    // optional straw bale insulation

/** Thermal properties for a material */
export interface MaterialProperties {
  /** Thermal conductivity BTU/(hr*ft*F) */
  conductivity: number;
  /** Density lbs/ft3 */
  density: number;
  /** Specific heat BTU/(lb*F) */
  specificHeat: number;
  /** Derived: thermal diffusivity ft2/hr = k / (rho * c) */
  readonly diffusivity: number;
  /** O2 diffusion coefficient in2/hr (0 for solids) */
  o2Diffusivity: number;
  /** Porosity fraction (0-1, affects O2 transport) */
  porosity: number;
}

/** Lookup thermal properties by material type and moisture content */
export function getMaterialProperties(type: MaterialType, moisture: number = 0.5): MaterialProperties {
  const props = MATERIAL_PROPS[type];
  if (type !== 'compost') return props;

  // Compost properties vary with moisture
  // Conductivity increases ~linearly with moisture (water conducts 25x better than air)
  const kDry = 0.05;  // BTU/(hr*ft*F)
  const kWet = 0.30;
  const k = kDry + (kWet - kDry) * moisture;

  // Density increases with moisture
  const rhoDry = 25;  // lbs/ft3
  const rhoWet = 55;
  const rho = rhoDry + (rhoWet - rhoDry) * moisture;

  // Specific heat increases with moisture (water c = 1.0, dry organic c = 0.4)
  const c = 0.4 + 0.6 * moisture;

  // O2 diffusivity decreases with moisture (water fills pores, blocks gas)
  const o2Max = 40;   // in2/hr at 0% moisture
  const o2Min = 2;    // in2/hr at 100% moisture (nearly blocked)
  const o2D = o2Max - (o2Max - o2Min) * moisture;

  // Porosity decreases with moisture
  const porosity = 0.5 - 0.3 * moisture;

  return {
    conductivity: k,
    density: rho,
    specificHeat: c,
    get diffusivity() { return this.conductivity / (this.density * this.specificHeat); },
    o2Diffusivity: o2D,
    porosity,
  };
}

const MATERIAL_PROPS: Record<MaterialType, MaterialProperties> = {
  compost: createProps(0.15, 40, 0.6, 20, 0.35),
  air:     createProps(0.015, 0.075, 0.24, 300, 1.0),
  brick:   createProps(0.4, 120, 0.2, 0, 0),
  pipe:    createProps(0.1, 90, 0.25, 0, 0),     // PVC
  log:     createProps(0.08, 30, 0.6, 0, 0.05),
  ground:  createProps(0.5, 100, 0.2, 0, 0),
  membrane:createProps(0.01, 5, 0.25, 0.5, 0.1),  // thin, some air permeability
  tarp:    createProps(0.01, 6, 0.3, 0, 0),        // impermeable
  straw:   createProps(0.025, 5, 0.3, 15, 0.8),   // highly porous, good insulator
};

function createProps(
  conductivity: number, density: number, specificHeat: number,
  o2Diffusivity: number, porosity: number,
): MaterialProperties {
  return {
    conductivity, density, specificHeat, o2Diffusivity, porosity,
    get diffusivity() { return this.conductivity / (this.density * this.specificHeat); },
  };
}
