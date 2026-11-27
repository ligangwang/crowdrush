/**
 * Crowd Rush's characters, built from code: the squad's soldier and his
 * three guns, the brute, and the dinosaur boss. No model files: each is a
 * small tree of joints with plain low-poly shapes hung on them, coloured
 * per vertex and drawn flat-shaded.
 *
 * The soldier and the brute are drawn hundreds at a time, so their run and
 * stomp cycles are baked: each figure is posed at every phase of its cycle
 * and its shapes are merged into one plain geometry per frame. A runner
 * then picks the frame for its point in the cycle, and every runner on the
 * same frame shares one draw call. The bosses are single figures, posed
 * live each frame.
 *
 * Every figure stands on y = 0 and faces +Z.
 */
import * as THREE from "three";

/** Baked frames: one geometry per phase of a cycle, and the figure's height. */
export type Baked = {
  frames: THREE.BufferGeometry[];
  height: number;
};

export type Joints = Record<string, THREE.Object3D>;
export type Pose = (j: Joints, phase: number) => void;

/** A jointed figure: its root, its joints by name, and its shapes. */
export type Figure = {
  root: THREE.Group;
  joints: Joints;
  meshes: THREE.Mesh[];
};

const TAU = Math.PI * 2;
const _v = new THREE.Vector3();
const _c = new THREE.Color();

// ---------------------------------------------------------------------------
// Shapes. Each is a non-indexed geometry with a colour per vertex, shaded a
// little darker toward its underside so flat colours still read as solid.

function paint(
  geo: THREE.BufferGeometry,
  color: THREE.ColorRepresentation,
  shade = 0.22,
) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute("uv");
  g.deleteAttribute("normal");
  const pos = g.getAttribute("position");
  g.computeBoundingBox();
  const { min, max } = g.boundingBox!;
  const span = Math.max(1e-6, max.y - min.y);
  const out = new Float32Array(pos.count * 3);
  _c.set(color);
  for (let i = 0; i < pos.count; i++) {
    const k = 1 - shade * (1 - (pos.getY(i) - min.y) / span);
    out[i * 3] = _c.r * k;
    out[i * 3 + 1] = _c.g * k;
    out[i * 3 + 2] = _c.b * k;
  }
  g.setAttribute("color", new THREE.BufferAttribute(out, 3));
  return g;
}

/** A box, optionally narrower at the top (`top` scales its upper face). */
function box(
  w: number,
  h: number,
  d: number,
  color: THREE.ColorRepresentation,
  top = 1,
  topD = top,
) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (top !== 1 || topD !== 1) {
    const p = g.getAttribute("position");
    for (let i = 0; i < p.count; i++)
      if (p.getY(i) > 0)
        p.setXYZ(i, p.getX(i) * top, p.getY(i), p.getZ(i) * topD);
  }
  return paint(g, color);
}
/** A tube along Y, `sides` round, from radius `r0` (bottom) to `r1` (top). */
const tube = (
  r0: number,
  r1: number,
  h: number,
  color: THREE.ColorRepresentation,
  sides = 6,
) => paint(new THREE.CylinderGeometry(r1, r0, h, sides), color);
const ball = (
  r: number,
  color: THREE.ColorRepresentation,
  detail = 1,
  shade = 0.22,
) => paint(new THREE.IcosahedronGeometry(r, detail), color, shade);
const cone = (
  r: number,
  h: number,
  color: THREE.ColorRepresentation,
  sides = 5,
) => paint(new THREE.ConeGeometry(r, h, sides), color, 0.1);
/** The top half of a ball: a helmet or a shoulder pad. */
const dome = (r: number, color: THREE.ColorRepresentation) =>
  paint(new THREE.SphereGeometry(r, 8, 4, 0, TAU, 0, Math.PI / 2), color, 0.3);

// ---------------------------------------------------------------------------
// Building a figure.

class Builder {
  readonly figure: Figure = {
    root: new THREE.Group(),
    joints: {},
    meshes: [],
  };
  /** A joint named `name` under `parent` (a joint's name, or the root). */
  joint(name: string, parent: string | null, x = 0, y = 0, z = 0) {
    const j = new THREE.Object3D();
    j.name = name;
    j.position.set(x, y, z);
    (parent ? this.figure.joints[parent] : this.figure.root).add(j);
    this.figure.joints[name] = j;
    return j;
  }
  /**
   * Hangs a shape on a joint. Shapes that share a `name` are one part when
   * a figure is recoloured or split (the soldier's jacket, his gun).
   */
  add(
    joint: string,
    name: string,
    geo: THREE.BufferGeometry,
    x = 0,
    y = 0,
    z = 0,
    rx = 0,
    ry = 0,
    rz = 0,
    scale: [number, number, number] = [1, 1, 1],
  ) {
    const mesh = new THREE.Mesh(geo);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    mesh.scale.set(...scale);
    this.figure.joints[joint].add(mesh);
    this.figure.meshes.push(mesh);
    return mesh;
  }
}

