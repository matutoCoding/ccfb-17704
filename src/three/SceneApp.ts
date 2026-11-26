import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Plan, GroomOp } from '../core/types';
import {
  ixToX,
  izToZ,
  indexAt,
  buildContours,
  sampleSurface,
  type TerrainData,
} from '../core/terrain';
import { buildGroomMask } from '../core/grooming';
import { createSnowMaterial, type SnowUniforms } from './snowMaterial';
import { buildFeatureMesh } from './featureMesh';
import { createFeature, featureBaseY } from '../core/features';
import type { JumpEval, PovSample } from '../core/course';
import type { ViewSettings } from '../ui/store';

export type ToolMode = 'orbit' | 'place' | 'groom';

export interface SceneHooks {
  onSelect?: (id: string | null) => void;
  onPlace?: (type: string, x: number, z: number) => void;
  onGroomClick?: (p: { x: number; z: number }) => void;
  onDragLive?: (id: string, x: number, z: number) => void;
  onDragEnd?: (id: string) => void;
  onFps?: (fps: number) => void;
  onPovTick?: (t: number, dur: number) => void;
  onPovEnd?: () => void;
}

interface PovState {
  samples: PovSample[];
  duration: number;
  time: number;
  playing: boolean;
  speed: number;
}

export class SceneApp {
  readonly container: HTMLElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly hooks: SceneHooks;

  private terrainRef: TerrainData | null = null;
  private lastSnowRef: Float32Array | null = null;
  private groomSig = '';
  private terrainMesh: THREE.Mesh | null = null;
  private snowMat: (THREE.ShaderMaterial & { uniforms: SnowUniforms }) | null = null;
  private groomTex: THREE.DataTexture | null = null;

  private featureGroup = new THREE.Group();
  private flightGroup = new THREE.Group();
  private haulGroup = new THREE.Group();
  private contourGroup = new THREE.Group();
  private groomPathGroup = new THREE.Group();
  private ghost: THREE.Group | null = null;
  private selectionBox: THREE.BoxHelper;

  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private downPos = { x: 0, y: 0 };
  private dragId: string | null = null;
  private dragOffset = { x: 0, z: 0 };
  private didDrag = false;

  mode: ToolMode = 'orbit';
  placeType: string | null = null;
  showGroomPaths = false;
  private plan: Plan | null = null;

  private pov: PovState | null = null;
  private clock = new THREE.Clock();
  private raf = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private dprCap = Math.min(window.devicePixelRatio || 1, 1.75);
  private currentDpr = this.dprCap;
  private lowFpsWindows = 0;
  private ro: ResizeObserver;
  private disposed = false;

  constructor(container: HTMLElement, hooks: SceneHooks = {}) {
    this.container = container;
    this.hooks = hooks;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.currentDpr);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';

    this.camera = new THREE.PerspectiveCamera(
      55,
      container.clientWidth / Math.max(1, container.clientHeight),
      0.3,
      2500,
    );
    this.camera.position.set(-158, 118, 150);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(-25, 2, -10);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 420;
    this.controls.update();

    this.scene.background = new THREE.Color(0xbdd8f2);
    this.scene.fog = new THREE.FogExp2(0xcfe2f5, 0.0016);

