import * as THREE from 'three';
import type { PlacedFeature } from '../core/types';
import { jumpProfile, footprint, localToWorldXZ, featureBaseY } from '../core/features';
import { sampleSurface, type TerrainData } from '../core/terrain';

let _shadowTex: THREE.CanvasTexture | null = null;
export function blobShadowTexture(): THREE.CanvasTexture {
  if (_shadowTex) return _shadowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
  g.addColorStop(0, 'rgba(20,32,48,0.42)');
  g.addColorStop(0.7, 'rgba(20,32,48,0.16)');
  g.addColorStop(1, 'rgba(20,32,48,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  _shadowTex = new THREE.CanvasTexture(c);
  return _shadowTex;
}

const MAT = {
  snow: new THREE.MeshStandardMaterial({ color: 0xf3f9ff, roughness: 0.92, metalness: 0 }),
  snowSide: new THREE.MeshStandardMaterial({ color: 0xcdddf0, roughness: 0.95 }),
  box: new THREE.MeshStandardMaterial({ color: 0x3a6ea5, roughness: 0.55, metalness: 0.1 }),
  boxTop: new THREE.MeshStandardMaterial({ color: 0xd7e6f7, roughness: 0.35, metalness: 0.25 }),
  metal: new THREE.MeshStandardMaterial({ color: 0xc9d4e2, roughness: 0.28, metalness: 0.85 }),
  rail: new THREE.MeshStandardMaterial({ color: 0xe23b3b, roughness: 0.4, metalness: 0.35 }),
  stair: new THREE.MeshStandardMaterial({ color: 0x8b98a8, roughness: 0.85 }),
  stairTop: new THREE.MeshStandardMaterial({ color: 0xe8f1fb, roughness: 0.9 }),
  pipe: new THREE.MeshStandardMaterial({ color: 0xeef6ff, roughness: 0.82, side: THREE.DoubleSide }),
};

function tagFeature(group: THREE.Group, id: string): THREE.Group {
  group.traverse((o) => {
    o.userData.featureId = id;
  });
  group.userData.featureId = id;
  return group;
}

function addBlobShadow(group: THREE.Group, sx: number, sz: number): void {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(sx, sz),
    new THREE.MeshBasicMaterial({
      map: blobShadowTexture(),
      transparent: true,
      depthWrite: false,
    }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.06;
  m.renderOrder = 1;
  group.add(m);
}

/** 跳台：沿纵剖面 Shape 挤出宽度，底边贴合自然地形，避免悬空 */
function buildJump(f: PlacedFeature, terrain: TerrainData | null): THREE.Group {
  const q = f.params;
  const prof = jumpProfile(q);
  const width = q.width ?? 5;
  const baseY = terrain ? featureBaseY(terrain, f) : 0;
  const groundRel = (s: number): number => {
    if (!terrain) return -3;
    const w = localToWorldXZ(f, s, 0);
    return sampleSurface(terrain, w.x, w.z) - baseY;
  };

  const sMin = -0.6;
  // 视觉体只做到落地坡后一小段；长缓冲区交给自然雪面，避免挤出长壳
  const sVisEnd = prof.landing.s1 + 2.5;
  const sMax = sVisEnd;
  const N = 44;
  // 底边贴着自然雪面（填筑截面）；剖面埋入雪面时退化为薄壳，避免深墙
  const bottomY = (s: number): number =>
    Math.min(groundRel(s) - 0.04, prof.surfaceY(s) - 0.12);
  const shape = new THREE.Shape();
  shape.moveTo(sMin, prof.surfaceY(sMin));
  for (let i = 1; i <= N; i++) {
    const s = sMin + ((sVisEnd - sMin) * i) / N;
    shape.lineTo(s, prof.surfaceY(s));
  }
  shape.lineTo(sVisEnd, bottomY(sVisEnd));
  for (let i = N; i >= 0; i--) {
    const s = sMin + ((sVisEnd - sMin) * i) / N;
    shape.lineTo(s, bottomY(s));
  }
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, steps: 1 });
  geo.translate(0, 0, -width / 2);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, [MAT.snow, MAT.snowSide]);
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  const g = new THREE.Group();
  g.add(mesh);

  // 起跳唇沿加深色耐磨条，提示起跳线
  const lip = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.05, width + 0.05),
    new THREE.MeshStandardMaterial({ color: 0x2b3a4d, roughness: 0.6 }),
  );
  lip.position.set(prof.lipS, prof.lipY + 0.03, 0);
  lip.rotation.z = prof.theta;
  g.add(lip);

  addBlobShadow(g, Math.max(8, prof.endS - prof.toeS), width + 3);
  return g;
}

function buildBox(f: PlacedFeature): THREE.Group {
  const L = f.params.length ?? 6;
  const w = f.params.width ?? 0.6;
  const h = f.params.height ?? 0.5;
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(L, h, w), MAT.box);
  body.position.y = h / 2;
  g.add(body);
  const top = new THREE.Mesh(new THREE.BoxGeometry(L + 0.08, 0.05, w + 0.1), MAT.boxTop);
  top.position.y = h + 0.025;
  g.add(top);
  addBlobShadow(g, L + 1.4, w + 1.6);
  return g;
}