/** Remembers a figure's rest pose, and puts it back. */
export function restOf(figure: Figure) {
  const rest = Object.values(figure.joints).map((joint) => ({
    joint,
    p: joint.position.clone(),
    q: joint.quaternion.clone(),
  }));
  return () => {
    for (const r of rest) {
      r.joint.position.copy(r.p);
      r.joint.quaternion.copy(r.q);
    }
  };
}

/**
 * Poses a figure at each phase and merges its shapes into one plain
 * geometry per frame, with flat normals and vertex colours. `keep` picks
 * the parts to bake (all of them by default). Every frame's `userData.parts`
 * lists where each part's vertices are, for `recolor`.
 */
export function bake(
  figure: Figure,
  pose: Pose,
  phases: number[],
  keep: (name: string) => boolean = () => true,
): Baked {
  const meshes = figure.meshes.filter((m) => keep(m.name));
  const total = meshes.reduce(
    (n, m) => n + m.geometry.getAttribute("position").count,
    0,
  );
  const colors = new Float32Array(total * 3);
  const parts: { name: string; start: number; count: number }[] = [];
  let o = 0;
  for (const m of meshes) {
    const col = m.geometry.getAttribute("color");
    colors.set(col.array as Float32Array, o * 3);
    parts.push({ name: m.name, start: o, count: col.count });
    o += col.count;
  }
  const colorAttr = new THREE.BufferAttribute(colors, 3);
  const reset = restOf(figure);
  let height = 0;
  const frames = phases.map((phase) => {
    reset();
    pose(figure.joints, phase);
    figure.root.updateMatrixWorld(true);
    const pos = new Float32Array(total * 3);
    let k = 0;
    for (const m of meshes) {
      const p = m.geometry.getAttribute("position");
      for (let i = 0; i < p.count; i++) {
        _v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
        pos[k++] = _v.x;
        pos[k++] = _v.y;
        pos[k++] = _v.z;
        if (_v.y > height) height = _v.y;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", colorAttr);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    geo.userData.parts = parts;
    return geo;
  });
  reset();
  figure.root.updateMatrixWorld(true);
  return { frames, height };
}

/**
 * A copy of the baked colours with some parts recoloured, keeping their
 * shading: each vertex keeps its brightness relative to the part's average.
 */
export function recolor(
  baked: Baked,
  tint: Record<string, THREE.ColorRepresentation>,
): THREE.BufferAttribute {
  const base = baked.frames[0].getAttribute("color") as THREE.BufferAttribute;
  const out = new Float32Array(base.array as Float32Array);
  const parts = baked.frames[0].userData.parts as {
    name: string;
    start: number;
    count: number;
  }[];
  const lum = (i: number) =>
    out[i * 3] * 0.3 + out[i * 3 + 1] * 0.59 + out[i * 3 + 2] * 0.11;
  for (const part of parts) {
    const want = tint[part.name];
    if (want === undefined) continue;
    const c = new THREE.Color(want);
    let avg = 0;
    for (let i = part.start; i < part.start + part.count; i++) avg += lum(i);
    avg = Math.max(0.0001, avg / part.count);
    for (let i = part.start; i < part.start + part.count; i++) {
      const k = Math.min(1.6, lum(i) / avg);
      out[i * 3] = c.r * k;
      out[i * 3 + 1] = c.g * k;
      out[i * 3 + 2] = c.b * k;
    }
  }
  return new THREE.BufferAttribute(out, 3);
}

// ---------------------------------------------------------------------------
// The soldier.

/** The squad's guns, one per damage level. */
export const GUNS = ["rifle", "cannon", "launcher"] as const;
export type Gun = (typeof GUNS)[number];
/** The part every shape of a gun belongs to. */
const gunPart = (gun: Gun) => `gun-${gun}`;

const SKIN = 0xf0c39a;
const STEEL = 0x2a2f38;

/**
 * The soldier: jacket and helmet in the team's colour (the parts "jacket"
 * and "helmet", which `recolor` repaints), a pack on his back, and all
 * three guns in his hands at once: a frame set is baked for his body and
 * one for each gun, so the squad can change guns as it upgrades.
 */
export function soldier(): Figure {
  const b = new Builder();
  const jacket = 0x3b7fd4;
  const trousers = 0x4a4f45;
  const boots = 0x23211f;
  b.joint("Hips", null, 0, 0.9, 0);
  b.joint("Spine", "Hips", 0, 0.06, 0);
  b.joint("Head", "Spine", 0, 0.56, 0);
  // hips, belt and chest
  b.add("Hips", "trousers", box(0.34, 0.2, 0.22, trousers), 0, -0.02, 0);
  b.add("Spine", "belt", box(0.37, 0.07, 0.25, 0x2c2a26), 0, 0.02, 0);
  b.add("Spine", "jacket", box(0.36, 0.5, 0.24, jacket, 1.2, 1.05), 0, 0.3, 0);
  b.add("Spine", "pouch", box(0.1, 0.1, 0.06, 0x5b5f4c), -0.1, 0.1, 0.14);
  b.add("Spine", "pouch", box(0.1, 0.1, 0.06, 0x5b5f4c), 0.1, 0.1, 0.14);
  // a small pack low on the back, so the jacket's colour shows from behind
  b.add("Spine", "pack", box(0.22, 0.2, 0.1, 0x5b5f4c, 0.9), 0, 0.2, -0.17);
  // head and helmet
  b.add("Head", "skin", tube(0.06, 0.06, 0.08, SKIN), 0, 0.02, 0);
  b.add("Head", "skin", ball(0.125, SKIN), 0, 0.17, 0.005);
  b.add(
    "Head",
    "helmet",
    dome(0.15, jacket),
    0,
    0.17,
    0,
    0,
    0,
    0,
    [1, 0.95, 1.08],
  );
  b.add("Head", "helmet", box(0.3, 0.035, 0.36, jacket), 0, 0.175, 0.01);
  b.add("Head", "strap", box(0.26, 0.03, 0.03, 0x2c2a26), 0, 0.11, 0.1);
  for (const [side, s] of [
    ["Left", 1],
    ["Right", -1],
  ] as const) {
    // an arm: shoulder, sleeve, forearm and hand
    b.joint(`${side}Arm`, "Spine", s * 0.25, 0.5, 0);
    b.joint(`${side}ForeArm`, `${side}Arm`, 0, -0.27, 0);
    b.add(`${side}Arm`, "jacket", ball(0.085, jacket, 0), 0, 0, 0);
    b.add(`${side}Arm`, "jacket", box(0.11, 0.28, 0.12, jacket), 0, -0.14, 0);
    b.add(`${side}ForeArm`, "jacket", box(0.095, 0.2, 0.1, jacket), 0, -0.1, 0);
    b.add(`${side}ForeArm`, "skin", box(0.08, 0.09, 0.09, SKIN), 0, -0.24, 0);
    // a leg: thigh, knee, shin and boot
    b.joint(`${side}UpLeg`, "Hips", s * 0.095, -0.08, 0);
    b.joint(`${side}Leg`, `${side}UpLeg`, 0, -0.4, 0);
    b.add(
      `${side}UpLeg`,
      "trousers",
      box(0.15, 0.42, 0.17, trousers, 1.08),
      0,
      -0.2,
      0,
    );
    b.add(
      `${side}Leg`,
      "trousers",
      box(0.12, 0.3, 0.14, trousers),
      0,
      -0.14,
      0,
    );
    b.add(`${side}Leg`, "boots", box(0.13, 0.14, 0.15, boots), 0, -0.34, 0);
    b.add(`${side}Leg`, "boots", box(0.13, 0.09, 0.26, boots), 0, -0.375, 0.06);
  }
  // The guns ride on the chest, so they stay level while the legs run.
  b.joint("Gun", "Spine", -0.13, 0.27, 0.2);
  addRifle(b);
  addCannon(b);
  addLauncher(b);
  return b.figure;
}

/** Shapes lying along Z (a gun's barrel) are tubes turned on their side. */
const ALONG_Z = Math.PI / 2;

function addRifle(b: Builder) {
  const p = gunPart("rifle");
  const wood = 0x7a4a26;
  b.add("Gun", p, box(0.055, 0.1, 0.42, STEEL), 0, 0, 0.08);
  b.add("Gun", p, tube(0.016, 0.016, 0.34, 0x3a404b), 0, 0.02, 0.44, ALONG_Z);
  b.add("Gun", p, box(0.05, 0.11, 0.22, wood, 0.9, 0.8), 0, -0.025, -0.22);
  b.add("Gun", p, box(0.045, 0.16, 0.07, STEEL), 0, -0.12, 0.1, 0.25);
  b.add("Gun", p, box(0.05, 0.05, 0.2, wood), 0, -0.03, 0.34);
  b.add("Gun", p, box(0.02, 0.04, 0.03, STEEL), 0, 0.07, 0.24);
  b.add("Gun", p, box(0.02, 0.04, 0.03, STEEL), 0, 0.055, 0.58);
}

function addCannon(b: Builder) {
  const p = gunPart("cannon");
  const brass = 0xd9a441;
  // six barrels round one axle, a drum behind them and an ammo box below
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    b.add(
      "Gun",
      p,
      tube(0.017, 0.017, 0.5, 0x4a5160, 5),
      Math.cos(a) * 0.045,
      Math.sin(a) * 0.045,
      0.4,
      ALONG_Z,
    );
  }
  b.add("Gun", p, tube(0.07, 0.07, 0.03, brass, 8), 0, 0, 0.62, ALONG_Z);
  b.add("Gun", p, tube(0.07, 0.07, 0.03, brass, 8), 0, 0, 0.3, ALONG_Z);
  b.add("Gun", p, tube(0.085, 0.085, 0.26, STEEL, 8), 0, 0, 0.03, ALONG_Z);
  b.add("Gun", p, box(0.1, 0.13, 0.16, 0x4e5a3a), 0.02, -0.14, 0.04);
  b.add("Gun", p, box(0.03, 0.05, 0.2, STEEL), 0, 0.1, 0.03);
  b.add("Gun", p, box(0.05, 0.08, 0.14, STEEL), 0, -0.02, -0.17);
}

function addLauncher(b: Builder) {
  const p = gunPart("launcher");
  const green = 0x55683a;
  // carried on the shoulder: a long tube, flared at the back, rocket showing
  const y = 0.2;
  const x = 0.03;
  b.add("Gun", p, tube(0.07, 0.07, 0.8, green, 8), x, y, 0.02, ALONG_Z);
  b.add("Gun", p, tube(0.078, 0.078, 0.06, 0x3c4a28, 8), x, y, 0.4, ALONG_Z);
  b.add("Gun", p, tube(0.105, 0.07, 0.14, 0x3c4a28, 8), x, y, -0.44, -ALONG_Z);
  b.add("Gun", p, cone(0.062, 0.2, 0xd8342c, 8), x, y, 0.52, ALONG_Z);
  b.add("Gun", p, tube(0.06, 0.06, 0.05, 0xe8e2d0, 8), x, y, 0.435, ALONG_Z);
  b.add("Gun", p, box(0.04, 0.13, 0.05, STEEL), x, y - 0.12, 0.12);
  b.add("Gun", p, box(0.04, 0.1, 0.05, STEEL), x, y - 0.1, 0.3);
  b.add("Gun", p, box(0.03, 0.07, 0.1, STEEL), x - 0.05, y + 0.09, 0.14);
}

/** Both hands on the gun: the right at its grip, the left under the barrel. */
function holdGun(j: Joints) {
  j.RightArm.rotation.set(-0.35, 0, -0.18);
  j.RightForeArm.rotation.set(-1.25, 0, 0.5);
  j.LeftArm.rotation.set(-0.95, 0, 0.42);
  j.LeftForeArm.rotation.set(-0.75, 0, -0.75);
}
/** The soldier running: a full stride for each turn of `p` from 0 to 1. */
export const runPose: Pose = (j, p) => {
  const s = Math.sin(p * TAU);
  const c = Math.cos(p * TAU);
  j.LeftUpLeg.rotation.x = -0.85 * s - 0.1;
  j.RightUpLeg.rotation.x = 0.85 * s - 0.1;
  j.LeftLeg.rotation.x = 0.25 + 1.0 * Math.max(0, c);
  j.RightLeg.rotation.x = 0.25 + 1.0 * Math.max(0, -c);
  j.Hips.position.y += Math.abs(c) * 0.05 - 0.03;
  j.Spine.rotation.x = 0.2;
  j.Spine.rotation.y = 0.1 * s;
  j.Head.rotation.x = -0.12;
  j.Head.rotation.y = -0.08 * s;
  holdGun(j);
  j.Gun.rotation.x = -0.12;
};
/** The soldier standing ready. */
export const standPose: Pose = (j) => {
  j.LeftUpLeg.rotation.z = 0.07;
  j.RightUpLeg.rotation.z = -0.07;
  j.Spine.rotation.x = 0.04;
  holdGun(j);
};

/** How many frames the run cycle has; one more, the last, is him standing. */
export const RUN_FRAMES = 10;

/**
 * The soldier baked for the squad: his body over a run cycle with the
 * standing frame last, and each gun over the same frames, so frame i of a
 * gun lines up with frame i of the body.
 */
export function bakeSoldier() {
  const figure = soldier();
  const phases = [
    ...Array.from({ length: RUN_FRAMES }, (_, i) => i / RUN_FRAMES),
    -1,
  ];
  const pose: Pose = (j, p) => (p < 0 ? standPose(j, 0) : runPose(j, p));
  const body = bake(figure, pose, phases, (name) => !name.startsWith("gun-"));
  const guns = GUNS.map((gun) =>
    bake(figure, pose, phases, (name) => name === gunPart(gun)),
  );
  return { body, guns };
}

// ---------------------------------------------------------------------------
// The brute.

/**
 * The brute: a hunched green ogre, all shoulders and fists, with tusks, a
 * horned iron cap and spiked shoulder plates. `chief` adds the warlord's
 * crest and cloak for the boss built from the same figure.
 */
export function brute(chief = false): Figure {
  const b = new Builder();
  const hide = 0x6f9a3c;
  const dark = 0x4f7430;
  const iron = 0x4a4c55;
  const leather = 0x6b4526;
  const bone = 0xf2ead2;
  b.joint("Hips", null, 0, 0.78, 0);
  b.joint("Spine", "Hips", 0, 0.1, 0);
  b.joint("Head", "Spine", 0, 0.78, 0.2);
  b.add("Hips", "cloth", box(0.7, 0.34, 0.5, leather, 1.1), 0, 0, 0);
  b.add("Hips", "cloth", box(0.3, 0.4, 0.06, 0x8a5a30), 0, -0.2, 0.27);
  b.add("Spine", "belt", box(0.8, 0.1, 0.56, 0x2e2a26), 0, 0.06, 0);
  b.add("Spine", "belt", box(0.16, 0.14, 0.04, 0xd9a441), 0, 0.06, 0.29);
  // a barrel of a chest, broad at the shoulders, leaning forward
  b.add("Spine", "hide", box(0.78, 0.8, 0.56, hide, 1.45, 1.15), 0, 0.5, 0.02);
  b.add(
    "Spine",
    "belly",
    ball(0.3, 0x9ab85c, 1),
    0,
    0.3,
    0.22,
    0,
    0,
    0,
    [1.15, 1, 0.6],
  );
  b.add(
    "Spine",
    "hide",
    ball(0.3, dark, 0),
    0,
    0.82,
    -0.12,
    0,
    0,
    0,
    [1.6, 0.8, 1],
  );
  // head sunk between the shoulders: heavy jaw, tusks, small red eyes
  b.add("Head", "hide", ball(0.24, hide, 1), 0, 0.14, 0, 0, 0, 0, [1, 0.95, 1]);
  b.add("Head", "hide", box(0.36, 0.16, 0.3, dark, 0.85), 0, 0, 0.06);
  b.add("Head", "brow", box(0.36, 0.06, 0.1, dark), 0, 0.2, 0.19, 0.3);
  for (const s of [-1, 1]) {
    b.add("Head", "eye", ball(0.035, 0xff4a2a, 0, 0), s * 0.09, 0.15, 0.215);
    b.add("Head", "tusk", cone(0.04, 0.16, bone), s * 0.13, 0.1, 0.2, -0.15);
    b.add(
      "Head",
      "ear",
      cone(0.05, 0.18, hide, 4),
      s * 0.27,
      0.16,
      -0.02,
      0,
      0,
      -s * 1.2,
    );
    b.add(
      "Head",
      "horn",
      cone(0.05, 0.24, bone),
      s * 0.17,
      0.42,
      0,
      0,
      0,
      -s * 0.5,
    );
  }
  b.add(
    "Head",
    "iron",
    dome(0.25, iron),
    0,
    0.17,
    -0.01,
    0,
    0,
    0,
    [1, 0.85, 1],
  );
  if (chief) {
    // the warlord's crest and cloak
    for (let i = 0; i < 5; i++)
      b.add(
        "Head",
        "crest",
        cone(0.05, 0.34 - Math.abs(i - 2) * 0.05, 0xd8342c, 4),
        0,
        0.5 - Math.abs(i - 2) * 0.03,
        0.14 - i * 0.08,
        -0.3 + i * 0.15,
      );
    b.add(
      "Spine",
      "cloak",
      box(0.9, 1.3, 0.06, 0x7a1a20, 0.8),
      0,
      0.25,
      -0.34,
      0.12,
    );
  }
  for (const [side, s] of [
    ["Left", 1],
    ["Right", -1],
  ] as const) {
    // long arms: plated shoulder, thick forearm, a fist like a boulder
    b.joint(`${side}Arm`, "Spine", s * 0.64, 0.78, 0);
    b.joint(`${side}ForeArm`, `${side}Arm`, 0, -0.46, 0);
    b.add(
      `${side}Arm`,
      "iron",
      dome(0.24, iron),
      s * 0.02,
      0.02,
      0,
      0,
      0,
      -s * 0.35,
    );
    for (const k of [-1, 0, 1])
      b.add(
        `${side}Arm`,
        "spike",
        cone(0.045, 0.2, bone, 4),
        s * (0.1 + (k === 0 ? 0.03 : 0)),
        0.26,
        k * 0.12,
        k * 0.35,
        0,
        -s * 0.45,
      );
    b.add(`${side}Arm`, "hide", box(0.24, 0.5, 0.26, hide, 1.15), 0, -0.22, 0);
    b.add(
      `${side}ForeArm`,
      "hide",
      box(0.22, 0.44, 0.24, dark, 0.85),
      0,
      -0.2,
      0,
    );
    b.add(`${side}ForeArm`, "band", box(0.26, 0.12, 0.28, leather), 0, -0.3, 0);
    b.add(`${side}ForeArm`, "hide", ball(0.2, hide, 0), 0, -0.52, 0.02);
    // short bowed legs and broad feet
    b.joint(`${side}UpLeg`, "Hips", s * 0.24, -0.1, 0);
    b.joint(`${side}Leg`, `${side}UpLeg`, 0, -0.32, 0);
    b.add(`${side}UpLeg`, "hide", box(0.28, 0.4, 0.3, dark, 1.1), 0, -0.14, 0);
    b.add(`${side}Leg`, "hide", box(0.22, 0.3, 0.24, hide), 0, -0.14, 0);
    b.add(`${side}Leg`, "foot", box(0.26, 0.12, 0.4, dark), 0, -0.3, 0.08);
    for (const k of [-1, 0, 1])
      b.add(
        `${side}Leg`,
        "claw",
        cone(0.03, 0.1, bone, 4),
        k * 0.08,
        -0.33,
        0.3,
        ALONG_Z,
      );
  }
  return b.figure;
}

/** The brute stomping forward, fists swinging. */
export const stompPose: Pose = (j, p) => {
  const s = Math.sin(p * TAU);
  const c = Math.cos(p * TAU);
  j.LeftUpLeg.rotation.x = -0.55 * s;
  j.RightUpLeg.rotation.x = 0.55 * s;
  j.LeftLeg.rotation.x = 0.1 + 0.6 * Math.max(0, c);
  j.RightLeg.rotation.x = 0.1 + 0.6 * Math.max(0, -c);
  j.Hips.position.y += Math.abs(c) * 0.06 - 0.04;
  j.Hips.rotation.z = 0.05 * s;
  j.Spine.rotation.x = 0.28;
  j.Spine.rotation.y = -0.12 * s;
  j.Head.rotation.x = -0.15;
  j.LeftArm.rotation.set(0.6 * s - 0.2, 0, 0.22);
  j.RightArm.rotation.set(-0.6 * s - 0.2, 0, -0.22);
  j.LeftForeArm.rotation.x = -0.45 - 0.2 * Math.max(0, s);
  j.RightForeArm.rotation.x = -0.45 - 0.2 * Math.max(0, -s);
};

/** How many frames the brute's stomp cycle has. */
export const STOMP_FRAMES = 8;
/** The brute baked over its stomp cycle. */
export const bakeBrute = () =>
  bake(
    brute(),
    stompPose,
    Array.from({ length: STOMP_FRAMES }, (_, i) => i / STOMP_FRAMES),
  );

/**
 * The warlord: the brute's stride, and for each slam both fists heaved
 * overhead and hammered down. `walk` is the stride's phase and `lift` how
 * far the arms are raised (0 to 1).
 */
export const warlordPose = (j: Joints, walk: number, lift: number) => {
  stompPose(j, walk);
  for (const [arm, s] of [
    [j.LeftArm, 1],
    [j.RightArm, -1],
  ] as const) {
    arm.rotation.x -= lift * 2.5;
    arm.rotation.z += s * lift * 0.25;
  }
  j.LeftForeArm.rotation.x -= lift * 0.5;
  j.RightForeArm.rotation.x -= lift * 0.5;
  j.Spine.rotation.x -= lift * 0.4;
};

// ---------------------------------------------------------------------------
// The dinosaur.

/**
 * The rex: a two-legged dinosaur with a heavy head, a jaw that opens (the
 * joint "Jaw"), small arms and a long tail (joints "Tail1" to "Tail4").
 */
export function rex(): Figure {
  const b = new Builder();
  const hide = 0x5d8a3a;
  const dark = 0x3f6a2c;
  const belly = 0xd9cf9a;
  const bone = 0xf6f0dc;
  b.joint("Hips", null, 0, 2.05, 0);
  b.joint("Chest", "Hips", 0, 0.1, 0.7);
  b.joint("Neck", "Chest", 0, 0.35, 0.7);
  b.joint("Head", "Neck", 0, 0.55, 0.45);
  b.joint("Jaw", "Head", 0, -0.12, -0.1);
  // body: hips and chest as two stretched balls, with a pale underside
  b.add("Hips", "hide", ball(0.92, hide, 1), 0, 0, 0, 0, 0, 0, [0.95, 1, 1.35]);
  b.add(
    "Hips",
    "belly",
    ball(0.7, belly, 1),
    0,
    -0.32,
    0.2,
    0,
    0,
    0,
    [0.9, 0.8, 1.5],
  );
  b.add(
    "Chest",
    "hide",
    ball(0.8, hide, 1),
    0,
    0.05,
    0.1,
    0,
    0,
    0,
    [0.9, 0.95, 1.25],
  );
  b.add(
    "Chest",
    "belly",
    ball(0.6, belly, 1),
    0,
    -0.24,
    0.25,
    0,
    0,
    0,
    [0.85, 0.8, 1.2],
  );
  b.add("Neck", "hide", tube(0.56, 0.4, 0.95, hide, 7), 0, 0.2, 0.12, 0.75);
  // a ridge of plates down the back, from the shoulders to the tail
  for (let i = 0; i < 4; i++)
    b.add(
      "Hips",
      "plate",
      cone(0.17, 0.46, dark, 4),
      0,
      0.98 - Math.abs(i - 1.5) * 0.09,
      0.75 - i * 0.5,
      -0.25,
    );
  for (let i = 0; i < 3; i++)
    b.add(
      "Chest",
      "plate",
      cone(0.15, 0.4 - i * 0.05, dark, 4),
      0,
      0.78 - i * 0.12,
      0.1 + i * 0.42,
      0.2 + i * 0.25,
    );
  // head: skull, snout, brow ridges, eyes, teeth in both jaws
  b.add("Head", "hide", box(0.62, 0.5, 0.7, hide, 0.82), 0, 0.14, 0.05);
  b.add("Head", "hide", box(0.5, 0.34, 0.75, hide, 0.8, 0.9), 0, 0.06, 0.68);
  b.add("Head", "plate", box(0.36, 0.06, 0.14, dark), 0, 0.26, 0.95);
  b.add("Jaw", "jaw", box(0.48, 0.16, 1.1, dark, 1.08), 0, -0.1, 0.52);
  b.add("Jaw", "mouth", box(0.36, 0.03, 0.9, 0xb23a48), 0, -0.01, 0.55);
  for (const s of [-1, 1]) {
    b.add(
      "Head",
      "brow",
      box(0.12, 0.12, 0.34, dark),
      s * 0.24,
      0.38,
      0.2,
      0.2,
    );
    b.add("Head", "eye", ball(0.07, 0xffd23a, 0, 0), s * 0.27, 0.27, 0.24);
    b.add("Head", "pupil", ball(0.035, 0x1a1a1a, 0, 0), s * 0.31, 0.27, 0.27);
    b.add(
      "Head",
      "nostril",
      box(0.04, 0.04, 0.06, 0x2a3a1c),
      s * 0.12,
      0.2,
      1.03,
    );
    for (let i = 0; i < 5; i++) {
      const z = 0.3 + i * 0.17;
      b.add(
        "Head",
        "teeth",
        cone(0.035, 0.14, bone, 4),
        s * (0.23 - i * 0.012),
        -0.14,
        z,
        Math.PI,
      );
      b.add(
        "Jaw",
        "teeth",
        cone(0.03, 0.11, bone, 4),
        s * (0.2 - i * 0.012),
        0.03,
        z - 0.02,
      );
    }
    // small arms with two claws
    b.joint(`${s > 0 ? "Left" : "Right"}Arm`, "Chest", s * 0.5, -0.25, 0.55);
    const arm = `${s > 0 ? "Left" : "Right"}Arm`;
    b.add(arm, "hide", box(0.14, 0.4, 0.16, dark, 1.2), 0, -0.16, 0.04, -0.5);
    b.add(arm, "hide", box(0.11, 0.3, 0.12, hide), 0, -0.32, 0.26, -1.5);
    for (const k of [-1, 1])
      b.add(arm, "claw", cone(0.03, 0.14, bone, 4), k * 0.04, -0.34, 0.45, 1.9);
    // legs: a great thigh, a shin angled back, a three-clawed foot
    const leg = s > 0 ? "Left" : "Right";
    b.joint(`${leg}UpLeg`, "Hips", s * 0.62, -0.05, 0.05);
    b.joint(`${leg}Leg`, `${leg}UpLeg`, 0, -0.95, 0.3);
    b.joint(`${leg}Foot`, `${leg}Leg`, 0, -0.9, -0.35);
    b.add(
      `${leg}UpLeg`,
      "hide",
      ball(0.58, hide, 1),
      0,
      -0.3,
      0.1,
      0.3,
      0,
      0,
      [0.66, 1.3, 1.05],
    );
    b.add(
      `${leg}Leg`,
      "hide",
      tube(0.2, 0.34, 1.0, dark, 7),
      0,
      -0.44,
      -0.17,
      -0.37,
    );
    b.add(`${leg}Foot`, "hide", ball(0.24, dark, 0), 0, 0.02, 0);
    b.add(`${leg}Foot`, "hide", box(0.5, 0.24, 0.8, dark, 0.8), 0, -0.08, 0.22);
    for (const k of [-1, 0, 1])
      b.add(
        `${leg}Foot`,
        "claw",
        cone(0.065, 0.28, bone, 4),
        k * 0.16,
        -0.12,
        0.7,
        ALONG_Z,
      );
  }
  // tail: four tapering lengths, each its own joint so it can sway
  const lengths = [0.95, 0.9, 0.85, 0.8];
  const radii = [0.7, 0.5, 0.33, 0.19, 0.05];
  let parent = "Hips";
  let at = -0.75;
  for (const [i, len] of lengths.entries()) {
    const name = `Tail${i + 1}`;
    b.joint(name, parent, 0, i === 0 ? 0.05 : 0, at);
    b.add(
      name,
      "hide",
      tube(radii[i], radii[i + 1], len, i % 2 ? dark : hide, 7),
      0,
      0,
      -len / 2,
      -ALONG_Z,
    );
    parent = name;
    at = -len;
  }
  return b.figure;
}

/**
 * How the rex stands and moves. `clock` runs all the time (breathing, the
 * tail's sway), `walk` is its stride's phase while it closes in (0 while it
 * stands still), and `lift` rises to 1 and back for each lunge.
 */
export function rexPose(j: Joints, clock: number, walk: number, lift: number) {
  const breath = Math.sin(clock * 1.8);
  const s = Math.sin(walk * TAU);
  const c = Math.cos(walk * TAU);
  const stride = walk ? 1 : 0;
  // reared up over its legs, head high, tail out behind as a balance
  const rear = 0.3 - lift * 0.2;
  j.Hips.rotation.x = -rear;
  j.Hips.position.y += breath * 0.03 + stride * Math.abs(c) * 0.08;
  j.Hips.rotation.z = stride * s * 0.04;
  j.Chest.rotation.x = -0.12 + breath * 0.02;
  j.Neck.rotation.x = -0.35 - lift * 0.25;
  j.Neck.rotation.y = Math.sin(clock * 0.9) * 0.12 * (1 - lift);
  j.Head.rotation.x = 0.55 + rear * 0.6 + lift * 0.2;
  j.Head.rotation.y = Math.sin(clock * 0.9 + 0.6) * 0.1 * (1 - lift);
  // the jaw hangs a little open and works as it breathes
  j.Jaw.rotation.x = 0.1 + Math.max(0, breath) * 0.08;
  for (const [leg, k] of [
    ["Left", 1],
    ["Right", -1],
  ] as const) {
    j[`${leg}UpLeg`].rotation.x = rear - 0.1 + stride * k * -0.5 * s;
    j[`${leg}Leg`].rotation.x = stride * 0.45 * Math.max(0, k * c);
    j[`${leg}Foot`].rotation.x = -stride * 0.3 * Math.max(0, k * c);
    j[`${leg}Arm`].rotation.x = Math.sin(clock * 2.4 + k) * 0.12 - lift * 0.6;
  }
  for (let i = 1; i <= 4; i++) {
    const tail = j[`Tail${i}`];
    tail.rotation.y = Math.sin(clock * 1.6 - i * 0.7) * 0.11 * i * 0.6;
    tail.rotation.x = (i === 1 ? rear * 0.8 : 0.05) + stride * s * 0.03;
  }
}
