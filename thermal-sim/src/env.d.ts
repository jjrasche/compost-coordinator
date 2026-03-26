/// <reference types="vite/client" />
/// <reference types="@webgpu/types" />

declare module '*.wgsl?raw' {
  const source: string;
  export default source;
}

// Fix TS 5.7+ strictness: Float32Array<ArrayBufferLike> vs GPUAllowSharedBufferSource
// WebGPU writeBuffer accepts any typed array at runtime; the type mismatch is a TS artifact.
declare interface GPUQueue {
  writeBuffer(
    buffer: GPUBuffer,
    bufferOffset: GPUSize64,
    data: AllowSharedBufferSource,
    dataOffset?: GPUSize64,
    size?: GPUSize64,
  ): void;
}
