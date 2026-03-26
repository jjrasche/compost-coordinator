/**
 * Compost fan controller — ESP32 C++ translation of fanController.ts
 *
 * Rule-based reactive controller with hysteresis. Four demand signals
 * (cooling, O2, moisture protection, cold protection) combine into
 * fan duty cycle and blast gate settings.
 *
 * Inputs: core temp (thermistor), avg O2 (electrochemical sensor),
 *         avg moisture (capacitive probe), ambient temp (DHT22).
 * Outputs: onSeconds, offSeconds (relay timing), gatePct (servo position).
 *
 * No floating-point division at runtime — all ramps use pre-computed
 * reciprocals. Total: ~2KB flash, 5 bytes RAM (hysteresis state).
 */

#pragma once
#include <stdint.h>
#include <math.h>

// ─── Thresholds (matching fanController.ts exactly) ───

// Temperature: Rosso (1993) — thermophilic 131-155°F, lethal >160°F
static constexpr float COOL_ACTIVATE   = 145.0f;
static constexpr float COOL_DEACTIVATE = 135.0f;
static constexpr float COOL_RANGE_INV  = 1.0f / (COOL_ACTIVATE - COOL_DEACTIVATE);  // 0.1

// O2: aerobic threshold 5% (Haug 1993). Inverted sense: low O2 = high demand
static constexpr float O2_ACTIVATE   = 0.08f;
static constexpr float O2_DEACTIVATE = 0.12f;
static constexpr float O2_RANGE_INV  = 1.0f / (O2_DEACTIVATE - O2_ACTIVATE);  // 25.0

// Moisture: falling-rate transition at 55% FC. Protect below 45% FC.
static constexpr float MOIST_ACTIVATE   = 0.45f;
static constexpr float MOIST_DEACTIVATE = 0.52f;
static constexpr float MOIST_RANGE_INV  = 1.0f / (MOIST_DEACTIVATE - MOIST_ACTIVATE);  // ~14.3

// Cold: fan pulls ambient air. Below 40°F, retain biological heat.
static constexpr float COLD_WARM = 40.0f;
static constexpr float COLD_COLD = 10.0f;
static constexpr float COLD_RANGE_INV = 1.0f / (COLD_WARM - COLD_COLD);  // ~0.033

// ─── Fan timing bounds ───

static constexpr uint8_t  MIN_ON_SEC  = 15;
static constexpr uint8_t  MAX_ON_SEC  = 120;
static constexpr uint16_t MIN_OFF_SEC = 120;
static constexpr uint16_t MAX_OFF_SEC = 3600;
static constexpr uint8_t  MIN_GATE_PCT = 10;
static constexpr uint8_t  MAX_GATE_PCT = 60;

// Maximum negative attenuation (moisture/cold dampens cooling/O2 demand)
static constexpr float MAX_NEG_ATTEN = 0.70f;

// ─── Types ───

enum class DominantConcern : uint8_t {
  IDLE,
  COOLING,
  OXYGEN,
  MOISTURE_PROTECT,
  COLD_PROTECT,
};

struct FanOutput {
  uint8_t  onSeconds;
  uint16_t offSeconds;
  uint8_t  gatePct;       // 0-100
  DominantConcern concern;
};

struct SensorReadings {
  float coreTemp;     // °F (thermistor in center of pile)
  float avgOxygen;    // fraction 0-0.21 (electrochemical sensor)
  float avgMoisture;  // fraction of field capacity 0-1 (capacitive probe)
  float ambientTemp;  // °F (DHT22)
};

// ─── Hysteresis state (5 bytes RAM) ───

struct ControllerState {
  bool coolingActive;
  bool oxygenActive;
  bool moistureProtectActive;
  bool coldProtectActive;
};

// ─── Demand signal functions (pure, no side effects) ───

/** Cooling demand: ramp 0→1 as core temp rises from 135→145°F */
inline float computeCoolingDemand(float coreTemp, bool isActive) {
  if (coreTemp >= COOL_ACTIVATE)   return 1.0f;
  if (coreTemp <= COOL_DEACTIVATE) return 0.0f;
  return isActive ? (coreTemp - COOL_DEACTIVATE) * COOL_RANGE_INV : 0.0f;
}

/** O2 demand: ramp 1→0 as O2 rises from 8%→12%. Low O2 = high demand. */
inline float computeOxygenDemand(float avgO2, bool isActive) {
  if (avgO2 <= O2_ACTIVATE)   return 1.0f;
  if (avgO2 >= O2_DEACTIVATE) return 0.0f;
  return isActive ? (O2_DEACTIVATE - avgO2) * O2_RANGE_INV : 0.0f;
}

