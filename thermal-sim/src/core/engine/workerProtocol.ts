/**
 * Message protocol between main thread and simulation Web Worker.
 *
 * Main → Worker: RunMessage (config + weather + fan mode)
 * Worker → Main: ProgressMessage | CompleteMessage
 */

import type { SimulationConfig } from '../types/SimulationConfig';
import type { StepSnapshot } from './tickStep';
import type { GridStateSnapshot } from '../types/CompostGrid';
import type { SimEvent } from '../../viz/TimelineChart';

/** Pre-computed ambient conditions for each sim step (avoids shipping WeatherSchedule to worker) */
export interface StepWeather {
  tempF: number;
  rh: number;
}

/** Grid state checkpoint for scrubber 3D replay */
export interface GridCheckpoint {
  timeHours: number;
  state: GridStateSnapshot;
  snapshot: StepSnapshot;
}

// --- Main → Worker ---

export interface RunMessage {
  type: 'run';
  config: SimulationConfig;
  /** Per-step ambient conditions (length = totalSteps). Null = use config.boundaries fixed values. */
  weatherSteps: StepWeather[] | null;
  fanMode: 'manual' | 'auto';
  /** Sim hours between grid checkpoints (default 24) */
  checkpointIntervalHours: number;
}

export type WorkerInMessage = RunMessage;

// --- Worker → Main ---

export interface ProgressMessage {
  type: 'progress';
  /** 0-1 fraction complete */
  percent: number;
  currentDay: number;
  totalDays: number;
}

export interface CompleteMessage {
  type: 'complete';
  snapshots: StepSnapshot[];
  gridCheckpoints: GridCheckpoint[];
  events: SimEvent[];
}

export type WorkerOutMessage = ProgressMessage | CompleteMessage;
