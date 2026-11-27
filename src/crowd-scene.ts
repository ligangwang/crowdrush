/**
 * Crowd Rush 3D — a three.js view of the same world that crowd-core runs.
 *
 * The characters are built from code (crowd-figures): low-poly figures with
 * flat shading and no model files. The squad and the brutes are drawn with
 * InstancedMesh from baked animation frames, so a squad of 140 runners costs
 * a handful of draw calls. The land and the roadblocks are photographs and
 * scans (crowd-land, crowd-models).
 *
 * Coordinates: crowd-core uses x in [-1, 1] across the road and z in metres
 * along it. Here X = x * ROAD, Y is up and Z = -z, so the squad runs toward
 * -Z and the camera looks down -Z.
 */
import * as THREE from "three";
import {
  BOSS_FALL,
  BOSS_IMPACT,
  BOSS_STOP,
  crowdRadius,
  opLabel,
  rng,
  squadRadius,
  type Block,
  packSize,
  firepower,
  volley,
  type Coin,
  type Gate,
  type Monster,
  type Upgrade,
  type BossKind,
  type World,
} from "./crowd-core";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { PROP_URLS, loadModel, propModel, type Props } from "./crowd-models";
import {
  RUN_FRAMES,
  bakeBrute,
  bakeSoldier,
  brute,
  recolor,
  restOf,
  rex,
  rexPose,
  warlordPose,
  type Baked,
  type Figure,
  type Joints,
} from "./crowd-figures";
import {
  HAZE,
  farHills,
  SUN_DIR,
  forest,
  groundMaterial,
  preloadLand,
  shadeTexture,
  skyDome,
  skyLight,
  texture,
  tileUv,
  treeHeight,
  type TreeSpot,
} from "./crowd-land";

/** Metres per road unit: the road is 2 × ROAD wide. */
export const ROAD = 3.4;
/** People drawn per squad; the count label shows the real number. */
export const MAX_DRAWN = 140;
const VIEW_AHEAD = 120;
const VIEW_BEHIND = 12;

export const TEAM = 0x3ea6ff;
export const RIVAL = 0xff5a5f;

export type SceneFx = {
  clock: number;
  shake: number;
  bossHit: number;
  slamAnim: number;
  /** Seconds since the boss was beaten, or -1 while it stands. */
  bossDown: number;
  sparks: {
    x: number;
    z: number;
    h: number;
    life: number;
    max: number;
    color: string;
    size: number;
  }[];
};

const flat = (
  color: number,
  extra: THREE.MeshStandardMaterialParameters = {},
) =>
  new THREE.MeshStandardMaterial({
    color,
    flatShading: true,
    roughness: 0.8,
    metalness: 0,
    ...extra,
  });

/** Formation slot i of n inside an ellipse: a sunflower spiral. */
function slot(i: number, n: number, rx: number, rz: number) {
  const r = n === 1 ? 0 : Math.sqrt((i + 0.5) / n);
  const a = i * 2.39996;
  return { x: Math.cos(a) * r * rx, z: Math.sin(a) * r * rz };
}
/** How deep a crowd of n runners is, so they are not packed shoulder to shoulder. */
function crowdDepth(n: number, rx: number) {
  return Math.min(3.2, Math.max(rx, (n * 0.16) / (Math.PI * rx)));
}

/** A set of InstancedMeshes that share instance slots, one per body part. */
class Parts {
  meshes: THREE.InstancedMesh[] = [];
  used = 0;
  constructor(
    scene: THREE.Scene,
    parts: { geo: THREE.BufferGeometry; mat: THREE.Material; per?: number }[],
    readonly capacity: number,
    shadows = true,
  ) {
    for (const p of parts) {
      const mesh = new THREE.InstancedMesh(
        p.geo,
        p.mat,
        capacity * (p.per ?? 1),
      );
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = shadows;
      mesh.frustumCulled = false;
      mesh.count = 0;
      scene.add(mesh);
      this.meshes.push(mesh);
    }
  }
  finish() {
    for (const m of this.meshes) {
      m.count = Math.min(m.instanceMatrix.count, this.used * this.perOf(m));
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    this.used = 0;
  }
  private perOf(m: THREE.InstancedMesh) {
    return m.instanceMatrix.count / this.capacity;
  }
}

const _m = new THREE.Matrix4();
const _local = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _v = new THREE.Vector3();

function base(x: number, y: number, z: number, yaw: number, s: number) {
  _q.setFromEuler(_e.set(0, yaw, 0));
  return _m.compose(_p.set(x, y, z), _q, _s.set(s, s, s));
}
function local(
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
  sx = 1,
  sy = 1,
  sz = 1,
) {
  _q.setFromEuler(_e.set(rx, ry, rz));
  return _local.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}
const _out = new THREE.Matrix4();
function put(
  mesh: THREE.InstancedMesh,
  i: number,
  b: THREE.Matrix4,
  l: THREE.Matrix4,
) {
  _out.multiplyMatrices(b, l);
  mesh.setMatrixAt(i, _out);
}

/**
 * Baked animation frames drawn with one InstancedMesh per frame and colour
 * variant. Each instance picks the frame for its point in the cycle.
 */
class FrameSet {
  private meshes: THREE.InstancedMesh[][];
  private used: number[][];
  readonly frames: number;
  constructor(
    scene: THREE.Scene,
    baked: Baked,
    variants: THREE.BufferAttribute[],
    readonly capacity: number,
    readonly scale: number,
  ) {
    this.frames = baked.frames.length;
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.85,
      metalness: 0,
    });
    this.meshes = variants.map((color) =>
      baked.frames.map((f) => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", f.getAttribute("position"));
        geo.setAttribute("normal", f.getAttribute("normal"));
        geo.setAttribute("color", color);
        const mesh = new THREE.InstancedMesh(geo, mat, capacity);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        mesh.count = 0;
        scene.add(mesh);
        return mesh;
      }),
    );
    this.used = variants.map(() => baked.frames.map(() => 0));
  }
  add(variant: number, frame: number, m: THREE.Matrix4) {
    const u = this.used[variant];
    if (u[frame] >= this.capacity) return;
    this.meshes[variant][frame].setMatrixAt(u[frame]++, m);
  }
  finish() {
    for (const [v, row] of this.meshes.entries())
      for (const [f, mesh] of row.entries()) {
        mesh.count = this.used[v][f];
        mesh.instanceMatrix.needsUpdate = true;
        this.used[v][f] = 0;
      }
  }
}

/** Soft round shadows under the instanced characters, far cheaper than shadow maps. */
class Blobs {
  private mesh: THREE.InstancedMesh;
  private used = 0;
  constructor(scene: THREE.Scene) {
    const geo = new THREE.CircleGeometry(1, 12);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(
      geo,
      new THREE.MeshBasicMaterial({
        color: 0x1d2a1a,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      }),
      900,
    );
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }
  add(X: number, Z: number, r: number) {
    if (this.used >= 900) return;
    this.mesh.setMatrixAt(this.used++, local(X, 0.03, Z, 0, 0, 0, r, 1, r));
  }
  finish() {
    this.mesh.count = this.used;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.used = 0;
  }
}

/** The squad: soldiers drawn from baked run frames, each with the squad's gun. */
class Runners {
  private model: FrameSet;
  /** One gun per damage level, drawn in the runners' hands. */
  private guns: FrameSet[];
  constructor(
    scene: THREE.Scene,
    readonly capacity: number,
    private blobs: Blobs,
  ) {
    const { body, guns } = bakeSoldier();
    const scale = 1.15 / body.height;
    this.model = new FrameSet(
      scene,
      body,
      [
        recolor(body, { jacket: 0x2f7fe0, helmet: 0x1d4f9a }),
        recolor(body, { jacket: 0xd9363e, helmet: 0x7a1a20 }),
      ],
      capacity,
      scale,
    );
    this.guns = guns.map(
      (g) =>
        new FrameSet(
          scene,
          g,
          [g.frames[0].getAttribute("color") as THREE.BufferAttribute],
          capacity,
          scale,
        ),
    );
  }
  /** Draws a squad of `count` around road position (x, z). */
  squad(
    x: number,
    z: number,
    count: number,
    radius: number,
    color: number,
    facing: 1 | -1,
    clock: number,
    running: boolean,
    lean: number,
    tier = 0,
  ) {
    const n = Math.min(count, MAX_DRAWN);
    const rx = radius * ROAD * 1.1;
    const rz = crowdDepth(n, rx);
    // the crowd bunches forward a little so its tail stays on screen
    const ahead = rz * 0.3 * facing;
    const model = this.model;
    const variant = color === TEAM ? 0 : 1;
    const gun = this.guns[Math.min(tier, this.guns.length - 1)];
    // the soldier faces +Z, so the squad (running toward -Z) turns round
    const myaw = facing === 1 ? Math.PI + lean : lean;
    for (let i = 0; i < n; i++) {
      const s = slot(i, n, rx, rz);
      const X = x * ROAD + s.x;
      const Z = -z - s.z * facing - ahead;
      const frame = running
        ? Math.floor(((((clock * 1.5 + i * 0.37) % 1) + 1) % 1) * RUN_FRAMES)
        : RUN_FRAMES;
      const m = base(X, 0, Z, myaw, model.scale);
      model.add(variant, frame, m);
      gun?.add(0, frame, m);
      this.blobs.add(X, Z, 0.26);
    }
  }
  finish() {
    this.model.finish();
    for (const g of this.guns) g.finish();
  }
}

