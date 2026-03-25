import * as THREE from 'three';

/** Map temperature (F) to an RGB color for visualization */
export function tempToColor(tempF: number, target: THREE.Color): THREE.Color {
  // Frozen → blue → cyan → yellow → orange → red → dark red
  if (tempF < 32) return target.setRGB(0.15, 0.15, 0.47);
  if (tempF < 50) return lerpColor(target, 0.15, 0.15, 0.47, 0.24, 0.39, 0.71, (tempF - 32) / 18);
  if (tempF < 70) return lerpColor(target, 0.24, 0.39, 0.71, 0.31, 0.71, 0.86, (tempF - 50) / 20);
  if (tempF < 100) return lerpColor(target, 0.31, 0.71, 0.86, 1.0, 0.82, 0.2, (tempF - 70) / 30);
  if (tempF < 131) return lerpColor(target, 1.0, 0.82, 0.2, 1.0, 0.55, 0.16, (tempF - 100) / 31);
  if (tempF < 160) return lerpColor(target, 1.0, 0.55, 0.16, 0.86, 0.24, 0.16, (tempF - 131) / 29);
  return lerpColor(target, 0.86, 0.24, 0.16, 0.55, 0.08, 0.08, Math.min(1, (tempF - 160) / 30));
}

function lerpColor(
  target: THREE.Color,
  r1: number, g1: number, b1: number,
  r2: number, g2: number, b2: number,
  t: number,
): THREE.Color {
  return target.setRGB(
    r1 + (r2 - r1) * t,
    g1 + (g2 - g1) * t,
    b1 + (b2 - b1) * t,
  );
}

/** Map O2 fraction (0-0.21) to color */
export function o2ToColor(o2: number, target: THREE.Color): THREE.Color {
  const norm = Math.min(o2 / 0.21, 1);
  // Red (anoxic) → yellow → green (atmospheric)
  if (norm < 0.3) return lerpColor(target, 0.7, 0.1, 0.1, 0.9, 0.7, 0.1, norm / 0.3);
  return lerpColor(target, 0.9, 0.7, 0.1, 0.2, 0.8, 0.2, (norm - 0.3) / 0.7);
}

/** Map moisture (0-1 FC) to color */
export function moistureToColor(m: number, target: THREE.Color): THREE.Color {
  // Brown (dry) → green → blue (saturated)
  if (m < 0.3) return lerpColor(target, 0.6, 0.4, 0.2, 0.4, 0.7, 0.3, m / 0.3);
  if (m < 0.65) return lerpColor(target, 0.4, 0.7, 0.3, 0.2, 0.5, 0.8, (m - 0.3) / 0.35);
  return lerpColor(target, 0.2, 0.5, 0.8, 0.1, 0.2, 0.6, (m - 0.65) / 0.35);
}
