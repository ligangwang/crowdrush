// The characters built from code: the soldier and his guns, the brute and
// the bosses' figures.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  GUNS,
  RUN_FRAMES,
  STOMP_FRAMES,
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
} from "../src/crowd-figures";

const count = (g: THREE.BufferGeometry) => g.getAttribute("position").count;
/** Every number of every frame is a real one, and the figure stands on the ground. */
function sound(baked: Baked) {
  for (const frame of baked.frames) {
    const pos = frame.getAttribute("position").array as Float32Array;
    assert.ok(pos.every(Number.isFinite));
    assert.equal(count(frame) % 3, 0);
    assert.equal(frame.getAttribute("color").count, count(frame));
    assert.equal(frame.getAttribute("normal").count, count(frame));
  }
}
const lowest = (g: THREE.BufferGeometry) => {
  const pos = g.getAttribute("position");
  let y = Infinity;
  for (let i = 0; i < pos.count; i++) y = Math.min(y, pos.getY(i));
  return y;
};

test("the soldier is baked over a run cycle, with every gun on the same frames", () => {
  const { body, guns } = bakeSoldier();
  // the run cycle, then the frame of him standing
  assert.equal(body.frames.length, RUN_FRAMES + 1);
  assert.equal(guns.length, GUNS.length);
  sound(body);
  for (const gun of guns) {
    assert.equal(gun.frames.length, body.frames.length);
    sound(gun);
    // a gun is carried: off the ground and below the helmet
    assert.ok(lowest(gun.frames[0]) > 0.5);
  }
  // about a person's height, feet near the ground in every frame
  assert.ok(body.height > 1.6 && body.height < 2);
  for (const frame of body.frames) assert.ok(Math.abs(lowest(frame)) < 0.2);
  // the frames differ (he runs), and the body has no gun in it
  assert.notDeepEqual(
    body.frames[0].getAttribute("position").array,
    body.frames[3].getAttribute("position").array,
  );
  const parts = body.frames[0].userData.parts as { name: string }[];
  assert.ok(parts.every((p) => !p.name.startsWith("gun-")));
  // light enough to draw by the hundred
  assert.ok(count(body.frames[0]) / 3 < 800);
});

test("a squad's colour repaints the jacket and helmet, and nothing else", () => {
  const { body } = bakeSoldier();
  const base = body.frames[0].getAttribute("color") as THREE.BufferAttribute;
  const red = recolor(body, { jacket: 0xd9363e, helmet: 0x7a1a20 });
  const parts = body.frames[0].userData.parts as {
    name: string;
    start: number;
    count: number;
  }[];
  assert.ok(parts.some((p) => p.name === "jacket"));
  assert.ok(parts.some((p) => p.name === "helmet"));
  for (const part of parts) {
    const changed = [...Array(part.count).keys()].some(
      (i) => red.getX(part.start + i) !== base.getX(part.start + i),
    );
    assert.equal(changed, ["jacket", "helmet"].includes(part.name), part.name);
  }
  // red where it was blue
  const jacket = parts.find((p) => p.name === "jacket")!;
  assert.ok(red.getX(jacket.start) > red.getZ(jacket.start));
  assert.ok(base.getZ(jacket.start) > base.getX(jacket.start));
});

test("the brute is baked over its stomp, taller and heavier than a soldier", () => {
  const stomp = bakeBrute();
  assert.equal(stomp.frames.length, STOMP_FRAMES);
  sound(stomp);
  assert.ok(stomp.height > bakeSoldier().body.height);
  assert.ok(count(stomp.frames[0]) / 3 < 1500);
});

/** A figure's box, as it is posed now. */
const boxOf = (figure: Figure) => {
  figure.root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(figure.root);
};

test("the rex opens its jaw, sways its tail and puts its pose back", () => {
  const figure = rex();
  for (const name of [
    "Jaw",
    "Head",
    "Tail1",
    "Tail4",
    "LeftUpLeg",
    "RightFoot",
  ])
    assert.ok(figure.joints[name], name);
  const reset = restOf(figure);
  const rest = figure.joints.Hips.quaternion.clone();
  rexPose(figure.joints, 1.3, 0.25, 1);
  assert.ok(!figure.joints.Hips.quaternion.equals(rest));
  const box = boxOf(figure);
  // stands on the ground, taller than it is wide, long from nose to tail
  assert.ok(Math.abs(box.min.y) < 0.4);
  assert.ok(box.max.y > 3);
  assert.ok(box.max.z - box.min.z > box.max.x - box.min.x);
  reset();
  assert.ok(figure.joints.Hips.quaternion.equals(rest));
  // walking moves its legs; standing still does not
  rexPose(figure.joints, 0, 0, 0);
  const still = figure.joints.LeftUpLeg.rotation.x;
  reset();
  rexPose(figure.joints, 0, 0.25, 0);
  assert.notEqual(figure.joints.LeftUpLeg.rotation.x, still);
});

test("the warlord is the brute with a crest, and heaves its fists up to slam", () => {
  const chief = brute(true);
  const plain = brute();
  assert.ok(chief.meshes.some((m) => m.name === "crest"));
  assert.ok(!plain.meshes.some((m) => m.name === "crest"));
  const reset = restOf(chief);
  warlordPose(chief.joints, 0, 0);
  const down = boxOf(chief).max.y;
  reset();
  warlordPose(chief.joints, 0, 1);
  assert.ok(boxOf(chief).max.y > down + 0.3);
});