/** Slimes and brutes. */
class Monsters {
  private slimes: Parts;
  private bars: Parts;
  private bruteModel: FrameSet;
  constructor(
    scene: THREE.Scene,
    private blobs: Blobs,
  ) {
    const eye = new THREE.SphereGeometry(1, 12, 8);
    const brow = new THREE.BoxGeometry(1, 1, 1);
    const whiteM = flat(0xffffff, { roughness: 0.25, flatShading: false });
    const blackM = flat(0x1b1b1b, { roughness: 0.2, flatShading: false });
    this.slimes = new Parts(
      scene,
      [
        {
          // wet, glossy jelly
          geo: new THREE.IcosahedronGeometry(0.42, 3),
          mat: flat(0x5fb832, {
            roughness: 0.16,
            flatShading: false,
            emissive: 0x1c4a08,
            emissiveIntensity: 0.6,
          }),
        },
        { geo: eye, mat: whiteM, per: 2 },
        { geo: eye, mat: blackM, per: 2 },
        { geo: brow, mat: blackM, per: 2 },
      ],
      120,
    );
    const stomp = bakeBrute();
    this.bruteModel = new FrameSet(
      scene,
      stomp,
      [stomp.frames[0].getAttribute("color") as THREE.BufferAttribute],
      32,
      2.3 / stomp.height,
    );
    const bar = new THREE.BoxGeometry(1, 1, 1);
    this.bars = new Parts(
      scene,
      [
        { geo: bar, mat: new THREE.MeshBasicMaterial({ color: 0x1a1a1a }) },
        { geo: bar, mat: new THREE.MeshBasicMaterial({ color: 0xffffff }) },
      ],
      140,
      false,
    );
    const fill = this.bars.meshes[1];
    for (let i = 0; i < fill.instanceMatrix.count; i++)
      fill.setColorAt(i, _c.set(0xffffff));
  }
  draw(m: Monster, clock: number) {
    const hop = Math.abs(Math.sin(clock * (m.big ? 5 : 9) + m.id * 1.7));
    const X = m.x * ROAD;
    const Z = -m.z;
    // monsters face the squad, which comes from +Z
    if (!m.big) {
      const p = this.slimes;
      if (p.used >= p.capacity) return;
      const k = p.used++;
      const squash = 1 + (1 - hop) * 0.18;
      const lift = hop * 0.32;
      const b = base(X, 0, Z, 0, 1);
      const [body, eyes, pupils, brows] = p.meshes;
      put(
        body,
        k,
        b,
        local(0, 0.34 + lift, 0, 0, m.id, 0, squash, 0.8 / squash, squash),
      );
      const ey = 0.42 + lift;
      for (const side of [-1, 1]) {
        const j = k * 2 + (side > 0 ? 1 : 0);
        put(eyes, j, b, local(side * 0.15, ey, 0.3, 0, 0, 0, 0.1, 0.11, 0.06));
        put(
          pupils,
          j,
          b,
          local(side * 0.13, ey - 0.01, 0.35, 0, 0, 0, 0.05, 0.055, 0.03),
        );
        put(
          brows,
          j,
          b,
          local(
            side * 0.15,
            ey + 0.12,
            0.33,
            0,
            0,
            side * -0.5,
            0.17,
            0.035,
            0.03,
          ),
        );
      }
      if (m.hp < m.maxHp)
        this.bar(X, 0.95 + lift, Z, 0.7, m.hp / m.maxHp, 0xff5a5f);
    } else {
      const set = this.bruteModel;
      const frame = Math.floor(
        ((((clock * 0.9 + m.id * 0.31) % 1) + 1) % 1) * set.frames,
      );
      set.add(0, frame, base(X, 0, Z, 0, set.scale));
      this.blobs.add(X, Z, 0.6);
      this.bar(X, 2.55, Z, 1.3, m.hp / m.maxHp, 0xff9f43);
    }
  }
  private bar(
    X: number,
    Y: number,
    Z: number,
    w: number,
    share: number,
    color: number,
  ) {
    const p = this.bars;
    if (p.used >= p.capacity) return;
    const k = p.used++;
    const [bg, fill] = p.meshes;
    bg.setMatrixAt(k, local(X, Y, Z, 0, 0, 0, w + 0.06, 0.13, 0.02));
    const fw = Math.max(0.001, w * share);
    fill.setMatrixAt(
      k,
      local(X - w / 2 + fw / 2, Y, Z + 0.02, 0, 0, 0, fw, 0.09, 0.02),
    );
    fill.setColorAt(k, _c.set(color));
  }
  finish() {
    this.bruteModel.finish();
    this.slimes.finish();
    this.bars.finish();
  }
}

/**
 * How the beaten boss moves, `t` seconds after its last hit (-1: standing).
 * It shudders and rears back with a roar, topples sideways and crashes down
 * at BOSS_IMPACT with a small bounce, lies there, then sinks away.
 */
export function bossFallPose(t: number) {
  const pose = { shake: 0, rear: 0, roar: 0, tip: 0, sink: 0, gone: false };
  if (t < 0) return pose;
  const rearUp = Math.min(1, t / 0.6);
  if (t < BOSS_IMPACT) {
    pose.shake = Math.sin(t * 55) * 0.18 * (1 - rearUp * 0.5);
    pose.rear = -0.3 * Math.sin((rearUp * Math.PI) / 2);
    pose.roar = 0.5 * Math.sin(rearUp * Math.PI);
    const p = Math.max(0, (t - 0.6) / (BOSS_IMPACT - 0.6));
    pose.tip = p * p * 1.5;
    pose.rear *= 1 - p;
  } else {
    const since = t - BOSS_IMPACT;
    pose.tip = 1.5 - 0.12 * Math.sin(since * 12) * Math.exp(-since * 5);
  }
  if (t > BOSS_FALL - 0.4) pose.sink = ((t - (BOSS_FALL - 0.4)) / 0.6) ** 2 * 3;
  pose.gone = t > BOSS_FALL + 0.4;
  return pose;
}

/**
 * A boss drawn from a jointed figure (crowd-figures), posed afresh each
 * frame by `pose`: `clock` runs all the time, `walk` is its stride's phase
 * while it closes in (0 while it stands) and `lift` rises to 1 and back for
 * each ground slam. A boss that `lunges` also throws itself forward with
 * its jaw open on each slam.
 */
class FigureBoss {
  readonly root = new THREE.Group();
  private mat: THREE.MeshStandardMaterial;
  private joints: Joints;
  private jaw?: THREE.Object3D;
  private reset: () => void;
  private clock = 0;
  private stride = 0;
  constructor(
    figure: Figure,
    height: number,
    private look: {
      pose: (j: Joints, clock: number, walk: number, lift: number) => void;
      /** Throws itself forward, jaw open, for each slam. */
      lunges?: boolean;
      /** Rewrites the figure's vertex colours. */
      paint?: (geo: THREE.BufferGeometry) => void;
      /** A glow that pulses with the clock, on top of the hit flash. */
      glow?: THREE.ColorRepresentation;
      /** How brightly it flashes when hit (1: the rex's flash). */
      flash?: number;
    },
  ) {
    this.mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.75,
    });
    this.joints = figure.joints;
    this.jaw = figure.joints.Jaw;
    this.reset = restOf(figure);
    // every joint's shapes become one mesh, so a boss is a draw call a joint
    for (const joint of Object.values(figure.joints)) {
      const shapes = joint.children.filter(
        (o): o is THREE.Mesh => (o as THREE.Mesh).isMesh,
      );
      if (!shapes.length) continue;
      const pos: number[] = [];
      const col: number[] = [];
      for (const shape of shapes) {
        shape.updateMatrix();
        const p = shape.geometry.getAttribute("position");
        const c = shape.geometry.getAttribute("color");
        for (let i = 0; i < p.count; i++) {
          _v.fromBufferAttribute(p, i).applyMatrix4(shape.matrix);
          pos.push(_v.x, _v.y, _v.z);
          col.push(c.getX(i), c.getY(i), c.getZ(i));
        }
        shape.removeFromParent();
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      look.paint?.(geo);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, this.mat);
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      joint.add(mesh);
    }
    look.pose(this.joints, 0, 0, 0);
    const box = new THREE.Box3().setFromObject(figure.root);
    this.reset();
    figure.root.scale.setScalar(height / Math.max(0.1, box.max.y - box.min.y));
    this.root.add(figure.root);
  }
  update(fx: SceneFx, dead: number, dt: number, moving: boolean) {
    // once beaten, it slows to a stagger, then freezes
    const speed = dead < 0 ? 1 : dead < 0.6 ? 0.3 : 0;
    this.clock += dt * speed;
    if (moving) this.stride += dt * 0.9 * speed;
    const glow = this.look.glow
      ? _c
          .set(this.look.glow)
          .multiplyScalar(0.35 + 0.2 * Math.sin(fx.clock * 5))
      : _c.setRGB(0, 0, 0);
    const hit = fx.bossHit * (this.look.flash ?? 1);
    this.mat.emissive.setRGB(
      glow.r + hit * 0.35,
      glow.g + hit * 0.1,
      glow.b + hit * 0.05,
    );
    const lift = fx.slamAnim > 0.5 ? (1 - fx.slamAnim) * 2 : fx.slamAnim * 2;
    this.reset();
    // (a stride of exactly 0 stands still, so a walking one never is)
    this.look.pose(
      this.joints,
      this.clock,
      moving ? (this.stride % 1) + 1e-4 : 0,
      lift,
    );
    const lunge = this.look.lunges ? lift : 0;
    const fall = bossFallPose(dead);
    if (this.jaw) this.jaw.rotation.x += lunge * 0.7 + fall.roar;
    const model = this.root;
    model.rotation.x = lunge * 0.25 + fall.rear;
    model.position.z = lunge * 1.2;
    model.position.x = fall.shake;
    model.rotation.z = fall.tip;
    model.position.y = -fall.sink;
  }
}

