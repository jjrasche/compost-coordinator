/**
 * Dynamic fan controller — rule-based reactive controller for aeration.
 *
 * Replaces fixed duty cycle with real-time adaptation based on pile state.
 * Outputs onSeconds, offSeconds, and gateOpening that get programmed into
 * the ESP32 controller.
 *
 * DESIGN DECISIONS:
 * - Rule-based with hysteresis, not PID. Compost thermal response is too
 *   slow (hours) for proportional control to add value over thresholds.
 * - Hysteresis on all thresholds prevents rapid cycling (e.g., cool above
 *   145°F, stop cooling below 135°F).
 * - Each concern (temp, O2, moisture, cold protection) produces a demand
 *   signal (0-1). The orchestrator combines them into fan settings.
 *
 * PHYSICS BASIS:
 * - Temperature: thermophilic peak at 131-155°F. Above 155°F bacteria die.
 *   Fan cools via evaporative + sensible heat removal.
 * - O2: aerobic bacteria need >5%. Below 8%, anaerobic conditions develop.
 *   Fan replenishes O2 from ambient air.
 * - Moisture: fan removes moisture via evaporation. Below 45% FC, reduce
 *   fan to preserve moisture (drying kills activity).
 * - Cold: below freezing, fan pulls in cold air. Reduce fan to retain
 *   biological heat and prevent freeze-out.
 */

import type { StepSnapshot } from './tickStep';

// --- Types ---

/** Controller output: replacement fan settings for the next timestep */
export interface FanControllerOutput {
  onSeconds: number;
  offSeconds: number;
  gateOpening: number;
  /** Which concern is currently dominant (for UI display) */
  dominantConcern: DominantConcern;
}

export type DominantConcern = 'cooling' | 'oxygen' | 'moisture_protect' | 'cold_protect' | 'idle';

/** Persistent controller state for hysteresis tracking */
export interface FanControllerState {
  coolingActive: boolean;
  oxygenActive: boolean;
  moistureProtectActive: boolean;
  coldProtectActive: boolean;
}

export function createControllerState(): FanControllerState {
  return {
    coolingActive: false,
    oxygenActive: false,
    moistureProtectActive: false,
    coldProtectActive: false,
  };
}

// --- Demand signals (pure leaf functions, each returns 0-1) ---

/** Hysteresis threshold pair: activate when crossing into active zone, deactivate when leaving */
interface HysteresisThresholds {
  activate: number;
  deactivate: number;
}

// Temperature: Rosso (1993) cardinal model — activity peaks at 131-155°F, bacteria die above 160°F.
// Buffer below lethal zone: activate cooling at 145°F, stand down at 135°F.
const COOLING_THRESHOLDS: HysteresisThresholds = { activate: 145, deactivate: 135 };

// O2: aerobic threshold 5% (Haug 1993 ch. 4). Buffer: activate at 8%, stand down at 12%.
const OXYGEN_THRESHOLDS: HysteresisThresholds = { activate: 0.08, deactivate: 0.12 };

// Moisture: falling-rate drying transition at 55% FC (config.criticalMoisture).
// Buffer below: activate protection at 45% FC, stand down at 52% FC.
const MOISTURE_THRESHOLDS: HysteresisThresholds = { activate: 0.45, deactivate: 0.52 };

// Cold: fan pulls ambient air. Below 40°F, heat retention matters.
// Full protection at 10°F (Michigan winter lows, NOAA Grand Rapids normals).
const COLD_THRESHOLDS = { warm: 40, cold: 10 };

/**
 * Cooling demand: ramp 0→1 as core temp rises from deactivate→activate threshold.
 * Pure function — reads but does not modify state.
 */
export function computeCoolingDemand(coreTemp: number, isActive: boolean): number {
  const { activate, deactivate } = COOLING_THRESHOLDS;
  if (coreTemp >= activate) return 1.0;
  if (coreTemp <= deactivate) return 0;
  return isActive ? (coreTemp - deactivate) / (activate - deactivate) : 0;
}

/**
 * O2 demand: ramp 1→0 as O2 rises from activate→deactivate threshold.
 * Inverted sense: low O2 = high demand.
 */
export function computeOxygenDemand(avgOxygen: number, isActive: boolean): number {
  const { activate, deactivate } = OXYGEN_THRESHOLDS;
  if (avgOxygen <= activate) return 1.0;
  if (avgOxygen >= deactivate) return 0;
  return isActive ? (deactivate - avgOxygen) / (deactivate - activate) : 0;
}

/**
 * Moisture protection: ramp 1→0 as moisture rises from activate→deactivate.
 * High value = pile is dry, fan should be reduced.
 */
export function computeMoistureProtection(avgMoisture: number, isActive: boolean): number {
  const { activate, deactivate } = MOISTURE_THRESHOLDS;
  if (avgMoisture <= activate) return 1.0;
  if (avgMoisture >= deactivate) return 0;
  return isActive ? (deactivate - avgMoisture) / (deactivate - activate) : 0;
}

/**
 * Cold protection: linear ramp from warm (0) to cold (1).
 * No hysteresis — temperature is external input, not influenced by fan.
 */
export function computeColdProtection(ambientTemp: number): number {
  const { warm, cold } = COLD_THRESHOLDS;
  if (ambientTemp >= warm) return 0;
  if (ambientTemp <= cold) return 1.0;
  return (warm - ambientTemp) / (warm - cold);
}

// --- Concept functions ---

