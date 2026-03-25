/**
 * Three.js 3D compost pile visualization.
 *
 * Renders the pile as a closed mesh using boundary face extraction:
 * for each compost voxel, emit a quad on each face that borders
 * non-compost (air, log, pipe, boundary). This produces a watertight
 * surface with correct top, sides, and bottom — no heightmap hacks.
 *
 * Each face is colored by the compost cell's field value (temp, O2, moisture).
 * Cut plane slices through the mesh to reveal internal distribution.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CompostGrid, MATERIAL_FROM_CODE, computeBrickLayout } from '../core/types/CompostGrid';
import type { SimulationConfig } from '../core/types/SimulationConfig';
import { tempToColor, o2ToColor, moistureToColor } from './tempColorScale';
import { AirflowParticles } from './AirflowParticles';

export type FieldType = 'temperature' | 'oxygen' | 'moisture';
export type CutAxis = 'x' | 'y' | 'z';

// Face normals and vertex offsets for the 6 cube faces
const FACE_NORMALS = [
  { axis: 'x', dir: -1, dx: 0, dy: 0, dz: 0 },  // -X (left)
  { axis: 'x', dir: 1,  dx: 1, dy: 0, dz: 0 },   // +X (right)
  { axis: 'y', dir: -1, dx: 0, dy: 0, dz: 0 },   // -Y (bottom)
  { axis: 'y', dir: 1,  dx: 0, dy: 1, dz: 0 },   // +Y (top)
  { axis: 'z', dir: -1, dx: 0, dy: 0, dz: 0 },   // -Z (front)
  { axis: 'z', dir: 1,  dx: 0, dy: 0, dz: 1 },   // +Z (back)
];

// Quad vertex offsets for each face direction (CCW winding)
const FACE_VERTS: number[][][] = [
  [[0,0,0],[0,1,0],[0,1,1],[0,0,1]], // -X
  [[1,0,1],[1,1,1],[1,1,0],[1,0,0]], // +X
  [[0,0,0],[0,0,1],[1,0,1],[1,0,0]], // -Y
  [[0,1,0],[1,1,0],[1,1,1],[0,1,1]], // +Y
  [[0,0,0],[1,0,0],[1,1,0],[0,1,0]], // -Z
  [[0,0,1],[0,1,1],[1,1,1],[1,0,1]], // +Z
];

export class PileScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;

  private pileMesh: THREE.Mesh | null = null;
  private pileWire: THREE.LineSegments | null = null;
  private pipeMesh: THREE.Mesh | null = null;
  private baseGroup: THREE.Group | null = null;
  private cutPlaneHelper: THREE.Mesh;
  private particles: AirflowParticles | null = null;

  private colorTemp = new THREE.Color();
  private lastFrameTime = 0;
  private lastSimTimeHours = 0;
  private storedConfig: SimulationConfig | null = null;

  field: FieldType = 'temperature';
  cutAxis: CutAxis = 'y';
  cutPosition: number = 1.0;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x1a1a2e);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
    this.camera.position.set(3.8, 1.8, 4.2);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(2, 0.15, 2);

    // Lighting
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(5, 8, 5);
    this.scene.add(dir);

    // Ground plane
    const groundGeo = new THREE.PlaneGeometry(10, 10);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x2a3a2a, roughness: 0.9 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(2, -0.01, 2);
    this.scene.add(ground);

    // Cut plane indicator
    const cutGeo = new THREE.PlaneGeometry(6, 6);
    const cutMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.06, side: THREE.DoubleSide,
    });
    this.cutPlaneHelper = new THREE.Mesh(cutGeo, cutMat);
    this.scene.add(this.cutPlaneHelper);

    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);
    this.animate();
  }

  /** Rebuild the pile mesh from the current grid state */
  updateFromGrid(grid: CompostGrid, config?: SimulationConfig, fanOn = false, simTimeHours = 0): void {
    // Particle system: create on first call with config, update on subsequent calls
    if (config) {
      if (!this.particles) {
        this.particles = new AirflowParticles(grid, config);
        this.scene.add(this.particles.points);
      } else {
        // Detect scrubber seek (time jumped backward) → reset particles
        if (simTimeHours < this.lastSimTimeHours - 0.5) {
          this.particles.reset();
        }
        this.particles.updateGridReference(grid, config, fanOn);
      }
      this.lastSimTimeHours = simTimeHours;
      this.storedConfig = config;
    }
    const { nx, ny, nz } = grid;
    const scale = grid.resolution / 12; // cell size in feet

    // Determine cut plane boundary
    const cutIdx = this.getCutIndex(grid);

    // Extract boundary faces
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];

    for (let y = 0; y < ny; y++) {
      for (let z = 0; z < nz; z++) {
        for (let x = 0; x < nx; x++) {
          const i = grid.idx(x, y, z);
          const matType = MATERIAL_FROM_CODE[grid.material[i]];
          if (matType !== 'compost') continue;

          // Cut plane: skip voxels beyond the cut
          if (!this.isVisible(x, y, z, cutIdx)) continue;

          // Get color for this cell
          this.colorizeCell(grid, i);
          const cr = this.colorTemp.r, cg = this.colorTemp.g, cb = this.colorTemp.b;

          // Check each of the 6 faces
          for (let f = 0; f < 6; f++) {
            const fn = FACE_NORMALS[f];
            const nx2 = x + (fn.axis === 'x' ? fn.dir : 0);
            const ny2 = y + (fn.axis === 'y' ? fn.dir : 0);
            const nz2 = z + (fn.axis === 'z' ? fn.dir : 0);

            // Emit face if neighbor is not compost
            let emitFace = false;
            if (!grid.inBounds(nx2, ny2, nz2)) {
              emitFace = true;
            } else {
              const neighborMat = MATERIAL_FROM_CODE[grid.material[grid.idx(nx2, ny2, nz2)]];
              if (neighborMat !== 'compost') {
                emitFace = true;
              }
            }
            if (!emitFace && grid.inBounds(nx2, ny2, nz2) && !this.isVisible(nx2, ny2, nz2, cutIdx)) {
              // Neighbor is beyond cut plane — emit face to show cross-section
              emitFace = true;
            }

            if (!emitFace) continue;

            // Emit 4 vertices for the quad
            const baseVert = positions.length / 3;
            const verts = FACE_VERTS[f];
            for (const v of verts) {
              positions.push(
                (x + v[0]) * scale,
                (y + v[1]) * scale,
                (z + v[2]) * scale,
              );
              // Slight shading variation per face direction for depth
              const shade = fn.axis === 'y' ? (fn.dir > 0 ? 1.0 : 0.6)
                          : fn.axis === 'x' ? 0.85 : 0.75;
              colors.push(cr * shade, cg * shade, cb * shade);
            }

            // Two triangles for the quad
            indices.push(
              baseVert, baseVert + 1, baseVert + 2,
              baseVert, baseVert + 2, baseVert + 3,
            );
          }
        }
      }
    }

    // Build or rebuild mesh
    if (this.pileMesh) this.scene.remove(this.pileMesh);
    if (this.pileWire) this.scene.remove(this.pileWire);

    if (positions.length === 0) {
      this.pileMesh = null;
      this.pileWire = null;
    } else {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();

      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.8,
        metalness: 0.0,
        side: THREE.FrontSide,
      });
      this.pileMesh = new THREE.Mesh(geo, mat);
      this.scene.add(this.pileMesh);

      // Subtle wireframe overlay — every voxel face edge visible for measurement
      const wireGeo = new THREE.WireframeGeometry(geo); // all edges, every triangle
      const wireMat = new THREE.LineBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.08,
      });
      this.pileWire = new THREE.LineSegments(wireGeo, wireMat);
      this.scene.add(this.pileWire);
    }

    // Base platform (bricks, hardware cloth, pipe) — rebuild if needed
    if (this.baseGroup) { this.scene.remove(this.baseGroup); this.baseGroup = null; }
    this.buildBase(grid, scale);

    // Cut plane helper
    if (this.cutPosition < 0.99) {
      this.cutPlaneHelper.visible = true;
      this.updateCutPlaneHelper(grid, scale);
    } else {
      this.cutPlaneHelper.visible = false;
    }
  }

  private colorizeCell(grid: CompostGrid, i: number): void {
    switch (this.field) {
      case 'temperature': tempToColor(grid.temp[i], this.colorTemp); break;
      case 'oxygen': o2ToColor(grid.oxygen[i], this.colorTemp); break;
      case 'moisture': moistureToColor(grid.moisture[i], this.colorTemp); break;
    }
  }

  private isVisible(x: number, y: number, z: number, cutIdx: number): boolean {
    switch (this.cutAxis) {
      case 'x': return x <= cutIdx;
      case 'y': return y <= cutIdx;
      case 'z': return z <= cutIdx;
    }
  }

  private getCutIndex(grid: CompostGrid): number {
    switch (this.cutAxis) {
      case 'x': return Math.min(grid.nx - 1, Math.floor(this.cutPosition * grid.nx));
      case 'y': return Math.min(grid.ny - 1, Math.floor(this.cutPosition * grid.ny));
      case 'z': return Math.min(grid.nz - 1, Math.floor(this.cutPosition * grid.nz));
    }
  }

  /** Build the base platform: tarp, bricks, hardware cloth, pipe, logs (external). */
  private buildBase(grid: CompostGrid, scale: number): void {
    this.baseGroup = new THREE.Group();
    const { nx, nz } = grid;
    const maxX = nx * scale;
    const maxZ = nz * scale;
    const plenumCellsY = Math.ceil(2.25 / grid.resolution);
    const plenumH = plenumCellsY * scale;

    // Tarp — dark surface on ground, extends slightly past pile
    const tarpOverhang = 0.3; // feet past pile on each side
    const tarpGeo = new THREE.PlaneGeometry(maxX + tarpOverhang * 2, maxZ + tarpOverhang * 2);
    const tarpMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a1a, roughness: 0.95, side: THREE.DoubleSide,
    });
    const tarp = new THREE.Mesh(tarpGeo, tarpMat);
    tarp.rotation.x = -Math.PI / 2;
    tarp.position.set(maxX / 2, 0.005, maxZ / 2);
    this.baseGroup.add(tarp);

    // Bricks — optimized placement (avoids pipe lane + hole exit zones)
    const brickGeo = new THREE.BoxGeometry(scale * 0.8, plenumH, scale * 0.8);
    const brickMat = new THREE.MeshStandardMaterial({ color: 0x9B7024, roughness: 0.9 });
    if (this.storedConfig) {
      for (const { x, z } of computeBrickLayout(this.storedConfig)) {
        const brick = new THREE.Mesh(brickGeo, brickMat);
        brick.position.set((x + 0.5) * scale, plenumH * 0.5, (z + 0.5) * scale);
        this.baseGroup.add(brick);
      }
    }

    // Hardware cloth — full footprint
    const clothGeo = new THREE.PlaneGeometry(maxX - scale, maxZ - scale);
    const clothMat = new THREE.MeshStandardMaterial({
      color: 0x999999, roughness: 0.3, metalness: 0.6,
      transparent: true, opacity: 0.4, side: THREE.DoubleSide,
    });
    const cloth = new THREE.Mesh(clothGeo, clothMat);
    cloth.rotation.x = -Math.PI / 2;
    cloth.position.set(maxX / 2, plenumH + 0.001, maxZ / 2);
    this.baseGroup.add(cloth);

    // Hardware cloth grid lines
    const clothWireGeo = new THREE.PlaneGeometry(maxX - scale, maxZ - scale,
      Math.round((maxX - scale) / scale), Math.round((maxZ - scale) / scale));
    const clothWire = new THREE.WireframeGeometry(clothWireGeo);
    const clothWireMat = new THREE.LineBasicMaterial({
      color: 0x888888, transparent: true, opacity: 0.2,
    });
    const clothLines = new THREE.LineSegments(clothWire, clothWireMat);
    clothLines.rotation.x = -Math.PI / 2;
    clothLines.position.set(maxX / 2, plenumH + 0.002, maxZ / 2);
    this.baseGroup.add(clothLines);

    // Pipe — gray cylinder along Z axis, full width
    const pipeRadiusFt = (this.storedConfig?.aeration.pipeDiameter ?? 4) / 2 / 12;
    const pipeLen = maxZ - scale;
    const pipeGeo = new THREE.CylinderGeometry(pipeRadiusFt, pipeRadiusFt, pipeLen, 12);
    const pipeMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.4 });
    const pipe = new THREE.Mesh(pipeGeo, pipeMat);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(maxX / 2, plenumH * 0.5, maxZ / 2);
    this.baseGroup.add(pipe);

    // Pipe holes — small bright spheres on upper arc (9→12→3 o'clock)
    // Upper arc directs air upward through hardware cloth into compost
    const aeration = this.storedConfig?.aeration;
    const holeSpacingFt = (aeration?.holeSpacing ?? 4) / 12;
    const holeDiameterFt = (aeration?.holeDiameter ?? 3/8) / 12;
    const holeGeo = new THREE.SphereGeometry(holeDiameterFt * 1.5, 6, 6); // slightly oversized for visibility
    const holeMat = new THREE.MeshBasicMaterial({ color: 0x88ccff });
    const holesPerRing = this.storedConfig?.aeration.holesPerRing ?? 3;
    const arcStart = -Math.PI / 2;  // 9 o'clock
    const arcSpan = Math.PI;        // sweep to 3 o'clock
    const holeAngles = holesPerRing === 1
      ? [0]  // single hole points straight up (12 o'clock)
      : Array.from({ length: holesPerRing }, (_, k) => arcStart + k * arcSpan / (holesPerRing - 1));
    const pipeStartZ = scale * 0.5;
    const pipeEndZ = maxZ - scale * 0.5;
    for (let z = pipeStartZ + holeSpacingFt; z < pipeEndZ; z += holeSpacingFt) {
      for (const angle of holeAngles) {
        const hx = maxX / 2 + Math.sin(angle) * pipeRadiusFt;
        const hy = plenumH * 0.5 + Math.cos(angle) * pipeRadiusFt;
        const hole = new THREE.Mesh(holeGeo, holeMat);
        hole.position.set(hx, hy, z);
        this.baseGroup.add(hole);
      }
    }

    // Logs — horizontal cylinders lying on ground OUTSIDE the pile on 3 sides
    // (4th side is removable for monthly transfer)
    const logDiameter = (this.storedConfig?.boundaries.logDiameter ?? 6) / 12;
    const logRadius = logDiameter / 2;
    const logMat = new THREE.MeshStandardMaterial({ color: 0x5a3a1a, roughness: 0.9 });

    // Back log (-Z side)
    const backLogGeo = new THREE.CylinderGeometry(logRadius, logRadius, maxX + 0.2, 8);
    const backLog = new THREE.Mesh(backLogGeo, logMat);
    backLog.rotation.z = Math.PI / 2; // lie along X
    backLog.position.set(maxX / 2, logRadius, -logRadius - 0.02);
    this.baseGroup.add(backLog);

    // Left log (-X side)
    const sideLogGeo = new THREE.CylinderGeometry(logRadius, logRadius, maxZ + 0.2, 8);
    const leftLog = new THREE.Mesh(sideLogGeo, logMat);
    leftLog.rotation.x = Math.PI / 2; // lie along Z
    leftLog.position.set(-logRadius - 0.02, logRadius, maxZ / 2);
    this.baseGroup.add(leftLog);

    // Right log (+X side)
    const rightLog = new THREE.Mesh(sideLogGeo, logMat);
    rightLog.rotation.x = Math.PI / 2;
    rightLog.position.set(maxX + logRadius + 0.02, logRadius, maxZ / 2);
    this.baseGroup.add(rightLog);

    // Front (+Z side) — no log, this is the removable side for monthly transfer

    this.scene.add(this.baseGroup);
  }

  private updateCutPlaneHelper(grid: CompostGrid, scale: number): void {
    const maxX = grid.nx * scale;
    const maxY = grid.ny * scale;
    const maxZ = grid.nz * scale;

    switch (this.cutAxis) {
      case 'x':
        this.cutPlaneHelper.rotation.set(0, Math.PI / 2, 0);
        this.cutPlaneHelper.position.set(this.cutPosition * maxX, maxY / 2, maxZ / 2);
        break;
      case 'y':
        this.cutPlaneHelper.rotation.set(Math.PI / 2, 0, 0);
        this.cutPlaneHelper.position.set(maxX / 2, this.cutPosition * maxY, maxZ / 2);
        break;
      case 'z':
        this.cutPlaneHelper.rotation.set(0, 0, 0);
        this.cutPlaneHelper.position.set(maxX / 2, maxY / 2, this.cutPosition * maxZ);
        break;
    }
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);

    const now = performance.now() / 1000; // seconds
    const dt = this.lastFrameTime > 0 ? Math.min(now - this.lastFrameTime, 0.05) : 0; // cap at 50ms
    this.lastFrameTime = now;

    if (this.particles && dt > 0) {
      this.particles.tick(dt);
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    this.particles?.dispose();
    this.renderer.dispose();
    this.controls.dispose();
  }
}