/**
 * Lava for the Inferno Rex: charred scales, darker where the model is
 * shaded darker, with scattered patches glowing like cooling lava.
 */
export function infernoPaint(geo: THREE.BufferGeometry) {
  const col = geo.getAttribute("color") as THREE.BufferAttribute | undefined;
  const pos = geo.getAttribute("position");
  const n = pos.count;
  const lum = (i: number) =>
    col ? col.getX(i) * 0.3 + col.getY(i) * 0.59 + col.getZ(i) * 0.11 : 0.5;
  let avg = 0;
  for (let i = 0; i < n; i++) avg += lum(i);
  avg = Math.max(1e-4, avg / Math.max(1, n));
  geo.computeBoundingBox();
  const size = geo.boundingBox!.getSize(new THREE.Vector3());
  const unit = Math.max(1e-4, size.x, size.y, size.z);
  const char = new THREE.Color(0x24120e);
  const ember = new THREE.Color(0x7a170a);
  const hot = new THREE.Color(0xff7a1c);
  const c = new THREE.Color();
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const shade = Math.min(1, Math.max(0, (lum(i) / avg - 0.6) * 1.2));
    c.copy(char).lerp(ember, shade);
    // lava veins: bands across the body, broken up so they read as cracks
    const x = pos.getX(i) / unit;
    const y = pos.getY(i) / unit;
    const z = pos.getZ(i) / unit;
    const vein = Math.sin(z * 31 + Math.sin(x * 23) * 2 + y * 9);
    if (vein > 0.55) c.lerp(hot, Math.min(1, (vein - 0.55) * 3));
    out[i * 3] = c.r;
    out[i * 3 + 1] = c.g;
    out[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(out, 3));
}

/**
 * The boss at the end of the road. Every BOSS_LEVELS levels a different one
 * waits there (see BOSSES in crowd-core). The Horned Titan is built here;
 * the others are figures from crowd-figures.
 */
class Boss {
  group = new THREE.Group();
  private arms: THREE.Group[] = [];
  private skin: THREE.MeshStandardMaterial[] = [];
  private eyes: THREE.MeshStandardMaterial;
  private body: THREE.Group;
  constructor(scene: THREE.Scene) {
    const purple = flat(0x6c3fd6);
    const deep = flat(0x5a37b0);
    const legs = flat(0x3b2a6b);
    const gold = flat(0xffd36a, { metalness: 0.3, roughness: 0.5 });
    this.eyes = flat(0xfff078, { emissive: 0xffe060, emissiveIntensity: 1 });
    this.skin = [purple, deep];
    const g = new THREE.Group();
    this.body = g;
    const add = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      x: number,
      y: number,
      z: number,
      parent: THREE.Object3D = g,
    ) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };
    for (const side of [-1, 1]) {
      add(new THREE.BoxGeometry(1.1, 2.2, 1.2), legs, side * 0.95, 1.1, 0);
      add(new THREE.BoxGeometry(1.3, 0.5, 1.6), legs, side * 0.95, 0.25, 0.2);
    }
    const torso = add(
      new THREE.DodecahedronGeometry(1.9, 0),
      purple,
      0,
      3.7,
      0,
    );
    torso.scale.set(1.25, 1.05, 0.95);
    const belly = add(
      new THREE.IcosahedronGeometry(1.15, 0),
      flat(0xb79cff),
      0,
      3.3,
      1.05,
    );
    belly.scale.set(1, 1, 0.45);
    const head = add(
      new THREE.IcosahedronGeometry(1.25, 1),
      purple,
      0,
      6.1,
      0.15,
    );
    head.scale.set(1.05, 0.92, 1);
    for (const side of [-1, 1]) {
      const horn = add(
        new THREE.ConeGeometry(0.32, 1.6, 6),
        gold,
        side * 1.05,
        7.1,
        0,
      );
      horn.rotation.z = side * -0.6;
      const eye = add(
        new THREE.SphereGeometry(0.22, 10, 8),
        this.eyes,
        side * 0.45,
        6.15,
        1.18,
      );
      eye.scale.set(1, 0.8, 0.6);
      const brow = add(
        new THREE.BoxGeometry(0.62, 0.16, 0.2),
        flat(0x2a1650),
        side * 0.45,
        6.5,
        1.15,
      );
      brow.rotation.z = side * -0.4;
      // shoulder pivots so the arms can swing up for a slam
      const arm = new THREE.Group();
      arm.position.set(side * 2.35, 4.8, 0);
      g.add(arm);
      add(new THREE.DodecahedronGeometry(0.75, 0), deep, 0, 0, 0, arm);
      add(new THREE.BoxGeometry(0.85, 2.4, 0.85), deep, 0, -1.4, 0, arm);
      add(new THREE.DodecahedronGeometry(0.75, 0), purple, 0, -2.8, 0.1, arm);
      for (const sp of [-0.3, 0.3])
        add(new THREE.ConeGeometry(0.16, 0.5, 4), gold, sp, 0.55, 0, arm);
      this.arms.push(arm);
    }
    // teeth
    for (let i = -2; i <= 2; i++) {
      const tooth = add(
        new THREE.ConeGeometry(0.09, 0.28, 4),
        flat(0xffffff),
        i * 0.2,
        5.55,
        1.15,
      );
      tooth.rotation.x = Math.PI;
    }
    // back spikes
    for (let i = 0; i < 4; i++) {
      const sp = add(
        new THREE.ConeGeometry(0.28, 0.9, 5),
        gold,
        0,
        4.9 - i * 0.7,
        -1.6,
      );
      sp.rotation.x = -1.1;
    }
    g.rotation.y = 0;
    this.group.add(g);
    scene.add(this.group);
    this.useLook(
      "rex",
      new FigureBoss(rex(), 6, { pose: rexPose, lunges: true }),
    );
    this.useLook(
      "inferno",
      new FigureBoss(rex(), 6.4, {
        pose: rexPose,
        lunges: true,
        paint: infernoPaint,
        glow: 0x5a1404,
        flash: 0.3,
      }),
    );
    this.useLook(
      "warlord",
      new FigureBoss(brute(true), 5.6, {
        pose: (j, _clock, walk, lift) => warlordPose(j, walk, lift),
        glow: 0x3a0606,
      }),
    );
  }
  private looks: Partial<Record<BossKind, FigureBoss>> = {};
  private kind: BossKind = "rex";
  private shown?: FigureBoss;
  private lastZ = 0;
  private moving = 0;
  /** Adds the figure drawn for one kind of boss. */
  private useLook(kind: BossKind, look: FigureBoss) {
    this.looks[kind] = look;
    look.root.visible = false;
    this.group.add(look.root);
    this.show(this.kind);
  }
  /** Shows the boss for this level. */
  show(kind: BossKind) {
    this.kind = kind;
    this.shown = this.looks[kind];
    for (const l of Object.values(this.looks))
      if (l) l.root.visible = l === this.shown;
    this.body.visible = !this.shown;
  }
  update(w: World, fx: SceneFx, dead: number, dt = 0) {
    if (w.boss.kind !== this.kind) this.show(w.boss.kind);
    this.group.position.set(0, 0, -w.boss.z);
    const fall = bossFallPose(dead);
    this.group.visible = !fall.gone;
    if (this.shown) {
      // walk while it closes in, idle otherwise
      const step = this.lastZ - w.boss.z;
      this.lastZ = w.boss.z;
      this.moving =
        step > 0.0001 && step < 1 ? 0.4 : Math.max(0, this.moving - dt);
      this.shown.update(fx, dead, dt, this.moving > 0);
      return;
    }
    const lift = fx.slamAnim > 0.5 ? (1 - fx.slamAnim) * 2 : fx.slamAnim * 2;
    const idle = Math.sin(fx.clock * 2.2) * 0.08;
    for (const [i, arm] of this.arms.entries()) {
      arm.rotation.x = -lift * 2.6 + idle * (i ? 1 : -1);
      arm.rotation.z = (i ? 1 : -1) * (0.15 + lift * 0.2);
    }
    this.body.position.y = Math.sin(fx.clock * 2.2) * 0.06 - lift * 0.15;
    for (const m of this.skin)
      m.emissive.setRGB(fx.bossHit * 0.3, fx.bossHit * 0.12, fx.bossHit * 0.25);
    this.eyes.emissiveIntensity = 0.7 + 0.5 * Math.sin(fx.clock * 6);
    // after the last hit the boss staggers, topples and sinks away
    this.body.position.x = fall.shake;
    this.body.rotation.x = fall.rear;
    this.body.rotation.z = fall.tip;
    this.body.position.y -= fall.sink;
  }
}