/** Update hysteresis state based on demand values crossing thresholds */
function updateHysteresis(state: FanControllerState, snapshot: StepSnapshot): void {
  const { activate: coolAct, deactivate: coolDeact } = COOLING_THRESHOLDS;
  if (snapshot.coreTemp >= coolAct) state.coolingActive = true;
  else if (snapshot.coreTemp <= coolDeact) state.coolingActive = false;

  const { activate: o2Act, deactivate: o2Deact } = OXYGEN_THRESHOLDS;
  if (snapshot.avgOxygen <= o2Act) state.oxygenActive = true;
  else if (snapshot.avgOxygen >= o2Deact) state.oxygenActive = false;

  const { activate: moistAct, deactivate: moistDeact } = MOISTURE_THRESHOLDS;
  if (snapshot.avgMoisture <= moistAct) state.moistureProtectActive = true;
  else if (snapshot.avgMoisture >= moistDeact) state.moistureProtectActive = false;

  state.coldProtectActive = snapshot.ambientTemp < (COLD_THRESHOLDS.warm + COLD_THRESHOLDS.cold) / 2;
}

interface DemandSignals {
  cooling: number;
  oxygen: number;
  moistureProtect: number;
  coldProtect: number;
}

/** Compute all four demand signals from snapshot + hysteresis state */
function computeDemandSignals(snapshot: StepSnapshot, state: FanControllerState): DemandSignals {
  return {
    cooling: computeCoolingDemand(snapshot.coreTemp, state.coolingActive),
    oxygen: computeOxygenDemand(snapshot.avgOxygen, state.oxygenActive),
    moistureProtect: computeMoistureProtection(snapshot.avgMoisture, state.moistureProtectActive),
    coldProtect: computeColdProtection(snapshot.ambientTemp),
  };
}

/** Identify which concern is dominant for UI display */
function pickDominantConcern(signals: DemandSignals): DominantConcern {
  const { cooling, oxygen, moistureProtect, coldProtect } = signals;
  const positiveDemand = Math.max(cooling, oxygen);
  const negativeDemand = Math.max(moistureProtect, coldProtect);

  if (positiveDemand <= 0.1 && negativeDemand <= 0.1) return 'idle';
  if (cooling >= oxygen && cooling >= negativeDemand) return 'cooling';
  if (oxygen >= cooling && oxygen >= negativeDemand) return 'oxygen';
  if (moistureProtect >= coldProtect) return 'moisture_protect';
  return 'cold_protect';
}

/**
 * Maximum negative attenuation factor.
 *
 * When both a positive demand (cooling/O2) and negative demand (moisture/cold)
 * are at 1.0 simultaneously, how much does the negative scale down the positive?
 *
 * Derived from thermal balance:
 *   - At 145°F core with 45% FC moisture, pile needs cooling but is drying out.
 *   - Complete fan shutoff (attenuation=1.0) risks thermal runaway past 160°F.
 *   - Minimum safe duty cycle at 145°F: ~30% of max (keeps core below 155°F).
 *   - So maximum attenuation = 1 - 0.30 = 0.70.
 */
const MAX_NEGATIVE_ATTENUATION = 0.70;

/** Fan timing bounds — derived from physical constraints */
const MIN_ON_SECONDS = 15;   // minimum to establish airflow through plenum
const MAX_ON_SECONDS = 120;  // longer runs waste energy, diminishing returns
const MIN_OFF_SECONDS = 120; // minimum rest for thermal mass to equilibrate
const MAX_OFF_SECONDS = 3600; // 1 hour max — must maintain some O2 baseline
const MIN_GATE = 0.10;       // below 10% gate, pressure drop kills flow
const MAX_GATE = 0.60;       // above 60%, cooling is too aggressive for most conditions

/** Combine four demand signals into a single net demand (0-1) */
function combineNetDemand(signals: DemandSignals): number {
  const positiveDemand = Math.max(signals.cooling, signals.oxygen);
  const negativeDemand = Math.max(signals.moistureProtect, signals.coldProtect);
  return positiveDemand * (1 - MAX_NEGATIVE_ATTENUATION * negativeDemand);
}

/** Map net demand (0-1) to concrete fan timing settings */
function mapDemandToFanSettings(netDemand: number): Pick<FanControllerOutput, 'onSeconds' | 'offSeconds' | 'gateOpening'> {
  return {
    onSeconds: Math.round(MIN_ON_SECONDS + netDemand * (MAX_ON_SECONDS - MIN_ON_SECONDS)),
    offSeconds: Math.round(MAX_OFF_SECONDS - netDemand * (MAX_OFF_SECONDS - MIN_OFF_SECONDS)),
    gateOpening: Math.round((MIN_GATE + netDemand * (MAX_GATE - MIN_GATE)) * 100) / 100,
  };
}

// --- Orchestrator ---

/**
 * Compute fan controller output from current pile state.
 * 1. Update hysteresis state
 * 2. Compute demand signals
 * 3. Combine into net demand
 * 4. Map to fan settings
 */
export function computeFanControl(
  snapshot: StepSnapshot,
  state: FanControllerState,
): FanControllerOutput {
  updateHysteresis(state, snapshot);
  const signals = computeDemandSignals(snapshot, state);
  const netDemand = combineNetDemand(signals);
  const fanSettings = mapDemandToFanSettings(netDemand);
  const dominantConcern = pickDominantConcern(signals);

  return { ...fanSettings, dominantConcern };
}