/** Moisture protection: ramp 1→0 as moisture rises from 45%→52% FC */
inline float computeMoistureProtection(float avgMoisture, bool isActive) {
  if (avgMoisture <= MOIST_ACTIVATE)   return 1.0f;
  if (avgMoisture >= MOIST_DEACTIVATE) return 0.0f;
  return isActive ? (MOIST_DEACTIVATE - avgMoisture) * MOIST_RANGE_INV : 0.0f;
}

/** Cold protection: linear ramp from warm (0) to cold (1). No hysteresis. */
inline float computeColdProtection(float ambientTemp) {
  if (ambientTemp >= COLD_WARM) return 0.0f;
  if (ambientTemp <= COLD_COLD) return 1.0f;
  return (COLD_WARM - ambientTemp) * COLD_RANGE_INV;
}

// ─── Hysteresis update ───

inline void updateHysteresis(ControllerState& state, const SensorReadings& readings) {
  if (readings.coreTemp >= COOL_ACTIVATE)        state.coolingActive = true;
  else if (readings.coreTemp <= COOL_DEACTIVATE)  state.coolingActive = false;

  if (readings.avgOxygen <= O2_ACTIVATE)           state.oxygenActive = true;
  else if (readings.avgOxygen >= O2_DEACTIVATE)    state.oxygenActive = false;

  if (readings.avgMoisture <= MOIST_ACTIVATE)      state.moistureProtectActive = true;
  else if (readings.avgMoisture >= MOIST_DEACTIVATE) state.moistureProtectActive = false;

  state.coldProtectActive = readings.ambientTemp < (COLD_WARM + COLD_COLD) * 0.5f;
}

// ─── Combiner + mapper ───

/** Combine four demand signals into net demand (0-1) */
inline float combineNetDemand(float cooling, float oxygen, float moistProtect, float coldProtect) {
  float positive = fmaxf(cooling, oxygen);
  float negative = fmaxf(moistProtect, coldProtect);
  return positive * (1.0f - MAX_NEG_ATTEN * negative);
}

/** Map net demand (0-1) to fan timing and gate position */
inline FanOutput mapDemandToOutput(float netDemand, float cooling, float oxygen,
                                    float moistProtect, float coldProtect) {
  FanOutput out;
  out.onSeconds  = (uint8_t)(MIN_ON_SEC  + netDemand * (MAX_ON_SEC  - MIN_ON_SEC)  + 0.5f);
  out.offSeconds = (uint16_t)(MAX_OFF_SEC - netDemand * (MAX_OFF_SEC - MIN_OFF_SEC) + 0.5f);
  out.gatePct    = (uint8_t)(MIN_GATE_PCT + netDemand * (MAX_GATE_PCT - MIN_GATE_PCT) + 0.5f);

  // Dominant concern (for status LED / display)
  float positive = fmaxf(cooling, oxygen);
  float negative = fmaxf(moistProtect, coldProtect);
  if (positive <= 0.1f && negative <= 0.1f)         out.concern = DominantConcern::IDLE;
  else if (cooling >= oxygen && cooling >= negative)  out.concern = DominantConcern::COOLING;
  else if (oxygen >= cooling && oxygen >= negative)   out.concern = DominantConcern::OXYGEN;
  else if (moistProtect >= coldProtect)               out.concern = DominantConcern::MOISTURE_PROTECT;
  else                                                out.concern = DominantConcern::COLD_PROTECT;

  return out;
}

// ─── Orchestrator (call this from loop()) ───

/**
 * Compute fan settings from sensor readings.
 * Call once per control interval (every 30-60 seconds).
 *
 * @param readings  Current sensor values
 * @param state     Persistent hysteresis state (survives across calls)
 * @return          Fan timing + gate + dominant concern
 */
inline FanOutput computeFanControl(const SensorReadings& readings, ControllerState& state) {
  updateHysteresis(state, readings);

  float cooling   = computeCoolingDemand(readings.coreTemp, state.coolingActive);
  float oxygen    = computeOxygenDemand(readings.avgOxygen, state.oxygenActive);
  float moistProt = computeMoistureProtection(readings.avgMoisture, state.moistureProtectActive);
  float coldProt  = computeColdProtection(readings.ambientTemp);

  float netDemand = combineNetDemand(cooling, oxygen, moistProt, coldProt);
  return mapDemandToOutput(netDemand, cooling, oxygen, moistProt, coldProt);
}

// ─── Fallback lookup table (populated from year sim validation) ───
// Use when sensors fail: ambient temp → conservative fan settings.
// Placeholder — populated by seasonValidation.test.ts output.

struct FanLookup {
  int8_t  ambientLow;
  int8_t  ambientHigh;
  uint8_t onSec;
  uint16_t offSec;
  uint8_t gatePct;
};

// TODO: populate from seasonValidation.test.ts output once year sim completes
// static constexpr FanLookup FALLBACK_LOOKUP[] = { ... };