/** Two doors with their number painted on a glassy panel. */
class GateView {
  group = new THREE.Group();
  private panels: {
    mat: THREE.MeshBasicMaterial;
    canvas: HTMLCanvasElement;
    tex: THREE.CanvasTexture;
  }[] = [];
  private state = "";
  constructor(
    readonly gate: Gate,
    frame: THREE.Material,
  ) {
    const H = 2.3;
    const span = ROAD * 1.06;
    for (const [i, side] of (["left", "right"] as const).entries()) {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 192;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(span, H * 0.86),
        mat,
      );
      const cx = (i === 0 ? -0.55 : 0.55) * ROAD;
      panel.position.set(cx, H * 0.47, 0);
      panel.renderOrder = 2;
      this.group.add(panel);
      this.panels.push({ mat, canvas, tex });
      void side;
    }
    const post = new THREE.BoxGeometry(0.22, H, 0.3);
    for (const x of [-1.1, 0, 1.1]) {
      const m = new THREE.Mesh(post, frame);
      m.position.set(x * ROAD, H / 2, 0);
      m.castShadow = true;
      this.group.add(m);
    }
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(ROAD * 2.3, 0.22, 0.32),
      frame,
    );
    beam.position.set(0, H, 0);
    beam.castShadow = true;
    this.group.add(beam);
    this.group.position.z = -gate.z;
    this.paint();
  }
  paint() {
    const g = this.gate;
    const state = `${g.used}${g.chosen}${g.wasBest}`;
    if (state === this.state) return;
    this.state = state;
    for (const [i, side] of (["left", "right"] as const).entries()) {
      const { canvas, tex, mat } = this.panels[i];
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      // Both doors look the same until you pass, so you have to do the
      // maths. Afterwards the one you took shows whether it was the better.
      const chosen = g.used && g.chosen === side;
      const tone = chosen ? (g.wasBest ? "good" : "bad") : "plain";
      const fill = { plain: "#3d9bff", good: "#2fd17a", bad: "#ff4d5a" }[tone];
      ctx.clearRect(0, 0, 256, 192);
      const grad = ctx.createLinearGradient(0, 0, 0, 192);
      grad.addColorStop(0, fill + "cc");
      grad.addColorStop(1, fill + "66");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 256, 192);
      ctx.fillStyle = "#ffffff30";
      ctx.fillRect(0, 0, 256, 18);
      ctx.font = "900 92px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 10;
      ctx.strokeStyle = "#0b2a55aa";
      const text = opLabel(g[side]);
      ctx.strokeText(text, 128, 100);
      ctx.fillStyle = "#fff";
      ctx.fillText(text, 128, 100);
      tex.needsUpdate = true;
      mat.opacity = g.used ? (chosen ? 0.75 : 0.3) : 0.92;
    }
  }
  dispose() {
    for (const p of this.panels) {
      p.tex.dispose();
      p.mat.dispose();
    }
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh && o.geometry) o.geometry.dispose();
    });
  }
}

/** A crate (shoot it open for recruits) or a stone wall (dodge it). */
/** Side and top colours of the two weapon crates. */
const UPGRADE_COLORS = {
  power: [0xc8322c, 0xff6a4d],
  rate: [0x178ccc, 0x5fd4ff],
} as const;
/** Bullet colour per power level: brighter and hotter as it rises. */
const BULLET_COLORS = [0xffe26a, 0xff9a3c, 0xff4f7a, 0xb46bff];