function buildRail(f: PlacedFeature): THREE.Group {
  const L = f.params.length ?? 7;
  const h = f.params.height ?? 0.55;
  const r = f.params.radius ?? 0.05;
  const drop = f.params.drop ?? 0;
  const g = new THREE.Group();
  const angle = drop ? Math.atan2(drop, L) : 0;

  const rail = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, 14), MAT.rail);
  rail.rotation.z = Math.PI / 2 + angle;
  rail.position.y = h - (drop ? drop / 2 : 0);
  g.add(rail);

  const postN = Math.max(2, Math.round(L / 2.4));
  for (let i = 0; i <= postN; i++) {
    const s = -L / 2 + (L * i) / postN;
    const topY = h - (drop ? drop * (i / postN) : 0);
    const postH = topY + 0.9; // 插入雪中
    const post = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r * 0.7, postH, 8), MAT.metal);
    post.position.set(s, topY - postH / 2 + 0.05, 0);
    g.add(post);
  }
  addBlobShadow(g, L + 1.2, 1.4);
  return g;
}

function buildStairs(f: PlacedFeature): THREE.Group {
  const steps = Math.round(f.params.steps ?? 6);
  const sh = f.params.stepHeight ?? 0.18;
  const sd = f.params.stepDepth ?? 0.38;
  const W = f.params.width ?? 3;
  const g = new THREE.Group();
  const base = 1.4;
  for (let i = 0; i < steps; i++) {
    const topY = -i * sh;
    const block = new THREE.Mesh(new THREE.BoxGeometry(sd + 0.02, base, W), MAT.stair);
    block.position.set(i * sd + sd / 2, topY - base / 2, 0);
    g.add(block);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(sd + 0.04, 0.04, W + 0.08), MAT.stairTop);
    cap.position.set(i * sd + sd / 2, topY + 0.02, 0);
    g.add(cap);
  }
  const run = steps * sd;
  const rise = steps * sh;
  if ((f.params.rail ?? 1) >= 1) {
    const rh = f.params.railHeight ?? 0.95;
    const railLen = Math.hypot(run, rise);
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, railLen, 12), MAT.rail);
    rail.rotation.z = Math.PI / 2 + Math.atan2(rise, run);
    rail.position.set(run / 2, rh - rise / 2, 0);
    g.add(rail);
    for (let i = 0; i <= 3; i++) {
      const t = i / 3;
      const s = t * run;
      const topY = rh - t * rise;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, topY + 0.8, 8), MAT.metal);
      post.position.set(s, topY - (topY + 0.8) / 2 + 0.05, 0);
      g.add(post);
    }
  }
  addBlobShadow(g, run + 1.5, W + 1.4);
  return g;
}

/** U 型池：横截面 Shape（平底+圆弧过渡+垂直段+池沿）挤出池长 */
function buildHalfpipe(f: PlacedFeature): THREE.Group {
  const L = f.params.length ?? 90;
  const R = f.params.radius ?? 5.5;
  const fw = f.params.flatWidth ?? 5;
  const vert = f.params.vertHeight ?? 0.8;
  const deck = f.params.deckWidth ?? 2.5;
  const halfFlat = fw / 2;
  const topY = R + vert;
  const outerW = halfFlat + R + deck;

  const shape = new THREE.Shape();
  // 从左池沿外端底面开始
  shape.moveTo(-outerW, -2.5);
  shape.lineTo(-outerW, topY);
  shape.lineTo(-(halfFlat + R), topY);
  shape.lineTo(-(halfFlat + R), R);
  // 左过渡弧：圆心 (-halfFlat, R)，角度 -π -> -π/2
  shape.absarc(-halfFlat, R, R, Math.PI, Math.PI * 1.5, false);
  shape.lineTo(halfFlat, 0);
  // 右过渡弧：圆心 (halfFlat, R)，角度 -π/2 -> 0
  shape.absarc(halfFlat, R, R, -Math.PI / 2, 0, false);
  shape.lineTo(halfFlat + R, topY);
  shape.lineTo(outerW, topY);
  shape.lineTo(outerW, -2.5);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: L,
    bevelEnabled: false,
    steps: 1,
    curveSegments: 18,
  });
  // shape x=w, y=y, 挤出 z=length；旋转使长度对齐世界 s(x)
  geo.translate(0, 0, -L / 2);
  const mesh = new THREE.Mesh(geo, MAT.pipe);
  mesh.rotation.y = Math.PI / 2;
  // 旋转后需要重新居中：rotation 作用于 mesh，几何原点不变，OK
  const g = new THREE.Group();
  g.add(mesh);
  addBlobShadow(g, L + 4, outerW * 2 + 3);
  return g;
}

export function buildFeatureMesh(f: PlacedFeature, terrain: TerrainData | null): THREE.Group {
  let g: THREE.Group;
  switch (f.kind) {
    case 'jump':
      g = buildJump(f, terrain);
      break;
    case 'box':
      g = buildBox(f);
      break;
    case 'rail':
      g = buildRail(f);
      break;
    case 'stairs':
      g = buildStairs(f);
      break;
    case 'halfpipe':
      g = buildHalfpipe(f);
      break;
  }
  const baseY = terrain ? featureBaseY(terrain, f) : 0;
  g.position.set(f.x, baseY, f.z);
  g.rotation.y = f.yaw;
  g.userData.sig = JSON.stringify(f.params);
  tagFeature(g, f.id);
  void footprint;
  return g;
}