    this.hemi = new THREE.HemisphereLight(0xcfe6ff, 0x51606f, 0.95);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d8, 1.7);
    this.sun.position.set(-100, 95, 75);
    this.scene.add(this.sun);

    // 远处兜底大地
    const farGround = new THREE.Mesh(
      new THREE.CircleGeometry(1400, 48),
      new THREE.MeshStandardMaterial({ color: 0xdfeaf6, roughness: 1 }),
    );
    farGround.rotation.x = -Math.PI / 2;
    farGround.position.y = -55;
    this.scene.add(farGround);

    this.scene.add(this.featureGroup, this.flightGroup, this.haulGroup, this.contourGroup, this.groomPathGroup);

    this.selectionBox = new THREE.BoxHelper(new THREE.Object3D(), 0x22d3ee);
    this.selectionBox.visible = false;
    this.scene.add(this.selectionBox);

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('contextmenu', this.onContextMenu);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);

    this.loop();
  }

  // ---------------- 地形 ----------------

  private buildTerrainMesh(plan: Plan): void {
    const t = plan.terrain;
    if (this.terrainMesh) {
      this.scene.remove(this.terrainMesh);
      this.terrainMesh.geometry.dispose();
      (this.terrainMesh.material as THREE.Material).dispose();
      this.terrainMesh = null;
    }
    if (this.groomTex) this.groomTex.dispose();
    const mask = buildGroomMask(plan);
    this.groomTex = new THREE.DataTexture(mask, t.nx, t.nz, THREE.RGBAFormat);
    this.groomTex.minFilter = THREE.LinearFilter;
    this.groomTex.magFilter = THREE.LinearFilter;
    this.groomTex.needsUpdate = true;

    const geo = new THREE.BufferGeometry();
    const verts = t.nx * t.nz;
    const pos = new Float32Array(verts * 3);
    const uv = new Float32Array(verts * 2);
    const snowAttr = new Float32Array(verts);
    for (let iz = 0; iz < t.nz; iz++) {
      for (let ix = 0; ix < t.nx; ix++) {
        const i = indexAt(t, ix, iz);
        const x = ixToX(t, ix);
        const z = izToZ(t, iz);
        pos[i * 3] = x;
        pos[i * 3 + 1] = t.ground[i] + t.snow[i];
        pos[i * 3 + 2] = z;
        uv[i * 2] = ix / (t.nx - 1);
        uv[i * 2 + 1] = iz / (t.nz - 1);
        snowAttr[i] = t.snow[i];
      }
    }
    const idx: number[] = [];
    for (let iz = 0; iz < t.nz - 1; iz++) {
      for (let ix = 0; ix < t.nx - 1; ix++) {
        const a = indexAt(t, ix, iz);
        const b = a + 1;
        const c = a + t.nx;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('aSnow', new THREE.BufferAttribute(snowAttr, 1));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    this.snowMat = createSnowMaterial(this.groomTex);
    this.snowMat.uniforms.uThin.value = 0.6;
    const mesh = new THREE.Mesh(geo, this.snowMat);
    mesh.name = 'terrain';
    this.terrainMesh = mesh;
    this.scene.add(mesh);
    this.terrainRef = t;
    this.lastSnowRef = t.snow;
    this.groomSig = this.computeGroomSig(plan);
  }

  private computeGroomSig(plan: Plan): string {
    return (
      plan.groomOps.length +
      '|' +
      plan.groomPaths
        .map((p) => `${p.id}:${p.bladeWidth}:${p.points.length}:${p.points.map((q) => q.x.toFixed(1) + ',' + q.z.toFixed(1)).join(';')}`)
        .join('||')
    );
  }

  private updateTerrainHeights(plan: Plan): void {
    const t = plan.terrain;
    if (!this.terrainMesh || this.terrainRef !== t) {
      this.buildTerrainMesh(plan);
      return;
    }
    const geo = this.terrainMesh.geometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const snow = geo.getAttribute('aSnow') as THREE.BufferAttribute;
    for (let i = 0; i < t.nx * t.nz; i++) {
      pos.setY(i, t.ground[i] + t.snow[i]);
      snow.setX(i, t.snow[i]);
    }
    pos.needsUpdate = true;
    snow.needsUpdate = true;
    geo.computeVertexNormals();
    this.lastSnowRef = t.snow;
    this.updateGroomMask(plan);
    this.groomSig = this.computeGroomSig(plan);
  }

  /** 仅当推铲路径/层数变化时重建方向掩码，避免每次拖道具都重算 */
  private maybeUpdateGroomMask(plan: Plan): void {
    const sig = this.computeGroomSig(plan);
    if (sig !== this.groomSig) {
      this.updateGroomMask(plan);
      this.groomSig = sig;
    }
  }

  private updateGroomMask(plan: Plan): void {
    if (!this.groomTex) return;
    const mask = buildGroomMask(plan);
    const img = this.groomTex.image as { data: Uint8Array; width: number; height: number };
    img.data.set(mask);
    this.groomTex.needsUpdate = true;
  }

  // ---------------- 方案同步 ----------------

  sync(plan: Plan, selectedId: string | null): void {
    const terrainChanged = this.terrainRef !== plan.terrain;
    this.plan = plan;
    if (terrainChanged) {
      this.buildTerrainMesh(plan);
    } else if (this.lastSnowRef !== plan.terrain.snow) {
      this.updateTerrainHeights(plan);
    } else {
      this.maybeUpdateGroomMask(plan);
    }
    this.syncFeatures(plan);
    this.syncSelection(selectedId);
    this.refreshGroomPaths(plan);
  }

  private syncFeatures(plan: Plan): void {
    const existing = new Map<string, THREE.Group>();
    for (const child of [...this.featureGroup.children]) {
      const g = child as THREE.Group;
      if (g.userData.featureId) existing.set(g.userData.featureId, g);
    }
    const alive = new Set<string>();
    for (const f of plan.features) {
      alive.add(f.id);
      let g = existing.get(f.id);
      const sig = JSON.stringify(f.params);
      if (!g) {
        g = buildFeatureMesh(f, plan.terrain);
        this.featureGroup.add(g);
      } else if (g.userData.sig !== sig) {
        this.featureGroup.remove(g);
        this.disposeObject(g);
        g = buildFeatureMesh(f, plan.terrain);
        this.featureGroup.add(g);
      } else {
        const baseY = featureBaseY(plan.terrain, f);
        g.position.set(f.x, baseY, f.z);
        g.rotation.y = f.yaw;
      }
      g.userData.sig = sig;
    }
    for (const [id, g] of existing) {
      if (!alive.has(id)) {
        this.featureGroup.remove(g);
        this.disposeObject(g);
      }
    }
  }

  private syncSelection(id: string | null): void {
    if (!id) {
      this.selectionBox.visible = false;
      return;
    }
    let target: THREE.Object3D | null = null;
    this.featureGroup.children.forEach((c) => {
      if ((c as THREE.Group).userData.featureId === id) target = c;
    });
    if (target) {
      this.selectionBox.setFromObject(target);
      this.selectionBox.visible = true;
    } else {
      this.selectionBox.visible = false;
    }
  }

  focusFeature(id: string): void {
    let g: THREE.Group | undefined;
    this.featureGroup.children.forEach((c) => {
      if ((c as THREE.Group).userData.featureId === id) g = c as THREE.Group;
    });
    if (!g) return;
    const box = new THREE.Box3().setFromObject(g);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const p = sphere.center;
    const dist = THREE.MathUtils.clamp(sphere.radius * 2.4, 16, 110);
    const dir = new THREE.Vector3(-0.72, 0.5, 0.68).normalize();
    this.controls.target.copy(p);
    this.camera.position.copy(p).addScaledVector(dir, dist);
    this.controls.update();
  }

  frameAll(): void {
    this.controls.target.set(-25, 2, -10);
    this.camera.position.set(-158, 118, 150);
    this.controls.update();
  }

  // ---------------- 视图设置 ----------------

  applyView(v: ViewSettings): void {
    if (this.snowMat) {
      this.snowMat.uniforms.uHeat.value = v.heatmap ? 1 : 0;
      this.snowMat.uniforms.uCorduroy.value = v.corduroy ? 1 : 0;
    }
    const flat = v.lighting === 'flat' ? Math.max(0.55, v.flatAmount) : 0;
    this.sun.intensity = 1.35 * (1 - flat * 0.92);
    this.hemi.intensity = 0.8 + flat * 0.8;
    const sunCol = new THREE.Color(0xfff0d8).lerp(new THREE.Color(0xffffff), flat);
    this.sun.color.copy(sunCol);
    if (this.snowMat) {
      this.snowMat.uniforms.uSun.value.setRGB(
        2.15 * (1 - flat * 0.92),
        1.95 * (1 - flat * 0.86),
        1.62 * (1 - flat * 0.74),
      );
      this.snowMat.uniforms.uAmb.value
        .setRGB(0.115, 0.15, 0.235)
        .lerp(new THREE.Color(0.6, 0.63, 0.7), flat);
      this.snowMat.uniforms.uGlitter.value = v.glitter ? 1 - flat : 0;
    }
    const bg = new THREE.Color(0xbdd8f2).lerp(new THREE.Color(0xdde2e7), flat);
    (this.scene.background as THREE.Color).copy(bg);
    const fogCol = new THREE.Color(0xcfe2f5).lerp(new THREE.Color(0xdfe3e8), flat);
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.copy(fogCol);
      this.scene.fog.density = 0.0016 + flat * 0.0022;
    }
    if (this.snowMat) {
      this.snowMat.uniforms.uFogColor.value.copy(fogCol);
      this.snowMat.uniforms.uFogDensity.value = 0.0016 + flat * 0.0022;
    }
    this.contourGroup.visible = v.contours;
  }

  setThinThreshold(m: number): void {
    if (this.snowMat) this.snowMat.uniforms.uThin.value = m;
  }

  // ---------------- 模式与拾取 ----------------

  setMode(mode: ToolMode, placeType?: string): void {
    this.mode = mode;
    this.placeType = placeType ?? null;
    this.clearGhost();    if (mode === 'place' && placeType && this.plan) {
      const f = createFeature(placeType, 0, 0);
      const g = buildFeatureMesh(f, this.plan.terrain);
      g.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          const cloneMat = (m: THREE.Material) => {
            const mm = m.clone() as THREE.MeshStandardMaterial;
            mm.transparent = true;
            mm.opacity = 0.55;
            mm.depthWrite = false;
            return mm;
          };
          mesh.material = Array.isArray(mesh.material)
            ? mesh.material.map(cloneMat)
            : cloneMat(mesh.material as THREE.Material);
        }
      });
      g.visible = false;
      this.ghost = g;
      this.scene.add(g);
    }
    this.renderer.domElement.style.cursor = mode === 'orbit' ? 'grab' : 'crosshair';
  }

  private clearGhost(): void {
    if (this.ghost) {
      this.scene.remove(this.ghost);
      this.disposeObject(this.ghost, true);
      this.ghost = null;
    }
  }

  private setPointer(e: PointerEvent): void {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }

  private terrainPoint(e: PointerEvent): { x: number; y: number; z: number } | null {
    if (!this.terrainMesh) return null;
    this.setPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.terrainMesh, false)[0];
    return hit ? { x: hit.point.x, y: hit.point.y, z: hit.point.z } : null;
  }

  private featureAt(e: PointerEvent): string | null {
    this.setPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.featureGroup.children, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o) {
        if (o.userData?.featureId) return o.userData.featureId as string;
        o = o.parent;
      }
    }
    return null;
  }

  private onContextMenu = (e: Event) => e.preventDefault();

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.downPos = { x: e.clientX, y: e.clientY };
    this.didDrag = false;
    if (this.mode === 'orbit') {
      const id = this.featureAt(e);
      if (id) {
        this.dragId = id;
        const p = this.terrainPoint(e);
        const f = this.plan?.features.find((q) => q.id === id);
        if (p && f) this.dragOffset = { x: f.x - p.x, z: f.z - p.z };
        this.controls.enabled = false;
        this.hooks.onSelect?.(id);
      }
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y) > 5) this.didDrag = true;
    const p = this.terrainPoint(e);

    if (this.dragId && p) {
      const x = p.x + this.dragOffset.x;
      const z = p.z + this.dragOffset.z;
      const g = this.findGroup(this.dragId);
      if (g && this.plan) {
        const f = this.plan.features.find((q) => q.id === this.dragId);
        const y = f ? featureBaseY(this.plan.terrain, { ...f, x, z }) : sampleSurface(this.plan.terrain, x, z);
        g.position.set(x, y, z);
        this.selectionBox.setFromObject(g);
      }
      this.hooks.onDragLive?.(this.dragId, x, z);
      return;
    }

    if (this.mode === 'place' && this.ghost && p) {
      this.ghost.visible = true;
      this.ghost.position.set(p.x, p.y, p.z);
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.dragId) {
      const id = this.dragId;
      this.dragId = null;
      this.controls.enabled = true;
      this.hooks.onDragEnd?.(id);
      return;
    }
    if (this.didDrag) return; // 轨道旋转，不算点击
    if (this.mode === 'place' && this.placeType) {
      const p = this.terrainPoint(e as PointerEvent);
      if (p) this.hooks.onPlace?.(this.placeType, p.x, p.z);
    } else if (this.mode === 'groom') {
      const p = this.terrainPoint(e as PointerEvent);
      if (p) this.hooks.onGroomClick?.({ x: p.x, z: p.z });
    } else if (this.mode === 'orbit') {
      const id = this.featureAt(e as PointerEvent);
      this.hooks.onSelect?.(id);
    }
  };

  private findGroup(id: string): THREE.Group | undefined {
    return this.featureGroup.children.find(
      (c) => (c as THREE.Group).userData.featureId === id,
    ) as THREE.Group | undefined;
  }

  // ---------------- 等高线 / 压雪路径 ----------------

  setShowGroomPaths(v: boolean): void {
    this.showGroomPaths = v;
    if (this.plan) this.refreshGroomPaths(this.plan);
  }

  setContours(enabled: boolean, terrain: TerrainData): void {
    this.contourGroup.clear();
    if (!enabled) return;
    const levels = buildContours(terrain, 5);
    for (const lv of levels) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(lv.segments, 3));
      const line = new THREE.LineSegments(
        geo,
        new THREE.LineBasicMaterial({ color: 0x1f4e79, transparent: true, opacity: 0.55 }),
      );
      this.contourGroup.add(line);
    }
  }

  private refreshGroomPaths(plan: Plan): void {
    this.groomPathGroup.clear();
    if (this.mode !== 'groom' && !this.showGroomPaths) return;
    for (const path of plan.groomPaths) {
      if (path.points.length < 2) continue;
      const pts = path.points.map((p) => {
        const y = sampleSurface(plan.terrain, p.x, p.z) + 0.25;
        return new THREE.Vector3(p.x, y, p.z);
      });
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(
        geo,
        new THREE.LineDashedMaterial({ color: 0xf59e0b, dashSize: 2, gapSize: 1.2, linewidth: 2 }),
      );
      line.computeLineDistances();
      this.groomPathGroup.add(line);
      // 宽度示意带
      const bandPts: number[] = [];
      for (let i = 0; i < path.points.length - 1; i++) {
        const a = path.points[i];
        const b = path.points[i + 1];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const l = Math.hypot(dx, dz) || 1;
        const nx = (-dz / l) * (path.bladeWidth / 2);
        const nz = (dx / l) * (path.bladeWidth / 2);
        const corners = [
          [a.x + nx, a.z + nz],
          [a.x - nx, a.z - nz],
          [b.x + nx, b.z + nz],
          [b.x - nx, b.z - nz],
        ];
        const y = (x: number, z: number) => sampleSurface(plan.terrain, x, z) + 0.12;
        bandPts.push(corners[0][0], y(corners[0][0], corners[0][1]), corners[0][1]);
        bandPts.push(corners[1][0], y(corners[1][0], corners[1][1]), corners[1][1]);
        bandPts.push(corners[2][0], y(corners[2][0], corners[2][1]), corners[2][1]);
        bandPts.push(corners[1][0], y(corners[1][0], corners[1][1]), corners[1][1]);
        bandPts.push(corners[3][0], y(corners[3][0], corners[3][1]), corners[3][1]);
        bandPts.push(corners[2][0], y(corners[2][0], corners[2][1]), corners[2][1]);
      }
      const bandGeo = new THREE.BufferGeometry();
      bandGeo.setAttribute('position', new THREE.Float32BufferAttribute(bandPts, 3));
      const band = new THREE.Mesh(
        bandGeo,
        new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false }),
      );
      this.groomPathGroup.add(band);
    }
  }

  // ---------------- 轨迹 / 落点 ----------------

  clearFlight(): void {
    this.flightGroup.clear();
  }

  showFlight(jumps: JumpEval[], selectedId: string | null): void {
    this.clearFlight();
    for (const j of jumps) {
      const selected = j.featureId === selectedId;
      const color = j.level === 'ok' ? 0x22c55e : j.level === 'warn' ? 0xf59e0b : 0xef4444;
      const pts = j.trajectoryWorld.map((p) => new THREE.Vector3(p.x, p.y + 1.2, p.z));
      if (pts.length < 2) continue;

      if (selected) {
        const curve = new THREE.CatmullRomCurve3(pts);
        const tube = new THREE.Mesh(
          new THREE.TubeGeometry(curve, Math.min(220, pts.length * 2), 0.14, 8, false),
          new THREE.MeshBasicMaterial({ color }),
        );
        this.flightGroup.add(tube);
      } else {
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        this.flightGroup.add(
          new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5 })),
        );
      }

      if (selected && j.landingWorld) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(1.1, 1.7, 40),
          new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.95 }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(j.landingWorld.x, j.landingWorld.y + 0.18, j.landingWorld.z);
        ring.userData.pulse = true;
        this.flightGroup.add(ring);

        const pole = new THREE.Mesh(
          new THREE.CylinderGeometry(0.09, 0.09, 4, 10),
          new THREE.MeshBasicMaterial({ color }),
        );
        pole.position.set(j.landingWorld.x, j.landingWorld.y + 2, j.landingWorld.z);
        this.flightGroup.add(pole);
      }
    }
  }

  // ---------------- 挖填调运箭头 ----------------

  setHaul(op: GroomOp | null): void {
    this.haulGroup.clear();
    if (!op) return;
    const addBlob = (x: number, z: number, v: number, color: number) => {
      if (!this.plan) return;
      const r = Math.min(2.2, 0.35 + Math.cbrt(v) * 0.28);
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(r, 12, 8),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75 }),
      );
      m.position.set(x, sampleSurface(this.plan.terrain, x, z) + r * 0.7, z);
      this.haulGroup.add(m);
    };
    for (const s of op.sources.slice(0, 10)) addBlob(s.x, s.z, s.v, 0xf97316);
    for (const d of op.destinations.slice(0, 10)) addBlob(d.x, d.z, d.v, 0x0ea5e9);

    const arrow = (from: { x: number; z: number }, to: { x: number; z: number }, color: number) => {
      if (!this.plan) return;
      const fy = sampleSurface(this.plan.terrain, from.x, from.z) + 2.5;
      const ty = sampleSurface(this.plan.terrain, to.x, to.z) + 2.5;
      const dir = new THREE.Vector3(to.x - from.x, ty - fy, to.z - from.z);
      const len = dir.length();
      if (len < 1) return;
      const a = new THREE.ArrowHelper(dir.normalize(), new THREE.Vector3(from.x, fy, from.z), len, color, 2.2, 1.2);
      this.haulGroup.add(a);
    };
    arrow(op.centroidCut, op.centroidFill, 0xf59e0b);
    arrow(op.centroidFill, op.stockpile, 0x8b5cf6);
  }

  clearHaul(): void {
    this.haulGroup.clear();
  }

  // ---------------- 第一人称 ----------------

  startPov(samples: PovSample[]): void {
    if (samples.length < 2) return;
    const duration = samples[samples.length - 1].t || samples.length / 30;
    this.pov = { samples, duration, time: 0, playing: true, speed: 1 };
    this.controls.enabled = false;
  }
  setPovPlaying(playing: boolean): void {
    if (this.pov) this.pov.playing = playing;
  }
  setPovSpeed(s: number): void {
    if (this.pov) this.pov.speed = s;
  }
  seekPov(t: number): void {
    if (this.pov) this.pov.time = Math.max(0, Math.min(this.pov.duration, t));
  }
  stopPov(): void {
    this.pov = null;
    this.controls.enabled = true;
  }
  getPovTime(): { t: number; dur: number; playing: boolean } | null {
    return this.pov ? { t: this.pov.time, dur: this.pov.duration, playing: this.pov.playing } : null;
  }

  private updatePov(dt: number): void {
    const pov = this.pov;
    if (!pov) return;
    if (pov.playing) pov.time += dt * pov.speed;
    if (pov.time >= pov.duration) {
      pov.time = pov.duration;
      pov.playing = false;
      this.hooks.onPovEnd?.();
    }
    this.hooks.onPovTick?.(pov.time, pov.duration);

    const ss = pov.samples;
    const sampleAt = (time: number) => {
      let i = 0;
      while (i < ss.length - 2 && ss[i + 1].t < time) i++;
      const a = ss[i];
      const b = ss[Math.min(i + 1, ss.length - 1)];
      const span = Math.max(1e-6, b.t - a.t);
      const k = Math.min(1, Math.max(0, (time - a.t) / span));
      return {
        x: a.x + (b.x - a.x) * k,
        y: a.y + (b.y - a.y) * k,
        z: a.z + (b.z - a.z) * k,
      };
    };

    const p = sampleAt(pov.time);
    // 头部轻微起伏
    const bob = pov.playing ? Math.sin(pov.time * 9) * 0.05 : 0;
    this.camera.position.set(p.x, p.y + 1.62 + bob, p.z);

    // 注视 0.45s 后的路径点，朝向更平滑；限制俯仰避免看天/穿地
    const ahead = sampleAt(Math.min(pov.duration, pov.time + 0.45));
    const dx = ahead.x - p.x;
    const dz = ahead.z - p.z;
    const horiz = Math.max(0.001, Math.hypot(dx, dz));
    let dy = ahead.y - p.y;
    dy = THREE.MathUtils.clamp(dy, -0.5 * horiz, 0.32 * horiz);
    const look = new THREE.Vector3(p.x + dx, p.y + 1.62 + dy + 0.05, p.z + dz);
    this.camera.lookAt(look);
  }

  // ---------------- 主循环 / 性能 ----------------

  private resize(): void {
    const w = this.container.clientWidth;
    const h = Math.max(1, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;

    if (this.snowMat) this.snowMat.uniforms.uTime.value = t;
    if (this.snowMat) this.snowMat.uniforms.uCam.value.copy(this.camera.position);

    if (this.pov) this.updatePov(dt);
    else this.controls.update();

    // 落点脉冲
    this.flightGroup.children.forEach((c) => {
      if ((c as THREE.Mesh).userData.pulse) {
        const s = 1 + 0.12 * Math.sin(t * 5);
        c.scale.setScalar(s);
      }
    });

    this.renderer.render(this.scene, this.camera);

    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      const fps = this.fpsFrames / this.fpsAcc;
      this.hooks.onFps?.(Math.round(fps));
      // 自适应分辨率保 45fps
      if (fps < 45) this.lowFpsWindows++;
      else this.lowFpsWindows = Math.max(0, this.lowFpsWindows - 1);
      if (this.lowFpsWindows >= 3 && this.currentDpr > 0.8) {
        this.currentDpr = Math.max(0.8, this.currentDpr - 0.25);
        this.renderer.setPixelRatio(this.currentDpr);
        this.lowFpsWindows = 0;
      } else if (fps > 57 && this.currentDpr < this.dprCap) {
        this.currentDpr = Math.min(this.dprCap, this.currentDpr + 0.25);
        this.renderer.setPixelRatio(this.currentDpr);
      }
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
  };

  private disposeObject(obj: THREE.Object3D, disposeClonedMaterials = false): void {
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      if (disposeClonedMaterials) {
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      }
    });
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('contextmenu', this.onContextMenu);
    this.controls.dispose();
    this.renderer.dispose();
    el.parentElement?.removeChild(el);
  }
}