class BlockView {
  group = new THREE.Group();
  private canvas = document.createElement("canvas");
  private tex: THREE.CanvasTexture;
  private hp = -1;
  private mats: THREE.Material[];
  private geos: THREE.BufferGeometry[] = [];
  private sprite?: THREE.Sprite;
  constructor(
    readonly block: Block,
    rewardTex?: THREE.Texture,
    /** Word painted on a weapon crate, already in the player's language. */
    private title = "",
    props: Props = {},
  ) {
    const up = block.upgrade;
    const crate = block.reward > 0 || !!up;
    const W = block.w * 2 * ROAD;
    const real = up ? props.ammo : crate ? props.crate : props.barrier;
    if (real) {
      this.real = true;
      this.mats = [];
      this.tex = new THREE.CanvasTexture(this.canvas);
      this.tex.colorSpace = THREE.SRGBColorSpace;
      this.buildReal(real, W, !!up, crate, rewardTex);
      return;
    }
    const H = crate ? 1.3 : 1.7;
    const D = crate ? 1.3 : 0.8;
    this.canvas.width = 256;
    this.canvas.height = Math.round((256 * H) / W);
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const tint = up
      ? UPGRADE_COLORS[up]
      : crate
        ? [0xe3963a, 0xf5b85a]
        : [0xa9a39a, 0xc4beb4];
    // wooden planks for crates (painted for weapon crates), dressed stone
    // for walls, each from a photograph
    const surface = (color: number) =>
      new THREE.MeshStandardMaterial({
        color,
        map: texture(
          up ? "planks-paint.jpg" : crate ? "planks.jpg" : "wall.jpg",
        ),
        roughness: crate ? 0.78 : 0.92,
      });
    const side = surface(up ? tint[0] : crate ? 0xf2d2a8 : 0xd8d2c8);
    const top = surface(up ? tint[1] : crate ? 0xffe2b8 : 0xe4ded4);
    this.mats = [side, side, top, side, side, side];
    const geo = boxUv(new THREE.BoxGeometry(W, H, D), W, H, D, crate ? 1.5 : 2);
    this.geos.push(geo);
    const box = new THREE.Mesh(geo, this.mats);
    box.position.y = H / 2;
    box.castShadow = true;
    box.receiveShadow = true;
    this.group.add(box);
    // the number (and frame, brace or word) is painted on a clear sheet just
    // in front of the face. No photograph is ever drawn into the canvas:
    // inside dingn's sandboxed frame that would taint it, and WebGL then
    // refuses it and draws the whole crate black.
    const front = new THREE.MeshStandardMaterial({
      map: this.tex,
      transparent: true,
      alphaTest: 0.02,
      roughness: crate ? 0.78 : 0.92,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    this.mats.push(front);
    const sheetGeo = new THREE.PlaneGeometry(W, H);
    this.geos.push(sheetGeo);
    const sheet = new THREE.Mesh(sheetGeo, front);
    sheet.position.set(0, H / 2, D / 2 + 0.004);
    sheet.receiveShadow = true;
    this.group.add(sheet);
    if (up) {
      // a glowing ring marks a weapon crate from far away
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(W * 0.62, 0.06, 6, 24),
        new THREE.MeshBasicMaterial({ color: tint[1] }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.06;
      this.geos.push(ring.geometry);
      this.mats.push(ring.material);
      this.group.add(ring);
    }
    if (crate && rewardTex) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: rewardTex, depthWrite: false }),
      );
      sprite.scale.set(1.3, 0.65, 1);
      sprite.position.y = H + 0.55;
      this.group.add(sprite);
      this.mats.push(sprite.material);
      this.sprite = sprite;
    }
    this.group.position.set(block.x * ROAD, 0, -block.z);
    this.paint();
  }
  /** True once it's drawn with a photographed model, not a box. */
  private real = false;

  /**
   * The photographed roadblock, sized to the block's width: a striped
   * concrete barrier for a wall, two military crates stacked for a reward
   * crate, a big ammo box for a weapon crate. The hits left show on a plate
   * in front, as on the boxes.
   */
  private buildReal(
    model: THREE.Object3D,
    W: number,
    weapon: boolean,
    crate: boolean,
    rewardTex?: THREE.Texture,
  ) {
    const size = new THREE.Box3()
      .setFromObject(model)
      .getSize(new THREE.Vector3());
    let H: number;
    let D: number;
    if (weapon) {
      // the ammo box's long side faces the squad
      const s = (W * 1.05) / size.z;
      const box = model.clone();
      box.scale.setScalar(s);
      box.rotation.y = Math.PI / 2;
      this.group.add(box);
      H = size.y * s;
      D = size.x * s;
    } else if (crate) {
      // two crates stacked, the top one slightly askew
      const s = W / size.x;
      const h = size.y * s;
      for (const [y, yaw, dx] of [
        [0, 0, 0],
        [h, 0.09, W * 0.03],
      ]) {
        const c = model.clone();
        c.scale.setScalar(s);
        c.position.set(dx, y, 0);
        c.rotation.y = yaw;
        this.group.add(c);
      }
      H = h * 2;
      D = size.z * s;
    } else {
      // a concrete barrier, a little taller than life so it reads as a wall
      const s = W / size.x;
      const wall = model.clone();
      wall.scale.set(s, s * 1.35, s);
      this.group.add(wall);
      H = size.y * s * 1.35;
      D = size.z * s;
    }
    // the plate with the hits left, just in front of the face
    const PW = Math.min(W * 0.62, 1.1);
    const PH = weapon ? PW * 0.62 : PW * 0.48;
    this.canvas.width = 256;
    this.canvas.height = Math.round((256 * PH) / PW);
    const front = new THREE.MeshBasicMaterial({
      map: this.tex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    this.mats.push(front);
    const plateGeo = new THREE.PlaneGeometry(PW, PH);
    this.geos.push(plateGeo);
    const plate = new THREE.Mesh(plateGeo, front);
    plate.position.set(0, Math.min(H * 0.55, H - PH / 2 - 0.05), D / 2 + 0.06);
    this.group.add(plate);
    if (weapon && this.block.upgrade) {
      // a glowing ring marks a weapon crate from far away
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(W * 0.62, 0.06, 6, 24),
        new THREE.MeshBasicMaterial({
          color: UPGRADE_COLORS[this.block.upgrade][1],
        }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.06;
      this.geos.push(ring.geometry);
      this.mats.push(ring.material);
      this.group.add(ring);
    }
    if (crate && rewardTex) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: rewardTex, depthWrite: false }),
      );
      sprite.scale.set(1.3, 0.65, 1);
      sprite.position.y = H + 0.55;
      this.group.add(sprite);
      this.mats.push(sprite.material);
      this.sprite = sprite;
    }
    this.group.position.set(this.block.x * ROAD, 0, -this.block.z);
    this.paint();
  }
  paint() {
    const b = this.block;
    if (b.hp === this.hp) return;
    this.hp = b.hp;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const { width: w, height: h } = this.canvas;
    const crate = b.reward > 0;
    ctx.clearRect(0, 0, w, h);
    if (this.real) {
      // a dark stencilled plate on the photographed model
      ctx.fillStyle = "rgba(14, 16, 20, 0.72)";
      ctx.beginPath();
      ctx.roundRect(4, 4, w - 8, h - 8, 18);
      ctx.fill();
      ctx.lineWidth = 6;
      ctx.strokeStyle = b.upgrade
        ? b.upgrade === "power"
          ? "#ffb08a"
          : "#9fe8ff"
        : "rgba(255, 255, 255, 0.55)";
      ctx.stroke();
      if (b.upgrade) {
        ctx.fillStyle = b.upgrade === "power" ? "#ffd34a" : "#d8f6ff";
        ctx.font = `900 ${Math.round(h * 0.24)}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(this.title, w / 2, h * 0.1, w - 28);
      }
    } else if (b.upgrade) {
      const power = b.upgrade === "power";
      // a dark painted frame and a stencilled word
      ctx.strokeStyle = power ? "#5c120e" : "#0a3c5a";
      ctx.lineWidth = 14;
      ctx.strokeRect(7, 7, w - 14, h - 14);
      ctx.fillStyle = power ? "#ffd34a" : "#d8f6ff";
      ctx.font = `900 ${Math.round(h * 0.26)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(this.title, w / 2, h * 0.08, w - 28);
    } else if (crate) {
      // a darker frame of boards and a cross brace, nailed on
      ctx.strokeStyle = "rgba(70, 38, 10, 0.55)";
      ctx.lineWidth = 16;
      ctx.strokeRect(8, 8, w - 16, h - 16);
      ctx.beginPath();
      ctx.moveTo(16, 16);
      ctx.lineTo(w - 16, h - 16);
      ctx.moveTo(w - 16, 16);
      ctx.lineTo(16, h - 16);
      ctx.lineWidth = 13;
      ctx.stroke();
      ctx.fillStyle = "rgba(40, 30, 20, 0.7)";
      for (const [x, y] of [
        [16, 16],
        [w - 16, 16],
        [16, h - 16],
        [w - 16, h - 16],
      ]) {
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.font = `900 ${Math.round(
      this.real ? h * (b.upgrade ? 0.5 : 0.72) : Math.min(h * 0.5, 96),
    )}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 10;
    ctx.strokeStyle = "#000000aa";
    const ty = b.upgrade ? h * 0.64 : h / 2 + 4;
    ctx.strokeText(String(b.hp), w / 2, ty);
    ctx.fillStyle = "#fff";
    ctx.fillText(String(b.hp), w / 2, ty);
    this.tex.needsUpdate = true;
  }
  /** Repaints a weapon crate's words, e.g. after the language changes. */
  relabel(title: string, labelTex: THREE.Texture) {
    this.title = title;
    this.hp = -1;
    this.paint();
    if (this.sprite) {
      this.sprite.material.map?.dispose();
      this.sprite.material.map = labelTex;
      this.sprite.material.needsUpdate = true;
    } else labelTex.dispose();
  }
  dispose() {
    this.tex.dispose();
    this.sprite?.material.map?.dispose();
    for (const m of this.mats) m.dispose();
    for (const g of this.geos) g.dispose();
  }
}

/** Shared geometry and materials for the level's coin packs. */
type CoinParts = ReturnType<typeof coinParts>;
function coinParts(
  keep: <G extends THREE.BufferGeometry>(g: G) => G,
  mat: <M extends THREE.Material>(m: M) => M,
) {
  // a flat coin for the piles, and a big coin on edge: a bright rim around a
  // deeper face with a raised star, so it reads as a coin from any angle
  const flatCoin = keep(new THREE.CylinderGeometry(0.15, 0.15, 0.05, 18));
  const rim = keep(new THREE.CylinderGeometry(0.42, 0.42, 0.1, 32));
  rim.rotateX(Math.PI / 2);
  const face = keep(new THREE.CylinderGeometry(0.33, 0.33, 0.13, 32));
  face.rotateX(Math.PI / 2);
  const starShape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 ? 0.08 : 0.2;
    if (i) starShape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    else starShape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const star = keep(
    new THREE.ExtrudeGeometry(starShape, { depth: 0.17, bevelEnabled: false }),
  );
  star.translate(0, 0, -0.085);
  const glow = keep(new THREE.RingGeometry(0.45, 0.62, 40));
  glow.rotateX(-Math.PI / 2);
  const gold = (color: number, emissive: number) =>
    mat(
      // real gold: mostly mirror, so it shines with the sky's light
      new THREE.MeshStandardMaterial({
        color,
        emissive: _c.set(emissive).multiplyScalar(0.8).getHex(),
        metalness: 0.85,
        roughness: 0.3,
      }),
    );
  return {
    flatCoin,
    rim,
    face,
    star,
    glow,
    bright: gold(0xffd34a, 0x6a4300),
    deep: gold(0xf0a81c, 0x5a3200),
    pale: gold(0xfff0a0, 0x7a5a10),
    glowMat: mat(
      new THREE.MeshBasicMaterial({
        color: 0xffbf1a,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      }),
    ),
  };
}

/**
 * A coin pack on the road: a pile of gold coin stacks, more for a fuller
 * pack, a big coin spinning above it, and a soft gold glow on the road. Each
 * hit makes it jump and flash.
 */
class CoinPackView {
  group = new THREE.Group();
  private spinner = new THREE.Group();
  private pile = new THREE.Group();
  private hp: number;
  private kick = 0;
  constructor(
    readonly coin: Coin,
    private parts: CoinParts,
  ) {
    const r = rng(coin.id * 977 + 3);
    const size = packSize(coin.value);
    // stacks of flat coins, tallest in the middle
    const stacks = 3 + Math.round(((coin.value - 3) / 7) * 4);
    for (let s = 0; s < stacks; s++) {
      const a = (s / stacks) * Math.PI * 2 + r();
      const d = s === 0 ? 0 : 0.17 + r() * 0.06;
      const n = (s === 0 ? 5 : 2) + Math.floor(r() * (2 + coin.value / 3));
      for (let k = 0; k < n; k++) {
        const m = new THREE.Mesh(
          parts.flatCoin,
          k === n - 1 ? parts.pale : k % 2 ? parts.deep : parts.bright,
        );
        m.position.set(
          Math.cos(a) * d + (r() - 0.5) * 0.02,
          0.025 + k * 0.05,
          Math.sin(a) * d + (r() - 0.5) * 0.02,
        );
        m.rotation.set((r() - 0.5) * 0.08, 0, (r() - 0.5) * 0.08);
        m.castShadow = true;
        this.pile.add(m);
      }
    }
    const rim = new THREE.Mesh(parts.rim, parts.bright);
    const face = new THREE.Mesh(parts.face, parts.deep);
    const star = new THREE.Mesh(parts.star, parts.pale);
    rim.castShadow = true;
    this.spinner.add(rim, face, star);
    const glow = new THREE.Mesh(parts.glow, parts.glowMat);
    glow.position.y = 0.03;
    glow.scale.setScalar(1.15);
    this.group.add(glow, this.pile, this.spinner);
    this.group.scale.setScalar(size);
    this.group.position.set(coin.x * ROAD, 0, -coin.z);
    this.hp = coin.hp;
  }
  update(clock: number, dt: number) {
    if (this.coin.hp < this.hp) {
      this.hp = this.coin.hp;
      this.kick = 1;
    }
    this.kick = Math.max(0, this.kick - dt * 6);
    const t = clock + this.coin.id;
    this.spinner.position.y = 0.88 + Math.sin(t * 3) * 0.07 + this.kick * 0.12;
    this.spinner.rotation.y = t * 2.4;
    const squash = 1 + this.kick * 0.12;
    this.pile.scale.set(squash, 1 / squash, squash);
  }
}

/** Box UVs in metres: the texture repeats every `size` on every face. */
function boxUv(
  geo: THREE.BoxGeometry,
  W: number,
  H: number,
  D: number,
  size: number,
) {
  const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
  // faces in order +x, -x, +y, -y, +z, -z, four corners each
  const spans = [
    [D, H],
    [D, H],
    [W, D],
    [W, D],
    [W, H],
    [W, H],
  ];
  for (let i = 0; i < uv.count; i++) {
    const [u, v] = spans[Math.floor(i / 4)];
    uv.setXY(i, (uv.getX(i) * u) / size, (uv.getY(i) * v) / size);
  }
  return geo;
}

/** A boulder: a lumpy ball, squashed flat when it is placed. */
function rockGeometry() {
  const geo = mergeVertices(new THREE.IcosahedronGeometry(0.5, 2));
  const pos = geo.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i);
    const n =
      1 +
      0.18 * Math.sin(_v.x * 7.1 + _v.y * 3.3) +
      0.12 * Math.sin(_v.z * 9.7 - _v.x * 4.1);
    _v.multiplyScalar(n);
    pos.setXYZ(i, _v.x, _v.y, _v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/** A steady pseudo-random number in [0, 1) for a given input. */
const hash = (v: number) => {
  const s = Math.sin(v) * 43758.5453;
  return s - Math.floor(s);
};

function labelTexture(text: string, color: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.font = "900 84px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 12;
    ctx.strokeStyle = "#000000aa";
    ctx.strokeText(text, 128, 66, 240);
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 66, 240);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class CrowdScene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
  private sun: THREE.DirectionalLight;
  private sky: THREE.Mesh;
  private skySettled: () => void = () => undefined;
  private skyReady = new Promise<void>((done) => (this.skySettled = done));
  private hills: THREE.Mesh;
  private runners: Runners;
  private blobs: Blobs;
  private monsters: Monsters;
  private boss: Boss;
  private bullets: THREE.InstancedMesh;
  private sparks: THREE.InstancedMesh;
  private level = new THREE.Group();
  private gates: GateView[] = [];
  private blocks = new Map<number, BlockView>();
  private levelGeos: THREE.BufferGeometry[] = [];
  private levelMats: THREE.Material[] = [];
  /** Brushed steel, which picks up the sky once it has loaded. */
  private gateFrame = new THREE.MeshStandardMaterial({
    color: 0xdfe3ea,
    metalness: 0.75,
    roughness: 0.32,
  });
  private ring: THREE.Mesh;
  /** The level's coin packs; rebuilt with the level. */
  private packs: CoinPackView[] = [];
  private camX = 0;
  private camPull = 0;
  private width = 1;
  private height = 1;
  private dpr = 1;
  /** Phones and tablets: lower resolution, no MSAA, smaller shadow map. */
  readonly lite: boolean;
  /** Resolution scale, lowered while frames run slow and raised once they recover. */
  private resScale = 1;
  private frameAvg = 1 / 60;
  private frameClock = 0;

  /**
   * Translates the English words painted into the 3D world (crate labels)
   * into the player's language. Read whenever a level is built.
   */
  translate: (text: string) => string = (text) => text;

  constructor(canvas: HTMLCanvasElement) {
    const lite =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches;
    this.lite = lite;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !lite,
      powerPreference: "high-performance",
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    // until the photographed sky arrives, a plain one of the same haze
    this.scene.background = HAZE.clone();
    this.scene.fog = new THREE.Fog(HAZE.clone(), 45, VIEW_AHEAD);

    const hemi = new THREE.HemisphereLight(0xe6f4ff, 0x6c8f4a, 1.6);
    this.scene.add(hemi);
    // the sky photograph: once here it also lights the scene, filling the
    // shade with its own blue and giving gold and steel something to reflect
    this.sky = skyDome((mesh) => {
      this.skySettled();
      if (this.disposed || !mesh) return;
      mesh.visible = true;
      this.scene.background = null;
      this.scene.environment = skyLight(this.renderer, mesh);
      this.scene.environmentIntensity = 0.9;
      hemi.intensity = 0.35;
    });
    this.scene.add(this.sky);
    this.hills = farHills();
    this.scene.add(this.hills);
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.9);
    sun.castShadow = true;
    sun.shadow.mapSize.setScalar(lite ? 1024 : 2048);
    const sc = sun.shadow.camera;
    sc.left = -14;
    sc.right = 14;
    sc.top = 30;
    sc.bottom = -16;
    sc.near = 1;
    sc.far = 80;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 3;
    this.scene.add(sun, sun.target);
    this.sun = sun;

    // grass that follows the camera, so it never runs out
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      groundMaterial(ROAD * 1.13),
    );
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = -0.02;
    grass.receiveShadow = true;
    grass.name = "grass";
    this.scene.add(grass);

    this.blobs = new Blobs(this.scene);
    this.runners = new Runners(this.scene, 360, this.blobs);
    this.monsters = new Monsters(this.scene, this.blobs);
    this.boss = new Boss(this.scene);

    this.bullets = new THREE.InstancedMesh(
      new THREE.CapsuleGeometry(0.05, 0.5, 1, 4),
      // tracers glow: they skip tone mapping so they stay hot and saturated
      new THREE.MeshBasicMaterial({ color: 0xffe26a, toneMapped: false }),
      lite ? 900 : 1600,
    );
    this.bullets.frustumCulled = false;
    this.bullets.count = 0;
    this.scene.add(this.bullets);
    this.sparks = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(1, 0),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      600,
    );
    for (let i = 0; i < 600; i++) this.sparks.setColorAt(i, _c.set(0xffffff));
    this.sparks.frustumCulled = false;
    this.sparks.count = 0;
    this.scene.add(this.sparks);

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1, 40),
      new THREE.MeshBasicMaterial({
        color: 0xffe08a,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    this.scene.add(this.ring);
    this.scene.add(this.level);
  }

  /**
   * Loads the scanned roadblocks and swaps them in. Until they arrive, or
   * if one fails to load, its plain stand-in box stays on screen.
   */
  async loadModels(progress?: (url: string, share: number) => void) {
    const get = (url: string) =>
      loadModel(url, (k) => progress?.(url, k)).finally(() =>
        progress?.(url, 1),
      );
    const [barrier, crate, ammo] = await Promise.allSettled([
      get(PROP_URLS.barrier),
      get(PROP_URLS.crate),
      get(PROP_URLS.ammo),
    ]);
    if (this.disposed) return;
    if (barrier.status === "fulfilled")
      this.props.barrier = propModel(barrier.value);
    // the scan has a closed crate (parts ending "_a") and an open one
    if (crate.status === "fulfilled")
      this.props.crate = propModel(crate.value, (n) => n.endsWith("_a"));
    if (ammo.status === "fulfilled") this.props.ammo = propModel(ammo.value);
    this.rebuildBlocks();
    this.modelsReady = true;
  }
  modelsReady = false;
  /** The photographed roadblocks, once loaded. */
  private props: Props = {};

  /**
   * Downloads everything a level shows: the sky, every photograph and the
   * models. `onProgress` gets the share done, 0 to 1. Resolves once all of
   * it is in (or has failed, in which case plain stand-ins are drawn).
   */
  async preload(onProgress: (share: number) => void) {
    // weights roughly by download size: a model is a few pictures' worth
    const MODEL = 4;
    const urls = Object.values(PROP_URLS);
    const shares = new Map(urls.map((u) => [u, 0]));
    let files = 0;
    let sky = 0;
    let total = 0;
    const report = () => {
      if (!total) return;
      let models = 0;
      for (const k of shares.values()) models += k * MODEL;
      onProgress(Math.min(1, (files + sky * 2 + models) / total));
    };
    const land = preloadLand(() => {
      files++;
      report();
    });
    total = land.count + 2 + urls.length * MODEL;
    report();
    const skyDone = this.skyReady.then(() => {
      sky = 1;
      report();
    });
    const models = this.loadModels((url, k) => {
      shares.set(url, Math.max(shares.get(url) ?? 0, k));
      report();
    }).catch((err) => console.warn("Crowd Rush models", err));
    await Promise.all([land.all, skyDone, models]);
    if (this.disposed) return;
    // send every picture to the graphics card now, not mid-run
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
      if (m?.map) this.renderer.initTexture(m.map);
    });
    onProgress(1);
  }
  private disposed = false;

  resize(width: number, height: number, dpr: number) {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.applyPixelRatio();
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    this.camera.aspect = aspect;
    // keep the whole road in view on a tall phone screen
    this.camera.fov = aspect < 0.8 ? 64 : aspect < 1.2 ? 56 : 48;
    this.camera.updateProjectionMatrix();
  }

  /** Builds the road, scenery, gates and blocks for a fresh level. */
  load(w: World) {
    this.clearLevel();
    const L = w.length + 40;
    const keep = <G extends THREE.BufferGeometry>(g: G) => (
      this.levelGeos.push(g),
      g
    );
    const mat = <M extends THREE.Material>(m: M) => (this.levelMats.push(m), m);

    // asphalt from a photograph, one tile every four metres
    const road = new THREE.Mesh(
      keep(
        tileUv(
          new THREE.BoxGeometry(ROAD * 2.2, 0.1, L + 40),
          ROAD * 2.2,
          L + 40,
          4,
        ),
      ),
      mat(
        new THREE.MeshStandardMaterial({
          color: 0xd2d4da,
          map: texture("road.jpg"),
          normalMap: texture("road-n.jpg", false),
          normalScale: new THREE.Vector2(0.7, 0.7),
          roughness: 0.92,
        }),
      ),
    );
    road.position.set(0, -0.04, -(L / 2) + 20);
    road.receiveShadow = true;
    this.level.add(road);

    // red and white kerbs along both edges, with rounded tops
    const kerbGeo = keep(new THREE.CapsuleGeometry(0.15, 1.2, 2, 8));
    kerbGeo.rotateX(Math.PI / 2);
    kerbGeo.scale(1, 0.55, 1);
    const kerbs = new THREE.InstancedMesh(
      kerbGeo,
      mat(new THREE.MeshStandardMaterial({ roughness: 0.55 })),
      Math.ceil((L + 40) / 1.5) * 2,
    );
    let k = 0;
    for (let z = -20; z < L; z += 1.5)
      for (const side of [-1, 1]) {
        kerbs.setMatrixAt(k, local(side * ROAD * 1.13, 0.02, -z));
        kerbs.setColorAt(
          k,
          _c.set(Math.round(z / 1.5) % 2 ? 0xd8302c : 0xf2f2ee),
        );
        k++;
      }
    kerbs.count = k;
    kerbs.receiveShadow = true;
    this.level.add(kerbs);

    // painted lane dashes, a little worn, lit like the road
    const dashGeo = keep(new THREE.PlaneGeometry(0.1, 2.6));
    dashGeo.rotateX(-Math.PI / 2);
    const dashes = new THREE.InstancedMesh(
      dashGeo,
      mat(
        new THREE.MeshStandardMaterial({
          color: 0xeceae2,
          roughness: 0.7,
          polygonOffset: true,
          polygonOffsetFactor: -2,
        }),
      ),
      Math.ceil(L / 6) * 2 + 4,
    );
    k = 0;
    for (let z = 0; z < L - 10; z += 6)
      for (const lx of [-0.36, 0.36])
        dashes.setMatrixAt(k++, local(lx * ROAD, 0.012, -z - 1.3));
    dashes.count = k;
    dashes.receiveShadow = true;
    this.level.add(dashes);

    // scenery: real trees, with soft shade under each, and rocks
    const r = rng(w.level * 31 + 7);
    const spots: TreeSpot[] = [];
    const rock = keep(rockGeometry());
    const maxRocks = Math.ceil((L + 40) / 3.2) * 2;
    const rocks = new THREE.InstancedMesh(
      rock,
      mat(
        new THREE.MeshStandardMaterial({
          map: texture("rock.jpg"),
          color: 0xc9c2b6,
          roughness: 0.9,
        }),
      ),
      maxRocks,
    );
    let ri = 0;
    for (let z = -20; z < L + 20; z += 3.2)
      for (const side of [-1, 1]) {
        const X = side * (ROAD * 1.13 + 3.2 + r() * 9);
        const Z = -(z + r() * 3);
        const s = 0.75 + r() * 0.7;
        const roll = r();
        if (roll < 0.15) {
          rocks.setMatrixAt(
            ri++,
            local(X, 0.1, Z, r(), r() * 3, 0, s, s * 0.6, s),
          );
          continue;
        }
        // firs where the old pines stood, broadleaf trees elsewhere
        spots.push({ x: X, z: Z, s, kind: roll < 0.5 ? 1 : 0 });
      }
    // looser woods further out, so the country has depth
    for (const [from, span, step] of [
      [12, 16, 3.5],
      [28, 40, 2.5],
    ])
      for (let z = -20; z < L + 60; z += step)
        for (const side of [-1, 1]) {
          const X = side * (ROAD * 1.13 + from + r() * span);
          spots.push({
            x: X,
            z: -(z + r() * step),
            s: 0.8 + r() * 0.6,
            kind: r() < 0.55 ? 1 : 0,
          });
        }
    rocks.count = ri;
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    rocks.frustumCulled = false;
    this.level.add(rocks);
    for (const m of forest(spots, hash)) {
      keep(m.geometry);
      this.level.add(m);
    }
    // the shade each crown throws, offset away from the sun
    const shadeGeo = keep(new THREE.PlaneGeometry(2, 2));
    shadeGeo.rotateX(-Math.PI / 2);
    const shades = new THREE.InstancedMesh(
      shadeGeo,
      mat(
        new THREE.MeshBasicMaterial({
          map: shadeTexture(),
          color: 0x0a1408,
          transparent: true,
          opacity: 0.38,
          depthWrite: false,
        }),
      ),
      spots.length,
    );
    for (const [i, t] of spots.entries()) {
      const h = treeHeight(t.kind) * t.s;
      const rx = (t.kind ? 0.32 : 0.5) * h;
      shades.setMatrixAt(
        i,
        local(
          t.x - SUN_DIR.x * h * 0.45,
          0.015,
          t.z - SUN_DIR.z * h * 0.45,
          0,
          0,
          0,
          rx,
          1,
          rx * 1.4,
        ),
      );
    }
    shades.count = spots.length;
    shades.frustumCulled = false;
    shades.renderOrder = 1;
    this.level.add(shades);

    // the arena where the boss waits: a round cobbled square
    const arenaR = ROAD * 1.6;
    const arena = new THREE.Mesh(
      keep(
        tileUv(
          new THREE.CircleGeometry(arenaR, 48),
          arenaR * 2,
          arenaR * 2,
          2.2,
        ),
      ),
      mat(
        new THREE.MeshStandardMaterial({
          map: texture("cobble.jpg"),
          normalMap: texture("cobble-n.jpg", false),
          color: 0xe8e2d8,
          roughness: 0.85,
        }),
      ),
    );
    arena.rotation.x = -Math.PI / 2;
    arena.position.set(0, 0.02, -w.boss.z);
    arena.receiveShadow = true;
    this.level.add(arena);
    // a ring of dressed stone round its edge
    const kerbRing = new THREE.Mesh(
      keep(new THREE.TorusGeometry(arenaR, 0.16, 6, 48)),
      mat(
        new THREE.MeshStandardMaterial({
          map: texture("wall.jpg"),
          color: 0xd8d2c8,
          roughness: 0.9,
        }),
      ),
    );
    kerbRing.rotation.x = -Math.PI / 2;
    kerbRing.scale.z = 0.5;
    kerbRing.position.set(0, 0.03, -w.boss.z);
    kerbRing.receiveShadow = true;
    this.level.add(kerbRing);
    const line = new THREE.Mesh(
      keep(new THREE.PlaneGeometry(ROAD * 2.2, 0.8)),
      mat(
        new THREE.MeshStandardMaterial({
          map: checker(),
          roughness: 0.7,
          polygonOffset: true,
          polygonOffsetFactor: -2,
        }),
      ),
    );
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, 0.02, -(w.boss.z - BOSS_STOP - 1));
    line.receiveShadow = true;
    this.level.add(line);

    // coin packs: a pile of gold coins under a big spinning coin
    if (w.coins.length) {
      const parts = coinParts(keep, mat);
      for (const c of w.coins) {
        const v = new CoinPackView(c, parts);
        this.packs.push(v);
        this.level.add(v.group);
      }
    }

    for (const th of w.things) {
      if (th.kind === "gate") {
        const g = new GateView(th, this.gateFrame);
        this.gates.push(g);
        this.level.add(g.group);
      }
    }
    this.world = w;
    this.addBlocks(w);
  }
  private world?: World;

  /** Crates and walls, as the photographed models once they're loaded. */
  private addBlocks(w: World) {
    for (const th of w.things) {
      if (th.kind !== "block") continue;
      const words = th.upgrade && this.upgradeWords(th.upgrade);
      const tex = words
        ? words.tex
        : th.reward
          ? labelTexture(`+${th.reward}`, "#fff36a")
          : undefined;
      const b = new BlockView(th, tex, words ? words.title : "", this.props);
      this.blocks.set(th.id, b);
      this.level.add(b.group);
    }
  }
  /** Swaps the level's stand-in boxes for the models that just arrived. */
  private rebuildBlocks() {
    if (!this.world) return;
    for (const b of this.blocks.values()) {
      b.group.removeFromParent();
      b.dispose();
    }
    this.blocks.clear();
    this.addBlocks(this.world);
  }

  /** The translated words for a weapon crate: on the box and above it. */
  private upgradeWords(up: Upgrade) {
    const power = up === "power";
    return {
      title: this.translate(power ? "POWER" : "RATE"),
      tex: labelTexture(
        this.translate(power ? "DMG+" : "RATE+"),
        power ? "#ffb08a" : "#9fe8ff",
      ),
    };
  }

  /** Repaints crate words in the current language without restarting. */
  relabel() {
    for (const b of this.blocks.values()) {
      if (!b.block.upgrade) continue;
      const { title, tex } = this.upgradeWords(b.block.upgrade);
      b.relabel(title, tex);
    }
  }

  private clearLevel() {
    for (const g of this.gates) g.dispose();
    for (const b of this.blocks.values()) b.dispose();
    this.gates = [];
    this.blocks.clear();
    for (const g of this.levelGeos) g.dispose();
    for (const m of this.levelMats) {
      // photographs are shared by every level, so they stay loaded
      const map = (m as THREE.MeshBasicMaterial).map;
      if (map && !map.userData.shared) map.dispose();
      m.dispose();
    }
    this.levelGeos = [];
    this.levelMats = [];
    this.packs = [];
    this.level.clear();
  }

  private applyPixelRatio() {
    const cap = this.lite ? 1.5 : 2;
    const ratio = Math.max(0.6, Math.min(this.dpr, cap) * this.resScale);
    if (Math.abs(ratio - this.renderer.getPixelRatio()) < 0.01) return;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(this.width, this.height, false);
  }
  /**
   * Keeps the frame rate up on slow devices: every two seconds, drop the
   * resolution a step if frames average under ~40 fps, and raise it again
   * once they're back near 60.
   */
  private adapt(dt: number) {
    if (dt <= 0 || dt > 0.25) return;
    this.frameAvg += (dt - this.frameAvg) * 0.05;
    this.frameClock += dt;
    if (this.frameClock < 2) return;
    this.frameClock = 0;
    if (this.frameAvg > 1 / 40 && this.resScale > 0.5) this.resScale -= 0.15;
    else if (this.frameAvg < 1 / 55 && this.resScale < 1)
      this.resScale = Math.min(1, this.resScale + 0.1);
    else return;
    this.applyPixelRatio();
  }

  render(w: World, fx: SceneFx, dt: number) {
    this.adapt(dt);
    const near = w.z - VIEW_BEHIND;
    const far = w.z + VIEW_AHEAD;
    const clock = fx.clock;
    const running = w.phase === "run";

    // gates and blocks
    for (const g of this.gates) {
      g.group.visible = g.gate.z > near && g.gate.z < far;
      if (g.group.visible) g.paint();
    }
    for (const b of this.blocks.values()) {
      b.group.visible = !b.block.dead && b.block.z > near && b.block.z < far;
      if (b.group.visible) b.paint();
    }

    // coin packs
    for (const p of this.packs) {
      const c = p.coin;
      p.group.visible = !c.taken && c.z > w.z - 1 && c.z < far;
      if (p.group.visible) p.update(clock, dt);
    }

    // squads
    if (w.count > 0)
      this.runners.squad(
        w.x,
        w.z,
        w.count,
        crowdRadius(w.count),
        TEAM,
        1,
        clock,
        running,
        Math.max(-0.5, Math.min(0.5, (w.x - w.targetX) * 1.2)),
        w.power - 1,
      );
    for (const th of w.things) {
      if (th.kind === "gate" || th.z < near || th.z > far || th.dead) continue;
      if (th.kind === "squad" && th.count > 0)
        this.runners.squad(
          th.x,
          th.z,
          th.count,
          squadRadius(th.count),
          RIVAL,
          -1,
          clock,
          th.z - w.z < 26,
          0,
        );
      else if (th.kind === "monster") this.monsters.draw(th, clock);
    }
    this.runners.finish();
    this.monsters.finish();
    this.blobs.finish();

    // boss
    this.boss.update(
      w,
      fx,
      w.phase === "won" ? Math.max(0, fx.bossDown) : -1,
      dt,
    );
    this.boss.group.visible = this.boss.group.visible && w.boss.z < far;

    // bullets: hotter colours and fatter rounds as the weapon gets stronger
    const tier = Math.max(0, Math.min(BULLET_COLORS.length - 1, w.power - 1));
    (this.bullets.material as THREE.MeshBasicMaterial).color.setHex(
      BULLET_COLORS[tier],
    );
    // a big squad fires volleys: each shot is drawn as several tracers
    // spread across the squad, thicker and longer the bigger it is
    const power = firepower(w.count);
    const fat = (1 + tier * 0.45) * (1 + power * 0.9);
    const long = 1 + power * 0.8;
    const tracers = this.lite
      ? Math.max(1, Math.ceil(volley(w.count) * 0.6))
      : volley(w.count);
    const spread = crowdRadius(w.count) * ROAD * 0.95;
    const cap = this.bullets.instanceMatrix.count;
    let n = 0;
    for (const b of w.bullets) {
      const seed = b.n ?? 0;
      for (let k = 0; k < tracers && n < cap; k++) {
        // a steady pseudo-random spot for each tracer of this shot
        const h1 = hash(seed * 12.9898 + k * 78.233);
        const h2 = hash(seed * 39.3468 + k * 11.135);
        const dx = k ? (h1 * 2 - 1) * spread : 0;
        const dz = k ? h2 * 4.5 : 0;
        this.bullets.setMatrixAt(
          n++,
          local(
            b.x * ROAD + dx,
            0.45 + (k ? h2 * 0.15 : 0.05),
            -b.z - 0.3 - dz,
            Math.PI / 2,
            0,
            0,
            fat,
            long,
            fat,
          ),
        );
      }
      if (n >= cap) break;
    }
    this.bullets.count = n;
    this.bullets.instanceMatrix.needsUpdate = true;

    // sparks
    n = 0;
    for (const p of fx.sparks) {
      if (n >= 600) break;
      const s = p.size * 1.2 * Math.max(0, 1 - p.life / p.max);
      this.sparks.setMatrixAt(
        n,
        local(p.x * ROAD, p.h, -p.z, p.life * 7, p.life * 5, 0, s, s, s),
      );
      this.sparks.setColorAt(n, _c.set(p.color));
      n++;
    }
    this.sparks.count = n;
    this.sparks.instanceMatrix.needsUpdate = true;
    if (this.sparks.instanceColor) this.sparks.instanceColor.needsUpdate = true;

    // slam shockwave rolls out from the boss toward the squad
    if (fx.slamAnim > 0 && fx.slamAnim < 0.75 && w.phase !== "won") {
      const k = 1 - fx.slamAnim / 0.75;
      const reach = BOSS_STOP * k + 2;
      this.ring.visible = true;
      this.ring.position.set(0, 0.06, -w.boss.z);
      this.ring.scale.setScalar(reach);
      (this.ring.material as THREE.MeshBasicMaterial).opacity = 1 - k * 0.8;
    } else this.ring.visible = false;

    // camera rides behind and above the squad
    this.camX += (w.x * ROAD * 0.45 - this.camX) * Math.min(1, dt * 4);
    const portrait = this.width / this.height < 0.8;
    // pull back as the squad grows so the whole crowd stays in frame
    const drawn = Math.min(Math.max(1, w.count), MAX_DRAWN);
    const depth = crowdDepth(drawn, crowdRadius(w.count) * ROAD * 1.1);
    this.camPull += (depth - this.camPull) * Math.min(1, dt * 2);
    const back = (portrait ? 9.5 : 8.5) + this.camPull * 0.9;
    const up = (portrait ? 10 : 7.4) + this.camPull * 0.6;
    const shake = fx.shake;
    const sx = shake ? (Math.random() - 0.5) * shake * 0.5 : 0;
    const sy = shake ? (Math.random() - 0.5) * shake * 0.35 : 0;
    this.camera.position.set(this.camX + sx, up + sy, -w.z + back);
    // on a tall screen, aim nearer so the road fills more of it than the sky
    this.camera.lookAt(this.camX * 0.6 + sx, 0, -w.z - (portrait ? 9 : 13));

    this.sun.position.set(-8 + this.camX, 22, -w.z + 12);
    this.sun.target.position.set(this.camX, 0, -w.z - 8);
    const grass = this.scene.getObjectByName("grass");
    if (grass) grass.position.z = -w.z - 60;
    this.sky.position.copy(this.camera.position);
    this.hills.position.set(this.camera.position.x, 0, this.camera.position.z);

    this.renderer.render(this.scene, this.camera);
  }

  /** Screen position in CSS pixels of a road point (x road units, z metres, h metres up). */
  project(x: number, z: number, h: number) {
    _v.set(x * ROAD, h, -z).project(this.camera);
    return {
      x: ((_v.x + 1) / 2) * this.width,
      y: ((1 - _v.y) / 2) * this.height,
      visible: _v.z < 1 && _v.z > -1,
    };
  }

  dispose() {
    this.disposed = true;
    this.clearLevel();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh) {
        o.geometry.dispose();
        const m = o.material;
        (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose());
      }
    });
    this.scene.environment?.dispose();
    this.renderer.dispose();
  }
}

function checker() {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 16;
  const ctx = c.getContext("2d");
  if (ctx)
    for (let x = 0; x < 16; x++)
      for (let y = 0; y < 2; y++) {
        ctx.fillStyle = (x + y) % 2 ? "#ffffff" : "#20232c";
        ctx.fillRect(x * 8, y * 8, 8, 8);
      }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}
