export { tickStep, runSimulation, addFreshMaterial, clearStageForTransfer, type StepSnapshot } from './tickStep';
export { computeHeatGeneration, tempActivityFactor, moistureActivityFactor, oxygenActivityFactor } from './bioActivity';
export { stepHeat, computeMaxTimestep } from './heatDiffusion';
export { solveOxygenSteadyState } from './oxygenSolver';
export { computeFanCooling, isFanOn } from './fanConvection';
export { updateMoisture } from './moistureTransport';
export { computeFanControl, createControllerState, type FanControllerOutput, type FanControllerState } from './fanController';
export type { WorkerInMessage, WorkerOutMessage, GridCheckpoint, StepWeather, RunMessage } from './workerProtocol';
